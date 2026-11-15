package environment

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type Setup struct {
	Resource            Resources          `json:"resource"`
	MaxEnvironments     int32              `json:"max_environments"`
	UserMaxEnvironments int32              `json:"user_max_environments"`
	Billing             *BillingConfig     `json:"billing,omitempty"`
	Grants              *[]resource.Object `json:"grants,omitempty"`
}
type SetupView struct {
	HostID              string            `json:"host_id"`
	HostName            string            `json:"host_name"`
	Resource            *Resources        `json:"resource"`
	MaxEnvironments     int32             `json:"max_environments"`
	UserMaxEnvironments int32             `json:"user_max_environments"`
	Capacity            Capacity          `json:"capacity"`
	ImageReady          bool              `json:"image_ready"`
	ImageReason         string            `json:"image_reason,omitempty"`
	Billing             BillingConfig     `json:"billing"`
	Grants              []resource.Object `json:"grants"`
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
	out := SetupView{HostID: h.ID, HostName: h.Name, MaxEnvironments: h.MaxEnvironments, UserMaxEnvironments: h.UserMaxEnvironments}
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
	out.Capacity.MaxEnvironments = capacity.MaxEnvironments
	if len(h.Resource) > 0 && string(h.Resource) != "null" {
		var r Resources
		if json.Unmarshal(h.Resource, &r) != nil || r.Validate() != nil {
			return out, errors.New("宿主环境规格无效")
		}
		out.Resource = &r
	}
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
	if !uuid.MatchString(id) || in.MaxEnvironments < 0 || in.MaxEnvironments > 1000000 || in.UserMaxEnvironments < 0 || in.UserMaxEnvironments > 1000000 {
		return out, bad("环境数量上限无效")
	}
	if err := in.Resource.Validate(); err != nil {
		return out, bad(err.Error())
	}
	if in.Grants != nil {
		if err := validateHostGrants(*in.Grants); err != nil {
			return out, err
		}
	}
	if in.Billing != nil {
		if err := in.Billing.validate(); err != nil {
			return out, err
		}
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
		billing := current.Billing
		if in.Billing != nil {
			billing = *in.Billing
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
		if billing != current.Billing {
			if billing.Enabled && (billing.CPU > 0 || billing.Memory > 0) {
				if s.credits == nil {
					return conflict("billing_unavailable", "环境积分计费服务不可用")
				}
				if _, err = s.credits.ComputeEnabled(ctx, tx); err != nil {
					return err
				}
			}
			if err = q.CloseHostBillingPeriods(ctx, id); err != nil {
				return err
			}
			if hasActor {
				if err = audit.Write(ctx, tx, audit.Event{ActorID: actor.ID, Action: "environment.billing.update", Category: "billing", TargetType: "host", TargetID: id, Params: map[string]any{"before": current.Billing, "after": billing}}); err != nil {
					return err
				}
			}
		}
		raw, _ := json.Marshal(in.Resource)
		pricing, _ := json.Marshal(billing)
		if err = q.SetHostSetup(ctx, sqlc.SetHostSetupParams{HostID: id, Resource: raw, UserMaxEnvironments: in.UserMaxEnvironments, Billing: pricing}); err != nil {
			return err
		}
		if err = q.SetHostLimit(ctx, sqlc.SetHostLimitParams{ID: id, MaxEnvironments: in.MaxEnvironments}); err != nil {
			return err
		}
		out, err = s.setupView(ctx, q, id, tx)
		return err
	})
	if err == nil && in.Billing != nil {
		s.wakeBilling()
	}
	return out, err
}
