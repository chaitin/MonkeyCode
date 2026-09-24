package endpoint

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"syscall"

	"github.com/jackc/pgx/v5"
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

func TestEndpointResponseSerializationFailure(t *testing.T) {
	w := httptest.NewRecorder()
	respond(w, http.StatusOK, make(chan int))
	if w.Code != http.StatusInternalServerError || strings.Contains(w.Body.String(), "chan") {
		t.Fatalf("未正确处理序列化失败: %d %q", w.Code, w.Body.String())
	}
}

func TestConnectionExpectedErrors(t *testing.T) {
	c := &connection{ctx: context.Background()}
	c.dead.Store(true)
	if c.expected(errors.New("forced close failure")) || !c.expected(io.EOF) || !c.expected(context.Canceled) || !c.expected(syscall.ECONNRESET) {
		t.Fatal("主动关闭未掩盖意外失败或误报了正常断开")
	}
}

type rollbackTestTx struct {
	pgx.Tx
	err error
}

func (tx rollbackTestTx) Rollback(context.Context) error { return tx.err }

func TestRollbackLoggingSkipsNormalErrorsAndRedactsDetails(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	rollback(context.Background(), rollbackTestTx{err: pgx.ErrTxClosed}, "user-1", "page")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	rollback(ctx, rollbackTestTx{err: errors.New("transaction canceled")}, "user-1", "page")
	rollback(context.Background(), rollbackTestTx{err: context.Canceled}, "user-1", "page")
	if logs.Len() != 0 {
		t.Fatalf("正常事务关闭或取消不应记录警告: %s", logs.String())
	}
	rollback(context.Background(), rollbackTestTx{err: errors.New("https://example.com/?token=private-token")}, "user-1", "page")
	if !strings.Contains(logs.String(), "error_type=") || !strings.Contains(logs.String(), "user_id=user-1") ||
		strings.Contains(logs.String(), "private-token") || strings.Contains(logs.String(), "token=") {
		t.Fatalf("回滚失败日志缺少安全上下文或泄露敏感信息: %s", logs.String())
	}
}
