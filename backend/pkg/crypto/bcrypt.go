package crypto

import (
	"errors"

	"golang.org/x/crypto/bcrypt"
)

// HashPassword 使用 bcrypt 加密密码
func HashPassword(password string) (string, error) {
	if len(password) > 32 {
		return "", errors.New("password must be less than 32 characters")
	}
	hashedBytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hashedBytes), nil
}

// VerifyPassword 验证密码
func VerifyPassword(dbPassword, password string) error {
	return bcrypt.CompareHashAndPassword([]byte(dbPassword), []byte(password))
}
