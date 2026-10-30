#!/usr/bin/env python3
"""将审核后的固定版本依赖与 engine 打包为后台可分发的目录。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--version', required=True)
parser.add_argument('--arch', choices=['amd64', 'arm64'], required=True)
parser.add_argument('--dependencies', type=Path, required=True)
parser.add_argument('--output', type=Path, default=Path('dist'))
args = parser.parse_args()
if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}', args.version):
    parser.error('版本号无效')
files = ['containerd', 'runsc', 'containerd-shim-runsc-v1', 'bridge', 'ptp', 'host-local', 'loopback', 'checkpointgofer', 'gvisor-proc-umounter', 'gvisor-sentry-prewarmer', 'gvisor_sentry', 'runsc-fd-parking', 'runsc-metric-server']
root = Path(__file__).resolve().parent.parent
output = args.output.resolve() / args.version
output.mkdir(parents=True, exist_ok=True)
final = output / args.arch
if final.exists():
    parser.error('目标发行目录已存在，禁止覆盖已发布版本')
with tempfile.TemporaryDirectory(prefix='.package-', dir=output) as work:
    stage = Path(work)
    for name in files:
        source = args.dependencies / name
        if source.is_symlink() or not source.is_file():
            parser.error(f'缺少已审核的依赖文件：{name}')
        shutil.copyfile(source, stage / name)
    subprocess.run(['go', 'build', '-trimpath', '-ldflags', f'-s -w -X main.version={args.version}',
                    '-o', str(stage / 'monkeyai-engine'), './cmd/monkeyai-engine'],
                   cwd=root, env={**os.environ, 'GOOS': 'linux', 'GOARCH': args.arch, 'CGO_ENABLED': '0'}, check=True)
    digests = {}
    for name in ['monkeyai-engine', *files]:
        path = stage / name
        with path.open('rb') as file:
            header = file.read(20)
            if len(header) != 20 or header[:6] != b'\x7fELF\x02\x01' or struct.unpack('<H', header[18:20])[0] != {'amd64': 62, 'arm64': 183}[args.arch]:
                parser.error(f'{name} 不是目标架构的 Linux ELF 文件')
            file.seek(0)
            digests[name] = hashlib.file_digest(file, 'sha256').hexdigest()
        path.chmod(0o755)
    provenance = args.dependencies / 'provenance.json'
    if provenance.exists():
        record = json.loads(provenance.read_text())
        if record['architecture'] != args.arch or record['files'] != {name: digests[name] for name in files}:
            parser.error('依赖文件与来源记录不一致')
        shutil.copyfile(provenance, stage / 'provenance.json')
    (stage / 'manifest.json').write_text(json.dumps({'version': args.version, 'architecture': args.arch, 'files': digests}, indent=2) + '\n')
    # 仅在所有文件构建和校验通过后发布完整目录。
    stage.rename(final)
print(f'发行目录已生成：{final}')
