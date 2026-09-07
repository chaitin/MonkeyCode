package skill

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"io"
	"net/http"
	"strconv"
)

type Service struct {
	CRUD    *resource.CRUD
	storage resource.Storage
	store   *resource.Store
}

func NewService(store *resource.Store, storage resource.Storage) *Service {
	s := &Service{store: store, storage: storage}
	s.CRUD = resource.NewCRUD(store, resource.Definition{Kind: "skill", Table: "skills", Path: "/skills", Fields: []string{"name", "description", "package_file_name", "package_s3_key", "package_size_bytes", "package_sha256", "file_count", "enabled"}, Hidden: []string{"package_s3_key"}, Validate: s.validate, Decorate: s.decorate, Persist: s.tags, References: func(ctx context.Context, tx pgx.Tx, id string) ([]resource.Object, error) {
		return resource.Rows(ctx, tx, `SELECT jsonb_build_object('id',e.id,'name',e.name) FROM experts e JOIN expert_skills x ON x.expert_id=e.id WHERE x.skill_id=$1 AND e.deleted_at IS NULL`, id)
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
	tags, err := resource.Rows(ctx, q, `SELECT jsonb_build_object('id',t.id,'name',t.name) FROM tags t JOIN resource_tags rt ON rt.tag_id=t.id WHERE rt.resource_type='skill' AND rt.resource_id=$1 AND t.deleted_at IS NULL ORDER BY t.id`, o.String("id"))
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
	if _, err := tx.Exec(ctx, `DELETE FROM resource_tags WHERE resource_type='skill' AND resource_id=$1`, in.String("id")); err != nil {
		return err
	}
	for _, id := range resource.Strings(raw) {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tags WHERE id=$1 AND deleted_at IS NULL)`, id).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return resource.Invalid("标签不存在")
		}
		if _, err := tx.Exec(ctx, `INSERT INTO resource_tags(resource_type,resource_id,tag_id,assigned_by_user_id) VALUES('skill',$1,$2,$3)`, in.String("id"), id, in.String("actor_id")); err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) RegisterAdmin(r chi.Router) {
	s.CRUD.Register(r)
	r.Post("/skills", s.upload)
	r.Put("/skills/{id}/package", s.upload)
	r.Get("/skills/{id}/package", func(w http.ResponseWriter, r *http.Request) { s.Download(w, r, chi.URLParam(r, "id")) })
	r.Get("/skills/{id}/manifest", func(w http.ResponseWriter, r *http.Request) {
		o, err := resource.Row(r.Context(), s.store.Pool, `SELECT to_jsonb(t) FROM skills t WHERE id=$1 AND deleted_at IS NULL`, chi.URLParam(r, "id"))
		if err != nil {
			resource.Fail(w, err)
			return
		}
		p, err := s.read(r.Context(), o)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		resource.ETag(w, o)
		resource.JSON(w, 200, resource.Object{"name": p.Name, "description": p.Description, "content": p.Content, "revision": o["revision"]})
	})
}
func (s *Service) upload(w http.ResponseWriter, r *http.Request) {
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
	o, err := s.CRUD.Save(r.Context(), u.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match"), in)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.ETag(w, o)
	resource.JSON(w, 200, o)
}
func (s *Service) Download(w http.ResponseWriter, r *http.Request, id string) {
	o, err := resource.Row(r.Context(), s.store.Pool, `SELECT to_jsonb(t) FROM skills t WHERE id=$1 AND deleted_at IS NULL`, id)
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
