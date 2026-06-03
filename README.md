# Lumo

Lumo is a child-safe voice AI demo. A child picks an age band, then has a short
spoken conversation with Lumo through a browser. A FastAPI backend proxies audio
to the OpenAI Realtime API while running every user transcript through a
deterministic safety policy engine before any response is allowed back.

## Architecture

```
┌─────────────┐    WebSocket     ┌──────────────────┐    WebSocket    ┌──────────────────────┐
│   Browser   │ ───────────────▶│  FastAPI proxy   │ ───────────────▶│  OpenAI Realtime API │
│ (Vite + TS) │◀─── PCM16 ──────│  + safety layer  │◀──── events ────│    (gpt-4o-rt)       │
└─────────────┘                  └──────────────────┘                 └──────────────────────┘
                                         │
                                         ▼
                                  in-memory session
                                  store + audit log
```

## Setup

### Backend

```bash
cd backend
python -m venv .venv
. .venv/Scripts/activate   # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -e ".[dev]"
cp .env.example .env       # then fill in OPENAI_API_KEY
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, pick an age band, and start talking.

## Environment variables

| Variable                  | Default                                   | Purpose                                      |
| ------------------------- | ----------------------------------------- | -------------------------------------------- |
| `OPENAI_API_KEY`          | _(required)_                              | OpenAI API key for the Realtime endpoint     |
| `OPENAI_REALTIME_MODEL`   | `gpt-realtime-2`                          | Realtime model                               |
| `OPENAI_REALTIME_URL`     | `wss://api.openai.com/v1/realtime`        | Realtime endpoint                            |
| `TTS_VOICE`               | `alloy`                                   | Voice used for spoken responses              |
| `SESSION_MAX_DURATION_S`  | `300`                                     | Hard cap per session                         |
| `DEBUG`                   | `false`                                   | Enables `/debug/*` routes                    |

## Safety layer

Every transcribed user turn passes through `app/services/safety/policy_engine.py`
before a response is delivered. Checks are deterministic (keywords + regex, no
LLM in the safety path) so they are auditable and fast:

- **SAFE_REFUSED_HARM** — weapons, self-harm, explicit content
- **SAFE_ESCALATE_PARENT** — distress, family crisis, unsafe-home signals
- **SAFE_BOUNDARY_DEPENDENCY_LANGUAGE** — over-attachment / secrecy framing
- **SAFE_MINIMIZED_SENSITIVE_DISCLOSURE** — address / phone / password leaks
- **SAFE_REDIRECTED_GENERAL** — topics off-limits for the chosen age band
- **SAFE_AGE_ADAPTED** — response needed simplification
- **SAFE_OK** — default pass

When a turn is blocked, the proxy sends `response.cancel` upstream and emits a
`safe_redirect` event to the client. All events land in the session record and
roll up into a parent-facing summary at `GET /session/{id}/summary`.

## Tests

```bash
cd backend
pytest -q
```

```bash
cd frontend
npm run typecheck
```

## Deployment

### Backend — Oracle Cloud (Ubuntu 22.04)

Requires Python 3.11+, nginx. Port 8000 stays internal; nginx fronts it.

```bash
# On the VM (first time):
git clone <repo> lumo-demo
cd lumo-demo/backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env && nano .env   # fill OPENAI_API_KEY, set ALLOWED_ORIGINS

# Service:
sudo cp lumo.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable lumo
sudo systemctl start lumo
sudo systemctl status lumo
journalctl -u lumo -f                # live logs

# nginx:
sudo apt install nginx
sudo cp nginx.conf /etc/nginx/sites-available/lumo
sudo ln -s /etc/nginx/sites-available/lumo /etc/nginx/sites-enabled/lumo
sudo nginx -t && sudo systemctl reload nginx

# Updates:
git pull && sudo systemctl restart lumo
```

Oracle security list: open 80 (and 443 with HTTPS). Keep 8000 closed.

`workers=1` is intentional — the in-memory session store is per-process.
Session summaries persist until server restart.

### HTTPS (recommended; required for AudioWorklet on non-localhost)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### Frontend — Cloudflare Pages

Two-page app (multi-page Vite build):
- `/` → `index.html` — your landing page (warm paper palette, Tailwind CDN).
- `/demo` → `demo.html` — age gate, voice session, summary screens.
- `/summary/<id>` → also served by `demo.html`; the demo bundle's router renders the summary from the URL.

1. Connect the GitHub repo to Cloudflare Pages.
2. Build command: `npm run build`
3. Build output: `dist`
4. Root directory: `frontend`
5. Env vars (Pages dashboard):
   - `VITE_BACKEND_WS=wss://your-oracle-domain`
   - `VITE_BACKEND_HTTP=https://your-oracle-domain`

`frontend/public/_redirects` maps `/demo` and `/summary/*` to `/demo.html`.
`frontend/public/_headers` sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
and `Referrer-Policy: strict-origin-when-cross-origin`.

### Local dev still works the same

`VITE_BACKEND_WS` / `VITE_BACKEND_HTTP` left empty → Vite dev proxy handles
`/session` and `/debug` to `localhost:8000` (see `vite.config.ts`).

