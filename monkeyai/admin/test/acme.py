"""使用本地 Pebble 验证容器中的真实签发、续期及失败恢复；不访问公网 CA。"""

import argparse
import http.client
import json
import re
import socket
import ssl
import subprocess
import tempfile
import time
import uuid
from pathlib import Path


PEBBLE = "ghcr.io/letsencrypt/pebble@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199"


def run(*args, check=True):
    result = subprocess.run(args, text=True, capture_output=True, timeout=180)
    if check and result.returncode:
        raise RuntimeError(f"命令失败：{' '.join(args)}\n{result.stdout}{result.stderr}")
    return result


def eventually(label, check, timeout=120):
    deadline = time.monotonic() + timeout
    report = time.monotonic() + 25
    while time.monotonic() < deadline:
        try:
            value = check()
            if value:
                print(f"通过：{label}", flush=True)
                return value
        except (OSError, http.client.HTTPException):
            pass
        if time.monotonic() >= report:
            print(f"等待：{label}", flush=True)
            report += 25
        time.sleep(0.5)
    raise AssertionError(f"等待超时：{label}")


def request(port, path="/", context=None, name="app.test", method="GET", headers=None):
    sock = socket.create_connection(("127.0.0.1", port), timeout=5)
    if context:
        sock = context.wrap_socket(sock, server_hostname=name)
    extra = "".join(f"{key}: {value}\r\n" for key, value in (headers or {}).items())
    sock.sendall(f"{method} {path} HTTP/1.1\r\nHost: {name}\r\n{extra}Connection: close\r\n\r\n".encode())
    response = http.client.HTTPResponse(sock)
    response.begin()
    cert = sock.getpeercert(binary_form=True) if context else None
    try:
        return response.status, dict(response.getheaders()), response.read(), cert
    finally:
        response.close()
        sock.close()


class Fixture:
    def __init__(self, image, directory):
        self.image = image
        self.directory = directory
        self.name = "monkeyai-acme-" + uuid.uuid4().hex[:10]
        self.containers = []
        self.env = {
            "MONKEYAI_AUTO_TLS_ENABLED": "true",
            "MONKEYAI_AUTO_TLS_EMAIL": "admin@example.com",
            "MONKEYAI_PUBLIC_URL": "https://app.test",
            "MONKEYAI_AUTO_TLS_CA": "https://ca.test:14000/dir",
        }

    def docker(self, *args, **kwargs):
        return run("docker", *args, **kwargs)

    def container(self, suffix, *args):
        name = self.name + "-" + suffix
        self.containers.append(name)
        self.docker("run", "-d", "--name", name, "--network", self.name, *args)
        return name

    def port(self, name, port):
        return int(self.docker("port", name, str(port)).stdout.strip().rsplit(":", 1)[1])

    def admin_args(self, env=None):
        args = ["--read-only", "--tmpfs", "/tmp", "-v", self.name + ":/var/lib/nginx/acme",
                "-v", str(self.directory / "ca.pem") + ":/etc/ssl/certs/ca-certificates.crt:ro"]
        for key, value in (self.env if env is None else env).items():
            args += ["-e", key + "=" + value]
        return args

    def start_admin(self, env=None):
        return self.container("admin", "--network-alias", "app.test", "-p", "127.0.0.1::8080",
                              "-p", "127.0.0.1::8443", *self.admin_args(env), self.image)

    def remove(self, name):
        self.docker("rm", "-f", name)
        self.containers.remove(name)

    def setup(self):
        print(f"创建本地测试环境：{self.name}", flush=True)
        self.docker("network", "create", self.name)
        self.docker("volume", "create", self.name)
        ca_config = self.directory / "openssl.cnf"
        ca_config.write_text("""[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=ca.test
[ext]
subjectAltName=DNS:ca.test
basicConstraints=critical,CA:TRUE
keyUsage=critical,digitalSignature,keyCertSign,cRLSign
""")
        run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            "-config", str(ca_config), "-keyout", str(self.directory / "ca.key"),
            "-out", str(self.directory / "ca.pem"))
        (self.directory / "pebble.json").write_text(json.dumps({"pebble": {
            "listenAddress": "0.0.0.0:14000", "managementListenAddress": "0.0.0.0:15000",
            "certificate": "/fixture/ca.pem", "privateKey": "/fixture/ca.key",
            "httpPort": 8080, "tlsPort": 8443, "keyAlgorithm": "ecdsa",
            "profiles": {"default": {"description": "本地续期测试", "validityPeriod": 180}},
        }}))
        (self.directory / "backend.mjs").write_text("""
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
const stats = { requests: 0, failures: 0, failedOrders: 0 };
const cert = fs.readFileSync('/fixture/ca.pem');
http.createServer((req, res) => {
    if (req.url === '/__acme') return res.end(JSON.stringify({ ...stats, now: Date.now() }));
    if (req.url === '/v1/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: start\\n\\n');
        const timer = setInterval(() => res.write('data: ' + Date.now() + '\\n\\n'), 1000);
        res.on('close', () => clearInterval(timer));
        return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ path: req.url, method: req.method, headers: req.headers }));
}).listen(8080);
https.createServer({ cert, key: fs.readFileSync('/fixture/ca.key') }, (req, res) => {
    stats.requests++;
    if (fs.existsSync('/fixture/offline') || (req.url === '/order-plz' && fs.existsSync('/fixture/reject-orders'))) {
        stats.failures++;
        if (req.url === '/order-plz') stats.failedOrders++;
        res.writeHead(503);
        return res.end('测试 CA 暂不可用');
    }
    const upstream = https.request({ host: 'pebble', port: 14000, servername: 'ca.test',
        path: req.url, method: req.method, headers: req.headers, ca: cert }, reply => {
        if (reply.statusCode === 200 && req.url.startsWith('/draft-ietf-acme-ari-03/renewalInfo/')) {
            let body = '';
            reply.setEncoding('utf8');
            reply.on('data', chunk => { body += chunk; });
            reply.on('end', () => {
                const info = JSON.parse(body);
                // 提前建议续期，为故障重试保留足够的证书有效期。
                const start = Date.parse(info.suggestedWindow.start) + 30000;
                info.suggestedWindow = {
                    start: new Date(start).toISOString(), end: new Date(start + 10000).toISOString(),
                };
                res.writeHead(200, { 'Content-Type': 'application/json', 'Retry-After': '3600' });
                res.end(JSON.stringify(info));
            });
            return;
        }
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
}).listen(14000);
""")
        mount = str(self.directory) + ":/fixture:ro"
        ca = self.container("pebble", "--network-alias", "pebble", "-p", "127.0.0.1::15000",
                            "-v", mount, "-e", "PEBBLE_VA_NOSLEEP=1", "-e", "PEBBLE_WFE_NONCEREJECT=0",
                            PEBBLE, "-config", "/fixture/pebble.json", "-strict", "-dnsserver", "127.0.0.11:53")
        backend = self.container("backend", "--network-alias", "backend", "--network-alias", "ca.test",
                                 "-p", "127.0.0.1::8080", "-v", mount,
                                 "node:24-alpine", "node", "/fixture/backend.mjs")
        self.backend_port = self.port(backend, 8080)
        api_context = ssl.create_default_context(cafile=str(self.directory / "ca.pem"))
        management = self.port(ca, 15000)
        root = eventually("本地 ACME 服务启动", lambda: request(management, "/roots/0", api_context, "ca.test")[2])
        self.context = ssl.create_default_context(cadata=root.decode())
        eventually("测试上游启动", lambda: request(self.backend_port, "/__acme")[0] == 200)

    def stats(self):
        return json.loads(request(self.backend_port, "/__acme")[2])

    def check(self):
        before = self.stats()["requests"]
        admin = self.start_admin({"MONKEYAI_AUTO_TLS_ENABLED": "false"})
        http_port = self.port(admin, 8080)
        eventually("关闭开关时 HTTP 健康", lambda: request(http_port, "/healthz")[0] == 200)
        assert request(http_port)[0] == 200
        assert json.loads(request(http_port, "/api/test")[2])["headers"]["x-forwarded-proto"] == "http"
        try:
            request(self.port(admin, 8443), context=self.context)
        except OSError:
            pass
        else:
            raise AssertionError("关闭开关后仍监听 HTTPS")
        assert self.stats()["requests"] == before, "关闭开关时访问了 CA"
        self.remove(admin)
        print("通过：关闭时保留 HTTP，且不申请证书", flush=True)

        invalid = [
            {"MONKEYAI_AUTO_TLS_ENABLED": "yes"},
            {"MONKEYAI_PUBLIC_URL": ""},
            {"MONKEYAI_PUBLIC_URL": "http://app.test"},
            {"MONKEYAI_PUBLIC_URL": "https://127.0.0.1"},
            {"MONKEYAI_PUBLIC_URL": "https://localhost"},
            {"MONKEYAI_PUBLIC_URL": "https://*.app.test"},
            {"MONKEYAI_PUBLIC_URL": "https://app.test/path"},
            {"MONKEYAI_PUBLIC_URL": "https://app.test?x=1"},
            {"MONKEYAI_PUBLIC_URL": "https://app.test:70000"},
            {"MONKEYAI_PUBLIC_URL": "https://app.test\nhttps://other.test"},
            {"MONKEYAI_AUTO_TLS_EMAIL": ""},
            {"MONKEYAI_AUTO_TLS_EMAIL": "admin@example.com\nadmin@example.com"},
            {"MONKEYAI_AUTO_TLS_CA": "http://ca.test:14000/dir"},
            {"MONKEYAI_AUTO_TLS_CA": "https://ca.test/dir\nhttps://ca.test/dir"},
        ]
        for changes in invalid:
            result = self.docker("run", "--rm", "--network", self.name,
                                 *self.admin_args(self.env | changes), self.image, "nginx", "-t", check=False)
            assert result.returncode != 0 and "MonkeyAI:" in result.stderr, f"错误配置未被拒绝：{changes}"
        print("通过：非法开关、地址、邮箱及多行配置被拒绝", flush=True)

        normalized = self.env | {"MONKEYAI_PUBLIC_URL": "https://APP.TEST:443/"}
        config = self.docker("run", "--rm", "--network", self.name, *self.admin_args(normalized),
                             self.image, "nginx", "-T").stdout
        assert "return 308 https://app.test$request_uri;" in config
        assert "ssl_certificate $acme_certificate;" in config
        other = self.env | {"MONKEYAI_AUTO_TLS_CA": "https://ca.test:14000/another-directory"}
        other_config = self.docker("run", "--rm", "--network", self.name, *self.admin_args(other),
                                   self.image, "nginx", "-T").stdout
        state = lambda content: next(line for line in content.splitlines() if "state_path " in line)
        assert state(config) != state(other_config), "不同 CA 共用了状态目录"
        print("通过：地址规范化、Nginx 变量保留及 CA 状态隔离", flush=True)

        admin = self.start_admin()
        http_port, tls = self.port(admin, 8080), self.port(admin, 8443)
        eventually("空证书卷允许 HTTP 健康检查", lambda: request(http_port, "/healthz")[0] == 200)
        status, headers, _, _ = request(http_port, "/oauth/callback?code=test", name="unknown.test")
        assert status == 308 and headers["Location"] == "https://app.test/oauth/callback?code=test"
        first = eventually("HTTP-01 首次签发并提供可信 HTTPS", lambda: request(tls, context=self.context)[3])
        for path in ["/api/test", "/oauth/test", "/v1/test", "/mcp/test", "/.well-known/oauth-authorization-server"]:
            status, _, body, _ = request(tls, path, self.context, method="POST" if path == "/v1/test" else "GET")
            data = json.loads(body)
            assert status == 200 and data["path"] == path
            assert data["headers"]["x-forwarded-proto"] == "https" and data["headers"]["host"] == "app.test"
        index = request(tls, context=self.context)[2]
        assert b'id="root"' in index, "镜像未包含管理端构建产物"
        assert request(tls, "/settings", self.context)[2] == index
        for asset in re.findall(rb'(?:src|href)="(/assets/[^\"]+)"', index):
            status, headers, body, _ = request(tls, asset.decode(), self.context)
            assert status == 200 and body and "immutable" in headers["Cache-Control"]
        print("通过：固定域名跳转、管理页面及 API/OAuth/模型/MCP 代理", flush=True)

        (self.directory / "offline").touch()
        self.remove(admin)
        admin = self.start_admin()
        tls = self.port(admin, 8443)
        reused = eventually("CA 暂不可用时重建仍复用原证书", lambda: request(tls, context=self.context)[3])
        assert reused == first, "重建后未复用已有证书"
        (self.directory / "offline").unlink()

        sock = self.context.wrap_socket(socket.create_connection(("127.0.0.1", tls), timeout=5), server_hostname="app.test")
        sock.sendall(b"GET /v1/stream HTTP/1.1\r\nHost: app.test\r\n\r\n")
        stream = http.client.HTTPResponse(sock)
        stream.begin()
        started = time.monotonic()
        assert stream.readline() == b"data: start\n" and time.monotonic() - started < 2
        second = eventually("自动续期后新握手使用新证书", lambda: self.changed(tls, first))
        renewed_at = self.stats()["now"]
        while True:
            line = stream.readline()
            assert line, "证书续期时原流式连接中断"
            if line.startswith(b"data: ") and int(line[6:]) >= renewed_at:
                break
        stream.close()
        sock.close()
        print("通过：证书切换期间原流式连接继续传输", flush=True)

        failures = self.stats()["failedOrders"]
        (self.directory / "reject-orders").touch()
        eventually("续期订单遇到 CA 错误", lambda: self.stats()["failedOrders"] > failures)
        assert request(tls, context=self.context)[3] == second, "续期失败未保留原证书"
        (self.directory / "reject-orders").unlink()
        eventually("CA 恢复后自动重试并更新证书", lambda: self.changed(tls, second))
        print("通过：续期失败保留原证书，恢复后自动重试", flush=True)

        self.remove(admin)
        admin = self.start_admin({"MONKEYAI_AUTO_TLS_ENABLED": "false"})
        eventually("关闭功能后恢复 HTTP", lambda: request(self.port(admin, 8080), "/healthz")[0] == 200)
        assert self.docker("exec", admin, "sh", "-c", "test -n \"$(ls -A /var/lib/nginx/acme)\"").returncode == 0
        print("通过：关闭功能保留证书数据", flush=True)

    def changed(self, port, previous):
        cert = request(port, context=self.context)[3]
        return cert if cert != previous else None

    def close(self, failed):
        if failed:
            for name in self.containers:
                result = self.docker("logs", "--tail", "50", name, check=False)
                print(name, result.stdout, result.stderr, flush=True)
        for name in reversed(self.containers):
            self.docker("rm", "-f", name, check=False)
        self.docker("volume", "rm", self.name, check=False)
        self.docker("network", "rm", self.name, check=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="monkeyai-admin:acme-test")
    args = parser.parse_args()
    test_data = Path(__file__).resolve().parents[2] / "data"
    test_data.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="acme-test-", dir=test_data) as temporary:
        fixture = Fixture(args.image, Path(temporary))
        failed = True
        try:
            fixture.setup()
            fixture.check()
            failed = False
        finally:
            fixture.close(failed)
