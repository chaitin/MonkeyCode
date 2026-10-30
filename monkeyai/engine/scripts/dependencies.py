#!/usr/bin/env python3
"""下载锁定的官方发行文件，校验后仅提取必需的普通 ELF 文件。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent
NAMES = {'containerd', 'runsc', 'containerd-shim-runsc-v1', 'bridge', 'ptp', 'host-local', 'loopback', 'checkpointgofer', 'gvisor-proc-umounter', 'gvisor-sentry-prewarmer', 'gvisor_sentry', 'runsc-fd-parking', 'runsc-metric-server'}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def extract(archive, members, destination, arch):
    with tarfile.open(archive, 'r:*') as package:
        for member, name in members.items():
            if name not in NAMES:
                raise ValueError('清单包含未知组件')
            matches = [item for item in package.getmembers() if item.name == member]
            if len(matches) != 1 or not matches[0].isfile() or not 0 < matches[0].size <= 256 << 20:
                raise ValueError(f'{member} 缺失、重复或不是受限普通文件')
            with package.extractfile(matches[0]) as source:
                header = source.read(20)
                machine = {'amd64': 62, 'arm64': 183}[arch]
                if len(header) != 20 or header[:6] != b'\x7fELF\x02\x01' or struct.unpack('<H', header[18:20])[0] != machine:
                    raise ValueError(f'{name} 不是目标架构 Linux ELF')
                path = destination / name
                with path.open('xb') as target:
                    target.write(header)
                    shutil.copyfileobj(source, target)
                path.chmod(0o755)


def prepare(arch, output, cache, lockfile):
    lock = json.loads(lockfile.read_text())
    if lock['schema_version'] != 1:
        raise ValueError('依赖清单版本无效')
    entries = lock['architectures'][arch]
    names = [name for entry in entries for name in entry['members'].values()]
    if set(names) != NAMES or len(names) != len(NAMES):
        raise ValueError('清单必须包含全部组件且不能重复')
    output = output.resolve()
    if output.exists():
        raise ValueError('输出目录已存在，请使用新目录，避免覆盖已审核依赖')
    output.parent.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.dependencies-', dir=output.parent) as work:
        stage = Path(work)
        for entry in entries:
            want = entry['sha256']
            if not re.fullmatch(r'[a-f0-9]{64}', want) or not entry['url'].startswith('https://github.com/'):
                raise ValueError('下载源或摘要无效')
            archive = cache / want
            if archive.exists() and (archive.is_symlink() or digest(archive) != want):
                raise ValueError('缓存摘要不匹配，请检查并移除损坏文件后重试')
            if not archive.exists():
                with tempfile.TemporaryDirectory(prefix='.download-', dir=cache) as tmp:
                    download = Path(tmp) / 'archive'
                    subprocess.run(['curl', '--proto', '=https', '--proto-redir', '=https', '--tlsv1.2',
                                    '--fail', '--location', '--silent', '--show-error', '--retry', '3',
                                    '--connect-timeout', '15', '--max-time', '900', '--max-filesize', str(512 << 20),
                                    entry['url'], '--output', str(download)], check=True)
                    if digest(download) != want:
                        raise ValueError(f'{entry["component"]} 上游文件摘要不匹配')
                    os.replace(download, archive)
            extract(archive, entry['members'], stage, arch)
        provenance = {'architecture': arch, 'lock_sha256': digest(lockfile), 'sources': entries,
                      'files': {name: digest(stage / name) for name in sorted(NAMES)}}
        (stage / 'provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n')
        stage.rename(output)
    print(f'{arch} 依赖已按固定摘要准备：{output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arch', choices=['amd64', 'arm64'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=ROOT / 'dist/cache')
    parser.add_argument('--lock', type=Path, default=ROOT / 'dependencies.lock.json')
    args = parser.parse_args()
    prepare(args.arch, args.output, args.cache, args.lock)
