#!/usr/bin/env python3
"""Upload files directly from disk, then use MCP to convert/save them.

MONKEYAI_MCP_KEY=... python3 kb-file-import.py --server https://office.example \
    --kb-id UUID report.docx diagram.svg
The key stays in the environment; file bytes never enter model tool arguments.
"""
import argparse
import http.client
import json
import mimetypes
import os
import random
from pathlib import Path
import sys
import time
import urllib.parse
import uuid

LIMIT = 32 * 1024 * 1024
FORMATS = {"txt", "md", "markdown", "html", "htm", "svg", "csv", "docx", "xls", "xlsx", "pptx", "pdf", "jpg", "jpeg", "png"}


class ImportClient:
    def __init__(self, server, key):
        parsed = urllib.parse.urlsplit(server)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path.rstrip("/"):
            raise ValueError("--server must be an HTTP(S) origin without credentials, path, query or fragment")
        self.parsed, self.key = parsed, key

    def connection(self):
        cls = http.client.HTTPSConnection if self.parsed.scheme == "https" else http.client.HTTPConnection
        return cls(self.parsed.hostname, self.parsed.port, timeout=180)

    def decode(self, response):
        raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise RuntimeError("Unexpectedly large API response")
        data = json.loads(raw)
        if response.status >= 400:
            raise RuntimeError(data.get("error", {}).get("message", f"HTTP {response.status}"))
        return data

    def tool(self, name, arguments):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}}).encode()
        conn = self.connection()
        try:
            conn.request("POST", "/mcp/kb", body, {"Authorization": f"Bearer {self.key}", "Content-Type": "application/json", "MCP-Protocol-Version": "2025-11-25"})
            reply = self.decode(conn.getresponse())
            if "error" in reply:
                raise RuntimeError(reply["error"].get("message", "MCP request failed"))
            result = reply["result"]
            if result.get("isError"):
                raise RuntimeError(result.get("structuredContent", {}).get("message", "MCP tool failed"))
            return result["structuredContent"]
        finally:
            conn.close()

    def upload(self, kb_id, path, parent_id=None, model_id=None, upload_key=None):
        # File bytes stream directly to the companion endpoint using the same Key.
        size = path.stat().st_size
        if not path.is_file() or not 0 < size <= LIMIT or path.suffix[1:].lower() not in FORMATS:
            raise ValueError(f"Unsupported format, empty file or file larger than 32 MiB: {path.name}")
        boundary = "monkeyai-" + uuid.uuid4().hex
        name = path.name
        if any(c in name for c in ['"', "\\", "\r", "\n"]):
            raise ValueError("Filename contains unsupported multipart characters")
        mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
        fields = {"title": path.name, "upload_key": upload_key or uuid.uuid4().hex}
        if parent_id:
            fields["parent_id"] = parent_id
        if model_id:
            fields["model_id"] = model_id
        prefix = "".join(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n' for key, value in fields.items()).encode()
        head = prefix + (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n').encode()
        tail = f"\r\n--{boundary}--\r\n".encode()
        conn = self.connection()
        try:
            conn.putrequest("POST", f"/mcp/kb/{urllib.parse.quote(kb_id, safe='')}/files/upload")
            conn.putheader("Authorization", f"Bearer {self.key}")
            conn.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
            conn.putheader("Content-Length", str(len(head) + size + len(tail)))
            conn.endheaders()
            conn.send(head)
            with path.open("rb") as source:
                remaining = size
                while remaining:
                    chunk = source.read(min(64 * 1024, remaining))
                    if not chunk:
                        raise RuntimeError("File changed during upload")
                    conn.send(chunk)
                    remaining -= len(chunk)
            conn.send(tail)
            return self.decode(conn.getresponse())
        finally:
            conn.close()

    def import_file(self, kb_id, path, parent_id=None, model_id=None, upload_key=None):
        image = path.suffix[1:].lower() in {"jpg", "jpeg", "png"}
        if image and not model_id:
            raise ValueError("Image import requires --model-id (an accessible vision model)")
        upload_key = upload_key or uuid.uuid4().hex
        # Report before sending bytes so an interrupted process can be resumed.
        print(json.dumps({"file": path.name, "upload_key": upload_key}, ensure_ascii=False), file=sys.stderr, flush=True)
        result = self.upload(kb_id, path, parent_id, model_id, upload_key)
        imported = result.get("import_context")
        task = result.get("task_context")
        deadline = time.monotonic() + 30 * 60
        attempts = busy = 0
        while True:
            if time.monotonic() >= deadline:
                raise TimeoutError("Import did not finish within 30 minutes")
            if result["status"] == "completed":
                return {"file": path.name, **result}
            if result["status"] == "failed":
                if image or not result.get("retryable") or not imported or busy >= 5:
                    raise RuntimeError(result.get("error", "Import failed"))
                busy += 1
                time.sleep(min(30, 2 ** busy) + random.random())
                result = self.tool("kb_upload_file", {"kb_id": kb_id, "import_context": imported})
                task = result.get("task_context", task)
                continue
            if result["status"] != "pending" or not task:
                raise RuntimeError("Invalid import response")
            time.sleep(max(1, min(10, result.get("poll_after_seconds", 3))))
            try:
                result = self.tool("kb_get_file_import_status", {"kb_id": kb_id, "task_context": task})
            except (ConnectionError, OSError, http.client.HTTPException):
                attempts += 1
                if attempts >= 3:
                    raise
                # Re-query the same task; never replay an ambiguous paid parse.
                time.sleep(2)



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", required=True)
    parser.add_argument("--kb-id", required=True)
    parser.add_argument("--parent-id")
    parser.add_argument("--upload-key", help="32 hex characters reused when retrying one file after a lost response")
    parser.add_argument("--model-id", help="Vision model UUID required for image descriptions; failed image calls are not automatically retried")
    parser.add_argument("files", nargs="+", type=Path)
    args = parser.parse_args()
    if args.upload_key and (len(args.files) != 1 or len(args.upload_key) != 32 or any(c not in "0123456789abcdefABCDEF" for c in args.upload_key)):
        parser.error("--upload-key requires exactly one file and 32 hexadecimal characters")
    key = os.environ.get("MONKEYAI_MCP_KEY", "")
    if not key:
        parser.error("Set MONKEYAI_MCP_KEY to an API Key with mcp:invoke scope")
    client = ImportClient(args.server, key)
    failed = False
    for path in args.files:
        try:
            print(json.dumps(client.import_file(args.kb_id, path, args.parent_id, args.model_id, args.upload_key), ensure_ascii=False), flush=True)
        except (ValueError, RuntimeError, OSError, http.client.HTTPException) as error:
            failed = True
            print(json.dumps({"file": path.name, "status": "failed", "error": str(error)}, ensure_ascii=False), file=sys.stderr, flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
