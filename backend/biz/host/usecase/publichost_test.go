package usecase

import (
	"context"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestPickHostSelectsHostByRandomOffset(t *testing.T) {
	repo := &publicHostRepoStub{
		hosts: []*db.Host{
			{ID: "host-a", Hostname: "a", Weight: 1},
			{ID: "host-b", Hostname: "b", Weight: 3},
			{ID: "host-c", Hostname: "c", Weight: 1},
		},
	}
	hoster := &publicHosterStub{
		onlineMap: map[string]bool{
			"host-a": true,
			"host-b": true,
			"host-c": true,
		},
	}
	u := &PublicHostUsecase{
		repo:     repo,
		taskflow: &taskflowClientStub{hoster: hoster},
	}

	offsets := []uint64{0, 1, 3, 4}
	limits := make([]uint64, 0, len(offsets))
	prevRandUint64n := randUint64n
	randUint64n = func(n uint64) (uint64, error) {
		limits = append(limits, n)
		v := offsets[0]
		offsets = offsets[1:]
		return v, nil
	}
	t.Cleanup(func() {
		randUint64n = prevRandUint64n
	})

	got := make([]string, 0, 4)
	for range 4 {
		host, err := u.PickHost(context.Background())
		if err != nil {
			t.Fatalf("PickHost() error = %v", err)
		}
		got = append(got, host.ID)
	}

	want := []string{"host-a", "host-b", "host-b", "host-c"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("PickHost() at %d = %q, want %q", i, got[i], want[i])
		}
	}

	for _, limit := range limits {
		if limit != 5 {
			t.Fatalf("rand limit = %d, want 5", limit)
		}
	}
}

func TestPickHostTreatsNonPositiveWeightsAsOne(t *testing.T) {
	u := &PublicHostUsecase{
		repo: &publicHostRepoStub{
			hosts: []*db.Host{
				{ID: "host-a", Hostname: "a", Weight: 0},
				{ID: "host-b", Hostname: "b", Weight: -2},
			},
		},
		taskflow: &taskflowClientStub{
			hoster: &publicHosterStub{
				onlineMap: map[string]bool{
					"host-a": true,
					"host-b": true,
				},
			},
		},
	}

	prevRandUint64n := randUint64n
	randUint64n = func(n uint64) (uint64, error) {
		if n != 2 {
			t.Fatalf("rand limit = %d, want 2", n)
		}
		return 1, nil
	}
	t.Cleanup(func() {
		randUint64n = prevRandUint64n
	})

	host, err := u.PickHost(context.Background())
	if err != nil {
		t.Fatalf("PickHost() error = %v", err)
	}
	if host.ID != "host-b" {
		t.Fatalf("PickHost() = %q, want %q", host.ID, "host-b")
	}
}

type publicHostRepoStub struct {
	hosts []*db.Host
	err   error
}

func (s *publicHostRepoStub) All(context.Context) ([]*db.Host, error) {
	return s.hosts, s.err
}

type publicHosterStub struct {
	onlineMap map[string]bool
	err       error
}

func (s *publicHosterStub) List(context.Context, string) (map[string]*taskflow.Host, error) {
	return nil, nil
}

func (s *publicHosterStub) IsOnline(context.Context, *taskflow.IsOnlineReq[string]) (*taskflow.IsOnlineResp, error) {
	if s.err != nil {
		return nil, s.err
	}
	return &taskflow.IsOnlineResp{OnlineMap: s.onlineMap}, nil
}

type taskflowClientStub struct {
	hoster taskflow.Hoster
}

func (s *taskflowClientStub) VirtualMachiner() taskflow.VirtualMachiner { return nil }
func (s *taskflowClientStub) Host() taskflow.Hoster                     { return s.hoster }
func (s *taskflowClientStub) FileManager() taskflow.FileManager         { return nil }
func (s *taskflowClientStub) TaskManager() taskflow.TaskManager         { return nil }
func (s *taskflowClientStub) PortForwarder() taskflow.PortForwarder     { return nil }
func (s *taskflowClientStub) Stats(context.Context) (*taskflow.Stats, error) {
	return nil, nil
}
func (s *taskflowClientStub) TaskLive(context.Context, string, bool, func(*taskflow.TaskChunk) error) error {
	return nil
}
