package endpoint

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/GoYoko/web"
	"github.com/alicebob/miniredis/v2"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	_ "github.com/mattn/go-sqlite3"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	endpointdb "github.com/chaitin/MonkeyCode/backend/db/endpoint"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/session"
)

func TestBridgeDiscoversAndRoutesAcrossInstances(t *testing.T) {
	ctx := context.Background()
	dbClient := enttest.Open(t, "sqlite3", fmt.Sprintf("file:endpoint-bridge-%s?mode=memory&cache=shared&_fk=1", uuid.NewString()))
	t.Cleanup(func() { _ = dbClient.Close() })
	redisServer := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	user := createBridgeUser(t, dbClient)
	cookie := createBridgeSession(t, redisServer.Addr(), user)
	serverA := newBridgeTestServer(t, dbClient, rdb, redisServer.Addr(), "instance-a")
	serverB := newBridgeTestServer(t, dbClient, rdb, redisServer.Addr(), "instance-b")

	machineA := uuid.NewString()
	machineB := uuid.NewString()
	connA := connectBridge(t, serverA.URL, cookie, machineA, "桌面端", "macos")
	defer connA.Close(websocket.StatusNormalClosure, "")
	assertMessageType(t, readBridgeMessage(t, connA), "welcome")
	assertDirectory(t, readBridgeMessage(t, connA), machineA)

	connB := connectBridge(t, serverB.URL, cookie, machineB, "移动端", "ios")
	defer connB.Close(websocket.StatusNormalClosure, "")
	assertMessageType(t, readBridgeMessage(t, connB), "welcome")
	assertDirectory(t, readBridgeMessage(t, connB), machineA, machineB)
	assertDirectory(t, readUntilDirectory(t, connA, machineA, machineB), machineA, machineB)

	requestID := uuid.NewString()
	writeBridgeMessage(t, connA, map[string]any{
		"type":       "request",
		"message_id": requestID,
		"target":     machineB,
		"method":     "agent.continue",
		"payload":    map[string]any{"task_id": "task-1"},
	})
	request := readUntilType(t, connB, "request")
	if request["source"] != machineA || request["target"] != machineB || request["message_id"] != requestID {
		t.Fatalf("转发请求身份不正确: %#v", request)
	}
	if _, ok := request["routed_at"].(float64); !ok {
		t.Fatalf("转发请求缺少 routed_at: %#v", request)
	}

	responseID := uuid.NewString()
	writeBridgeMessage(t, connB, map[string]any{
		"type":       "response",
		"message_id": responseID,
		"target":     machineA,
		"reply_to":   requestID,
		"payload":    map[string]any{"accepted": true},
	})
	response := readUntilType(t, connA, "response")
	if response["source"] != machineB || response["reply_to"] != requestID || response["message_id"] != responseID {
		t.Fatalf("转发响应关联不正确: %#v", response)
	}

	offlineID := uuid.NewString()
	writeBridgeMessage(t, connA, map[string]any{
		"type":       "event",
		"message_id": uuid.NewString(),
		"target":     offlineID,
		"method":     "agent.notice",
		"payload":    map[string]any{},
	})
	protocolError := readUntilType(t, connA, "error")
	errorBody, _ := protocolError["error"].(map[string]any)
	if errorBody["code"] != "target_unavailable" {
		t.Fatalf("未知目标错误 = %#v", protocolError)
	}

	if got := rdb.TTL(ctx, presenceKey(user.ID, uuid.MustParse(machineA))).Val(); got <= 0 {
		t.Fatalf("端点在线租约未建立: %v", got)
	}
}

func TestBridgeIsolatesUsersAndManagesEndpointLifecycle(t *testing.T) {
	dbClient := enttest.Open(t, "sqlite3", fmt.Sprintf("file:endpoint-management-%s?mode=memory&cache=shared&_fk=1", uuid.NewString()))
	t.Cleanup(func() { _ = dbClient.Close() })
	redisServer := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	owner := createBridgeUser(t, dbClient)
	other := createBridgeUser(t, dbClient)
	ownerCookie := createBridgeSession(t, redisServer.Addr(), owner)
	otherCookie := createBridgeSession(t, redisServer.Addr(), other)
	serverA := newBridgeTestServer(t, dbClient, rdb, redisServer.Addr(), "management-a")
	serverB := newBridgeTestServer(t, dbClient, rdb, redisServer.Addr(), "management-b")

	machineA := uuid.NewString()
	machineB := uuid.NewString()
	machineOther := uuid.NewString()
	connA := connectBridge(t, serverA.URL, ownerCookie, machineA, "办公电脑", "macos")
	defer connA.Close(websocket.StatusNormalClosure, "")
	assertMessageType(t, readBridgeMessage(t, connA), "welcome")
	assertDirectory(t, readBridgeMessage(t, connA), machineA)
	connB := connectBridge(t, serverB.URL, ownerCookie, machineB, "手机", "ios")
	assertMessageType(t, readBridgeMessage(t, connB), "welcome")
	assertDirectory(t, readBridgeMessage(t, connB), machineA, machineB)
	readUntilDirectory(t, connA, machineA, machineB)

	connOther := connectBridge(t, serverA.URL, otherCookie, machineOther, "其他用户", "android")
	defer connOther.Close(websocket.StatusNormalClosure, "")
	assertMessageType(t, readBridgeMessage(t, connOther), "welcome")
	assertDirectory(t, readBridgeMessage(t, connOther), machineOther)

	messageID := uuid.NewString()
	writeBridgeMessage(t, connA, map[string]any{
		"type":       "event",
		"message_id": messageID,
		"target":     machineOther,
		"method":     "agent.notice",
		"payload":    map[string]any{},
	})
	protocolError := readUntilType(t, connA, "error")
	errorBody, _ := protocolError["error"].(map[string]any)
	if errorBody["code"] != "target_unavailable" {
		t.Fatalf("跨用户路由错误 = %#v", protocolError)
	}

	list := requestBridgeAPI(t, http.MethodGet, serverA.URL+"/api/v1/endpoints", ownerCookie, nil)
	items, _ := list["data"].([]any)
	if len(items) != 2 {
		t.Fatalf("当前用户端点数量 = %d, want 2: %#v", len(items), list)
	}

	alias := "随身手机"
	updated := requestBridgeAPI(
		t,
		http.MethodPatch,
		serverA.URL+"/api/v1/endpoints/"+machineB,
		ownerCookie,
		map[string]any{"alias": alias},
	)
	data, _ := updated["data"].(map[string]any)
	if data["display_name"] != alias {
		t.Fatalf("端点别名未更新: %#v", updated)
	}

	requestBridgeAPI(t, http.MethodPost, serverA.URL+"/api/v1/endpoints/"+machineB+"/revoke", ownerCookie, nil)
	if status := waitForBridgeClose(t, connB); status != websocket.StatusCode(4002) {
		t.Fatalf("撤销关闭码 = %d, want 4002", status)
	}
	readUntilDirectory(t, connA, machineA)
	waitForEndpointOffline(t, rdb, owner.ID, uuid.MustParse(machineB))

	requestBridgeAPI(t, http.MethodPost, serverA.URL+"/api/v1/endpoints/"+machineB+"/restore", ownerCookie, nil)
	readUntilDirectory(t, connA, machineA, machineB)
	restored := connectBridge(t, serverB.URL, ownerCookie, machineB, "手机", "ios")
	assertMessageType(t, readBridgeMessage(t, restored), "welcome")
	assertDirectory(t, readBridgeMessage(t, restored), machineA, machineB)
	replacement := connectBridge(t, serverA.URL, ownerCookie, machineB, "手机", "ios")
	defer replacement.Close(websocket.StatusNormalClosure, "")
	assertMessageType(t, readBridgeMessage(t, replacement), "welcome")
	assertDirectory(t, readBridgeMessage(t, replacement), machineA, machineB)
	if status := waitForBridgeClose(t, restored); status != websocket.StatusCode(4001) {
		t.Fatalf("连接替换关闭码 = %d, want 4001", status)
	}
}

func TestRestoreRemainsIdempotentWhenEndpointIsRestoredWhileWaitingForLock(t *testing.T) {
	ctx := context.Background()
	dbClient := enttest.Open(t, "sqlite3", fmt.Sprintf("file:endpoint-restore-%s?mode=memory&cache=shared&_fk=1", uuid.NewString()))
	t.Cleanup(func() { _ = dbClient.Close() })
	redisServer := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	user := createBridgeUser(t, dbClient)
	cookie := createBridgeSession(t, redisServer.Addr(), user)
	server := newBridgeTestServerWithConfig(t, dbClient, rdb, redisServer.Addr(), "restore", func(cfg *config.Config) {
		cfg.EndpointBridge.MaxEndpoints = 1
	})
	machineID := uuid.New()
	item, err := dbClient.Endpoint.Create().
		SetUserID(user.ID).
		SetMachineID(machineID).
		SetDeviceName("手机").
		SetPlatform(endpointdb.PlatformIos).
		SetOsVersion("1.0").
		SetArch("arm64").
		SetClientVersion("test").
		SetStatus(endpointdb.StatusRevoked).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	lockKey := "endpoint:registration:" + user.ID.String()
	if err := rdb.Set(ctx, lockKey, "other", 5*time.Second).Err(); err != nil {
		t.Fatal(err)
	}
	commandCount := redisServer.CommandCount()
	result := make(chan error, 1)
	go func() {
		req, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/endpoints/"+machineID.String()+"/restore", nil)
		if err != nil {
			result <- err
			return
		}
		req.AddCookie(cookie)
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			result <- err
			return
		}
		defer response.Body.Close()
		var payload map[string]any
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			result <- err
			return
		}
		if response.StatusCode != http.StatusOK || payload["code"] != float64(0) {
			result <- fmt.Errorf("恢复端点失败: status=%d payload=%v", response.StatusCode, payload)
			return
		}
		result <- nil
	}()

	deadline := time.Now().Add(time.Second)
	for redisServer.CommandCount() < commandCount+3 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if redisServer.CommandCount() < commandCount+3 {
		t.Fatal("恢复请求未等待注册锁")
	}
	for {
		_, err = item.Update().SetStatus(endpointdb.StatusActive).Save(ctx)
		if err == nil {
			break
		}
		if !strings.Contains(err.Error(), "database table is locked") || time.Now().After(deadline) {
			t.Fatal(err)
		}
		time.Sleep(time.Millisecond)
	}
	if err := rdb.Del(ctx, lockKey).Err(); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func TestBridgeRejectsUntrustedOriginAndInvalidEnvelope(t *testing.T) {
	dbClient := enttest.Open(t, "sqlite3", fmt.Sprintf("file:endpoint-security-%s?mode=memory&cache=shared&_fk=1", uuid.NewString()))
	t.Cleanup(func() { _ = dbClient.Close() })
	redisServer := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	user := createBridgeUser(t, dbClient)
	cookie := createBridgeSession(t, redisServer.Addr(), user)
	server := newBridgeTestServer(t, dbClient, rdb, redisServer.Addr(), "security")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	header := http.Header{}
	header.Set("Cookie", cookie.String())
	header.Set("Origin", "https://evil.example.com")
	conn, response, err := websocket.Dial(
		ctx,
		"ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/endpoints/connect",
		&websocket.DialOptions{HTTPHeader: header},
	)
	if conn != nil {
		_ = conn.CloseNow()
	}
	if err == nil || response == nil || response.StatusCode != http.StatusForbidden {
		t.Fatalf("不可信 Origin 应被拒绝: response=%v err=%v", response, err)
	}

	machineID := uuid.NewString()
	valid := connectBridge(t, server.URL, cookie, machineID, "桌面端", "macos")
	defer valid.Close(websocket.StatusNormalClosure, "")
	assertMessageType(t, readBridgeMessage(t, valid), "welcome")
	assertDirectory(t, readBridgeMessage(t, valid), machineID)
	writeBridgeMessage(t, valid, map[string]any{
		"type":       "event",
		"message_id": uuid.NewString(),
		"target":     machineID,
		"method":     "agent.notice",
		"source":     machineID,
		"payload":    map[string]any{},
	})
	protocolError := readUntilType(t, valid, "error")
	errorBody, _ := protocolError["error"].(map[string]any)
	if errorBody["code"] != "invalid_message" {
		t.Fatalf("伪造来源错误 = %#v", protocolError)
	}

	messageID := uuid.NewString()
	writeBridgeMessage(t, valid, map[string]any{
		"type":       "request",
		"message_id": messageID,
		"target":     machineID,
		"method":     "Invalid Method",
		"payload":    map[string]any{},
	})
	protocolError = readUntilType(t, valid, "error")
	if protocolError["reply_to"] != messageID {
		t.Fatalf("可识别消息的协议错误未关联原消息: %#v", protocolError)
	}
}

func TestHandshakeCloseStatusAllowsServiceUnavailableRetry(t *testing.T) {
	if got := handshakeCloseStatus(errServiceUnavailable); got != websocket.StatusTryAgainLater {
		t.Fatalf("服务不可用关闭码 = %d, want %d", got, websocket.StatusTryAgainLater)
	}
	if got := handshakeCloseStatus(errUnsupportedData); got != websocket.StatusUnsupportedData {
		t.Fatalf("二进制握手关闭码 = %d, want %d", got, websocket.StatusUnsupportedData)
	}
}

func TestDevelopmentPlainWebSocketOnlyAllowsLoopback(t *testing.T) {
	bridge := &Bridge{config: bridgeConfig{debug: true}}
	external := httptest.NewRequest(http.MethodGet, "http://example.com/api/v1/endpoints/connect", nil)
	if err := bridge.validateUpgrade(external); err == nil {
		t.Fatal("开发环境不应允许非本机明文 WebSocket")
	}
	loopback := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/v1/endpoints/connect", nil)
	if err := bridge.validateUpgrade(loopback); err != nil {
		t.Fatalf("开发环境本机明文 WebSocket 被拒绝: %v", err)
	}
}

func newBridgeTestServer(t *testing.T, dbClient *db.Client, rdb *redis.Client, redisAddr, instanceID string) *httptest.Server {
	t.Helper()
	return newBridgeTestServerWithConfig(t, dbClient, rdb, redisAddr, instanceID, nil)
}

func newBridgeTestServerWithConfig(
	t *testing.T,
	dbClient *db.Client,
	rdb *redis.Client,
	redisAddr string,
	instanceID string,
	configure func(*config.Config),
) *httptest.Server {
	t.Helper()
	host, portText, err := net.SplitHostPort(redisAddr)
	if err != nil {
		t.Fatal(err)
	}
	var port int
	if _, err := fmt.Sscanf(portText, "%d", &port); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{}
	cfg.Debug = true
	cfg.Redis.Host = host
	cfg.Redis.Port = port
	cfg.Session.ExpireDay = 1
	cfg.EndpointBridge.InstanceID = instanceID
	cfg.EndpointBridge.AllowedOrigins = []string{"https://app.example.com"}
	if configure != nil {
		configure(cfg)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	sess := session.New(cfg)
	auth := middleware.NewAuthMiddleware(sess, nil, logger)
	w := web.New()
	e := w.Echo()
	bridge := newBridge(dbClient, rdb, cfg, logger)
	bridge.Register(w, auth)
	t.Cleanup(func() { bridge.Close() })
	server := httptest.NewServer(e)
	t.Cleanup(server.Close)
	return server
}

func createBridgeUser(t *testing.T, client *db.Client) *domain.User {
	t.Helper()
	user := &domain.User{
		ID:     uuid.New(),
		Name:   "端点测试用户",
		Role:   consts.UserRoleIndividual,
		Status: consts.UserStatusActive,
	}
	if _, err := client.User.Create().
		SetID(user.ID).
		SetName(user.Name).
		SetRole(user.Role).
		SetStatus(user.Status).
		Save(context.Background()); err != nil {
		t.Fatal(err)
	}
	return user
}

func createBridgeSession(t *testing.T, redisAddr string, user *domain.User) *http.Cookie {
	t.Helper()
	host, portText, err := net.SplitHostPort(redisAddr)
	if err != nil {
		t.Fatal(err)
	}
	var port int
	if _, err := fmt.Sscanf(portText, "%d", &port); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{}
	cfg.Redis.Host = host
	cfg.Redis.Port = port
	cfg.Session.ExpireDay = 1
	sess := session.New(cfg)
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	if _, err := sess.Save(c, consts.MonkeyCodeAISession, user.ID, user); err != nil {
		t.Fatal(err)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("登录 Cookie 数量 = %d", len(cookies))
	}
	return cookies[0]
}

func connectBridge(t *testing.T, baseURL string, cookie *http.Cookie, machineID, deviceName, platform string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	header := http.Header{}
	header.Set("Cookie", cookie.String())
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(baseURL, "http")+"/api/v1/endpoints/connect", &websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		t.Fatal(err)
	}
	writeBridgeMessage(t, conn, map[string]any{
		"type":              "hello",
		"protocol_versions": []int{1},
		"machine_id":        machineID,
		"profile": map[string]any{
			"device_name":    deviceName,
			"platform":       platform,
			"os_version":     "1.0",
			"arch":           "arm64",
			"client_version": "test",
		},
	})
	return conn
}

func writeBridgeMessage(t *testing.T, conn *websocket.Conn, value any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := wsjson.Write(ctx, conn, value); err != nil {
		t.Fatal(err)
	}
}

func readBridgeMessage(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var message map[string]any
	if err := wsjson.Read(ctx, conn, &message); err != nil {
		t.Fatal(err)
	}
	return message
}

func requestBridgeAPI(t *testing.T, method, url string, cookie *http.Cookie, body any) map[string]any {
	t.Helper()
	var raw []byte
	if body != nil {
		var err error
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, url, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(cookie)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || payload["code"] != float64(0) {
		t.Fatalf("%s %s 失败: status=%d payload=%#v", method, url, response.StatusCode, payload)
	}
	return payload
}

func waitForBridgeClose(t *testing.T, conn *websocket.Conn) websocket.StatusCode {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		_, _, err := conn.Read(ctx)
		if err == nil {
			continue
		}
		return websocket.CloseStatus(err)
	}
}

func waitForEndpointOffline(t *testing.T, rdb *redis.Client, userID, machineID uuid.UUID) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if rdb.Exists(context.Background(), presenceKey(userID, machineID)).Val() == 0 {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("端点在线租约未及时清理: %s", machineID)
}

func readUntilType(t *testing.T, conn *websocket.Conn, messageType string) map[string]any {
	t.Helper()
	for range 8 {
		message := readBridgeMessage(t, conn)
		if message["type"] == messageType {
			return message
		}
	}
	t.Fatalf("未收到消息类型 %s", messageType)
	return nil
}

func readUntilDirectory(t *testing.T, conn *websocket.Conn, machines ...string) map[string]any {
	t.Helper()
	for range 8 {
		message := readBridgeMessage(t, conn)
		if message["type"] != "directory.snapshot" {
			continue
		}
		items, _ := message["endpoints"].([]any)
		found := make(map[string]bool, len(items))
		for _, item := range items {
			endpoint, _ := item.(map[string]any)
			found[fmt.Sprint(endpoint["machine_id"])] = true
		}
		if len(found) != len(machines) {
			continue
		}
		matches := true
		for _, machineID := range machines {
			matches = matches && found[machineID]
		}
		if matches {
			return message
		}
	}
	t.Fatalf("未收到期望的完整端点目录: %v", machines)
	return nil
}

func assertMessageType(t *testing.T, message map[string]any, want string) {
	t.Helper()
	if message["type"] != want {
		raw, _ := json.Marshal(message)
		t.Fatalf("消息类型 = %v, want %s, message=%s", message["type"], want, raw)
	}
}

func assertDirectory(t *testing.T, message map[string]any, machines ...string) {
	t.Helper()
	assertMessageType(t, message, "directory.snapshot")
	items, ok := message["endpoints"].([]any)
	if !ok {
		t.Fatalf("目录格式错误: %#v", message)
	}
	got := make(map[string]bool, len(items))
	for _, item := range items {
		endpoint, _ := item.(map[string]any)
		got[fmt.Sprint(endpoint["machine_id"])] = true
	}
	for _, machineID := range machines {
		if !got[machineID] {
			t.Fatalf("目录缺少 %s: %#v", machineID, message)
		}
	}
	if len(got) != len(machines) {
		t.Fatalf("目录端点数量 = %d, want %d: %#v", len(got), len(machines), message)
	}
}
