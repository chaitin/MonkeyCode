package enginehost

import (
	"encoding/json"
	"net"
	"net/http"
	"net/netip"
	"slices"
)

func privateIP(ip netip.Addr) bool {
	return ip.IsPrivate() || netip.MustParsePrefix("100.64.0.0/10").Contains(ip)
}

func publicIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return ""
	}
	ip = ip.Unmap()
	// 与默认部署的审计来源规则一致：仅内网代理的 X-Real-IP 可覆盖连接地址。
	if ip.IsPrivate() {
		if values := r.Header.Values("X-Real-IP"); len(values) == 1 {
			if forwarded, err := netip.ParseAddr(values[0]); err == nil {
				ip = forwarded.Unmap()
			}
		}
	}
	if !ip.IsGlobalUnicast() || ip.IsLoopback() || privateIP(ip) || ip.Zone() != "" {
		return ""
	}
	return ip.String()
}

// 必须在验证原始心跳签名后补充，保留未知报告字段以兼容后续 engine。
func networkReport(raw json.RawMessage, r *http.Request) json.RawMessage {
	ip := publicIP(r)
	if ip == "" {
		return raw
	}
	var report map[string]json.RawMessage
	if json.Unmarshal(raw, &report) != nil {
		return raw
	}
	var system map[string]json.RawMessage
	if data := report["system"]; len(data) > 0 && json.Unmarshal(data, &system) != nil {
		return raw
	}
	if system == nil {
		system = make(map[string]json.RawMessage)
	}
	var addresses []string
	if data := system["public_ips"]; len(data) > 0 && json.Unmarshal(data, &addresses) != nil {
		return raw
	}
	if !slices.Contains(addresses, ip) && len(addresses) < 64 {
		addresses = append(addresses, ip)
	}
	system["public_ips"], _ = json.Marshal(addresses)
	report["system"], _ = json.Marshal(system)
	result, err := json.Marshal(report)
	if err != nil {
		return raw
	}
	return result
}
