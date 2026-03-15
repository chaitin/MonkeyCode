import subprocess
import unittest
import os
import shutil

HELLO_DIR = os.path.dirname(os.path.abspath(__file__))
EXPECTED_OUTPUT = "Hello, World!\n"


def is_command_available(cmd):
    return shutil.which(cmd) is not None


@unittest.skipUnless(is_command_available("javac"), "javac not available")
class TestJava(unittest.TestCase):

    def test_java(self):
        os.chdir(HELLO_DIR)
        subprocess.run(["javac", "Hello.java"], check=True, capture_output=True)
        result = subprocess.run(
            ["java", "-cp", HELLO_DIR, "Hello"],
            capture_output=True,
            text=True
        )
        self.assertEqual(result.stdout, EXPECTED_OUTPUT)


if __name__ == "__main__":
    unittest.main()
