package endpoint

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"uuid"
)

const deviceBody = `{"device_name":"电脑","platform":"web","os_version":"15","arch":"arm64","client_version":"1","protocol_version":null,"client_type":"web","client_name":"浏览器","channel":"stable","locale":"zh-CN","system_locale":"en-US","timezone":"Asia/Shanghai","runtime_version":"1.2","engine_version":"2.3","electron_version":"3.4"}`

func TestRegistrationValidation(t *testing.T) {
	if r, err := registration([]byte(deviceBody)); err != nil || r.Platform != "web" || r.ProtocolVersion != nil || r.ClientName == nil {
		t.Fatalf("合法登记未解码: %+v %v", r, err)
	}
	for _, body := range []string{
		`{}`, `{"device_name":"电脑","device_name":"其它"}`,
		strings.Replace(deviceBody, `"device_name"`, `"Device_Name"`, 1),
		strings.Replace(deviceBody, `"protocol_version":null`, `"protocol_version":0`, 1),
		strings.Replace(deviceBody, `"protocol_version":null`, `"protocol_version":2147483648`, 1),
		strings.Replace(deviceBody, `"client_type":"web"`, `"client_type":""`, 1),
		strings.Replace(deviceBody, `"timezone":"Asia/Shanghai"`, `"timezone":"\n"`, 1),
		strings.Replace(deviceBody, `"device_name":"电脑"`, `"device_name":"`+strings.Repeat("x", 129)+`"`, 1),
		strings.TrimSuffix(deviceBody, "}") + `,"machine_id":"` + machineA + `"}`,
		strings.TrimSuffix(deviceBody, "}") + `,"access_token":"secret"}`,
		deviceBody + `{}`,
	} {
		if _, err := registration([]byte(body)); err == nil {
			t.Fatalf("非法登记被接受: %s", body)
		}
	}
}

func TestDeviceRegistration(t *testing.T) {
	f := newFixture(t)
	if code, _ := call(t, f, "PUT", "/endpoints/"+machineA, deviceBody, ""); code != 401 {
		t.Fatalf("未鉴权登记: %d", code)
	}
	observer := dial(t, f, machineB, "owner")
	code, data := call(t, f, "PUT", "/endpoints/"+machineA, deviceBody, "owner")
	if code != 200 || !bytes.Contains(data, []byte(`"protocol_version":null`)) || !bytes.Contains(data, []byte(`"last_reported_at":`)) || !bytes.Contains(data, []byte(`"online":false`)) {
		t.Fatalf("设备登记失败: %d %s", code, data)
	}
	snapshot := readWS(t, observer, "directory.snapshot")
	if !bytes.Contains(snapshot["endpoints"], []byte(`"machine_id":"`+machineA+`"`)) || !bytes.Contains(snapshot["endpoints"], []byte(`"client_name":"浏览器"`)) {
		t.Fatalf("目录未广播登记: %s", snapshot)
	}
	code, data = call(t, f, "GET", "/endpoints/"+machineA, "", "owner")
	if code != 200 || !bytes.Contains(data, []byte(`"last_seen_at":null`)) || !bytes.Contains(data, []byte(`"platform":"web"`)) {
		t.Fatalf("登记内容不正确: %d %s", code, data)
	}
	if code, _ = call(t, f, "GET", "/endpoints/"+machineA, "", "other"); code != 404 {
		t.Fatalf("跨用户获取登记: %d", code)
	}
	if code, _ = call(t, f, "PATCH", "/endpoints/"+machineA, `{"alias":"常用电脑"}`, "owner"); code != 200 {
		t.Fatal(code)
	}
	readWS(t, observer, "directory.snapshot")
	code, data = call(t, f, "PUT", "/endpoints/"+machineA, strings.Replace(deviceBody, `"device_name":"电脑"`, `"device_name":"新电脑"`, 1), "owner")
	if code != 200 || !bytes.Contains(data, []byte(`"display_name":"常用电脑"`)) || !bytes.Contains(data, []byte(`"device_name":"新电脑"`)) {
		t.Fatalf("重复登记覆盖别名: %d %s", code, data)
	}
	readWS(t, observer, "directory.snapshot")
	if code, _ = call(t, f, "PUT", "/endpoints/"+machineA, strings.TrimSuffix(deviceBody, "}")+`,"last_reported_at":123}`, "owner"); code != 400 {
		t.Fatalf("客户端伪造报告时间: %d", code)
	}
	if code, _ = call(t, f, "PUT", "/endpoints/"+machineA, deviceBody+strings.Repeat(" ", 4096), "owner"); code != 400 {
		t.Fatalf("超长请求未拒绝: %d", code)
	}
	if code, _ = call(t, f, "POST", "/endpoints/"+machineA+"/revoke", "", "owner"); code != 200 {
		t.Fatal(code)
	}
	readWS(t, observer, "directory.snapshot")
	code, data = call(t, f, "PUT", "/endpoints/"+machineA, deviceBody, "owner")
	if code != 409 || !bytes.Contains(data, []byte("endpoint_revoked")) {
		t.Fatalf("撤销设备被自动恢复: %d %s", code, data)
	}
}

func TestDeviceRegistrationRateLimit(t *testing.T) {
	f := newFixture(t)
	for range 10 {
		code, data := call(t, f, "PUT", "/endpoints/"+machineA, deviceBody, "owner")
		if code != 200 {
			t.Fatalf("十次登记以内不应限速: %d %s", code, data)
		}
	}
	req, err := http.NewRequestWithContext(t.Context(), "PUT", f.server.URL+"/endpoints/"+machineA, strings.NewReader(deviceBody))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer owner")
	resp, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 429 || resp.Header.Get("Retry-After") == "" {
		t.Fatalf("第十一次登记应限速并给出等待时间: %d %s", resp.StatusCode, resp.Header.Get("Retry-After"))
	}
}

func TestDeviceLimit(t *testing.T) {
	f := newFixture(t)
	if _, err := f.pool.Exec(t.Context(), `INSERT INTO endpoints(user_id,machine_id,device_name,platform,os_version,arch,client_version,protocol_version)
SELECT $1,gen_random_uuid(),'电脑','macos','15','arm64','1',1 FROM generate_series(1,19)`, f.user); err != nil {
		t.Fatal(err)
	}
	code, data := call(t, f, "PUT", "/endpoints/"+uuid.New().String(), deviceBody, "owner")
	if code != 200 {
		t.Fatalf("登记未满限额: %d %s", code, data)
	}
	code, data = call(t, f, "PUT", "/endpoints/"+uuid.New().String(), deviceBody, "owner")
	if code != 409 || !bytes.Contains(data, []byte("endpoint_limit_exceeded")) {
		t.Fatalf("超过限额的结果错误: %d %s", code, data)
	}
	code, data = call(t, f, "GET", "/endpoints", "", "owner")
	if code != 200 {
		t.Fatalf("限额影响端点列表: %d %s", code, data)
	}
	var page Page
	if err := json.Unmarshal(data, &page); err != nil || page.Total != 20 {
		t.Fatalf("限额后设备数错误: %s %v", data, err)
	}
}
