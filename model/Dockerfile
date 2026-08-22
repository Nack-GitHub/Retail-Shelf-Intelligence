FROM python:3.12-slim

WORKDIR /srv
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY contracts /srv/contracts
COPY model/requirements-serve.txt /srv/model/requirements-serve.txt
RUN pip install --no-cache-dir -r model/requirements-serve.txt -e ./contracts

COPY model/shelfeye_ml /srv/model/shelfeye_ml
COPY model/class_map.yaml /srv/model/class_map.yaml
WORKDIR /srv/model
ENV PYTHONPATH=/srv/model

CMD ["uvicorn", "shelfeye_ml.serving.app:app", "--host", "0.0.0.0", "--port", "8001"]
