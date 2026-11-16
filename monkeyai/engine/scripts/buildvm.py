#!/usr/bin/env python3
"""在对应架构的独立 Linux 构建机生成固定版本组件；Runner 不执行本脚本。"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

from packagevm import ROOT, NAMES, digest, package


def download(url, checksum, cache):
    destination = cache / checksum
    if destination.exists():
        if not destination.is_file() or destination.is_symlink() or digest(destination) != checksum:
            raise ValueError('组件下载缓存摘要不符')
        return destination
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as output:
        stage = Path(output.name)
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                total = 0
                while data := response.read(1 << 20):
                    total += len(data)
                    if total > 512 << 20:
                        raise ValueError('组件下载超过上限')
                    output.write(data)
            output.flush()
            os.fsync(output.fileno())
            if digest(stage) != checksum:
                raise ValueError('组件下载摘要不匹配')
            os.link(stage, destination)
        finally:
            stage.unlink(missing_ok=True)
    return destination


def command(args, cwd, env=None):
    subprocess.run([str(arg) for arg in args], cwd=cwd, env=env, check=True)


def source_tree(archive, destination):
    with tarfile.open(archive, 'r:xz') as tar:
        if sum(member.size for member in tar.getmembers()) > 2 << 30:
            raise ValueError('构建源码展开体积超过上限')
        tar.extractall(destination, filter='data')
    children = list(destination.iterdir())
    if len(children) != 1 or not children[0].is_dir():
        raise ValueError('源码归档布局不符')
    return children[0]


def source_digest():
    paths = [ROOT / 'go.mod', ROOT / 'go.sum']
    paths += [p for folder in ('cmd', 'internal') for p in (ROOT / folder).rglob('*.go') if not p.name.endswith('_test.go')]
    value = hashlib.sha256()
    for path in sorted(paths):
        value.update(path.relative_to(ROOT).as_posix().encode() + b'\0' + hashlib.sha256(path.read_bytes()).digest())
    return value.hexdigest()


def import_go_components(source, output, architecture):
    source = source.resolve(strict=True)
    record = json.loads((source / 'go-components.json').read_text())
    names = {'monkeyai-guest', 'monkeyai-selftest', 'umoci'}
    lock = json.loads((ROOT / 'firecracker.lock.json').read_text())
    if (record.get('architecture') != architecture or record.get('source_sha256') != source_digest()
            or record.get('umoci_sum') != lock['umoci']['sum'] or set(record.get('files', {})) != names):
        raise ValueError('Go组件与当前源码、架构或umoci锁定身份不一致')
    from packagevm import static_elf
    for name in names:
        path = source / name
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 256 << 20 or digest(path) != record['files'][name]:
            raise ValueError('预编译Go组件摘要、类型或大小无效')
        static_elf(path, architecture)
        shutil.copyfile(path, output / name)


def build(architecture, output, cache, jobs, go_components=None):
    native = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine())
    if platform.system() != 'Linux' or native != architecture:
        raise ValueError('内核和静态工具必须在对应架构的独立 Linux 构建机原生构建')
    if jobs < 1 or jobs > 64:
        raise ValueError('构建并行数必须介于1和64之间')
    tools = ['make', 'gcc', 'pkg-config', 'bison', 'flex', 'bc', 'objcopy']
    if go_components is None:
        tools.append('go')
    for tool in tools:
        if not shutil.which(tool):
            raise ValueError(f'构建机缺少 {tool}；请在构建镜像中准备依赖')
    lock = json.loads((ROOT / 'firecracker.lock.json').read_text())
    entry = lock['architectures'][architecture]
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError('组件输出目录必须为空')
    cache.mkdir(parents=True, exist_ok=True)
    inputs = {
        'firecracker': (entry['archive_url'], entry['archive_sha256']),
        'config': (entry['config_url'], entry['config_sha256']),
        'kernel': (lock['kernel_source']['url'], lock['kernel_source']['sha256']),
        'e2fsprogs': (lock['e2fsprogs']['url'], lock['e2fsprogs']['sha256']),
    }
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {name: executor.submit(download, url, checksum, cache) for name, (url, checksum) in inputs.items()}
        fetched = {name: future.result() for name, future in futures.items()}
    suffix = {'amd64': 'x86_64', 'arm64': 'aarch64'}[architecture]
    with tarfile.open(fetched['firecracker'], 'r:gz') as tar:
        for name in ('firecracker', 'jailer'):
            expected = f"{name}-{lock['firecracker_version']}-{suffix}"
            found = [m for m in tar.getmembers() if Path(m.name).name == expected]
            if len(found) != 1 or not found[0].isfile() or not 0 < found[0].size < 256 << 20:
                raise ValueError(f'官方归档缺少唯一普通程序 {name}')
            with tar.extractfile(found[0]) as source, (output / name).open('xb') as target:
                shutil.copyfileobj(source, target)
            (output / name).chmod(0o755)
    env = os.environ.copy()
    env.update({'GOWORK': 'off', 'CGO_ENABLED': '0', 'GOOS': 'linux', 'GOARCH': architecture})
    if go_components is not None:
        import_go_components(go_components, output, architecture)
    else:
        command(['go', 'build', '-trimpath', '-ldflags=-s -w', '-o', output / 'monkeyai-guest', './cmd/monkeyai-guest'], ROOT, env)
        command(['go', 'build', '-trimpath', '-ldflags=-s -w', '-o', output / 'monkeyai-selftest', './cmd/monkeyai-selftest'], ROOT, env)
        module = lock['umoci']
        info = json.loads(subprocess.check_output(['go', 'mod', 'download', '-json', f"{module['module']}@{module['version']}"], cwd=ROOT, env=env))
        if info.get('Sum') != module['sum']:
            raise ValueError('umoci 源码模块摘要不符')
        command(['go', 'build', '-mod=readonly', '-trimpath', '-ldflags=-s -w', '-o', output / 'umoci', './cmd/umoci'], Path(info['Dir']), env)
    with tempfile.TemporaryDirectory(prefix='monkeyai-vm-build-') as work:
        work = Path(work)
        kernel_dir, fs_dir = work / 'kernel', work / 'e2fsprogs'
        kernel_dir.mkdir()
        fs_dir.mkdir()
        kernel = source_tree(fetched['kernel'], kernel_dir)
        fs = source_tree(fetched['e2fsprogs'], fs_dir)
        shutil.copyfile(fetched['config'], kernel / '.config')
        command(['scripts/config', '--disable', 'DEBUG_INFO_BTF', '--set-str', 'SYSTEM_TRUSTED_KEYS', '', '--set-str', 'SYSTEM_REVOCATION_KEYS', ''], kernel)
        command(['make', 'olddefconfig'], kernel)
        config = (kernel / '.config').read_text()
        for option in ('CONFIG_EXT4_FS=y', 'CONFIG_IP_PNP=y', 'CONFIG_VIRTIO_VSOCKETS=y', 'CONFIG_DEVTMPFS_MOUNT=y', 'CONFIG_CGROUPS=y'):
            if option not in config.splitlines():
                raise ValueError(f'构建内核缺少 {option}')
        command(['make', f'-j{jobs}', 'vmlinux' if architecture == 'amd64' else 'Image'], kernel)
        if architecture == 'amd64':
            command(['objcopy', '--strip-debug', kernel / 'vmlinux', output / 'kernel'], kernel)
        else:
            shutil.copyfile(kernel / 'arch/arm64/boot/Image', output / 'kernel')
        command(['./configure', '--disable-nls', '--disable-uuidd', '--disable-fuse2fs', '--disable-elf-shlibs'], fs)
        command(['make', f'-j{jobs}', 'libs'], fs)
        command(['make', '-C', 'misc', f'-j{jobs}', 'mke2fs.static'], fs)
        shutil.copyfile(fs / 'misc/mke2fs.static', output / 'mke2fs')
        # 保留构建所用源码版本、配置和授权材料，不把这些文件混入宿主可执行路径。
        notices = output / 'licenses'
        notices.mkdir()
        for name, path in [('linux.COPYING', kernel / 'COPYING'), ('e2fsprogs.NOTICE', fs / 'NOTICE')]:
            if path.is_file():
                shutil.copyfile(path, notices / name)
        shutil.copyfile(kernel / '.config', notices / f'kernel-{architecture}.config')
    shutil.copyfile(ROOT / 'guest/bootstrap.sh', output / 'guest-bootstrap')
    shutil.copyfile(ROOT / 'guest/monkeyai-guest.service', output / 'monkeyai-guest.service')
    for name, mode in NAMES.items():
        (output / name).chmod(mode)
    provenance = {'architecture': architecture, 'firecracker_version': lock['firecracker_version'], 'kernel_version': lock['kernel_version'], 'files': {name: digest(output / name) for name in NAMES}}
    (output / 'components.json').write_text(json.dumps(provenance, sort_keys=True, indent=2) + '\n')
    return provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arch', choices=['amd64', 'arm64'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--go-components', type=Path, help='可选的同源码静态Go交叉编译产物，须附带摘要清单')
    parser.add_argument('--jobs', type=int, default=4)
    args = parser.parse_args()
    build(args.arch, args.output, args.cache, args.jobs, args.go_components)


if __name__ == '__main__':
    main()
