package crypto

import (
	"crypto/aes"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

func uuidToBytes(uuid string) ([]byte, error) {
	s := strings.ReplaceAll(uuid, "-", "")
	return hex.DecodeString(s)
}

func bytesToUUID(b []byte) string {
	hexStr := hex.EncodeToString(b)
	return hexStr[0:8] + "-" +
		hexStr[8:12] + "-" +
		hexStr[12:16] + "-" +
		hexStr[16:20] + "-" +
		hexStr[20:32]
}

func deriveKey(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:16] // AES-128
}

// MapUUID 正向映射 UUID
func MapUUID(uuid string, secret string) (string, error) {
	data, err := uuidToBytes(uuid)
	if err != nil {
		return "", err
	}

	key := deriveKey(secret)

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	out := make([]byte, 16)
	block.Encrypt(out, data)

	return bytesToUUID(out), nil
}

// UnmapUUID 反向映射 UUID
func UnmapUUID(uuid string, secret string) (string, error) {
	data, err := uuidToBytes(uuid)
	if err != nil {
		return "", err
	}

	key := deriveKey(secret)

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	out := make([]byte, 16)
	block.Decrypt(out, data)

	return bytesToUUID(out), nil
}
