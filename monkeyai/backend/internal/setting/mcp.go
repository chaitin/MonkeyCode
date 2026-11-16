package setting

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"strings"
)

func parseMCPBlockedCIDRs(raw json.RawMessage) ([]netip.Prefix, error) {
	var cidrs []string
	if json.Unmarshal(raw, &cidrs) != nil || cidrs == nil {
		return nil, errors.New("MCP 黑名单必须是 CIDR 字符串数组")
	}
	prefixes := make([]netip.Prefix, 0, len(cidrs))
	for i, cidr := range cidrs {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(cidr))
		if err != nil || (prefix.Addr().Is4In6() && prefix.Bits() < 96) {
			return nil, fmt.Errorf("第 %d 个 MCP 黑名单 IP 段无效，请使用 IPv4 或 IPv6 CIDR", i+1)
		}
		if prefix.Addr().Is4In6() {
			prefix = netip.PrefixFrom(prefix.Addr().Unmap(), prefix.Bits()-96)
		}
		prefixes = append(prefixes, prefix.Masked())
	}
	return prefixes, nil
}

func (s *Service) MCPBlockedCIDRs(ctx context.Context) ([]netip.Prefix, error) {
	value, err := s.GetValue(ctx, "mcp")
	if err != nil {
		return nil, err
	}
	var config struct {
		BlockedCIDRs json.RawMessage `json:"blocked_cidrs"`
	}
	if err := json.Unmarshal(value, &config); err != nil {
		return nil, err
	}
	return parseMCPBlockedCIDRs(config.BlockedCIDRs)
}
