#!/usr/bin/env python3

import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKSPACE_ROOT = ROOT.parent


class MakefileAgentVersionTest(unittest.TestCase):
    def test_engine_builds_embed_agent_commit_hash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            agent = pathlib.Path(tmp)
            (agent / "cmd" / "ohmyagent").mkdir(parents=True)
            (agent / "cmd" / "ohmyagent" / "main.go").write_text(
                "package main\nfunc main() {}\n",
                encoding="utf-8",
            )
            subprocess.run(["git", "init", "--quiet"], cwd=agent, check=True)
            subprocess.run(["git", "add", "."], cwd=agent, check=True)
            subprocess.run(
                [
                    "git",
                    "-c",
                    "user.name=Desktop Test",
                    "-c",
                    "user.email=desktop-test@example.invalid",
                    "commit",
                    "--quiet",
                    "-m",
                    "fixture",
                ],
                cwd=agent,
                check=True,
            )
            commit = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=agent,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()

            dry_run = subprocess.run(
                ["make", "--dry-run", "engine-universal", f"OHMYAGENT_SRC={agent}"],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            ).stdout

            linker_value = f"-X main.Version={commit}"
            self.assertEqual(dry_run.count(linker_value), 2)

    def test_windows_release_workflows_embed_agent_commit_hash(self) -> None:
        for name in ("desktop-windows.yml", "desktop-win7.yml"):
            with self.subTest(workflow=name):
                workflow = (WORKSPACE_ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8")
                self.assertIn('AGENT_VERSION="$(git rev-parse --short HEAD)"', workflow)
                self.assertIn("-X main.Version=${AGENT_VERSION}", workflow)


if __name__ == "__main__":
    unittest.main()
