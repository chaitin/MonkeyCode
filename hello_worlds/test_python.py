import subprocess
import unittest
import os
import shutil

HELLO_DIR = os.path.dirname(os.path.abspath(__file__))
EXPECTED_OUTPUT = "Hello, World!\n"


def is_command_available(cmd):
    return shutil.which(cmd) is not None


@unittest.skipUnless(is_command_available("python3"), "python3 not available")
class TestPython(unittest.TestCase):

    def test_python(self):
        result = subprocess.run(
            ["python3", os.path.join(HELLO_DIR, "hello.py")],
            capture_output=True,
            text=True
        )
        self.assertEqual(result.stdout, EXPECTED_OUTPUT)


if __name__ == "__main__":
    unittest.main()
