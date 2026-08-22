"""Detached launcher for the ML service (see backend/devrun.py for why)."""
import os, signal, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOGDIR = Path(os.environ.get("SHELFEYE_LOGDIR", ROOT / ".logs"))
LOGDIR.mkdir(parents=True, exist_ok=True)
PIDFILE = LOGDIR / "ml.pid"

if sys.argv[1] == "stop":
    if PIDFILE.exists():
        try:
            os.killpg(os.getpgid(int(PIDFILE.read_text())), signal.SIGTERM)
            print("ml stopped")
        except (ProcessLookupError, ValueError):
            pass
        PIDFILE.unlink(missing_ok=True)
    sys.exit(0)

env = {**os.environ, "PYTHONPATH": str(ROOT), "PYTHONUNBUFFERED": "1"}
with (LOGDIR / "ml.log").open("wb") as log:
    proc = subprocess.Popen(
        [str(ROOT / ".venv/bin/uvicorn"), "shelfeye_ml.serving.app:app",
         "--host", "127.0.0.1", "--port", "8001"],
        cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL, start_new_session=True,
    )
PIDFILE.write_text(str(proc.pid))
print(f"ml pid={proc.pid} artifact={env.get('MODEL_ARTIFACT_DIR', 'default')}")
