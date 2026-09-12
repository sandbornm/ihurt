import asyncio
from contextlib import asynccontextmanager
import io
import secrets
import wave
from pathlib import Path
import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import BadSignature, URLSafeTimedSerializer
from starlette.middleware.trustedhost import TrustedHostMiddleware
from .config import Settings
from .limits import Limits
from .models import MapRequest
from .providers import create_providers, possible_emergency, SAFETY_MESSAGE


class RequestBoundary:
    def __init__(self, app, settings: Settings):
        self.app, self.settings = app, settings

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        async def secure_send(message):
            if message["type"] == "http.response.start":
                message["headers"].extend([
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"permissions-policy", b"camera=(), geolocation=(), microphone=(self)"),
                    (b"content-security-policy", b"default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"),
                ])
                if scope["path"].startswith("/api/"):
                    message["headers"].append((b"cache-control", b"no-store"))
                if self.settings.app_env == "production":
                    message["headers"].append((b"strict-transport-security", b"max-age=31536000"))
            await send(message)
        if scope["method"] not in ("GET", "HEAD", "OPTIONS"):
            origin = headers.get(b"origin", b"").decode()
            if origin not in self.settings.allowed_origins:
                return await JSONResponse({"detail": "This request origin is not allowed."}, 403)(scope, receive, secure_send)
            limit = self.settings.max_audio_bytes + 16384 if scope["path"] == "/api/transcribe" else 24000
            data = bytearray()
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                data.extend(message.get("body", b""))
                if len(data) > limit:
                    return await JSONResponse({"detail": "This request is too large."}, 413)(scope, receive, secure_send)
                if not message.get("more_body"):
                    break
            original_receive = receive
            sent = False
            async def bounded_receive():
                nonlocal sent
                if not sent:
                    sent = True
                    return {"type": "http.request", "body": bytes(data), "more_body": False}
                return await original_receive()
            receive = bounded_receive
        await self.app(scope, receive, secure_send)


def create_app(settings: Settings | None = None, provider=None):
    settings = settings or Settings()
    limits = Limits(settings)
    providers = {"demo": provider} if provider else create_providers(settings)
    signer = URLSafeTimedSerializer(settings.session_secret, salt="ihurt-visitor-v1")
    gate = asyncio.Semaphore(4)

    @asynccontextmanager
    async def lifespan(app):
        yield
        for provider in providers.values():
            if hasattr(provider, "client"):
                await provider.client.close()

    app = FastAPI(title="ihurt", docs_url="/api/docs" if settings.app_env == "development" else None, redoc_url=None, openapi_url="/api/openapi.json" if settings.app_env == "development" else None, lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    app.add_middleware(RequestBoundary, settings=settings)
    app.state.limits = limits

    def identity(request: Request, required=True):
        ip = limits.ip_key(request.client.host if request.client else "unknown")
        limits.rate(ip)
        owner = None
        try:
            owner = signer.loads(request.cookies.get("ihurt_visitor", ""), max_age=86400)
        except BadSignature:
            pass
        if required and not owner:
            raise HTTPException(401, "Your session has expired. Refresh the page to continue.")
        return owner, ip

    async def challenge(token: str):
        if not settings.turnstile_secret_key:
            return
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", data={"secret": settings.turnstile_secret_key, "response": token})
                response.raise_for_status()
                result = response.json()
        except (httpx.HTTPError, ValueError):
            raise HTTPException(503, "Visitor verification is unavailable. Please try again shortly.") from None
        if not result.get("success") or result.get("hostname") not in settings.allowed_hosts or result.get("action") != "map":
            raise HTTPException(403, "Please complete the visitor check and try again.")

    @app.get("/api/health")
    async def health():
        return {"status": "ok", "provider": settings.llm_provider}

    @app.get("/api/session")
    async def session(request: Request, response: Response):
        owner, ip = identity(request, required=False)
        if not owner:
            limits.mint_session(ip)
            owner = secrets.token_urlsafe(24)
            response.set_cookie("ihurt_visitor", signer.dumps(owner), max_age=86400, httponly=True, secure=settings.app_env == "production", samesite="strict")
        return {"provider": settings.llm_provider, "providers": [{"id": key, "name": name, "available": key in providers} for key, name in [("demo", "Demo · no AI"), ("local", "Local model"), ("openai", "OpenAI"), ("anthropic", "Anthropic"), ("grok", "Grok")]], "remaining": limits.remaining(owner, ip), "limit": settings.activities_per_day, "turn_limit": settings.turns_per_activity, "turnstile_site_key": settings.turnstile_site_key, "max_audio_seconds": settings.max_audio_seconds, "transcription_available": "openai" in providers}

    @app.post("/api/map")
    async def map_note(body: MapRequest, request: Request):
        owner, ip = identity(request)
        if body.provider not in providers:
            raise HTTPException(400, "This provider is not enabled. Configure its key on your local server.")
        paid = body.provider in ("openai", "anthropic", "grok")
        if paid and not body.consent:
            raise HTTPException(400, "Please agree to send this note to the selected AI provider before mapping.")
        if not body.activity_id:
            await challenge(body.challenge_token)
        if gate.locked():
            raise HTTPException(503, "The mapper is busy. Please try again shortly.", headers={"Retry-After": "10"})
        async with gate:
            activity_id = limits.reserve(owner, ip, body.request_id, body.activity_id, paid=paid)
            try:
                result = await asyncio.wait_for(providers[body.provider].map(body), timeout=120 if body.provider == "local" else 40)
                if possible_emergency(body.note + " " + " ".join(a.text for a in body.answers)):
                    result.urgent, result.safety_message, result.question = True, SAFETY_MESSAGE, None
                if limits.turns(activity_id) >= settings.turns_per_activity or len(body.answers) >= 2:
                    result.question = None
                return {"activity_id": activity_id, "map": result.model_dump(), "remaining": limits.remaining(owner, ip), "provider": body.provider}
            except (Exception,) as exc:
                # Do not include provider errors or user content in logs or responses.
                if isinstance(exc, HTTPException):
                    raise
                return JSONResponse({"detail": "The mapping service could not finish. Please retry this activity.", "activity_id": activity_id, "remaining": limits.remaining(owner, ip)}, status_code=502)
            finally:
                limits.release(activity_id)

    @app.post("/api/transcribe")
    async def transcribe(request: Request, audio: UploadFile = File(...), consent: bool = Form(False), request_id: str = Form(..., pattern=r"^[a-f0-9-]{36}$"), challenge_token: str = Form("", max_length=2048)):
        owner, ip = identity(request)
        if "openai" not in providers:
            raise HTTPException(400, "Voice-note transcription requires OpenAI mode. Type or use device dictation in the meantime.")
        if not consent:
            raise HTTPException(400, "Please agree to send this recording to OpenAI.")
        raw = await audio.read(settings.max_audio_bytes + 1)
        await audio.close()
        if len(raw) > settings.max_audio_bytes:
            raise HTTPException(413, "Record a shorter voice note.")
        try:
            with wave.open(io.BytesIO(raw), "rb") as wav:
                if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 16000 or wav.getcomptype() != "NONE":
                    raise ValueError()
                frames = wav.getnframes()
                if not 0 < frames <= settings.max_audio_seconds * 16000:
                    raise ValueError()
                pcm = wav.readframes(frames)
                if len(pcm) != frames * 2:
                    raise ValueError()
            cleaned = io.BytesIO()
            with wave.open(cleaned, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(16000)
                wav.writeframes(pcm)
        except (wave.Error, EOFError, ValueError):
            raise HTTPException(422, "Record up to 60 seconds using the app's recorder.") from None
        await challenge(challenge_token)
        if gate.locked():
            raise HTTPException(503, "Transcription is busy. Please try again shortly.")
        async with gate:
            limits.reserve(owner, ip, request_id, None, kind="audio", paid=True)
            try:
                text = await asyncio.wait_for(providers["openai"].transcribe(cleaned.getvalue()), timeout=40)
                return {"text": text}
            except Exception:
                raise HTTPException(502, "The recording could not be transcribed. You can type your note instead.") from None

    dist = Path(__file__).resolve().parent.parent / "dist" / "app"
    if dist.exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
        for folder in ("models", "draco"):
            if (dist / folder).exists():
                app.mount(f"/{folder}", StaticFiles(directory=dist / folder), name=folder)
        @app.get("/")
        async def index():
            return FileResponse(dist / "index.html")
        @app.get("/heat.wasm")
        async def wasm():
            return FileResponse(dist / "heat.wasm", media_type="application/wasm")
        @app.get("/favicon.svg")
        async def favicon():
            return FileResponse(dist / "favicon.svg", media_type="image/svg+xml")
    return app


app = create_app()
