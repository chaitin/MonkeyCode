package msgpush

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"sort"
	"strings"
)

// MsgCrypt 微信公众号安全模式消息加解密
type MsgCrypt struct {
	token  string
	aesKey []byte // 32 bytes, decoded from EncodingAESKey
	appID  string
}

// encryptedEnvelope 加密消息的 XML 信封（接收）
type encryptedEnvelope struct {
	XMLName    xml.Name `xml:"xml"`
	ToUserName string   `xml:"ToUserName"`
	Encrypt    string   `xml:"Encrypt"`
}

// encryptedReply 加密回复的 XML 信封
type encryptedReply struct {
	XMLName      xml.Name `xml:"xml"`
	Encrypt      string   `xml:"Encrypt"`
	MsgSignature string   `xml:"MsgSignature"`
	TimeStamp    string   `xml:"TimeStamp"`
	Nonce        string   `xml:"Nonce"`
}

// NewMsgCrypt 创建 MsgCrypt 实例
// encodingAESKey 是微信后台配置的 43 字符 base64 编码密钥
func NewMsgCrypt(token, encodingAESKey, appID string) (*MsgCrypt, error) {
	if len(encodingAESKey) != 43 {
		return nil, fmt.Errorf("invalid EncodingAESKey length: %d, expected 43", len(encodingAESKey))
	}

	aesKey, err := base64.StdEncoding.DecodeString(encodingAESKey + "=")
	if err != nil {
		return nil, fmt.Errorf("failed to decode EncodingAESKey: %w", err)
	}

	if len(aesKey) != 32 {
		return nil, fmt.Errorf("decoded AES key length: %d, expected 32", len(aesKey))
	}

	return &MsgCrypt{
		token:  token,
		aesKey: aesKey,
		appID:  appID,
	}, nil
}

// DecryptMessage 验签并解密 POST body，返回明文 XML
func (mc *MsgCrypt) DecryptMessage(msgSignature, timestamp, nonce string, body []byte) ([]byte, error) {
	var env encryptedEnvelope
	if err := xml.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("failed to unmarshal encrypted envelope: %w", err)
	}

	// 验签（常量时间比较，防时序攻击）
	sig := calcMsgSignature(mc.token, timestamp, nonce, env.Encrypt)
	if subtle.ConstantTimeCompare([]byte(sig), []byte(msgSignature)) != 1 {
		return nil, fmt.Errorf("message signature verification failed")
	}

	// 解密
	plaintext, err := mc.decrypt(env.Encrypt)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt message: %w", err)
	}

	return plaintext, nil
}

// EncryptMessage 加密回复 XML，返回加密信封 XML
func (mc *MsgCrypt) EncryptMessage(plainXML []byte, timestamp, nonce string) ([]byte, error) {
	encrypted, err := mc.encrypt(plainXML)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt message: %w", err)
	}

	sig := calcMsgSignature(mc.token, timestamp, nonce, encrypted)

	reply := encryptedReply{
		Encrypt:      encrypted,
		MsgSignature: sig,
		TimeStamp:    timestamp,
		Nonce:        nonce,
	}

	return xml.Marshal(reply)
}

// DecryptEchoStr 解密 URL 验证的 echostr
func (mc *MsgCrypt) DecryptEchoStr(msgSignature, timestamp, nonce, echostr string) (string, error) {
	// 验签（常量时间比较，防时序攻击）
	sig := calcMsgSignature(mc.token, timestamp, nonce, echostr)
	if subtle.ConstantTimeCompare([]byte(sig), []byte(msgSignature)) != 1 {
		return "", fmt.Errorf("echostr signature verification failed")
	}

	plaintext, err := mc.decrypt(echostr)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt echostr: %w", err)
	}

	return string(plaintext), nil
}

// decrypt 解密 base64 密文，返回明文内容
// 格式: AES-CBC(key, iv=key[:16]) → pkcs7Unpad(32) → 16字节随机 + 4字节长度(BigEndian) + 明文 + appID
func (mc *MsgCrypt) decrypt(ciphertext string) ([]byte, error) {
	cipherData, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return nil, fmt.Errorf("base64 decode failed: %w", err)
	}

	plainData, err := cbcDecrypt(mc.aesKey, cipherData)
	if err != nil {
		return nil, err
	}

	plainData, err = pkcs7Unpad(plainData, 32)
	if err != nil {
		return nil, err
	}

	// 16字节随机前缀 + 4字节长度 + 明文 + appID
	if len(plainData) < 20 {
		return nil, fmt.Errorf("decrypted data too short")
	}

	msgLen := binary.BigEndian.Uint32(plainData[16:20])
	if uint32(len(plainData)) < 20+msgLen {
		return nil, fmt.Errorf("invalid message length in decrypted data")
	}

	content := plainData[20 : 20+msgLen]
	appID := string(plainData[20+msgLen:])

	if appID != mc.appID {
		return nil, fmt.Errorf("appID mismatch: got %s, expected %s", appID, mc.appID)
	}

	return content, nil
}

// encrypt 加密明文，返回 base64 密文
func (mc *MsgCrypt) encrypt(plaintext []byte) (string, error) {
	// 16字节随机前缀
	randomBytes := make([]byte, 16)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("failed to generate random bytes: %w", err)
	}

	// 4字节长度 (BigEndian)
	msgLen := make([]byte, 4)
	binary.BigEndian.PutUint32(msgLen, uint32(len(plaintext)))

	// 拼接: random(16) + msgLen(4) + plaintext + appID
	buf := make([]byte, 0, 20+len(plaintext)+len(mc.appID))
	buf = append(buf, randomBytes...)
	buf = append(buf, msgLen...)
	buf = append(buf, plaintext...)
	buf = append(buf, []byte(mc.appID)...)

	// PKCS7 填充 (blocksize=32)
	padded := pkcs7Pad(buf, 32)

	// AES-CBC 加密
	encrypted, err := cbcEncrypt(mc.aesKey, padded)
	if err != nil {
		return "", err
	}

	return base64.StdEncoding.EncodeToString(encrypted), nil
}

// calcMsgSignature 计算消息签名: SHA1(sort(token, timestamp, nonce, encrypt))
func calcMsgSignature(token, timestamp, nonce, encrypt string) string {
	params := []string{token, timestamp, nonce, encrypt}
	sort.Strings(params)

	h := sha1.New()
	h.Write([]byte(strings.Join(params, "")))
	return hex.EncodeToString(h.Sum(nil))
}

// pkcs7Pad PKCS#7 填充，blockSize 为 32
func pkcs7Pad(data []byte, blockSize int) []byte {
	padding := blockSize - len(data)%blockSize
	padBytes := make([]byte, padding)
	for i := range padBytes {
		padBytes[i] = byte(padding)
	}
	return append(data, padBytes...)
}

// pkcs7Unpad PKCS#7 去填充
func pkcs7Unpad(data []byte, blockSize int) ([]byte, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("pkcs7 unpad: empty data")
	}
	if len(data)%blockSize != 0 {
		return nil, fmt.Errorf("pkcs7 unpad: data length %d not multiple of block size %d", len(data), blockSize)
	}

	padding := int(data[len(data)-1])
	if padding == 0 || padding > blockSize {
		return nil, fmt.Errorf("pkcs7 unpad: invalid padding value %d", padding)
	}

	for i := len(data) - padding; i < len(data); i++ {
		if data[i] != byte(padding) {
			return nil, fmt.Errorf("pkcs7 unpad: invalid padding")
		}
	}

	return data[:len(data)-padding], nil
}

// cbcEncrypt AES-CBC 加密，IV = key[:16]
//
// 固定 IV 看似偏离 AES-CBC 最佳实践，但这是微信公众号"安全模式"协议的硬要求
// （详见微信官方加解密示例）。安全性靠 plaintext 头部的 16 字节随机前缀
// （见 encrypt 中的 randomBytes）作为"实际 IV"——每条消息这 16 字节都不同，
// 等价于把 IV 嵌入 plaintext 的开头，因此密文不会因相同明文而重复。
// 不要把这里改成 rand IV，否则微信服务端无法解密。
func cbcEncrypt(key, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("aes new cipher: %w", err)
	}

	iv := key[:aes.BlockSize]
	mode := cipher.NewCBCEncrypter(block, iv)

	ciphertext := make([]byte, len(plaintext))
	mode.CryptBlocks(ciphertext, plaintext)

	return ciphertext, nil
}

// cbcDecrypt AES-CBC 解密，IV = key[:16]
func cbcDecrypt(key, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("aes new cipher: %w", err)
	}

	if len(ciphertext)%aes.BlockSize != 0 {
		return nil, fmt.Errorf("ciphertext length %d not multiple of AES block size", len(ciphertext))
	}

	iv := key[:aes.BlockSize]
	mode := cipher.NewCBCDecrypter(block, iv)

	plaintext := make([]byte, len(ciphertext))
	mode.CryptBlocks(plaintext, ciphertext)

	return plaintext, nil
}
