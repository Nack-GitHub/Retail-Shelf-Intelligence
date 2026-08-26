# ShelfEye — backend API + ML model
#
# Host ports are shifted off the defaults (postgres 5433, redis 6380) so this
# stack never collides with anything already running on the machine.

SHELL := /bin/bash
BACKEND := backend
MODEL := model
PY_BACKEND := $(BACKEND)/.venv/bin/python
PY_MODEL := $(MODEL)/.venv/bin/python

.PHONY: help setup dataset infra infra-stop migrate seed reset-db api worker ml stop \
        test test-backend test-model test-contracts lint check-boundary \
        train train-smoke evaluate export card demo clean-artifacts

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Setup ────────────────────────────────────────────────────────────────────

setup: ## Create both venvs and install dependencies
	python3 -m venv $(BACKEND)/.venv
	$(BACKEND)/.venv/bin/pip install -q --upgrade pip
	$(BACKEND)/.venv/bin/pip install -q -r $(BACKEND)/requirements.txt -e ./contracts
	python3 -m venv $(MODEL)/.venv
	$(MODEL)/.venv/bin/pip install -q --upgrade pip
	$(MODEL)/.venv/bin/pip install -q -r $(MODEL)/requirements.txt -e ./contracts
	@test -f $(BACKEND)/.env || cp $(BACKEND)/.env.example $(BACKEND)/.env
	@echo "setup complete"

dataset: ## Extract the Roboflow dataset (idempotent)
	@mkdir -p $(MODEL)/data
	@unzip -q -o $(MODEL)/shelf-product.v1i.yolov11.zip -d $(MODEL)/data/
	@echo "train=$$(ls $(MODEL)/data/train/images | wc -l | tr -d ' ') \
	valid=$$(ls $(MODEL)/data/valid/images | wc -l | tr -d ' ') \
	test=$$(ls $(MODEL)/data/test/images | wc -l | tr -d ' ')"

# ── Infrastructure ───────────────────────────────────────────────────────────

infra: ## Start postgres, redis, minio
	docker compose up -d postgres redis minio
	docker compose up minio-init

infra-stop: ## Stop this project's containers only (never removes them)
	docker compose stop

migrate: ## Apply database migrations
	cd $(BACKEND) && .venv/bin/alembic upgrade head

seed: ## Seed demo users, stores and model versions
	cd $(BACKEND) && PYTHONPATH=. .venv/bin/python -m app.db.seed

reset-db: ## Drop and rebuild THIS project's schema, then reseed (destructive)
	@# Development databases accumulate every test run — after a few hundred
	@# captures every store reads 100% OSA and "0 days since visit", and the
	@# demo stops demonstrating anything. Touches the shelfeye database only.
	cd $(BACKEND) && .venv/bin/alembic downgrade base && .venv/bin/alembic upgrade head
	$(MAKE) seed

# ── Services ─────────────────────────────────────────────────────────────────

api: ## Start the API (detached)
	cd $(BACKEND) && python3 devrun.py api

worker: ## Start the Celery worker (detached)
	cd $(BACKEND) && python3 devrun.py worker

ml: ## Start the ML inference service (detached)
	cd $(MODEL) && python3 devrun_ml.py start

stop: ## Stop API, worker and ML service
	-cd $(BACKEND) && python3 devrun.py stop
	-cd $(MODEL) && python3 devrun_ml.py stop

# ── Tests ────────────────────────────────────────────────────────────────────

test: test-contracts test-backend test-model ## Run every suite

test-contracts:
	cd contracts && ../$(BACKEND)/.venv/bin/python -m pytest tests -q

test-backend: ## Needs `make infra migrate` first
	cd $(BACKEND) && PYTHONPATH=. .venv/bin/python -m pytest tests -q

test-model:
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m pytest tests -q

lint: ## ruff check + format
	cd $(BACKEND) && .venv/bin/ruff check app tests --fix && .venv/bin/ruff format app tests

check-boundary: ## Fail if the backend ever grows an ML dependency
	@! grep -rlE '^\s*(import|from)\s+(torch|ultralytics|cv2|tensorflow)\b' \
	  $(BACKEND)/app --include='*.py' || (echo "CV library in backend/app" && exit 1)
	@! grep -qiE '^(torch|ultralytics|opencv|tensorflow)' $(BACKEND)/requirements.txt \
	  || (echo "CV library in backend/requirements.txt" && exit 1)
	@echo "boundary intact: no CV library in the backend"

# ── ML ───────────────────────────────────────────────────────────────────────

train-smoke: ## 2 epochs at imgsz 320 — proves the pipeline, measures epoch time
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.training.train \
	  --config configs/smoke.yaml

train: ## Full run, detached (hours)
	cd $(MODEL) && python3 launch_training.py configs/yolo11n-640.yaml

evaluate: ## Evaluate on the test split against the promotion gates
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.eval.evaluate \
	  --weights artifacts/shelf-product-yolo26l-960/weights/best.pt --split test --imgsz 960

export: ## Export ONNX (opset 17) into the artifact directory
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.training.export_onnx \
	  --weights artifacts/shelf-product-yolo26l-960/weights/best.pt --imgsz 960

card: ## Generate model_card.md
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.eval.model_card \
	  --artifact-dir artifacts/shelf-product-yolo26l-960

demo: ## Walk the golden path against a running API
	cd $(BACKEND) && python3 scripts/demo_golden_path.py
