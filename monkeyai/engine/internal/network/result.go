package network

import (
	"encoding/json"
	"errors"
	"net/netip"
)

func connection(raw []byte, b binding) (Connection, error) {
	var result struct {
		Interfaces []struct {
			Name    string `json:"name"`
			Sandbox string `json:"sandbox"`
		} `json:"interfaces"`
		IPs []struct {
			Interface *int   `json:"interface"`
			Address   string `json:"address"`
			Gateway   string `json:"gateway"`
		} `json:"ips"`
	}
	if json.Unmarshal(raw, &result) != nil || len(result.Interfaces) != 2 || len(result.IPs) != 1 {
		return Connection{}, errors.New("CNI 结果结构无效")
	}
	c := Connection{Gateway: result.IPs[0].Gateway}
	address, err := netip.ParsePrefix(result.IPs[0].Address)
	if err != nil {
		return c, err
	}
	c.Address = address.Addr().String()
	index := result.IPs[0].Interface
	if index == nil || *index < 0 || *index >= len(result.Interfaces) || result.Interfaces[*index].Name != "eth0" || result.Interfaces[*index].Sandbox != b.path() {
		return c, errors.New("CNI 容器接口不匹配")
	}
	for _, iface := range result.Interfaces {
		if iface.Sandbox == "" {
			c.Device = iface.Name
		}
	}
	if !c.validate(b.Config) {
		return c, errors.New("CNI 地址或宿主接口无效")
	}
	return c, nil
}
