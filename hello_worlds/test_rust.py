import subprocess
import unittest
import os
import shutil

HELLO_DIR = os.path.dirname(os.path.abspath(__file__))
EXPECTED_OUTPUT = "Hello, World!\n"


def is_command_available(cmd):
    return shutil.which(cmd) is not None


@unittest.skipUnless(is_command_available("rustc"), "rustc not available")
class TestRust(unittest.TestCase):

    def test_rust(self):
        os.chdir(HELLO_DIR)
        subprocess.run(["rustc", "hello.rs", "-o", "hello_rust"], check=True, capture_output=True)
        result = subprocess.run(
            [os.path.join(HELLO_DIR, "hello_rust")],
            capture_output=True,
            text=True
        )
        self.assertEqual(result.stdout, EXPECTED_OUTPUT)


if __name__ == "__main__":
    unittest.main()
