package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
)

// AESEncryptor AES 加密器
type AESEncryptor struct {
	key []byte
}

// NewAESEncryptor 创建 AES 加密器
// key 必须是 16, 24 或 32 字节，分别对应 AES-128, AES-192 或 AES-256
func NewAESEncryptor(key []byte) (*AESEncryptor, error) {
	if len(key) != 16 && len(key) != 24 && len(key) != 32 {
		return nil, fmt.Errorf("invalid key size: must be 16, 24 or 32 bytes")
	}
	return &AESEncryptor{key: key}, nil
}

// NewAESEncryptorFromString 从字符串创建 AES 加密器
// 会自动将字符串转换为合适的密钥长度（32字节 = AES-256）
func NewAESEncryptorFromString(keyString string) (*AESEncryptor, error) {
	key := []byte(keyString)

	// 如果密钥长度不是标准长度，则填充或截断到 32 字节
	if len(key) < 32 {
		// 填充到 32 字节
		paddedKey := make([]byte, 32)
		copy(paddedKey, key)
		key = paddedKey
	} else if len(key) > 32 {
		// 截断到 32 字节
		key = key[:32]
	}

	return NewAESEncryptor(key)
}

// Encrypt 使用 AES-GCM 加密数据
// 返回 base64 编码的加密数据（包含 nonce）
func (e *AESEncryptor) Encrypt(plaintext []byte) (string, error) {
	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}

	// 使用 GCM 模式
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create GCM: %w", err)
	}

	// 生成随机 nonce
	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}

	// 加密数据，nonce 会被附加到密文前面
	ciphertext := aesGCM.Seal(nonce, nonce, plaintext, nil)

	// 返回 base64 编码的结果
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// EncryptString 加密字符串
func (e *AESEncryptor) EncryptString(plaintext string) (string, error) {
	return e.Encrypt([]byte(plaintext))
}

// Decrypt 使用 AES-GCM 解密数据
// 输入应该是 base64 编码的密文
func (e *AESEncryptor) Decrypt(ciphertext string) ([]byte, error) {
	// 解码 base64
	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return nil, fmt.Errorf("decode base64: %w", err)
	}

	block, err := aes.NewCipher(e.key)
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(data) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	// 提取 nonce 和密文
	nonce, ciphertextBytes := data[:nonceSize], data[nonceSize:]

	// 解密
	plaintext, err := aesGCM.Open(nil, nonce, ciphertextBytes, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt: %w", err)
	}

	return plaintext, nil
}

// DecryptString 解密为字符串
func (e *AESEncryptor) DecryptString(ciphertext string) (string, error) {
	plaintext, err := e.Decrypt(ciphertext)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

// EncryptToBytes 加密并返回原始字节（不进行 base64 编码）
func (e *AESEncryptor) EncryptToBytes(plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(e.key)
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generate nonce: %w", err)
	}

	ciphertext := aesGCM.Seal(nonce, nonce, plaintext, nil)
	return ciphertext, nil
}

// DecryptFromBytes 从原始字节解密（不进行 base64 解码）
func (e *AESEncryptor) DecryptFromBytes(ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(e.key)
	if err != nil {
		return nil, fmt.Errorf("create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create GCM: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertextBytes := ciphertext[:nonceSize], ciphertext[nonceSize:]

	plaintext, err := aesGCM.Open(nil, nonce, ciphertextBytes, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt: %w", err)
	}

	return plaintext, nil
}

// GenerateAESKey 生成随机的 AES 密钥
// size 必须是 16, 24 或 32，分别对应 AES-128, AES-192 或 AES-256
func GenerateAESKey(size int) ([]byte, error) {
	if size != 16 && size != 24 && size != 32 {
		return nil, fmt.Errorf("invalid key size: must be 16, 24 or 32 bytes")
	}

	key := make([]byte, size)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("generate key: %w", err)
	}

	return key, nil
}
