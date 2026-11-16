#!/usr/bin/env python3
"""从已锁定的本地组件生成 Firecracker 依赖包；不发布、不安装宿主。"""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import struct
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
NAMES = {
    'firecracker': 0o755, 'jailer': 0o755, 'kernel': 0o644,
    'umoci': 0o755, 'mke2fs': 0o755, 'monkeyai-guest': 0o755,
    'monkeyai-selftest': 0o755,
    'guest-bootstrap': 0o755, 'monkeyai-guest.service': 0o644,
}
MAX_FILE = 256 << 20


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        while data := f.read(1 << 20):
            h.update(data)
    return h.hexdigest()


def static_elf(path, architecture):
    with path.open('rb') as f:
        header = f.read(64)
        if len(header) != 64 or header[:7] != b'\x7fELF\x02\x01\x01':
            raise ValueError(f'{path.name} 不是 Linux 64位小端 ELF')
        expected = {'amd64': 62, 'arm64': 183}[architecture]
        if struct.unpack_from('<H', header, 18)[0] != expected:
            raise ValueError(f'{path.name} 架构不匹配')
        offset = struct.unpack_from('<Q', header, 32)[0]
        size, count = struct.unpack_from('<HH', header, 54)
        if count > 256 or count and size < 56:
            raise ValueError('ELF program header 无效')
        for index in range(count):
            f.seek(offset + index * size)
            entry = f.read(56)
            if len(entry) != 56 or struct.unpack_from('<I', entry)[0] == 3:
                raise ValueError(f'{path.name} 依赖动态加载器或 ELF 不完整')


def package(source, destination, architecture, lock_path=None):
    source = Path(source).resolve(strict=True)
    destination = Path(destination)
    lock = json.loads(Path(lock_path or ROOT / 'firecracker.lock.json').read_text())
    if architecture not in lock['architectures'] or lock['schema'] != 1:
        raise ValueError('不支持的目标架构或锁文件')
    provenance = json.loads((source / 'components.json').read_text())
    if (provenance.get('architecture') != architecture
            or provenance.get('firecracker_version') != lock['firecracker_version']
            or provenance.get('kernel_version') != lock['kernel_version']
            or set(provenance.get('files', {})) != set(NAMES)):
        raise ValueError('组件清单与架构、版本或固定文件集合不匹配')
    for name, mode in NAMES.items():
        path = source / name
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_FILE:
            raise ValueError(f'不安全或过大的组件: {name}')
        if digest(path) != provenance['files'][name]:
            raise ValueError(f'组件摘要不符: {name}')
        if mode & 0o111 and name != 'guest-bootstrap':
            static_elf(path, architecture)
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / 'firecracker.tgz'
    if archive.exists() or archive.is_symlink():
        raise ValueError('输出已存在，拒绝覆盖固定版本归档')
    with tempfile.NamedTemporaryFile(dir=destination, prefix='.firecracker-', delete=False) as f:
        temporary = Path(f.name)
        try:
            with gzip.GzipFile(fileobj=f, mode='wb', filename='', mtime=0) as gz:
                with tarfile.open(fileobj=gz, mode='w|', format=tarfile.USTAR_FORMAT) as tar:
                    for name in sorted(NAMES):
                        path = source / name
                        info = tarfile.TarInfo(name)
                        info.size = path.stat().st_size
                        info.mode = NAMES[name]
                        with path.open('rb') as data:
                            tar.addfile(info, data)
            f.flush()
            os.fsync(f.fileno())
            os.chmod(temporary, 0o644)
            # 同目录原子发布，不覆盖并发打包者的产物。
            os.link(temporary, archive)
        finally:
            temporary.unlink(missing_ok=True)
    record = {
        'version': 1,
        'firecracker_version': lock['firecracker_version'],
        'kernel_version': lock['kernel_version'],
        'archive_sha256': digest(archive),
        'files': provenance['files'],
    }
    output = destination / 'firecracker.json'
    with output.open('x') as f:
        json.dump(record, f, ensure_ascii=False, sort_keys=True, indent=2)
        f.write('\n')
        f.flush()
        os.fsync(f.fileno())
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--components', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--arch', choices=['amd64', 'arm64'], required=True)
    args = parser.parse_args()
    package(args.components, args.output, args.arch)


if __name__ == '__main__':
    main()
