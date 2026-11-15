#!/usr/bin/env python3
"""从依赖镜像下载锁定发行文件，校验后仅提取必需的普通 ELF 文件。"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MIRROR = 'https://release.monkeycode-ai.com/public/monkeyai/engine/dependencies'
NAMES = {'gvisor_sentry', 'runsc-metric-server', 'ctr', 'docker-init', 'runsc-fd-parking', 'runsc', 'containerd', 'dockerd', 'containerd-shim-runc-v2', 'runc', 'docker', 'checkpointgofer', 'docker-proxy', 'gvisor-proc-umounter', 'gvisor-sentry-prewarmer'}


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


def validate_existing(arch, output, lockfile):
    provenance = output / 'provenance.json'
    if output.is_symlink() or provenance.is_symlink() or not provenance.is_file():
        raise ValueError('已有依赖目录缺少可信来源记录')
    record = json.loads(provenance.read_text())
    if record.get('architecture') != arch or record.get('lock_sha256') != digest(lockfile) or set(record.get('files', {})) != NAMES:
        raise ValueError('已有依赖目录与架构或锁文件不一致，请使用新版本')
    for name, want in record['files'].items():
        path = output / name
        if path.is_symlink() or not path.is_file() or digest(path) != want:
            raise ValueError(f'已有依赖文件校验失败：{name}')


def locked_entries(arch, lockfile):
    lock = json.loads(lockfile.read_text())
    if lock['schema_version'] != 1:
        raise ValueError('依赖清单版本无效')
    entries = lock['architectures'][arch]
    names = [name for entry in entries for name in entry['members'].values()]
    if set(names) != NAMES or len(names) != len(NAMES):
        raise ValueError('清单必须包含全部组件且不能重复')
    for entry in entries:
        if not re.fullmatch(r'[a-f0-9]{64}', entry['sha256']) or not entry['url'].startswith(('https://github.com/', 'https://download.docker.com/linux/static/stable/')):
            raise ValueError('下载源或摘要无效')
    if len({archive_name(entry) for entry in entries}) != len(entries):
        raise ValueError('依赖归档文件名重复')
    return entries


def dependency_version(lockfile):
    value = json.loads(lockfile.read_text()).get('dependency_version', '')
    if not isinstance(value, str) or not re.fullmatch(r'v[0-9]{8}', value):
        raise ValueError('依赖锁必须指定 vYYMMDDNN 格式的 dependency_version')
    return value


def archive_name(entry):
    name = urlsplit(entry['url']).path.rsplit('/', 1)[-1]
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}', name):
        raise ValueError('依赖归档文件名无效')
    return name


def cached(entry, cache):
    archive = cache / entry['sha256']
    if archive.is_symlink() or (archive.exists() and (not archive.is_file() or digest(archive) != entry['sha256'])):
        raise ValueError('缓存摘要不匹配，请检查并移除损坏文件后重试')
    return archive if archive.exists() else None


def download(source, target, limit, upstream=False):
    subprocess.run(['curl', '--proto', '=https', '--proto-redir', '=https', '--tlsv1.2',
                    '--fail', '--location', '--max-redirs', '10' if upstream else '0',
                    '--progress-bar', '--show-error', '--retry', '3', '--retry-all-errors',
                    '--connect-timeout', '15', '--max-time', '900', '--max-filesize', str(limit),
                    source, '--output', str(target)], check=True)


def fetch_upstream(entry, cache):
    want = entry['sha256']
    if not re.fullmatch(r'[a-f0-9]{64}', want) or not entry['url'].startswith(('https://github.com/', 'https://download.docker.com/linux/static/stable/')):
        raise ValueError('下载源或摘要无效')
    cache.mkdir(parents=True, exist_ok=True)
    archive = cached(entry, cache)
    if archive:
        print(f'{entry["component"]} {entry["version"]} 复用已校验缓存', flush=True)
        return archive
    print(f'下载官方依赖 {entry["component"]} {entry["version"]}', flush=True)
    with tempfile.TemporaryDirectory(prefix='.download-', dir=cache) as tmp:
        path = Path(tmp) / 'archive'
        download(entry['url'], path, 512 << 20, upstream=True)
        if digest(path) != want:
            raise ValueError(f'{entry["component"]} 下载文件摘要不匹配')
        archive = cache / want
        os.replace(path, archive)
    return archive


def unpack_bundle(bundle, entries, cache):
    expected = {archive_name(entry): entry for entry in entries}
    if len(expected) != len(entries):
        raise ValueError('依赖归档文件名重复')
    with tempfile.TemporaryDirectory(prefix='.unpack-', dir=cache) as work:
        stage = Path(work)
        seen = set()
        with gzip.open(bundle, 'rb') as compressed:
            with tarfile.open(fileobj=compressed, mode='r:') as package:
                for member in package:
                    if member.name not in expected or member.name in seen or not member.isfile() or not 0 < member.size <= 512 << 20:
                        raise ValueError('依赖包包含未知、重复或无效归档')
                    entry = expected[member.name]
                    path = stage / entry['sha256']
                    with package.extractfile(member) as source, path.open('xb') as target:
                        shutil.copyfileobj(source, target)
                    if digest(path) != entry['sha256']:
                        raise ValueError(f'{entry["component"]} 归档摘要不匹配')
                    seen.add(member.name)
            trailer = compressed.read(10241)
            if len(trailer) > 10240 or any(trailer):
                raise ValueError('依赖包尾部无效')
        if seen != set(expected):
            raise ValueError('依赖包缺少锁定归档')
        for entry in entries:
            os.replace(stage / entry['sha256'], cache / entry['sha256'])


def ensure_archives(arch, entries, cache, lockfile, mirror):
    version = dependency_version(lockfile)
    parsed = urlsplit(mirror)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('依赖镜像必须为无凭据的 HTTPS 地址')
    present = [cached(entry, cache) is not None for entry in entries]
    if all(present):
        print(f'{arch} 全部依赖归档缓存校验通过，跳过下载', flush=True)
        return
    print(f'下载依赖包 {version}/{arch}/dependencies.tgz', flush=True)
    with tempfile.TemporaryDirectory(prefix='.download-', dir=cache) as work:
        path = Path(work) / 'dependencies.tgz'
        download(f'{mirror.rstrip("/")}/{version}/{arch}/dependencies.tgz', path, len(entries) * (512 << 20))
        unpack_bundle(path, entries, cache)


def prepare(arch, output, cache, lockfile, reuse=False, mirror=DEFAULT_MIRROR):
    entries = locked_entries(arch, lockfile)
    if output.is_symlink():
        raise ValueError('依赖输出目录不能是符号链接')
    output = output.resolve()
    if output.exists() and reuse:
        validate_existing(arch, output, lockfile)
        print(f'{arch} 已有依赖校验通过，复用：{output}')
        return
    if output.exists():
        raise ValueError('输出目录已存在，请使用新目录，避免覆盖已审核依赖')
    output.parent.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.dependencies-', dir=output.parent) as work:
        stage = Path(work)
        ensure_archives(arch, entries, cache, lockfile, mirror)
        for entry in entries:
            extract(cache / entry['sha256'], entry['members'], stage, arch)
        provenance = {'architecture': arch, 'lock_sha256': digest(lockfile), 'sources': entries,
                      'files': {name: digest(stage / name) for name in sorted(NAMES)}}
        (stage / 'provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n')
        stage.rename(output)
    print(f'{arch} 依赖已按固定摘要准备：{output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reuse', action='store_true', help='校验并复用已有完整依赖目录')
    parser.add_argument('--arch', choices=['amd64', 'arm64'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=ROOT / 'dist/cache')
    parser.add_argument('--lock', type=Path, default=ROOT / 'dependencies.lock.json')
    parser.add_argument('--mirror', default=os.environ.get('ENGINE_DEPENDENCY_URL') or DEFAULT_MIRROR,
                        help='依赖镜像地址；缺失时直接失败，不回退官方上游')
    args = parser.parse_args()
    try:
        prepare(args.arch, args.output, args.cache, args.lock, args.reuse, args.mirror)
    except (ValueError, OSError, EOFError, tarfile.TarError, subprocess.CalledProcessError) as error:
        print(f'依赖准备失败：{error}；请检查缓存或先同步锁定依赖到镜像源', file=sys.stderr)
        sys.exit(1)
