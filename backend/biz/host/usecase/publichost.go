package usecase

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"fmt"

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
}

var randUint64n = randomUint64n

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

	selected, err := pickWeightedHost(onlines)
	if err != nil {
		return nil, err
	}

	return cvt.From(selected, &domain.Host{}), nil
}

func pickWeightedHost(hosts []*db.Host) (*db.Host, error) {
	weights := make([]uint64, len(hosts))
	var totalWeight uint64
	for i, h := range hosts {
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

	offset, err := randUint64n(totalWeight)
	if err != nil {
		return nil, err
	}
	for i, w := range weights {
		if offset < w {
			return hosts[i], nil
		}
		offset -= w
	}

	return nil, errcode.ErrPublicHostNotFound.Wrap(fmt.Errorf("failed to select public host"))
}

func randomUint64n(n uint64) (uint64, error) {
	if n == 0 {
		return 0, fmt.Errorf("random upper bound must be positive")
	}

	limit := ^uint64(0) - (^uint64(0) % n)
	var buf [8]byte
	for {
		if _, err := rand.Read(buf[:]); err != nil {
			return 0, err
		}
		v := binary.BigEndian.Uint64(buf[:])
		if v < limit {
			return v % n, nil
		}
	}
}
