import subprocess
import unittest
import os
import shutil

HELLO_DIR = os.path.dirname(os.path.abspath(__file__))
EXPECTED_OUTPUT = "Hello, World!\n"


def is_command_available(cmd):
    return shutil.which(cmd) is not None


@unittest.skipUnless(is_command_available("npx"), "npx not available")
class TestTypeScript(unittest.TestCase):

    def test_typescript(self):
        result = subprocess.run(
            ["npx", "ts-node", os.path.join(HELLO_DIR, "hello.ts")],
            capture_output=True,
            text=True
        )
        self.assertEqual(result.stdout, EXPECTED_OUTPUT)


if __name__ == "__main__":
    unittest.main()
