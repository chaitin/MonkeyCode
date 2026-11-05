package expert

import (
	"bytes"
	"encoding/base64"
	"image"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

const userAvatarLimit = 256 << 10
const userAvatarMaxEdge = 512

func readUserAvatar(value any) (*avatarChange, error) {
	if value == nil {
		return &avatarChange{}, nil
	}
	raw, ok := value.(string)
	header, encoded, found := strings.Cut(raw, ",")
	contentType := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	if !ok || !found || header != "data:"+contentType+";base64" || (contentType != "image/png" && contentType != "image/jpeg" && contentType != "image/webp") {
		return nil, resource.InvalidCode("expert_avatar_invalid", "头像必须为 PNG、JPEG 或 WebP 的 base64 data URL")
	}
	if len(encoded) > base64.StdEncoding.EncodedLen(userAvatarLimit) {
		return nil, resource.InvalidCode("expert_avatar_too_large", "头像大小不能超过 256 KiB")
	}
	data, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(data) == 0 {
		return nil, resource.InvalidCode("expert_avatar_invalid", "头像编码无效")
	}
	if len(data) > userAvatarLimit {
		return nil, resource.InvalidCode("expert_avatar_too_large", "头像大小不能超过 256 KiB")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return nil, resource.InvalidCode("expert_avatar_invalid", "头像图片无效")
	}
	if config.Width > userAvatarMaxEdge || config.Height > userAvatarMaxEdge {
		return nil, resource.InvalidCode("expert_avatar_too_large", "头像宽高不能超过 512 像素")
	}
	avatar, err := readAvatar(data)
	if err != nil {
		return nil, err
	}
	if avatar.mime != contentType {
		return nil, resource.InvalidCode("expert_avatar_invalid", "头像类型与图片内容不符")
	}
	return avatar, nil
}

func (s *Service) saveUserExpert(w http.ResponseWriter, r *http.Request) {
	var in resource.Object
	if err := resource.Decode(w, r, &in); err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	var avatar *avatarChange
	if value, exists := in[avatarChangeKey]; exists {
		var err error
		avatar, err = readUserAvatar(value)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
	}
	user, _ := identity.UserFromContext(r.Context())
	out, err := s.saveAvatar(r.Context(), user.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match"), in, avatar, true)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		status = http.StatusCreated
	}
	resource.ETag(w, out)
	resource.JSON(r.Context(), w, status, out)
}
