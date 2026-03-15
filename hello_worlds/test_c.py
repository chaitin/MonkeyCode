import subprocess
import unittest
import os
import shutil

HELLO_DIR = os.path.dirname(os.path.abspath(__file__))
EXPECTED_OUTPUT = "Hello, World!\n"


def is_command_available(cmd):
    return shutil.which(cmd) is not None


@unittest.skipUnless(is_command_available("gcc"), "gcc not available")
class TestC(unittest.TestCase):

    def test_c(self):
        os.chdir(HELLO_DIR)
        subprocess.run(["gcc", "hello.c", "-o", "hello_c"], check=True, capture_output=True)
        result = subprocess.run(
            [os.path.join(HELLO_DIR, "hello_c")],
            capture_output=True,
            text=True
        )
        self.assertEqual(result.stdout, EXPECTED_OUTPUT)


if __name__ == "__main__":
    unittest.main()
