"""使用隔离的 Docker 容器验证 Nginx 访问日志，不连接业务服务。"""

import argparse
import http.client
import json
import os
import subprocess
import tempfile
import time
import unittest
import uuid
from pathlib import Path


IMAGE = os.environ.get("MONKEYAI_TEST_ADMIN_IMAGE", "")


@unittest.skipUnless(IMAGE, "设置 MONKEYAI_TEST_ADMIN_IMAGE 或传入 --image 运行真实 Nginx 验证")
class AccessLogTest(unittest.TestCase):
    def docker(self, *args):
        result = subprocess.run(["docker", *args], text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="monkeyai-access-log-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.network = "monkeyai-access-log-" + uuid.uuid4().hex[:12]
        self.docker("network", "create", self.network)
        self.addCleanup(self.docker, "network", "rm", self.network)
        statuses = (200, 201, 204, 302, 400, 401, 404, 500)
        locations = "\n".join(
            f'location = /api/status/{status} {{ return {status}; }}' for status in statuses
        )
        backend_config = root / "backend.conf"
        backend_config.write_text('''pid /tmp/nginx.pid;
error_log /dev/stderr info;
events {}
http {
    access_log off;
    map $uri $response_request_id {
        default backend-request-id;
        /api/no-id "";
    }
    server {
        listen 8080;
        add_header X-Request-ID $response_request_id always;
        location = /api/echo {
            return 200 "$request_method|$args|$http_authorization|$http_cookie|$http_x_request_id";
        }
        ''' + locations + '''
        location = /api/unavailable { return 444; }
        location / { return 200 "ok"; }
    }
}
''')
        self.backend = self.docker("create", "--network", self.network, "--network-alias", "backend",
                                   "--entrypoint", "nginx", IMAGE, "-c", "/tmp/backend.conf", "-g", "daemon off;")
        self.addCleanup(self.docker, "rm", "-f", self.backend)
        self.docker("cp", str(backend_config), self.backend + ":/tmp/backend.conf")
        self.docker("start", self.backend)
        source = Path(__file__).resolve().parents[1]
        self.admin = self.docker("create", "--network", self.network, "-p", "127.0.0.1::8080",
                                 "-e", "MONKEYAI_AUTO_TLS_ENABLED=false", "-e", "MONKEYAI_TLS_ENABLED=false",
                                 "-e", "MONKEYAI_RUNTIME_PREVIEW_ORIGIN_TEMPLATE=", "-e", "MONKEYAI_TRUSTED_PROXY_CIDRS=",
                                 IMAGE)
        self.addCleanup(self.docker, "rm", "-f", self.admin)
        self.docker("cp", str(source / "nginx.conf"), self.admin + ":/etc/nginx/nginx.conf")
        self.docker("cp", str(source / "nginx") + "/.", self.admin + ":/etc/nginx/monkeyai/")
        asset = root / "access-log-test.js"
        asset.write_text("console.log('access log test')\n")
        self.docker("cp", str(asset), self.admin + ":/usr/share/nginx/html/access-log-test.js")
        self.docker("start", self.admin)
        self.port = int(self.docker("port", self.admin, "8080/tcp").rsplit(":", 1)[1])
        for _ in range(50):
            try:
                if self.request("/healthz")[0] == 200:
                    break
            except OSError:
                pass
            time.sleep(0.1)
        else:
            self.fail(self.docker("logs", self.admin))
        self.docker("exec", self.admin, "nginx", "-t")

    def request(self, path, method="GET", body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, response.read(), {key.lower(): value for key, value in response.getheaders()}
        finally:
            connection.close()

    def test_access_output(self):
        for status in (200, 201, 204, 302, 400, 401, 404, 500):
            self.assertEqual(self.request(f"/api/status/{status}")[0], status)
        user_agent = 'test "quoted" \\ agent'
        headers = {"User-Agent": user_agent, "Authorization": "Bearer auth-secret",
                   "Cookie": "session=cookie-secret", "Referer": "https://example.test/referer-secret",
                   "X-Request-ID": "client-request-id"}
        payload = "body-secret"
        status, body, response_headers = self.request("/api/echo?token=query-secret", "POST", payload, headers)
        request_id = response_headers["x-request-id"]
        self.assertEqual(status, 200)
        self.assertEqual(body.decode(), "POST|token=query-secret|Bearer auth-secret|session=cookie-secret|client-request-id")
        self.assertEqual(request_id, "backend-request-id")
        self.assertEqual(self.request("/api/no-id")[0], 200)
        self.assertEqual(self.request("/api/example.js")[0], 200)
        asset_status, _, asset_headers = self.request("/access-log-test.js?v=1")
        self.assertEqual(asset_status, 200)
        self.assertEqual(self.request("/access-log-test.js?v=1", headers={"If-Modified-Since": asset_headers["last-modified"]})[0], 304)
        self.assertEqual(self.request("/missing-access-log-test.js")[0], 404)
        self.assertEqual(self.request("/dashboard?token=spa-secret")[0], 200)
        for path in ("/healthz", "/preview/preview-secret/", "/device?code=device-secret",
                     "/api/auth/v1/client-requests/device", "/api/v1/design-resources/resource-secret/file",
                     "/api/v1/endpoints/abcdef/proxy/proxy-secret", "/endpoints/abcdef/files/file-secret"):
            self.request(path)
        self.assertEqual(self.request("/api/unavailable")[0], 502)
        # 优雅退出等待所有 worker 完成写入，避免按时间猜测日志是否就绪。
        self.docker("stop", "-t", "5", self.admin)
        output = self.docker("logs", self.admin)
        rows = [json.loads(line) for line in output.splitlines() if line.startswith("{")]
        self.assertEqual(len(rows), 14, rows)
        by_path = {row["path"]: row for row in rows}
        for status in (200, 201, 204, 302, 400, 401, 404, 500):
            self.assertEqual(by_path[f"/api/status/{status}"]["status"], status)
        echo = by_path["/api/echo?token=query-secret"]
        self.assertEqual(echo["user_agent"], user_agent)
        self.assertEqual(echo["request_id"], request_id)
        self.assertEqual(echo["method"], "POST")
        self.assertEqual(echo["response_bytes"], len(body))
        self.assertGreater(echo["request_length"], len(payload))
        self.assertRegex(echo["upstream_addr"], r"^\d+\.\d+\.\d+\.\d+:8080$")
        self.assertGreaterEqual(float(echo["upstream_response_time"]), 0)
        self.assertIsInstance(echo["request_time"], (int, float))
        for path in ("/api/no-id", "/api/unavailable", "/missing-access-log-test.js"):
            self.assertRegex(by_path[path]["request_id"], r"^[a-f0-9]{32}$")
        self.assertEqual(by_path["/api/unavailable"]["status"], 502)
        self.assertEqual(by_path["/missing-access-log-test.js"]["upstream_addr"], "")
        self.assertIn("/dashboard?token=spa-secret", by_path)
        self.assertIn("/api/example.js", by_path)
        for secret in ("auth-secret", "cookie-secret", "referer-secret", "body-secret",
                       "preview-secret", "device-secret", "resource-secret", "proxy-secret", "file-secret"):
            self.assertNotIn(secret, output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default=IMAGE, help="包含 Nginx ACME 的现有 Admin 镜像")
    args, remaining = parser.parse_known_args()
    if args.image:
        IMAGE = args.image
        AccessLogTest.__unittest_skip__ = False
    unittest.main(argv=[__file__, *remaining])
