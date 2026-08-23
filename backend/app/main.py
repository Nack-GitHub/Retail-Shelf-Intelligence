"""FastAPI application entry point."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import (
    analytics,
    areas,
    auth,
    captures,
    catalog,
    findings,
    routes,
    stores,
    sync,
    tasks,
    visits,
)
from app.core.config import settings
from app.core.exceptions import ShelfEyeError
from app.core.logging import configure_logging, get_logger, set_request_id

configure_logging()
log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info(
        "startup",
        app=settings.app_name,
        version=settings.app_version,
        ml_client=settings.ml_client,
        config_version=settings.analysis_config_version,
    )
    yield
    log.info("shutdown")


app = FastAPI(
    title="ShelfEye API",
    version=settings.app_version,
    description=(
        "Shelf gap detection and replenishment. Public responses are camelCase to "
        "match the frontend's domain types; the internal ML contract is snake_case."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    """Mint or adopt a request id and echo it back.

    The same id reaches the Celery task and the ML service, so one identifier
    ties together every process that touched a photo.
    """
    rid = set_request_id(request.headers.get("X-Request-ID"))
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response


@app.exception_handler(ShelfEyeError)
async def domain_error_handler(request: Request, exc: ShelfEyeError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.http_status,
        content={"errorCode": exc.code, "detail": exc.detail, "userMessage": exc.user_message},
    )


@app.get("/healthz", tags=["ops"])
async def healthz() -> dict:
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
        "mlClient": settings.ml_client,
    }


for router in (
    auth.router,
    routes.router,
    stores.router,
    catalog.router,
    visits.router,
    captures.router,
    findings.router,
    tasks.router,
    analytics.router,
    areas.router,
    sync.router,
):
    app.include_router(router, prefix="/v1")
