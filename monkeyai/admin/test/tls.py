"""离线验证入口配置选择，不连接公网 CA。"""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


class TLSConfigTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="monkeyai-tls-config-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        source = Path(__file__).resolve().parents[1]
        shutil.copytree(source / "nginx", self.root / "templates")
        script = (source / "entrypoint.sh").read_text()
        for old, name in (("/etc/nginx/monkeyai", "templates"), ("/tmp/nginx", "output"),
                          ("/run/monkeyai/tls", "certificates"), ("/var/lib/nginx/acme", "acme")):
            script = script.replace(old, str(self.root / name))
        (self.root / "entrypoint.sh").write_text(script)
        (self.root / "certificates").mkdir()
        for name in ("server.crt", "server.key"):
            (self.root / "certificates" / name).write_text("test fixture")
        (self.root / "bin").mkdir()
        commands = {
            "nginx": '#!/bin/sh\nprintf "%s\\n" "$*" >> "$NGINX_TEST_LOG"\n',
            "envsubst": '#!/bin/sh\nexec python3 "$NGINX_TEST_ENVSUBST" "$@"\n',
        }
        for name, content in commands.items():
            path = self.root / "bin" / name
            path.write_text(content)
            path.chmod(0o755)
        (self.root / "envsubst.py").write_text('''import os, re, sys
content = sys.stdin.read()
for name in re.findall(r"\\$\\{([A-Z0-9_]+)\\}", sys.argv[1]):
    content = content.replace("${" + name + "}", os.environ.get(name, ""))
sys.stdout.write(content)
''')

    def run_entrypoint(self, **changes):
        environment = dict(os.environ, PATH=str(self.root / "bin") + os.pathsep + os.environ["PATH"],
                           MONKEYAI_TLS_ENABLED="true", MONKEYAI_AUTO_TLS_ENABLED="false",
                           MONKEYAI_PUBLIC_URL="https://office.example.com",
                           MONKEYAI_RUNTIME_PREVIEW_ORIGIN_TEMPLATE="", MONKEYAI_TRUSTED_PROXY_CIDRS="",
                           NGINX_TEST_LOG=str(self.root / "nginx.log"),
                           NGINX_TEST_ENVSUBST=str(self.root / "envsubst.py"))
        environment.update(changes)
        return subprocess.run(["sh", str(self.root / "entrypoint.sh"), "nginx", "-g", "daemon off;"],
                              env=environment, text=True, capture_output=True, timeout=30)

    def test_self_signed_tls_for_ip_and_domain(self):
        for origin in ("https://127.0.0.1", "https://[2001:db8::1]:8443", "https://office.example.com:18443"):
            with self.subTest(origin=origin):
                result = self.run_entrypoint(MONKEYAI_PUBLIC_URL=origin)
                self.assertEqual(result.returncode, 0, result.stderr)
                config = (self.root / "output/site.conf").read_text()
                self.assertIn("listen 8443 ssl;", config)
                self.assertIn("ssl_certificate /run/monkeyai/tls/server.crt;", config)
                self.assertIn("return 308 " + origin + "$request_uri;", config)
                self.assertIn("error_page 497 =308 " + origin + "$request_uri;", config)
                self.assertNotIn("acme_certificate monkeyai;", config)

    def test_acme_takes_priority_without_local_certificate(self):
        (self.root / "certificates/server.key").unlink()
        result = self.run_entrypoint(MONKEYAI_AUTO_TLS_ENABLED="true", MONKEYAI_AUTO_TLS_EMAIL="admin@example.com")
        self.assertEqual(result.returncode, 0, result.stderr)
        config = (self.root / "output/site.conf").read_text()
        self.assertIn("ssl_certificate $acme_certificate;", config)
        self.assertNotIn("ssl_certificate /run/monkeyai/tls/server.crt;", config)

    def test_explicitly_disabled_tls_keeps_http(self):
        result = self.run_entrypoint(MONKEYAI_TLS_ENABLED="false")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("listen 8443", (self.root / "output/site.conf").read_text())

    def test_invalid_address_or_missing_key_is_rejected(self):
        for origin in ("http://office.example.com", "https://office.example.com/path", "https://office.example.com;bad"):
            with self.subTest(origin=origin):
                self.assertNotEqual(self.run_entrypoint(MONKEYAI_PUBLIC_URL=origin).returncode, 0)
        (self.root / "certificates/server.key").unlink()
        self.assertNotEqual(self.run_entrypoint().returncode, 0)


if __name__ == "__main__":
    unittest.main()
