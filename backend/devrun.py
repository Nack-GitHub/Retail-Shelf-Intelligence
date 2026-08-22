"""Start a long-running dev process detached from this shell.

Same reason as model/launch_training.py: start_new_session=True calls setsid(2)
so the process survives its parent, which the tooling here otherwise reaps.

    python devrun.py api      # uvicorn
    python devrun.py worker   # celery
    python devrun.py stop
"""

import os
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRATCH = Path(os.environ.get("SHELFEYE_LOGDIR", ROOT / ".logs"))
SCRATCH.mkdir(parents=True, exist_ok=True)

COMMANDS = {
    "api": [".venv/bin/uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    "worker": [".venv/bin/celery", "-A", "app.workers.celery_app", "worker",
               "--loglevel=info", "-c", "2"],
}


def start(name: str) -> None:
    log = SCRATCH / f"{name}.log"
    env = {**os.environ, "PYTHONPATH": str(ROOT), "PYTHONUNBUFFERED": "1"}
    with log.open("wb") as fh:
        proc = subprocess.Popen(
            [str(ROOT / c) if c.startswith(".venv") else c for c in COMMANDS[name]],
            cwd=ROOT, env=env, stdout=fh, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, start_new_session=True,
        )
    (SCRATCH / f"{name}.pid").write_text(str(proc.pid))
    print(f"{name} pid={proc.pid} log={log}")


def stop() -> None:
    for pid_file in SCRATCH.glob("*.pid"):
        try:
            pid = int(pid_file.read_text())
            os.killpg(os.getpgid(pid), signal.SIGTERM)
            print(f"stopped {pid_file.stem} ({pid})")
        except (ProcessLookupError, ValueError):
            pass
        pid_file.unlink(missing_ok=True)


if __name__ == "__main__":
    action = sys.argv[1]
    stop() if action == "stop" else start(action)
