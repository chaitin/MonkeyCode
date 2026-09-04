package identity

import "testing"

func TestPasswordHash(t *testing.T) {
	encoded, err := hashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !verifyPassword("correct horse battery staple", encoded) {
		t.Fatal("正确密码未通过校验")
	}
	if verifyPassword("wrong password", encoded) {
		t.Fatal("错误密码通过了校验")
	}
}

func TestVerifyPasswordRejectsInvalidHash(t *testing.T) {
	for _, encoded := range []string{"", "$bcrypt$hash", "$pbkdf2-sha256$1$bad$bad"} {
		if verifyPassword("password", encoded) {
			t.Fatalf("非法密码摘要通过校验: %q", encoded)
		}
	}
}
