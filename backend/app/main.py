import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import debug, session

log = logging.getLogger("lumo")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not set")
    if len(settings.OPENAI_API_KEY) < 20:
        raise RuntimeError("OPENAI_API_KEY looks invalid")
    log.info(
        "Lumo backend starting — model=%s allowed_origins=%s",
        settings.OPENAI_REALTIME_MODEL,
        settings.ALLOWED_ORIGINS,
    )
    yield


app = FastAPI(title="Lumo Backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(session.router)
app.include_router(debug.router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
