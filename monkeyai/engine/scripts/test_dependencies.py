import hashlib
import io
import json
from pathlib import Path
import struct
import tarfile
import tempfile
import unittest

import dependencies


class DependenciesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cache = self.root / 'cache'
        self.cache.mkdir()
        self.output = self.root / 'output'
        self.lock = self.root / 'lock.json'

    def fixture(self, mode='valid'):
        archive = self.root / 'archive.tar'
        members = {}
        with tarfile.open(archive, 'w') as tar:
            for name in sorted(dependencies.NAMES):
                member = 'bin/' + name
                members[member] = name
                content = b'\x7fELF\x02\x01' + b'\0' * 12 + struct.pack('<H', 183 if mode == 'wrong_arch' else 62)
                entry = tarfile.TarInfo(member)
                entry.size = len(content)
                if mode == 'symlink':
                    entry.type, entry.linkname, entry.size = tarfile.SYMTYPE, '/etc/passwd', 0
                tar.addfile(entry, io.BytesIO(content))
                if mode == 'duplicate':
                    tar.addfile(entry, io.BytesIO(content))
        checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
        archive.rename(self.cache / checksum)
        entry = {'component': 'fixture', 'version': 'v1', 'url': 'https://github.com/example/release',
                 'sha256': checksum, 'members': members}
        self.lock.write_text(json.dumps({'schema_version': 1, 'architectures': {'amd64': [entry]}}))
        return self.cache / checksum

    def prepare(self):
        dependencies.prepare('amd64', self.output, self.cache, self.lock)

    def test_complete_package_and_provenance(self):
        self.fixture()
        self.prepare()
        record = json.loads((self.output / 'provenance.json').read_text())
        self.assertEqual(record['lock_sha256'], dependencies.digest(self.lock))
        self.assertEqual(set(record['files']), dependencies.NAMES)
        for name, digest in record['files'].items():
            self.assertEqual(dependencies.digest(self.output / name), digest)
            self.assertEqual((self.output / name).stat().st_mode & 0o777, 0o755)
        with self.assertRaisesRegex(ValueError, '已存在'):
            self.prepare()

    def test_rejects_corrupted_cache_without_publishing(self):
        self.fixture().write_bytes(b'corrupted')
        with self.assertRaisesRegex(ValueError, '缓存摘要'):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_rejects_unsafe_members_and_wrong_architecture(self):
        for mode in ['symlink', 'duplicate', 'wrong_arch']:
            with self.subTest(mode=mode):
                self.fixture(mode)
                with self.assertRaises(ValueError):
                    self.prepare()
                self.assertFalse(self.output.exists())

    def test_rejects_unknown_output_name(self):
        self.fixture()
        data = json.loads(self.lock.read_text())
        data['architectures']['amd64'][0]['members']['bin/runsc'] = '../outside'
        self.lock.write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertFalse((self.root / 'outside').exists())


if __name__ == '__main__':
    unittest.main()
