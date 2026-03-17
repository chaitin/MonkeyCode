package usecase

import (
	"context"
	"fmt"
	"sync/atomic"

	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

type PublicHostUsecase struct {
	repo     domain.PublicHostRepo
	taskflow taskflow.Clienter
	rr       uint64
}

func NewPublicHostUsecase(i *do.Injector) (domain.PublicHostUsecase, error) {
	return &PublicHostUsecase{
		repo:     do.MustInvoke[domain.PublicHostRepo](i),
		taskflow: do.MustInvoke[taskflow.Clienter](i),
	}, nil
}

// PickHost implements domain.PublicHostUsecase.
func (p *PublicHostUsecase) PickHost(ctx context.Context) (*domain.Host, error) {
	hs, err := p.repo.All(ctx)
	if err != nil {
		return nil, err
	}

	resp, err := p.taskflow.Host().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
		IDs: cvt.Iter(hs, func(_ int, h *db.Host) string { return h.ID }),
	})
	if err != nil {
		return nil, err
	}

	onlines := make([]*db.Host, 0)
	for _, h := range hs {
		if resp.OnlineMap[h.ID] {
			onlines = append(onlines, h)
		}
	}

	if len(onlines) == 0 {
		return nil, errcode.ErrPublicHostNotFound.Wrap(fmt.Errorf("no online public hosts found"))
	}

	weights := make([]uint64, len(onlines))
	var totalWeight uint64
	for i, h := range onlines {
		w := h.Weight
		if w <= 0 {
			w = 1
		}
		weights[i] = uint64(w)
		totalWeight += weights[i]
	}
	if totalWeight == 0 {
		return nil, errcode.ErrPublicHostNotFound.Wrap(fmt.Errorf("no valid weights found"))
	}

	idx := atomic.AddUint64(&p.rr, 1) - 1
	offset := idx % totalWeight
	var selected *db.Host
	for i, w := range weights {
		if offset < w {
			selected = onlines[i]
			break
		}
		offset -= w
	}
	if selected == nil {
		return nil, errcode.ErrPublicHostNotFound.Wrap(fmt.Errorf("failed to select public host"))
	}

	return cvt.From(selected, &domain.Host{}), nil
}
