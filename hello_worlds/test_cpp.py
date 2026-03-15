import subprocess
import unittest
import os
import shutil

HELLO_DIR = os.path.dirname(os.path.abspath(__file__))
EXPECTED_OUTPUT = "Hello, World!\n"


def is_command_available(cmd):
    return shutil.which(cmd) is not None


@unittest.skipUnless(is_command_available("g++"), "g++ not available")
class TestCpp(unittest.TestCase):

    def test_cpp(self):
        os.chdir(HELLO_DIR)
        subprocess.run(["g++", "hello.cpp", "-o", "hello_cpp"], check=True, capture_output=True)
        result = subprocess.run(
            [os.path.join(HELLO_DIR, "hello_cpp")],
            capture_output=True,
            text=True
        )
        self.assertEqual(result.stdout, EXPECTED_OUTPUT)


if __name__ == "__main__":
    unittest.main()
