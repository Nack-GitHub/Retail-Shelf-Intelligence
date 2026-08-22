"""Launch training in a detached session that outlives the parent shell.

macOS has no setsid(1); start_new_session=True calls setsid(2) directly, which
puts the run in its own process group and session so a parent shell exiting
cannot take it down.
"""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOG = Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / "train.log")
CONFIG = sys.argv[1] if len(sys.argv) > 1 else "configs/yolo11n-640.yaml"

env = {**os.environ, "PYTHONPATH": str(ROOT), "PYTHONUNBUFFERED": "1"}
with LOG.open("wb") as log:
    proc = subprocess.Popen(
        [str(ROOT / ".venv/bin/python"), "-u", "-m", "shelfeye_ml.training.train",
         "--config", CONFIG],
        cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL, start_new_session=True,
    )
print(f"pid={proc.pid} log={LOG}")
(ROOT / ".training.pid").write_text(str(proc.pid))
