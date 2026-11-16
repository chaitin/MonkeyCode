import argparse
import base64
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("kbpack", Path(__file__).with_name("pandawiki_kbpack.py"))
k = importlib.util.module_from_spec(spec)
spec.loader.exec_module(k)


@contextmanager
def fixture(denied=False, changing=False, lost_response=False):
    state = {"posts": [], "lists": 0}
    groups = [{"nav_id": "nav1", "nav_name": "帮助", "list": [
        {"id": "folder", "type": 1, "name": "入门", "parent_id": "", "position": 1},
        {"id": "doc", "type": 2, "name": "说明", "parent_id": "folder", "position": 2},
    ]}]
    if denied:
        groups[0]["list"].append({"id": "denied", "type": 2, "name": "受限", "parent_id": "", "position": 3})

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, value):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(k.encode(value))

        def do_GET(self):
            if self.path == "/wiki/share/v1/node/list":
                state["lists"] += 1
                data = json.loads(json.dumps(groups))
                if changing and state["lists"] > 1:
                    data[0]["nav_name"] = "changed"
                self.send({"success": True, "data": data})
            elif "node/detail" in self.path:
                if "id=denied" in self.path:
                    self.send({"success": False, "message": "denied"})
                else:
                    self.send({"success": True, "data": {"type": 2, "meta": {"content_type": "md"},
                                                          "content": "# 使用说明\n\n正文\n\n[链接](/help)"}})
            else:
                self.send_response(404)
                self.end_headers()

        def do_POST(self):
            data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state["posts"].append((self.path, data))
            if lost_response:
                self.connection.shutdown(2)
                self.connection.close()
                return
            self.send({"id": "id-" + str(len(state["posts"]))})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", state
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def export_args(base, output, **kwargs):
    values = dict(url=base + "/wiki/node/doc", output=str(output), cookies=None, kb_id=None,
                  timeout=2, source_id="fixture", name="知识库", allow_partial=False, max_nodes=50000)
    values.update(kwargs)
    return argparse.Namespace(**values)


class PackageTests(unittest.TestCase):
    def test_url_export_and_deterministic_package(self):
        with tempfile.TemporaryDirectory() as tmp, fixture() as (base, state):
            package = Path(tmp) / "out.zip"
            k.export_package(export_args(base, package))
            meta, nodes, bodies = k.load_package(package)
            self.assertEqual(meta["name"], "知识库")
            self.assertEqual([n["node_type"] for n in nodes], ["folder", "folder", "document"])
            self.assertIn(base + "/help", next(iter(bodies.values())))
            second = Path(tmp) / "second.zip"
            k.export_package(export_args(base, second))
            self.assertEqual(package.read_bytes(), second.read_bytes())

    def test_business_denied_not_silently_exported(self):
        with tempfile.TemporaryDirectory() as tmp, fixture(denied=True) as (base, _):
            package = Path(tmp) / "out.zip"
            with self.assertRaises(k.Failure):
                k.export_package(export_args(base, package))
            self.assertFalse(package.exists())
            report = json.loads(package.with_suffix(".report.json").read_text())
            self.assertEqual(len(report["failures"]), 1)
            k.export_package(export_args(base, package, allow_partial=True))
            self.assertEqual(len(k.load_package(package)[2]), 1)

    def test_source_change_does_not_produce_package(self):
        with tempfile.TemporaryDirectory() as tmp, fixture(changing=True) as (base, _):
            package = Path(tmp) / "out.zip"
            with self.assertRaises(k.Failure):
                k.export_package(export_args(base, package))
            self.assertFalse(package.exists())

    def test_tampering_detected_before_any_write(self):
        with tempfile.TemporaryDirectory() as tmp, fixture() as (base, state):
            package = Path(tmp) / "out.zip"
            k.export_package(export_args(base, package))
            with zipfile.ZipFile(package) as z:
                files = {n: z.read(n) for n in z.namelist()}
            body = next(n for n in files if n.endswith(".md"))
            files[body] = b"tampered"
            with zipfile.ZipFile(package, "w") as z:
                for name, data in files.items():
                    z.writestr(name, data)
            with self.assertRaisesRegex(k.Failure, "摘要"):
                k.load_package(package)
            self.assertEqual(state["posts"], [])

    def test_tree_cycle_rejected(self):
        with self.assertRaisesRegex(k.Failure, "环"):
            k.tree_order([{"key": "a", "title": "A", "node_type": "folder", "parent_key": "b", "order": 0},
                          {"key": "b", "title": "B", "node_type": "folder", "parent_key": "a", "order": 0}])

    def test_images_packaged_and_deduplicated(self):
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9V8AAAAASUVORK5CYII=")
        class ImageClient:
            timeout = 2
            def request(self, address):
                return png
        files = {}
        collector = k.ImageCollector(ImageClient(), "knowledge/test", files)
        dataurl = "data:image/png;base64," + base64.b64encode(png).decode()
        raw = ('![图](<images/a(b).png> "标题")\n![内嵌](' + dataurl + ')\n'
               '![引用][pic]\n[pic]: /pic.png "描述"\n<img src="/pic.png" alt="HTML">').encode()
        body = collector.rewrite(raw, "https://example.com/node/a").decode()
        self.assertEqual(len(files), 1)
        self.assertNotIn("base64", body)
        self.assertEqual(body.count("../assets/"), 4)
        self.assertIn('"标题"', body)
        self.assertEqual(next(iter(files.values())), png)

    def test_invalid_image_rejected(self):
        with self.assertRaises(k.Failure):
            k.ImageCollector(k.Client(), "knowledge/test", {}).rewrite(
                b"![bad](data:image/png;base64,abcdef)", "https://example.com")

    def test_html_conversion(self):
        try:
            import markdownify  # noqa: F401
        except ImportError:
            self.skipTest("optional HTML dependencies not installed")
        body, warnings = k.markdown('<h1>标题</h1><p>正文 <a href="/help">链接</a></p><script>bad()</script>', "html", "https://example.com/node/a")
        self.assertIn("# 标题", body.decode())
        self.assertIn("https://example.com/help", body.decode())
        self.assertNotIn("bad()", body.decode())
        self.assertIn("html_converted_to_markdown", warnings)


if __name__ == "__main__":
    unittest.main()
