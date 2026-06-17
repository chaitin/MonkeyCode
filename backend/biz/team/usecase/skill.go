// Package usecase — 团队管理员侧 skill 的业务逻辑:zip 校验 + OSS 上传 +
// agent_skill upsert + new version + group binding 替换。D3 语义:Content
// 非空 → 新版本;只改元数据 → mutate 行。
package usecase

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"path"
	"strings"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/agentresource"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

// skillS3KeyPrefix:S3 上每个 skill 版本对应的 key 形如
//   agent-resources/skills/team/<team_id>/<skill_id>/<version>.zip
const skillS3KeyPrefix = "agent-resources/skills/team"

type teamSkillUsecase struct {
	repo     domain.TeamSkillRepo
	objstore agentresource.ObjectStore
	logger   *slog.Logger
}

func NewTeamSkillUsecase(i *do.Injector) (domain.TeamSkillUsecase, error) {
	return &teamSkillUsecase{
		repo:     do.MustInvoke[domain.TeamSkillRepo](i),
		objstore: do.MustInvoke[agentresource.ObjectStore](i),
		logger:   do.MustInvoke[*slog.Logger](i),
	}, nil
}

func (u *teamSkillUsecase) List(ctx context.Context, teamUser *domain.TeamUser) (*domain.ListTeamSkillsResp, error) {
	skills, err := u.repo.List(ctx, teamUser.GetTeamID())
	if err != nil {
		return nil, err
	}
	out := make([]*domain.TeamSkill, 0, len(skills))
	for _, s := range skills {
		ts, err := u.skillToDTO(ctx, s)
		if err != nil {
			return nil, err
		}
		out = append(out, ts)
	}
	return &domain.ListTeamSkillsResp{Skills: out}, nil
}

func (u *teamSkillUsecase) Add(ctx context.Context, teamUser *domain.TeamUser, req *domain.AddTeamSkillReq) (*domain.TeamSkill, error) {
	// JSON 入口:把 Content (SKILL.md 文本) 打成单文件 zip,再走 AddPackage 路径。
	data, err := packageSkillMarkdownContent(req.Content)
	if err != nil {
		return nil, err
	}
	pkg := &domain.AddTeamSkillPackageReq{
		AddTeamSkillReq: *req,
		PackageFilename: skillPackageFilename(req.Name),
		PackageData:     data,
	}
	return u.AddPackage(ctx, teamUser, pkg)
}

func (u *teamSkillUsecase) AddPackage(ctx context.Context, teamUser *domain.TeamUser, req *domain.AddTeamSkillPackageReq) (*domain.TeamSkill, error) {
	teamID := teamUser.GetTeamID()
	userID := teamUser.User.ID

	frontmatterTags, err := validateSkillZipPackage(req.PackageData)
	if err != nil {
		return nil, err
	}

	// 取 team 的 bare repo;不存在视为系统级 bug(InitTeam 应已 provision)。
	repoID, err := u.repo.GetBareRepoID(ctx, teamID)
	if err != nil {
		return nil, err
	}

	// upsert agent_skill 行
	skill, err := u.repo.UpsertSkill(ctx, teamID, repoID, userID, req.Name, req.Description, req.IsForceDelivery, req.ExtensionPackageID)
	if err != nil {
		return nil, err
	}

	// 算 next version
	nextVer, err := u.repo.NextVersionFor(ctx, skill.ID)
	if err != nil {
		return nil, err
	}

	// 上传 OSS
	s3Key := fmt.Sprintf("%s/%s/%s/%s.zip", skillS3KeyPrefix, teamID.String(), skill.ID.String(), nextVer)
	prefix, filename := path.Split(s3Key)
	if err := u.objstore.PutFile(ctx, strings.TrimSuffix(prefix, "/"), filename, bytes.NewReader(req.PackageData)); err != nil {
		return nil, err
	}

	// tags 优先级:form 字段 present → 覆盖;absent → 用 frontmatter 解析出来的
	tags := req.Tags
	if tags == nil {
		tags = frontmatterTags
	}

	// 写新 version + 切 active_version_id
	if _, err := u.repo.CreateVersion(ctx, skill.ID, nextVer, s3Key, domain.SkillVersionMeta{
		Description: req.Description,
		Tags:        tags,
		// Categories: 当前 frontmatter 解析不暴露,留空。
		SourceType:  req.SourceType,
		SourceLabel: req.SourceLabel,
	}); err != nil {
		return nil, err
	}

	// group binding 全量替换
	if err := u.repo.ReplaceGroupBindings(ctx, teamID, skill.ID, req.GroupIDs); err != nil {
		return nil, err
	}

	return u.loadDTO(ctx, teamID, skill.ID)
}

func (u *teamSkillUsecase) Update(ctx context.Context, teamUser *domain.TeamUser, req *domain.UpdateTeamSkillReq) (*domain.TeamSkill, error) {
	teamID := teamUser.GetTeamID()

	// D3:Content 非空 → 内容变更 → 新版本;否则只改元数据。
	if strings.TrimSpace(req.Content) != "" {
		// 走 Add 同款流程:打包 + upload + new version
		data, err := packageSkillMarkdownContent(req.Content)
		if err != nil {
			return nil, err
		}
		// 先 load skill 拿 name(name 不允许改);再走 AddPackage
		skills, err := u.repo.List(ctx, teamID)
		if err != nil {
			return nil, err
		}
		var existing *db.AgentSkill
		for _, s := range skills {
			if s.ID == req.SkillID {
				existing = s
				break
			}
		}
		if existing == nil {
			return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("skill not found"))
		}
		pkg := &domain.AddTeamSkillPackageReq{
			AddTeamSkillReq: domain.AddTeamSkillReq{
				Name:            existing.Name,
				Description:     strDerefOr(req.Description, existing.Description),
				Tags:            req.Tags,
				Content:         req.Content,
				GroupIDs:        req.GroupIDs,
				SkillMDPath:     strDeref(req.SkillMDPath),
				IsForceDelivery: boolDeref(req.IsForceDelivery, existing.IsForceDelivery),
				SourceType:      strDeref(req.SourceType),
				SourceLabel:     strDeref(req.SourceLabel),
			},
			PackageFilename: skillPackageFilename(existing.Name),
			PackageData:     data,
		}
		return u.AddPackage(ctx, teamUser, pkg)
	}

	// 仅 metadata 更新(name / description / is_force_delivery)
	if _, err := u.repo.UpdateMeta(ctx, teamID, req.SkillID, req.Name, req.Description, req.IsForceDelivery); err != nil {
		return nil, err
	}
	// tags 存在 active version 的 parsed_meta 上,原地更新(不建新版本)。
	if req.Tags != nil {
		if err := u.repo.UpdateActiveVersionTags(ctx, req.SkillID, req.Tags); err != nil {
			return nil, err
		}
	}
	if req.GroupIDs != nil {
		if err := u.repo.ReplaceGroupBindings(ctx, teamID, req.SkillID, req.GroupIDs); err != nil {
			return nil, err
		}
	}
	return u.loadDTO(ctx, teamID, req.SkillID)
}

func (u *teamSkillUsecase) Delete(ctx context.Context, teamUser *domain.TeamUser, req *domain.DeleteTeamSkillReq) error {
	return u.repo.SoftDeleteSkill(ctx, teamUser.GetTeamID(), req.SkillID)
}

// ---- DTO helpers ----

func (u *teamSkillUsecase) loadDTO(ctx context.Context, teamID, skillID uuid.UUID) (*domain.TeamSkill, error) {
	skill, err := u.repo.GetSkill(ctx, teamID, skillID)
	if err != nil {
		return nil, err
	}
	return u.skillToDTO(ctx, skill)
}

func (u *teamSkillUsecase) skillToDTO(ctx context.Context, s *db.AgentSkill) (*domain.TeamSkill, error) {
	dto := &domain.TeamSkill{
		ID:              s.ID,
		Name:            s.Name,
		Description:     s.Description,
		IsForceDelivery: s.IsForceDelivery,
		Enabled:         s.Enabled,
		CreatedAt:       s.CreatedAt.Unix(),
		UpdatedAt:       s.UpdatedAt.Unix(),
	}
	if s.ActiveVersionID != nil {
		ver, err := u.repo.GetActiveVersion(ctx, s.ID)
		if err != nil {
			return nil, err
		}
		if ver != nil {
			dto.ActiveVersion = ver.Version
			dto.S3Key = ver.S3Key
			dto.Tags = ver.ParsedMeta.Tags
			dto.Categories = ver.ParsedMeta.Categories
			dto.SourceType = ver.ParsedMeta.SourceType
			dto.SourceLabel = ver.ParsedMeta.SourceLabel
		}
	}
	groups, err := u.repo.LoadGroups(ctx, s.ID)
	if err != nil {
		return nil, err
	}
	dto.Groups = groups
	return dto, nil
}

// ---- zip helpers ----

// validateSkillZipPackage 校验 zip 至少含一个 SKILL.md(大小写不敏感),返回
// frontmatter 解析出的 tags(没有则 nil)。
func validateSkillZipPackage(data []byte) ([]string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("invalid skill zip package"))
	}
	for _, f := range reader.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if !strings.EqualFold(path.Base(f.Name), "SKILL.md") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, errcode.ErrBadRequest.Wrap(err)
		}
		body, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			return nil, errcode.ErrBadRequest.Wrap(err)
		}
		return parseFrontmatterTags(body), nil
	}
	return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("zip package missing SKILL.md"))
}

// parseFrontmatterTags 极简 YAML frontmatter 解析:支持
//   tags: ["a", "b"]
//   tags: [a, b]
//   tags:
//     - a
//     - b
// 找不到/形式不对就返回 nil(降级到 frontmatter 无 tags)。
func parseFrontmatterTags(body []byte) []string {
	s := string(body)
	if !strings.HasPrefix(s, "---") {
		return nil
	}
	end := strings.Index(s[3:], "\n---")
	if end < 0 {
		return nil
	}
	fm := s[3 : 3+end]
	lines := strings.Split(fm, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "tags:") {
			continue
		}
		rest := strings.TrimSpace(strings.TrimPrefix(trimmed, "tags:"))
		if rest != "" {
			// inline array
			rest = strings.TrimSpace(rest)
			if strings.HasPrefix(rest, "[") && strings.HasSuffix(rest, "]") {
				inner := strings.TrimSuffix(strings.TrimPrefix(rest, "["), "]")
				parts := strings.Split(inner, ",")
				out := make([]string, 0, len(parts))
				for _, p := range parts {
					p = strings.Trim(strings.TrimSpace(p), `"'`)
					if p != "" {
						out = append(out, p)
					}
				}
				return out
			}
			return nil
		}
		// block list:- a / - b / ...
		var out []string
		for _, sub := range lines[i+1:] {
			ts := strings.TrimSpace(sub)
			if !strings.HasPrefix(ts, "-") {
				break
			}
			val := strings.Trim(strings.TrimSpace(strings.TrimPrefix(ts, "-")), `"'`)
			if val != "" {
				out = append(out, val)
			}
		}
		return out
	}
	return nil
}

func packageSkillMarkdownContent(content string) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("SKILL.md")
	if err != nil {
		return nil, err
	}
	if _, err := w.Write([]byte(content)); err != nil {
		_ = zw.Close()
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func skillPackageFilename(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "skill"
	}
	replacer := strings.NewReplacer("/", "-", "\\", "-", ":", "-", " ", "-")
	name = strings.Trim(replacer.Replace(name), ".-")
	if name == "" {
		name = "skill"
	}
	return fmt.Sprintf("%s.zip", name)
}

// ---- misc ----

func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
func boolDeref(p *bool, dflt bool) bool {
	if p == nil {
		return dflt
	}
	return *p
}
func strDerefOr(p *string, dflt string) string {
	if p == nil {
		return dflt
	}
	return *p
}

// silence cvt import if unused in some build flag
var _ = cvt.Iter[int, int]
