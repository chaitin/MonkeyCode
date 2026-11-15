import hashlib
import io
import json
from pathlib import Path
import struct
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import subprocess

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
        self.lock.write_text(json.dumps({'schema_version': 1, 'dependency_version': 'v26110301', 'architectures': {'amd64': [entry]}}))
        return self.cache / checksum

    def bundle(self, content=None):
        entry = json.loads(self.lock.read_text())['architectures']['amd64'][0]
        if content is None:
            content = (self.cache / entry['sha256']).read_bytes()
        result = self.root / 'dependencies.tgz'
        with tarfile.open(result, 'w:gz') as package:
            item = tarfile.TarInfo(dependencies.archive_name(entry))
            item.size = len(content)
            package.addfile(item, io.BytesIO(content))
        return result.read_bytes()

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

    def test_reuses_only_verified_dependencies(self):
        self.fixture()
        self.prepare()
        with patch.object(dependencies.subprocess, 'run') as run:
            dependencies.prepare('amd64', self.output, self.cache, self.lock, reuse=True)
            run.assert_not_called()
        (self.output / 'runsc').write_bytes(b'corrupted')
        with self.assertRaisesRegex(ValueError, '校验失败'):
            dependencies.prepare('amd64', self.output, self.cache, self.lock, reuse=True)

    def test_reuse_rejects_changed_lock(self):
        self.fixture()
        self.prepare()
        self.lock.write_text(self.lock.read_text() + ' ')
        with self.assertRaisesRegex(ValueError, '锁文件'):
            dependencies.prepare('amd64', self.output, self.cache, self.lock, reuse=True)

    def test_failed_download_is_never_cached(self):
        archive = self.fixture()
        archive.unlink()
        def fail(command, **kwargs):
            self.assertIn('--retry-all-errors', command)
            Path(command[-1]).write_bytes(b'partial')
            raise subprocess.CalledProcessError(18, command)
        with patch.object(dependencies.subprocess, 'run', side_effect=fail):
            with self.assertRaises(subprocess.CalledProcessError):
                self.prepare()
        self.assertFalse(archive.exists())
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_mirror_download_keeps_original_lock_and_provenance(self):
        archive = self.fixture()
        content = archive.read_bytes()
        bundle = self.bundle()
        archive.unlink()
        before = self.lock.read_bytes()
        def download(command, **kwargs):
            self.assertEqual(command[-3], 'https://oss.example/engine/dependencies/v26110301/amd64/dependencies.tgz')
            self.assertEqual(command[command.index('--max-redirs') + 1], '0')
            self.assertFalse(any('github.com' in arg for arg in command))
            Path(command[-1]).write_bytes(bundle)
        with patch.object(dependencies.subprocess, 'run', side_effect=download) as run:
            dependencies.prepare('amd64', self.output, self.cache, self.lock, mirror='https://oss.example/engine/dependencies/')
            run.assert_called_once()
        record = json.loads((self.output / 'provenance.json').read_text())
        self.assertEqual(record['sources'][0]['url'], 'https://github.com/example/release')
        self.assertEqual(self.lock.read_bytes(), before)
        self.assertEqual(archive.read_bytes(), content)

    def test_default_mirror_never_falls_back_to_upstream(self):
        archive = self.fixture()
        archive.unlink()
        def unavailable(command, **kwargs):
            self.assertEqual(command[-3], dependencies.DEFAULT_MIRROR + '/v26110301/amd64/dependencies.tgz')
            raise subprocess.CalledProcessError(22, command)
        with patch.object(dependencies.subprocess, 'run', side_effect=unavailable) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                self.prepare()
            run.assert_called_once()
        self.assertFalse(self.output.exists())
        self.assertFalse(archive.exists())

    def test_bad_mirror_or_content_is_rejected(self):
        archive = self.fixture()
        archive.unlink()
        for mirror in ('', 'http://example.com', 'https://user:pass@example.com', 'https://example.com?token=x', 'https://example.com/#fragment'):
            with patch.object(dependencies.subprocess, 'run') as run:
                with self.assertRaises(ValueError):
                    dependencies.prepare('amd64', self.output, self.cache, self.lock, mirror=mirror)
                run.assert_not_called()
        corrupted = self.bundle(b'corrupt')
        with patch.object(dependencies.subprocess, 'run', side_effect=lambda command, **kw: Path(command[-1]).write_bytes(corrupted)):
            with self.assertRaisesRegex(ValueError, '摘要不匹配'):
                self.prepare()
        self.assertFalse(archive.exists())
        self.assertFalse(self.output.exists())

    def test_upstream_requires_explicit_selection(self):
        archive = self.fixture()
        content = archive.read_bytes()
        archive.unlink()
        entry = dependencies.locked_entries('amd64', self.lock)[0]
        def download(command, **kwargs):
            self.assertEqual(command[-3], entry['url'])
            self.assertEqual(command[command.index('--max-redirs') + 1], '10')
            Path(command[-1]).write_bytes(content)
        with patch.object(dependencies.subprocess, 'run', side_effect=download):
            self.assertEqual(dependencies.fetch_upstream(entry, self.cache), archive)

    def test_cache_is_shared_across_engine_releases(self):
        archive = self.fixture()
        with patch.object(dependencies.subprocess, 'run') as run:
            for name in ('v1', 'v2'):
                dependencies.prepare('amd64', self.root / name, self.cache, self.lock)
            run.assert_not_called()
        self.assertTrue(archive.exists())

    def test_dependency_version_uses_release_number(self):
        self.fixture()
        self.assertEqual(dependencies.dependency_version(self.lock), 'v26110301')
        data = json.loads(self.lock.read_text())
        for value in ('v1', 'latest', '../outside', '26110301', '', 123):
            data['dependency_version'] = value
            self.lock.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                dependencies.dependency_version(self.lock)

    def test_bundle_rejects_invalid_entries_and_truncation(self):
        archive = self.fixture()
        contents = archive.read_bytes()
        entry = dependencies.locked_entries('amd64', self.lock)[0]
        archive.unlink()
        for mode in ('missing', 'unknown', 'duplicate', 'symlink', 'oversize', 'truncated'):
            with self.subTest(mode=mode):
                path = self.root / 'invalid.tgz'
                with tarfile.open(path, 'w:gz') as package:
                    if mode != 'missing':
                        item = tarfile.TarInfo(dependencies.archive_name(entry))
                        item.size = len(contents)
                        payload = contents
                        if mode == 'unknown':
                            item.name = '../outside'
                        elif mode == 'symlink':
                            item.type, item.linkname, item.size, payload = tarfile.SYMTYPE, '/etc/passwd', 0, b''
                        elif mode == 'oversize':
                            item.size = (512 << 20) + 1
                            package.fileobj.write(item.tobuf())
                        if mode != 'oversize':
                            package.addfile(item, io.BytesIO(payload))
                        if mode == 'duplicate':
                            package.addfile(item, io.BytesIO(payload))
                if mode == 'truncated':
                    path.write_bytes(path.read_bytes()[:-8])
                with self.assertRaises((ValueError, OSError, EOFError, tarfile.TarError)):
                    dependencies.unpack_bundle(path, [entry], self.cache)
                self.assertFalse(archive.exists())

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
