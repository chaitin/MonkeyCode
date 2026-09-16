package endpoint

import (
	"encoding/json"
	"strings"
	"testing"
)

const machineA = "4f1207be-1ce0-4e88-8e3e-e92690567ec8"
const machineB = "dc9e38fe-c928-42b1-b8eb-e8ca41d712fe"
const messageID = "6ccdf7ee-10c2-4926-86ce-8f9ca82aa2ca"

func TestMessageValidation(t *testing.T) {
	base := `{"type":"request","message_id":"` + messageID + `","target":"` + machineB + `","method":"agent.example","payload":{"n":9007199254740993}}`
	tests := map[string]string{
		"duplicate":         strings.Replace(base, `"type":"request"`, `"type":"request","type":"event"`, 1),
		"duplicate_payload": strings.Replace(base, `9007199254740993}`, `1,"n":2}`, 1),
		"source":            strings.Replace(base, `"method"`, `"source":"`+machineA+`","method"`, 1),
		"null_source":       strings.Replace(base, `"method"`, `"source":null,"method"`, 1),
		"reply_on_request":  strings.Replace(base, `"method"`, `"reply_to":null,"method"`, 1),
		"uuid":              strings.Replace(base, machineB, strings.ToUpper(machineB), 1),
		"payload_array":     strings.Replace(base, `{"n":9007199254740993}`, `[]`, 1),
		"payload_null":      strings.Replace(base, `{"n":9007199254740993}`, `null`, 1),
		"method":            strings.Replace(base, "agent.example", "Agent/example", 1),
		"extra_json":        base + `{}`,
		"depth":             strings.Replace(base, `9007199254740993`, strings.Repeat("[", 65)+"0"+strings.Repeat("]", 65), 1),
		"encoding":          strings.Replace(base, "example", string([]byte{0xff}), 1),
	}
	for name, data := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := message([]byte(data)); err == nil {
				t.Fatal("接受了无效消息")
			}
		})
	}
	m, err := message([]byte(base))
	if err != nil {
		t.Fatal(err)
	}
	m.Source = machineA
	m.RoutedAt = 1
	data, err := json.Marshal(m)
	if err != nil || !strings.Contains(string(data), "9007199254740993") {
		t.Fatalf("载荷精度发生变化: %s %v", data, err)
	}
	aliased := strings.Replace(base, `"method"`, `"Type":"response","Reply_To":"`+messageID+`","method"`, 1)
	parsed, err := message([]byte(aliased))
	if err != nil || parsed.Type != "request" || parsed.ReplyTo != "" {
		t.Fatalf("未知大小写字段覆盖信封: %+v %v", parsed, err)
	}
	unknown := strings.Replace(base, `"method"`, `"future":true,"method"`, 1)
	m, err = message([]byte(unknown))
	if err != nil {
		t.Fatal(err)
	}
	data, _ = json.Marshal(m)
	if strings.Contains(string(data), "future") {
		t.Fatal("转发了未知信封字段")
	}
}

func TestHelloValidation(t *testing.T) {
	h := Hello{Type: "hello", Versions: []int{1}, MachineID: machineA, Profile: Profile{"电脑", "macos", "15", "arm64", "1"}}
	data, _ := json.Marshal(h)
	if _, err := hello(data); err != nil {
		t.Fatal(err)
	}
	for _, versions := range [][]int{{}, {1, 1}, {0, 1}, {2}} {
		h.Versions = versions
		data, _ = json.Marshal(h)
		if _, err := hello(data); err == nil {
			t.Fatalf("接受了版本列表 %v", versions)
		}
	}
	h.Versions = []int{1}
	h.Profile.DeviceName = strings.Repeat("中", 43)
	data, _ = json.Marshal(h)
	if _, err := hello(data); err == nil {
		t.Fatal("未按 UTF-8 字节限制名称")
	}
}

func TestOrigin(t *testing.T) {
	for in, want := range map[string]string{"https://EXAMPLE.com:443/path": "https://example.com", "http://[::1]:80": "http://[::1]", "https://example.com:8443": "https://example.com:8443", "null": "", "https://user:pass@example.com": ""} {
		if got := origin(in); got != want {
			t.Fatalf("origin(%q)=%q, want %q", in, got, want)
		}
	}
}
