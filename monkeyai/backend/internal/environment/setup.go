package environment

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type Setup struct {
	Billing *BillingConfig     `json:"billing,omitempty"`
	Grants  *[]resource.Object `json:"grants,omitempty"`
}
type SetupView struct {
	HostID      string            `json:"host_id"`
	HostName    string            `json:"host_name"`
	Capacity    Capacity          `json:"capacity"`
	ImageReady  bool              `json:"image_ready"`
	ImageReason string            `json:"image_reason,omitempty"`
	Billing     BillingConfig     `json:"billing"`
	Grants      []resource.Object `json:"grants"`
}

func (s *Service) defaultImage(ctx context.Context, arch string) (string, string, error) {
	if s.images == nil {
		return "", "", errors.New("server 尚未准备默认环境镜像")
	}
	reference, digest, err := s.images.Default(ctx, arch)
	if err != nil {
		return "", "", err
	}
	if (!image.MatchString(reference) && !imageTag.MatchString(reference)) || !imageHash.MatchString(digest) || len(reference) > 512 || image.MatchString(reference) && !strings.HasSuffix(reference, "@"+digest) {
		return "", "", errors.New("server 默认镜像引用或摘要无效")
	}
	return reference, digest, nil
}
func (s *Service) setupView(ctx context.Context, q *sqlc.Queries, host string, db resource.Queryer) (SetupView, error) {
	h, err := q.HostSetup(ctx, host)
	if err != nil {
		return SetupView{}, err
	}
	out := SetupView{HostID: h.ID, HostName: h.Name}
	out.Billing, err = decodeBilling(h.Billing)
	if err != nil {
		return out, err
	}
	capacity, err := q.GetHost(ctx, host)
	if err != nil {
		return out, err
	}
	status, err := q.HostStatus(ctx, host)
	if err != nil {
		return out, err
	}
	out.Capacity = reportedCapacity(status.Report)
	out.Capacity.Enabled = capacity.Enabled
	out.Grants, err = resource.Grants(ctx, db, "host", host)
	if err != nil {
		return out, err
	}
	if _, _, err := s.defaultImage(ctx, status.Architecture); err != nil {
		out.ImageReason = err.Error()
	} else {
		out.ImageReady = true
	}
	return out, nil
}
func (s *Service) getSetup(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !uuid.MatchString(id) {
		fail(w, r, notFound)
		return
	}
	var out SetupView
	err := s.transactionWithTx(r.Context(), func(q *sqlc.Queries, tx pgx.Tx) error {
		var err error
		out, err = s.setupView(r.Context(), q, id, tx)
		return err
	})
	if err != nil {
		fail(w, r, err)
		return
	}
	respond(w, r, 200, out)
}
func (s *Service) putSetup(w http.ResponseWriter, r *http.Request) {
	var in Setup
	if !decode(w, r, &in) {
		return
	}
	out, err := s.saveSetup(r.Context(), chi.URLParam(r, "id"), in)
	if err != nil {
		fail(w, r, err)
		return
	}
	respond(w, r, 200, out)
}
func (s *Service) saveSetup(ctx context.Context, id string, in Setup) (SetupView, error) {
	var out SetupView
	if !uuid.MatchString(id) {
		return out, bad("宿主 ID 无效")
	}
	if in.Grants != nil {
		if err := validateHostGrants(*in.Grants); err != nil {
			return out, err
		}
	}
	if in.Billing != nil {
		return out, bad("云电脑计费已改为全局配置，请到费用设置修改")
	}
	err := s.transactionWithTx(ctx, func(q *sqlc.Queries, tx pgx.Tx) error {
		h, err := q.HostStatus(ctx, id)
		if err != nil {
			return err
		}
		if h.Status != "active" {
			return conflict("host_unavailable", "宿主未接入或已撤销")
		}
		current, err := s.setupView(ctx, q, id, tx)
		if err != nil {
			return err
		}
		actor, hasActor := identity.UserFromContext(ctx)
		if in.Grants != nil && !sameHostGrants(*in.Grants, current.Grants) {
			if !hasActor {
				return &failure{401, "invalid_token", "缺少授权操作者"}
			}
			if err = resource.SaveGrants(ctx, tx, "host", id, actor.ID, *in.Grants, false); err != nil {
				return err
			}
			if err = resource.Audit(ctx, tx, actor.ID, "host", id, "grants"); err != nil {
				return err
			}
		}
		if err = q.SetHostSetup(ctx, id); err != nil {
			return err
		}
		out, err = s.setupView(ctx, q, id, tx)
		return err
	})
	return out, err
}
