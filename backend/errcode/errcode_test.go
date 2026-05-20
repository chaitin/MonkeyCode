package errcode_test

import (
	"testing"

	"github.com/GoYoko/web/locale"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"golang.org/x/text/language"
)

func TestTeamMemberLimitExceededHasChineseMessage(t *testing.T) {
	localizer := locale.NewLocalizerWithFile(language.Chinese, errcode.LocalFS, []string{"locale.zh.toml", "locale.en.toml"})

	got := localizer.Message("zh", "err-team-member-limit-exceeded", nil)

	if got != "团队成员数量已达上限" {
		t.Fatalf("message = %q, want %q", got, "团队成员数量已达上限")
	}
}
