#!/usr/bin/env python3

import pathlib
import tempfile
import unittest

from check_command_contract import build_commands, literal_invokes, registered_commands


class CommandContractParserTest(unittest.TestCase):
    def test_parses_namespaced_handlers_and_manifest(self) -> None:
        manifest = 'AppManifest::new().commands(&["one", "two"])'
        handler = "tauri::generate_handler![one, driver::two]"
        self.assertEqual(build_commands(manifest), {"one", "two"})
        self.assertEqual(registered_commands(handler), {"one", "two"})

    def test_literal_invokes_ignore_plugin_namespace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "client.ts"
            path.write_text(
                'invoke<Result>("session_open"); invoke("plugin:dialog|open");',
                encoding="utf-8",
            )
            self.assertEqual(literal_invokes([path]), {"session_open"})


if __name__ == "__main__":
    unittest.main()
