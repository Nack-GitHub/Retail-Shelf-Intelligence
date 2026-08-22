#!/bin/bash
# Detached training launcher. setsid puts the run in its own session so it
# survives the parent shell exiting.
cd "$(dirname "$0")"
export PYTHONPATH=.
exec .venv/bin/python -u -m shelfeye_ml.training.train --config configs/yolo11n-640.yaml
