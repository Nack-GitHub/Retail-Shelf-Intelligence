# ShelfEye — backend API + ML model
#
# Host ports are shifted off the defaults (postgres 5433, redis 6380) so this
# stack never collides with anything already running on the machine.

SHELL := /bin/bash
BACKEND := backend
MODEL := model
PY_BACKEND := $(BACKEND)/.venv/bin/python
PY_MODEL := $(MODEL)/.venv/bin/python

.PHONY: help setup dataset infra infra-stop migrate seed seed-history planogram reset-db api worker ml stop \
        test test-backend test-model test-contracts lint check-boundary \
        train train-smoke evaluate export card demo clean-artifacts \
        resplit resplit-cv train-baseline train-noerasing train-recall train-cv \
        gap-diag evaluate-holdout aggregate-cv

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

seed: ## Seed demo users, stores, model versions and visit history
	cd $(BACKEND) && PYTHONPATH=. .venv/bin/python -m app.db.seed
	$(MAKE) seed-history

planogram: ## Regenerate backend/app/services/planogram.json from the artifact's class map
	@# The SKU names a rep is told to restock come from the class list the model
	@# was trained on. Rerun after training on a different one.
	cd $(MODEL) && .venv/bin/python -m shelfeye_ml.artifact.export_planogram

seed-history: ## Seed visits from real dataset photos (needs `dataset` + `infra`)
	@# Separate from `seed` so the integration suite, which calls seed() directly,
	@# does not pay for twenty-one uploads and a full pipeline run per session.
	cd $(BACKEND) && PYTHONPATH=. .venv/bin/python -m app.db.seed_history

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
#
# Every artifact target below points at ONE run, named by these variables.
# Ultralytics builds the directory as artifacts/<run_name>/ where run_name is
# the key of the same name in the training config, and always writes the
# weights as best.pt and last.pt — the directory changes per config, the
# filenames never do. `--fold N` appends `-foldN` to the directory.
#
# Override on the command line to point at whichever run you just trained:
#
#     make evaluate RUN=shelf-product-yolo26l-640-recall IMGSZ=640
#     make gap-diag RUN=shelf-product-yolo26l-640-noerasing IMGSZ=640 \
#                   DATA=data/splits/holdout/data.yaml
#
# ⚠️ DATA defaults to the ORIGINAL Roboflow split, and that default is load
# bearing. The re-split in data/splits/ reshuffles every image, so a model
# trained before the re-split has already SEEN ~85% of the new holdout test
# set. Scoring old weights against data/splits/** reports a contaminated
# number that looks like a large improvement. Only pass DATA=.../splits/... for
# weights that were themselves trained on that same split.

RUN     ?= shelf-product-yolo26l-960
WEIGHTS ?= artifacts/$(RUN)/weights/best.pt
IMGSZ   ?= 960
DATA    ?= data/data.yaml
FOLDS   ?= 5

train-smoke: ## 2 epochs at imgsz 320 — proves the pipeline, measures epoch time
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.training.train \
	  --config configs/smoke.yaml

train: ## Full run, detached (hours)
	cd $(MODEL) && python3 launch_training.py configs/yolo11n-640.yaml

evaluate: ## Evaluate $(RUN) on the test split against the promotion gates
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.eval.evaluate \
	  --weights $(WEIGHTS) --data $(DATA) --split test --imgsz $(IMGSZ)

export: ## Export ONNX (opset 17) into the artifact directory
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.training.export_onnx \
	  --weights $(WEIGHTS) --imgsz $(IMGSZ)

card: ## Generate model_card.md
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.eval.model_card \
	  --artifact-dir artifacts/$(RUN)

demo: ## Walk the golden path against a running API
	cd $(BACKEND) && python3 scripts/demo_golden_path.py

# ── Gap-recall work ──────────────────────────────────────────────────────────
#
# Split the labour by what each machine is good at. Everything under `resplit`
# and `gap-diag` is CPU or single-pass inference and runs on a laptop in
# seconds to minutes. Only the `train-*` targets need a real GPU.
#
# These reuse RUN / WEIGHTS / IMGSZ / DATA from the ML section above. Point
# them at whichever artifact you just brought back from the training box:
#
#     make gap-diag RUN=shelf-product-yolo26l-640-recall IMGSZ=640 \
#                   DATA=data/splits/holdout/data.yaml
#
# The cross-validation targets carry their own pair of variables because the
# fold artifacts are named after the CV config, not after RUN. CV_RUN must
# match the `run_name:` inside CV_CONFIG or the evaluate step looks in the
# wrong directory.

CV_CONFIG ?= configs/yolo26l-640-recall.yaml
CV_RUN    ?= shelf-product-yolo26l-640-recall
CV_IMGSZ  ?= 640

resplit: ## Re-split 70/15/15 by store group, stratified on gap count
	@# Writes ABSOLUTE paths into data/splits/**/*.txt, so re-run this on
	@# whichever machine is about to train. It takes under a second.
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.training.resplit \
	  --mode holdout --ratios 70 15 15

resplit-cv: ## Carve an untouched test split, then build $(FOLDS) folds from the rest
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.training.resplit \
	  --mode kfold --folds $(FOLDS)

train-baseline: ## CONTROL: old settings, but val on and imgsz matched to the data
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.training.train \
	  --config configs/yolo26l-640-baseline.yaml

train-noerasing: ## ABLATION: baseline with erasing 0.0 — run this one first
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.training.train \
	  --config configs/yolo26l-640-noerasing.yaml

train-recall: ## Full recall-first config (run after the two above)
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.training.train \
	  --config configs/yolo26l-640-recall.yaml

train-cv: ## Train + evaluate every fold of $(CV_CONFIG). Hours. GPU only.
	@for k in $$(seq 0 $$(($(FOLDS) - 1))); do \
	  echo "=== fold $$k ==="; \
	  cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.training.train \
	    --config $(CV_CONFIG) --fold $$k && \
	  PYTHONPATH=. .venv/bin/python -m shelfeye_ml.eval.evaluate \
	    --weights artifacts/$(CV_RUN)-fold$$k/weights/best.pt \
	    --data data/splits/kfold/fold$$k/data.yaml --split test --imgsz $(CV_IMGSZ) \
	    || exit 1; \
	done

aggregate-cv: ## Collapse the folds into mean +- SD and a pooled interval
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.eval.aggregate_folds \
	  --run $(CV_RUN) --folds $(FOLDS)

evaluate-holdout: ## Gate $(RUN) against the re-split test set (301 gap instances)
	@# ⚠️ Valid ONLY for weights trained on data/splits/holdout. Anything older
	@# than the re-split has trained on most of these images already.
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.eval.evaluate \
	  --weights $(WEIGHTS) --data data/splits/holdout/data.yaml \
	  --split test --imgsz $(IMGSZ)

gap-diag: ## Ceiling, operating point and miss profile for Empty Shelf. Laptop-friendly.
	@# Uses $(DATA), which defaults to the original Roboflow split — the safe
	@# choice for weights that predate the re-split. Pass
	@# DATA=data/splits/holdout/data.yaml once the model was trained on it.
	cd $(MODEL) && PYTHONPATH=. .venv/bin/python -m shelfeye_ml.eval.gap_diagnostics \
	  --weights $(WEIGHTS) --data $(DATA) --split test --imgsz $(IMGSZ)
