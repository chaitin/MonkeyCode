import json
from pathlib import Path
import struct
import tempfile
import unittest

from buildvm import import_go_components, source_digest
from packagevm import ROOT, digest


class BuildVMTest(unittest.TestCase):
    def test_import_checks_source_architecture_and_bytes(self):
        for mode in ('ok', 'source', 'arch', 'bytes'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as work:
                root = Path(work)
                source, output = root / 'input', root / 'output'
                source.mkdir()
                output.mkdir()
                files = {}
                for name in ('monkeyai-guest', 'monkeyai-selftest', 'umoci'):
                    raw = bytearray(64)
                    raw[:7] = b'\x7fELF\x02\x01\x01'
                    struct.pack_into('<H', raw, 18, 62)
                    (source / name).write_bytes(raw)
                    files[name] = digest(source / name)
                record = {
                    'architecture': 'amd64', 'source_sha256': source_digest(),
                    'umoci_sum': json.loads((ROOT / 'firecracker.lock.json').read_text())['umoci']['sum'],
                    'files': files,
                }
                if mode == 'source':
                    record['source_sha256'] = '0' * 64
                if mode == 'arch':
                    record['architecture'] = 'arm64'
                if mode == 'bytes':
                    (source / 'monkeyai-guest').write_bytes(b'changed')
                (source / 'go-components.json').write_text(json.dumps(record))
                if mode == 'ok':
                    import_go_components(source, output, 'amd64')
                    self.assertEqual(set(files), {file.name for file in output.iterdir()})
                else:
                    with self.assertRaises(ValueError):
                        import_go_components(source, output, 'amd64')


if __name__ == '__main__':
    unittest.main()
