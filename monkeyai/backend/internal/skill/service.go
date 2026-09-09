package skill

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/skill/sqlc"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type Service struct {
	CRUD    *resource.CRUD
	storage resource.Storage
	store   *resource.Store
}

func NewService(store *resource.Store, storage resource.Storage) *Service {
	s := &Service{store: store, storage: storage}
	s.CRUD = resource.NewCRUD(store, resource.Definition{Kind: "skill", Repository: func(q resource.Queryer) resource.Repository { return sqlc.New(q) }, Path: "/skills", Fields: []string{"name", "description", "package_file_name", "package_s3_key", "package_size_bytes", "package_sha256", "file_count", "enabled"}, UserFields: []string{"name", "description", "content", "tag_ids", "package_bytes"}, Hidden: []string{"package_s3_key"}, Validate: s.validate, Decorate: s.decorate, Persist: s.tags, References: func(ctx context.Context, tx pgx.Tx, id string) ([]resource.Object, error) {
		return resource.DecodeObjects(sqlc.New(tx).ListReferences(ctx, id))
	}})
	return s
}
func (s *Service) read(ctx context.Context, object resource.Object) (Package, error) {
	r, err := s.storage.Get(ctx, object.String("package_s3_key"))
	if err != nil {
		return Package{}, err
	}
	defer r.Close()
	b, err := io.ReadAll(io.LimitReader(r, MaxPackage+1))
	if err != nil {
		return Package{}, err
	}
	p, err := Parse(b)
	if err != nil || int64(len(b)) != object.Int("package_size_bytes") || p.SHA != object.String("package_sha256") {
		return Package{}, &resource.Error{Status: 502, Code: "storage_corrupted", Message: "技能包大小或摘要不一致，请重新上传"}
	}
	return p, nil
}
func (s *Service) validate(ctx context.Context, tx pgx.Tx, in, old resource.Object) error {
	var p Package
	var err error
	data, uploaded := in["package_bytes"].([]byte)
	if uploaded {
		p, err = Parse(data)
	} else if old.String("id") != "" {
		p, err = s.read(ctx, old)
	} else {
		return resource.Invalid("请上传技能 ZIP")
	}
	if err != nil {
		return resource.Invalid(err.Error())
	}
	if !uploaded {
		if _, ok := in["description"]; !ok {
			in["description"] = p.Description
		}
		content := p.Content
		if c, ok := in["content"].(string); ok {
			content = c
		}
		if in.String("name") != p.Name || in.String("description") != p.Description || content != p.Content {
			p, err = p.Rewrite(in.String("name"), in.String("description"), content)
			if err != nil {
				return resource.Invalid(err.Error())
			}
		}
	}
	key := old.String("package_s3_key")
	if p.SHA != old.String("package_sha256") {
		key = "skills/" + in.String("id") + "/" + resource.ID() + "/package.zip"
		if err = s.storage.Put(ctx, key, p.Bytes, "application/zip"); err != nil {
			return err
		}
	}
	in["name"] = p.Name
	in["description"] = p.Description
	in["package_s3_key"] = key
	in["package_file_name"] = p.Name + ".zip"
	in["package_sha256"] = p.SHA
	in["package_size_bytes"] = len(p.Bytes)
	in["file_count"] = len(p.Files)
	return nil
}
func (s *Service) decorate(ctx context.Context, q resource.Queryer, o resource.Object) error {
	tags, err := resource.DecodeObjects(sqlc.New(q).ListTags(ctx, o.String("id")))
	if err != nil {
		return err
	}
	o["tags"] = tags
	return nil
}
func (s *Service) tags(ctx context.Context, tx pgx.Tx, in resource.Object) error {
	raw, ok := in["tag_ids"]
	if !ok {
		return nil
	}
	if _, err := sqlc.New(tx).DeleteTags(ctx, in.String("id")); err != nil {
		return err
	}
	for _, id := range resource.Strings(raw) {
		exists, err := sqlc.New(tx).TagExists(ctx, id)
		if err != nil {
			return err
		}

		if !exists {
			return resource.Invalid("标签不存在")
		}
		if _, err := sqlc.New(tx).CreateTagLink(ctx, sqlc.CreateTagLinkParams{ResourceID: in.String("id"), TagID: id, AssignedByUserID: in.String("actor_id")}); err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) RegisterAdmin(r chi.Router) {
	s.CRUD.Register(r)
	r.Post("/skills", func(w http.ResponseWriter, r *http.Request) { s.upload(w, r, false) })
	r.Put("/skills/{id}/package", func(w http.ResponseWriter, r *http.Request) { s.upload(w, r, false) })
	r.Get("/skills/{id}/package", func(w http.ResponseWriter, r *http.Request) { s.Download(w, r, chi.URLParam(r, "id")) })
	r.Get("/skills/{id}/manifest", func(w http.ResponseWriter, r *http.Request) { s.manifest(w, r, false) })
}
func (s *Service) manifest(w http.ResponseWriter, r *http.Request, personal bool) {
	o, err := resource.DecodeObject(sqlc.New(s.store.Pool).GetSkill(r.Context(), chi.URLParam(r, "id")))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if personal {
		user, _ := identity.UserFromContext(r.Context())
		if o.String("ownership_type") != "user" || o.String("owner_user_id") != user.ID {
			resource.Fail(w, resource.NotFound)
			return
		}
	}
	p, err := s.read(r.Context(), o)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.ETag(w, o)
	resource.JSON(w, 200, resource.Object{"name": p.Name, "description": p.Description, "content": p.Content, "revision": o["revision"]})
}
func (s *Service) upload(w http.ResponseWriter, r *http.Request, personal bool) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxPackage+(1<<20))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		resource.Fail(w, resource.Invalid("技能包上传无效或超限"))
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, _, err := r.FormFile("package")
	if err != nil {
		resource.Fail(w, resource.Invalid("缺少 package"))
		return
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, MaxPackage+1))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	p, err := Parse(b)
	if err != nil {
		resource.Fail(w, resource.Invalid(err.Error()))
		return
	}
	in := resource.Object{}
	if meta := r.FormValue("metadata"); meta != "" {
		if err = json.Unmarshal([]byte(meta), &in); err != nil || in == nil {
			resource.Fail(w, resource.Invalid("元数据格式无效"))
			return
		}
	}
	in["name"] = p.Name
	in["package_bytes"] = b
	u, _ := identity.UserFromContext(r.Context())
	save := s.CRUD.Save
	status := http.StatusOK
	if personal {
		save = s.CRUD.SaveUser
		if r.Method == http.MethodPost {
			status = http.StatusCreated
		}
	}
	o, err := save(r.Context(), u.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match"), in)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.ETag(w, o)
	resource.JSON(w, status, o)
}
func (s *Service) Download(w http.ResponseWriter, r *http.Request, id string) {
	o, err := resource.DecodeObject(sqlc.New(s.store.Pool).GetSkill(r.Context(), id))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if hash := r.URL.Query().Get("sha256"); hash != "" && hash != o.String("package_sha256") {
		resource.Fail(w, resource.Conflict)
		return
	}
	p, err := s.read(r.Context(), o)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, o.String("package_file_name")))
	w.Header().Set("Content-Length", strconv.FormatInt(o.Int("package_size_bytes"), 10))
	w.Header().Set("ETag", `"`+o.String("package_sha256")+`"`)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-SHA256", o.String("package_sha256"))
	_, _ = w.Write(p.Bytes)
}
