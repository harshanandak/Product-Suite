import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"


def _run_backend_import(*modules: str) -> subprocess.CompletedProcess[str]:
    command = "; ".join(f"import {module}" for module in modules) + "; print('ok')"
    env = os.environ.copy()
    env["PYTHONPATH"] = ""
    return subprocess.run(
        [sys.executable, "-c", command],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )


def test_backend_root_can_import_config_and_security_modules():
    result = _run_backend_import("config", "security")
    assert result.returncode == 0, result.stderr
    assert "ok" in result.stdout


def test_backend_root_can_import_server_module():
    result = _run_backend_import("server")
    assert result.returncode == 0, result.stderr
    assert "ok" in result.stdout
