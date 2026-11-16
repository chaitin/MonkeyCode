import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tarfile
import tempfile
import unittest

MODULE = Path(__file__).with_name('packagevm.py')
spec = importlib.util.spec_from_file_location('packagevm', MODULE)
packagevm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packagevm)


class PackageVMTest(unittest.TestCase):
    def fixture(self, base, arch='amd64'):
        source = base / 'source'
        source.mkdir()
        files = {}
        for name, mode in packagevm.NAMES.items():
            data = bytearray(64)
            data[:7] = b'\x7fELF\x02\x01\x01'
            struct.pack_into('<H', data, 18, 62 if arch == 'amd64' else 183)
            if not mode & 0o111 or name == 'guest-bootstrap':
                data = b'fixed content'
            (source / name).write_bytes(data)
            files[name] = hashlib.sha256(data).hexdigest()
        lock = json.loads((packagevm.ROOT / 'firecracker.lock.json').read_text())
        (source / 'components.json').write_text(json.dumps({
            'architecture': arch, 'firecracker_version': lock['firecracker_version'],
            'kernel_version': lock['kernel_version'], 'files': files,
        }))
        return source, files

    def test_archive_and_determinism(self):
        for arch in ('amd64', 'arm64'):
            with self.subTest(arch=arch), tempfile.TemporaryDirectory() as work:
                base = Path(work)
                source, files = self.fixture(base, arch)
                first = packagevm.package(source, base / 'first', arch)
                second = packagevm.package(source, base / 'second', arch)
                self.assertEqual(first, second)
                with tarfile.open(base / 'first/firecracker.tgz') as tar:
                    self.assertEqual(set(tar.getnames()), set(packagevm.NAMES))
                    for member in tar:
                        self.assertEqual(member.mode, packagevm.NAMES[member.name])
                        data = tar.extractfile(member).read()
                        self.assertEqual(hashlib.sha256(data).hexdigest(), files[member.name])
                with self.assertRaises(ValueError):
                    packagevm.package(source, base / 'first', arch)

    def test_corruption_architecture_and_symlink(self):
        for mode in ('checksum', 'arch', 'symlink'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as work:
                base = Path(work)
                source, _ = self.fixture(base)
                if mode == 'checksum':
                    (source / 'firecracker').write_bytes(b'changed')
                if mode == 'symlink':
                    (source / 'kernel').unlink()
                    (source / 'kernel').symlink_to('/etc/passwd')
                with self.assertRaises(ValueError):
                    packagevm.package(source, base / 'out', 'arm64' if mode == 'arch' else 'amd64')
                self.assertFalse((base / 'out/firecracker.tgz').exists())


if __name__ == '__main__':
    unittest.main()
