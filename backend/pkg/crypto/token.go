package crypto

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"time"
)

var (
	ErrGenerateToken = errors.New("failed to generate token")
	ErrInvalidToken  = errors.New("invalid token")
	ErrExpiredToken  = errors.New("token has expired")
	ErrInvalidLength = errors.New("invalid token length")
)

func Simple(content string, expiredAt time.Time) (string, error) {
	contentBytes := []byte(content)
	contentLen := uint16(len(contentBytes))

	// 5 bytes random + 2 bytes length + content + 8 bytes timestamp
	dataLen := 5 + 2 + len(contentBytes) + 8
	data := make([]byte, dataLen)
	if _, err := rand.Read(data[:5]); err != nil {
		return "", ErrGenerateToken
	}

	binary.BigEndian.PutUint16(data[5:7], contentLen)
	copy(data[7:7+len(contentBytes)], contentBytes)
	t := expiredAt.UnixNano()
	binary.BigEndian.PutUint64(data[7+len(contentBytes):], uint64(t))
	token := base32.StdEncoding.EncodeToString(data)
	return token, nil
}

func ValidateSimple(token string) (string, error) {
	data, err := base32.StdEncoding.DecodeString(token)
	if err != nil {
		return "", errors.Join(ErrInvalidToken, err)
	}
	if len(data) < 5+2+8 { // minimum length: 5 random + 2 length + 0 content + 8 timestamp
		return "", ErrInvalidLength
	}

	contentLen := binary.BigEndian.Uint16(data[5:7])
	expectedLen := 5 + 2 + int(contentLen) + 8
	if len(data) != expectedLen {
		return "", ErrInvalidLength
	}

	content := string(data[7 : 7+int(contentLen)])
	t := int64(binary.BigEndian.Uint64(data[7+int(contentLen):]))
	if time.Now().UnixNano() > t {
		return "", ErrExpiredToken
	}
	return content, nil
}
