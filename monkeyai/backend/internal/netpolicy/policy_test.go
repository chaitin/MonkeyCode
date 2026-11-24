package netpolicy

import (
	"context"
	"errors"
	"net/netip"
	"testing"
)

func TestMixedAnswersAndReadErrors(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "10.0.0.0/8")
	ips := []netip.Addr{netip.MustParseAddr("1.1.1.1"), netip.MustParseAddr("::ffff:10.1.2.3")}
	var read Reader = func(context.Context) ([]netip.Prefix, error) {
		return []netip.Prefix{netip.MustParsePrefix("10.1.0.0/16")}, nil
	}
	if err := read.Check(t.Context(), ips); !errors.Is(err, ErrDenied) {
		t.Fatal(err)
	}
	var empty Reader
	if err := empty.Check(t.Context(), ips); err != nil {
		t.Fatal(err)
	}
	if err := empty.Check(t.Context(), []netip.Addr{netip.MustParseAddr("127.0.0.1")}); !errors.Is(err, ErrDenied) {
		t.Fatal("空名单不得关闭基础限制")
	}
	failure := errors.New("读取失败")
	read = func(context.Context) ([]netip.Prefix, error) { return nil, failure }
	if !errors.Is(read.Check(t.Context(), ips), failure) {
		t.Fatal("配置故障不得放行")
	}
}
