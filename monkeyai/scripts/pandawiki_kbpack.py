#!/usr/bin/env python3
"""PandaWiki 前台 URL → 管理后台可导入的知识库资源包。"""
import argparse
import base64
import binascii
import hashlib
from http.cookiejar import MozillaCookieJar
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import urllib.error
import urllib.parse as url
import urllib.request as http
import zipfile

MAX_RESPONSE = 32 << 20
MAX_BODY = 8 << 20
MAX_PACKAGE = 2 << 30
MAX_EXPANDED = 4 << 30


class Failure(Exception):
    pass


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def key(prefix, value):
    return prefix + hashlib.sha256(str(value).encode()).hexdigest()


def origin(address):
    p = url.urlsplit(address)
    return p.scheme, p.netloc


class SameOrigin(http.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if origin(req.full_url) != origin(newurl):
            raise Failure("请求跳转到了其他站点；请直接提供最终站点 URL")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Client:
    def __init__(self, cookie_file=None, kb_id=None, timeout=30):
        jar = MozillaCookieJar()
        if cookie_file:
            jar.load(cookie_file, ignore_discard=True)
        self.opener = http.build_opener(SameOrigin(), http.HTTPCookieProcessor(jar))
        self.headers = {"User-Agent": "PandaWiki-KBPack/1.0"}
        if kb_id:
            self.headers["X-KB-ID"] = kb_id
        self.timeout = timeout

    def request(self, address, data=None):
        body = encode(data) if data is not None else None
        headers = dict(self.headers)
        if body is not None:
            headers["Content-Type"] = "application/json"
            # Current MonkeyAI resource.Decode limits request bodies to 1 MiB.
            if len(body) > 1 << 20:
                raise Failure("文档请求超过当前 MonkeyAI API 的 1 MiB 上限，尚未发送")
        req = http.Request(address, data=body, headers=headers)
        try:
            with self.opener.open(req, timeout=self.timeout) as response:
                raw = response.read(MAX_RESPONSE + 1)
        except urllib.error.HTTPError as exc:
            raise Failure(f"HTTP {exc.code}；请检查地址和登录会话") from None
        except (OSError, urllib.error.URLError) as exc:
            raise Failure(f"网络请求失败（{type(exc).__name__}）") from None
        if len(raw) > MAX_RESPONSE:
            raise Failure("响应超过 32 MiB 限制")
        return raw

    def json(self, address, data=None, panda=False):
        try:
            result = json.loads(self.request(address, data))
        except (ValueError, UnicodeDecodeError):
            raise Failure("接口未返回 JSON，可能是登录页或路径不匹配") from None
        if panda:
            if not isinstance(result, dict) or result.get("success") is not True:
                raise Failure("PandaWiki 业务请求失败；请检查当前身份的阅读权限")
            return result.get("data")
        return result


def valid_url(address):
    p = url.urlsplit(address)
    if p.scheme not in ("http", "https") or not p.netloc or p.username or p.password:
        raise Failure("请输入不带用户名密码的 http(s) 前台 URL")
    if p.query or p.fragment:
        # Query tokens must not end up in exported links or reports.
        address = url.urlunsplit((p.scheme, p.netloc, p.path, "", ""))
    return address


def api_candidates(address):
    p = url.urlsplit(address)
    path = p.path.rstrip("/")
    if "/node/" in path:
        path = path.split("/node/", 1)[0]
    elif path.endswith("/node"):
        path = path[:-5]
    # Try the actual frontend prefix first, then its ancestors.
    parts = path.split("/")
    return list(dict.fromkeys(url.urlunsplit((p.scheme, p.netloc,
        "/".join(parts[:i]).rstrip("/") + "/share/v1", "", ""))
        for i in range(len(parts), 0, -1)))


def discover(client, address):
    errors = []
    for api in api_candidates(address):
        try:
            groups = client.json(api + "/node/list", panda=True)
            if not isinstance(groups, list):
                raise Failure("目录数据格式不匹配")
            return api, groups
        except Failure as exc:
            errors.append(str(exc))
    raise Failure("未找到可读取的 PandaWiki 前台目录。需要登录时使用 --cookies；"
                  "网关未注入库身份时可补充 --kb-id。" + " / ".join(dict.fromkeys(errors)))


def markdown(content, content_type, page):
    warnings = []
    if content_type == "html" or (content_type != "md" and re.search(r"<(?:p|div|h[1-6])\b", content, re.I)):
        try:
            from bs4 import BeautifulSoup
            from markdownify import markdownify
        except ImportError:
            raise Failure("HTML 文档需要安装依赖：python3 -m pip install -r monkeyai/scripts/requirements-kbpack.txt") from None
        soup = BeautifulSoup(content, "html.parser")
        for tag in soup(["script", "style", "iframe", "object"]):
            tag.decompose()
            warnings.append("removed_unsupported_html")
        for tag in soup.find_all(True):
            for attr in ("href", "src"):
                if tag.get(attr):
                    tag[attr] = url.urljoin(page, tag[attr])
        content = markdownify(str(soup), heading_style="ATX", code_language="")
        warnings.append("html_converted_to_markdown")
    # Image destinations are normalized by ImageCollector after conversion.
    content = re.sub(r'(?<!!)\[([^\]\n]*)\]\(([^\s)]+)\)',
                     lambda m: "[" + m[1] + "](" + url.urljoin(page, m[2]) + ")", content)
    if not content.strip():
        raise Failure("正文为空，不能导入知识库")
    raw = content.encode()
    if len(raw) > MAX_BODY:
        raise Failure("单篇正文超过 8 MiB")
    return raw, warnings


def image_extension(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    raise Failure("图片不是支持的 PNG/JPEG/GIF/WebP 文件（不接受 SVG 或登录页）")


class ImageCollector:
    def __init__(self, client, root, files):
        self.client, self.root, self.files = client, root, files
        self.cache = {}

    def collect(self, source, page):
        source = source.replace("\\(", "(").replace("\\)", ")")
        address = url.urljoin(page, source)
        if address in self.cache:
            return self.cache[address]
        if address.lower().startswith("data:"):
            try:
                header, payload = address.split(",", 1)
                if not header.lower().startswith("data:image/") or len(payload) > MAX_RESPONSE * 2:
                    raise ValueError()
                data = base64.b64decode(payload, validate=True) if header.lower().endswith(";base64") else url.unquote_to_bytes(payload)
            except (ValueError, binascii.Error):
                raise Failure("内嵌图片编码无效") from None
        else:
            valid_url(address)
            # A separate client prevents forwarding source cookies or X-KB-ID to a CDN.
            client = self.client if origin(address) == origin(page) else Client(timeout=self.client.timeout)
            data = client.request(address)
        if not data or len(data) > MAX_RESPONSE:
            raise Failure("图片为空或超过 32 MiB")
        name = hashlib.sha256(data).hexdigest() + image_extension(data)
        self.files[self.root + "/assets/" + name] = data
        local = "../assets/" + name
        self.cache[address] = local
        return local

    def rewrite(self, raw, page):
        content = raw.decode()
        # Inline destinations support angle brackets, titles and balanced parentheses.
        target = r"<(?:[^>\n]+)>|(?:[^\s()\\]|\\.|\((?:[^()\\]|\\.|\([^()]*\))*\))+"
        pattern = r'(!\[(?:[^\]\\]|\\.)*\]\(\s*)(' + target + r')'
        def inline(m):
            return m[1] + self.collect(m[2].removeprefix("<").removesuffix(">"), page)
        content = re.sub(pattern, inline, content)
        # Reference images: rewrite their definitions, preserving labels and titles.
        labels = set()
        for m in re.finditer(r'!\[([^\]]*)\](?:\[([^\]]*)\])?(?!\()', content):
            labels.add(" ".join((m[2] or m[1]).lower().split()))
        def reference(m):
            if " ".join(m[2].lower().split()) not in labels:
                return m[0]
            return m[1] + self.collect(m[3].removeprefix("<").removesuffix(">"), page)
        content = re.sub(r'(?m)^( {0,3}\[([^\]]+)\]:\s*)(' + target + r')', reference, content)
        # Raw HTML images in Markdown, including lazy loaded images.
        def html_image(m):
            tag = m[0]
            attr = re.search(r'(?:src|data-src)\s*=\s*([\'"])(.*?)\1', tag, re.I)
            if not attr:
                raise Failure("HTML 图片缺少 src")
            alt = re.search(r'alt\s*=\s*([\'"])(.*?)\1', tag, re.I)
            return "![" + ((alt[2] if alt else "").replace("]", "")) + "](" + self.collect(attr[2], page) + ")"
        content = re.sub(r'<img\b[^>]*>', html_image, content, flags=re.I)
        if len(content.encode()) > MAX_BODY:
            raise Failure("改写后的正文超过 8 MiB")
        return content.encode()


def tree_order(nodes):
    """Validate references and return parent-before-child order without recursion."""
    by_key = {}
    for node in nodes:
        k = node.get("key")
        if not isinstance(k, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", k) or k in by_key:
            raise Failure("节点 key 无效或重复")
        if node.get("node_type") not in ("folder", "document") or not node.get("title", "").strip():
            raise Failure("节点类型或标题无效")
        by_key[k] = node
    children = {None: []}
    for node in nodes:
        parent = node.get("parent_key")
        if parent is not None and (parent not in by_key or by_key[parent]["node_type"] != "folder"):
            raise Failure("目录存在缺失或非文件夹父节点")
        children.setdefault(parent, []).append(node)
    for siblings in children.values():
        orders = [n.get("order") for n in siblings]
        if any(type(o) is not int or o < 0 for o in orders) or len(set(orders)) != len(orders):
            raise Failure("同级 order 必须是唯一非负整数")
    pending = sorted(children[None], key=lambda n: n["order"], reverse=True)
    out = []
    while pending:
        node = pending.pop()
        out.append(node)
        pending.extend(sorted(children.get(node["key"], []), key=lambda n: n["order"], reverse=True))
    if len(out) != len(nodes):
        raise Failure("目录存在环")
    return out


def atomic_file(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=".kbpack-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def export_package(args):
    address = valid_url(args.url)
    output = Path(args.output)
    if output.exists():
        raise Failure("输出 ZIP 已存在，请选择新路径")
    report_path = output.with_suffix(".report.json")
    client = Client(args.cookies, args.kb_id, args.timeout)
    api, groups = discover(client, address)
    if args.max_nodes < 1:
        raise Failure("--max-nodes 必须为正整数")
    before = encode(groups)
    source = args.source_id or url.urlsplit(address).netloc
    slug = key("kb-", args.kb_id or api)
    root = "knowledge/" + slug
    files, nodes, source_nodes, seen = {}, [], [], set()
    images = ImageCollector(client, root, files)
    report = {"source": address, "scope": "current_identity_discoverable", "consistency": "best_effort",
              "failures": [], "warnings": [], "documents": 0, "hidden_count": None}
    for group in groups:
        nav = key("nav-", group.get("nav_id") or "default")
        if nav in seen:
            raise Failure("导航 ID 重复")
        seen.add(nav)
        nodes.append({"key": nav, "node_type": "folder", "parent_key": None,
                      "order": len(nodes), "title": group.get("nav_name") or "文档"})
        for item in group.get("list") or []:
            ident = str(item.get("id") or "")
            if not ident or ident in seen:
                raise Failure("源目录包含空或重复节点 ID")
            seen.add(ident)
            source_nodes.append((nav, item))
    if not source_nodes or len(source_nodes) + len(nodes) > args.max_nodes:
        raise Failure("目录为空或节点数超过限制")
    folder_ids = {str(n["id"]) for _, n in source_nodes if n.get("type") == 1}
    for nav, item in source_nodes:
        ident = str(item["id"])
        parent = str(item.get("parent_id") or "")
        if parent and parent not in folder_ids:
            raise Failure("可见目录缺少父文件夹；无法可靠还原结构")
        node = {"key": key("node-", ident), "node_type": "folder" if item.get("type") == 1 else "document",
                "parent_key": key("node-", parent) if parent else nav,
                "order": 0, "title": item.get("name") or "未命名"}
        if item.get("type") not in (1, 2):
            raise Failure("未知 PandaWiki 节点类型")
        if node["node_type"] == "document":
            print(f"采集文档 {report['documents'] + 1}", file=sys.stderr)
            try:
                detail = client.json(api + "/node/detail?" + url.urlencode({"id": ident, "format": "raw"}), panda=True)
                if not isinstance(detail, dict) or detail.get("type") != 2:
                    raise Failure("正文响应类型不匹配")
                page = api.split("/share/v1", 1)[0] + "/node/" + url.quote(ident, safe="")
                raw, warnings = markdown(detail.get("content") or "", (detail.get("meta") or {}).get("content_type"), page)
                raw = images.rewrite(raw, page)
                content_path = root + "/documents/" + node["key"] + ".md"
                files[content_path] = raw
                node.update(content_path=content_path, source_type="text")
                report["documents"] += 1
                report["warnings"].extend({"key": node["key"], "warning": w} for w in warnings)
            except Failure as exc:
                report["failures"].append({"key": node["key"], "error": str(exc)})
                continue
        node["_position"] = item.get("position") or 0
        nodes.append(node)
    # Stable order within each parent, retaining original source positions.
    siblings = {}
    for node in nodes:
        siblings.setdefault(node["parent_key"], []).append(node)
    for group in siblings.values():
        for index, node in enumerate(sorted(group, key=lambda n: (n.get("_position", n["order"]), n["key"]))):
            node["order"] = index
            node.pop("_position", None)
    nodes = tree_order(nodes)
    after = client.json(api + "/node/list", panda=True)
    if encode(after) != before:
        report["failures"].append({"error": "采集期间目录发生变化，请重新运行"})
        atomic_file(report_path, encode(report))
        raise Failure("采集期间目录发生变化，未生成 ZIP；详见报告")
    report["images"] = len([p for p in files if "/assets/" in p])
    report["image_bytes"] = sum(len(data) for p, data in files.items() if "/assets/" in p)
    atomic_file(report_path, encode(report))
    if report["failures"] and not args.allow_partial:
        raise Failure(f"{len(report['failures'])} 篇采集失败，未生成 ZIP；查看 {report_path}，或显式使用 --allow-partial")
    if not report["documents"]:
        raise Failure("没有成功采集的文档，未生成 ZIP")
    files[root + "/kb.json"] = encode({"name": args.name or url.urlsplit(address).netloc,
                                          "description": "从 PandaWiki 前台采集的知识库", "tags": ["PandaWiki"]})
    files[root + "/tree.json"] = encode({"nodes": nodes})
    entries = [{"path": name, "sha256": sha(data), "size": len(data)} for name, data in sorted(files.items())]
    section = {"schema_version": 1, "publisher_id": key("pandawiki-", source),
               "knowledge_bases": [{"slug": slug, "metadata_path": root + "/kb.json",
                                     "tree_path": root + "/tree.json", "files": entries}]}
    section["release_id"] = key("r-", encode(section).hex())
    files["manifest.json"] = encode({"knowledge_resources": section})
    if sum(map(len, files.values())) > MAX_EXPANDED:
        raise Failure("展开内容超过 4 GiB")
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=output.parent, prefix=".kbpack-")
    os.close(fd)
    try:
        with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED) as z:
            for name, data in sorted(files.items()):
                info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, data)
        if os.path.getsize(temp) > MAX_PACKAGE:
            raise Failure("压缩包超过 2 GiB")
        # Exclusive creation prevents overwriting a concurrently produced export.
        with output.open("xb") as target, open(temp, "rb") as source_file:
            import shutil
            shutil.copyfileobj(source_file, target)
    finally:
        os.unlink(temp)
    print(f"已生成 {output}：{report['documents']} 篇文档、{report['images']} 张图片；报告 {report_path}")
    print("可在管理后台的“导入资源包”中上传此 ZIP，选择知识库分区并确认。")


def load_package(path):
    if Path(path).stat().st_size > MAX_PACKAGE:
        raise Failure("压缩包超过 2 GiB")
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        names = [i.filename for i in infos]
        if len(names) != len(set(n.lower() for n in names)) or sum(i.file_size for i in infos) > MAX_EXPANDED:
            raise Failure("ZIP 路径重复或展开超限")
        for name in names:
            if name.startswith("/") or "\\" in name or any(p in ("", ".", "..") for p in name.split("/")):
                raise Failure("ZIP 路径不安全")
        section = json.loads(z.read("manifest.json"))["knowledge_resources"]
        if section.get("schema_version") != 1 or len(section["knowledge_bases"]) != 1:
            raise Failure("兼容导入只支持 v1 单知识库包")
        entry = section["knowledge_bases"][0]
        expected = set()
        for f in entry["files"]:
            if f["path"] in expected:
                raise Failure("文件清单重复")
            expected.add(f["path"])
            data = z.read(f["path"])
            if sha(data) != f["sha256"] or len(data) != f["size"]:
                raise Failure("文件摘要或大小不匹配")
        if expected != set(names) - {"manifest.json"}:
            raise Failure("文件清单与 ZIP 不一致")
        metadata = json.loads(z.read(entry["metadata_path"]))
        nodes = tree_order(json.loads(z.read(entry["tree_path"]))["nodes"])
        bodies = {}
        for n in nodes:
            if n["node_type"] == "document":
                body = z.read(n["content_path"]).decode("utf-8")
                if not body.strip() or len(body.encode()) > MAX_BODY:
                    raise Failure("正文为空或超限")
                bodies[n["key"]] = body
        return metadata, nodes, bodies


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="PandaWiki 首页或文档 URL；导出整个可发现目录")
    parser.add_argument("-o", "--output", default="pandawiki-knowledge.zip")
    parser.add_argument("--name", help="目标知识库名称")
    parser.add_argument("--source-id", help="稳定的源实例别名；默认使用域名")
    parser.add_argument("--kb-id", help="只有网关未注入 X-KB-ID 时才需要")
    parser.add_argument("--allow-partial", action="store_true", help="允许跳过不可读文档；报告列出遗漏")
    parser.add_argument("--max-nodes", type=int, default=50000)
    parser.add_argument("--cookies", help="Netscape 格式源站 Cookie 文件（需要登录时使用）")
    parser.add_argument("--timeout", type=float, default=30)
    args = parser.parse_args()
    try:
        export_package(args)
    except (Failure, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as exc:
        print(f"失败：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
