# Lumo

A child-safe voice AI demo. A parent enters a PIN, a child picks an age band,
and then they have a short spoken conversation with **Lumo** through the
browser. Every transcribed turn is checked by a deterministic safety engine
**before** Lumo is allowed to respond, and the parent sees a full session
summary at the end.

Built with FastAPI + OpenAI Realtime API (GA) on the backend, and a vanilla
TypeScript Vite app on the frontend.

---

## Live demo

- `https://lumo.shreyas.space/` — landing page (warm paper palette)
- `https://lumo.shreyas.space/demo` — PIN gate → age gate → voice session
- `https://lumo.shreyas.space/summary/<uuid>` — shareable session summary

---

## Architecture

```
┌─────────────┐    Try Demo →     ┌──────────────┐    PIN     ┌──────────────┐
│  Landing /  │ ──────────────▶  │  Demo /demo  │ ─────────▶ │   Age gate   │
└─────────────┘                   └──────────────┘            └──────┬───────┘
                                                                     │
                                                              ┌──────▼───────┐
                                                              │ Voice screen │
                                                              └──────┬───────┘
                                                                     │
                            PCM16 audio + JSON events                │
   ┌─────────────┐ ◀───────────────────────────────────────────▶ ┌──▼──────────────┐ ◀──────────▶ ┌─────────────────────┐
   │  Browser    │                                                │ FastAPI proxy   │              │  OpenAI Realtime    │
   │  + mic /    │                                                │  + safety layer │              │  API   v1 (GA)      │
   │  AudioCtx   │                                                │  + session store│              │  gpt-realtime-2     │
   └─────────────┘                                                └─────────────────┘              └─────────────────────┘
                                                                          │
                                                                          ▼
                                                                  in-memory session
                                                                  + raw event log
                                                                  + safety events
                                                                          │
                                                              GET /session/<id>/summary
                                                                          │
                                                                          ▼
                                                                 ┌────────────────┐
                                                                 │ Summary screen │
                                                                 │ (donut + bars  │
                                                                 │  + topic tags) │
                                                                 └────────────────┘
```

The browser never talks to OpenAI directly. The API key lives on the backend,
and the proxy intercepts every transcribed user turn for safety policy
enforcement before forwarding upstream events back to the client.

---

## Features

- **Two-page app**: warm Tailwind landing at `/`, code-split demo bundle at `/demo`.
- **PIN gate**: 4-digit access PIN, keyboard or on-screen pad, shake animation on wrong entry.
- **Server-VAD voice loop**: real-time PCM16/24kHz mic capture (AudioWorklet) → relay → Lumo speaks back.
- **Barge-in**: speak while Lumo is talking → immediate audio flush + upstream cancel + 300ms bleed guard.
- **Safety layer**: deterministic keyword/regex policy engine runs on every transcript before any audio is allowed back.
- **Shareable summaries**: every session gets `/summary/<uuid>` with stats, SVG donut of safety reason codes, activity bar chart, top topics, and JSON download.
- **Fatal-error overlay**: friendly mapped messages for mic denial, backend down, quota exhausted, rate-limited, API key invalid, dropped connection.
- **Live partial transcript**: speculative wiring for partial transcription deltas (shows greyed italic bubble on the right while the child speaks).

---

## Local setup

### Backend

```bash
cd backend
python -m venv .venv
. .venv/Scripts/activate          # Windows
# source .venv/bin/activate       # macOS/Linux
pip install -e ".[dev]"
cp ../.env.example ../.env        # or: cp .env.example .env
# Edit .env and paste your OPENAI_API_KEY
uvicorn app.main:app --reload --port 8000
```

`load_dotenv(find_dotenv())` walks upward, so either `lumo-demo/.env` or
`lumo-demo/backend/.env` works.

### Frontend

```bash
cd frontend
npm install
npm run dev                       # http://localhost:5173
```

Open `http://localhost:5173`, click **Try Demo →**, enter the PIN, pick an
age, allow microphone access, and start talking.

---

## Environment variables

### Backend

| Variable                  | Default                                | Purpose                                                  |
| ------------------------- | -------------------------------------- | -------------------------------------------------------- |
| `OPENAI_API_KEY`          | _(required)_                           | OpenAI Realtime API key. Validated at startup.           |
| `OPENAI_REALTIME_MODEL`   | `gpt-realtime-2`                       | Realtime model.                                          |
| `OPENAI_REALTIME_URL`     | `wss://api.openai.com/v1/realtime`     | Realtime endpoint.                                       |
| `TTS_VOICE`               | `alloy`                                | Voice used for spoken responses.                         |
| `SESSION_MAX_DURATION_S`  | `300`                                  | Hard cap per session (clamped by query param `duration`).|
| `DEBUG`                   | `false`                                | Enables `/debug/session/<id>` and `/debug/config`.       |
| `ALLOWED_ORIGINS`         | `*`                                    | Comma-separated CORS origins. Set explicitly in prod.    |

### Frontend (Vite — must be prefixed `VITE_`)

| Variable             | Default (`.env.production`)   | Purpose                                                       |
| -------------------- | ----------------------------- | ------------------------------------------------------------- |
| `VITE_DEMO_PIN`      | _(empty — must be set)_       | 4-digit demo access PIN. Fail-closed if missing.              |
| `VITE_BACKEND_WS`    | `wss://your-oracle-domain`    | Backend WebSocket origin. Leave blank in dev (Vite proxies).  |
| `VITE_BACKEND_HTTP`  | `https://your-oracle-domain`  | Backend HTTP origin. Leave blank in dev.                      |

In **dev**, `VITE_BACKEND_*` empty → Vite dev server proxies `/session` and
`/debug` to `localhost:8000`. In **prod**, set the real backend URLs in
Cloudflare Pages → Settings → Environment variables.

`VITE_DEMO_PIN` is intentionally fail-closed: if unset, every PIN entry is
rejected and a console warning fires. The PIN is bundled into the JS at build
time — it's demo gating, **not** security.

---

## Safety layer

Every transcribed user turn passes through
`backend/app/services/safety/policy_engine.py` before a response is allowed.
Checks are deterministic (keywords + regex, no LLM in the safety path) so they
are auditable and fast.

| Reason code                              | Triggers on                                          |
| ---------------------------------------- | ---------------------------------------------------- |
| `SAFE_REFUSED_HARM`                      | Weapons, self-harm, explicit content                 |
| `SAFE_ESCALATE_PARENT`                   | Distress, family crisis, unsafe-home signals         |
| `SAFE_BOUNDARY_DEPENDENCY_LANGUAGE`      | Over-attachment / secrecy framing                    |
| `SAFE_MINIMIZED_SENSITIVE_DISCLOSURE`    | Address / phone / password leaks                     |
| `SAFE_REDIRECTED_GENERAL`                | Topics off-limits for the chosen age band            |
| `SAFE_AGE_ADAPTED`                       | Response needed simplification                       |
| `SAFE_OK`                                | Default pass                                         |

When a turn is blocked, the proxy sends `response.cancel` upstream and emits a
`safe_redirect` event to the client. The voice screen flushes any in-flight
audio, drops the partial assistant bubble, shows Lumo's age-appropriate
redirect text, then displays a 5-second countdown banner before auto-navigating
to the summary.

All events land in the session record (`session_store.py`) and roll up into a
parent-facing summary at `GET /session/<id>/summary` with reason-code counts,
escalations, safe-turn %, and an activity timeline.

---

## Error handling

The demo screen catches and maps every failure mode to a friendly fatal-error
overlay. The backend includes a structured `{type, source, code, message}`
event for upstream errors so the client can pick the right message.

| Scenario                          | Title shown                       | Retry? |
| --------------------------------- | --------------------------------- | ------ |
| Backend unreachable (5s timeout)  | _Can't reach Lumo_                | Yes    |
| Backend down mid-session          | _Connection lost_                 | Yes    |
| OpenAI quota exhausted            | _Lumo is taking a break_          | No     |
| OpenAI rate limited               | _Lumo is popular right now_       | Yes    |
| OpenAI key invalid / unauthorized | _Lumo is misconfigured_           | No     |
| OpenAI server error               | _Lumo had a hiccup_               | Yes    |
| Mic permission denied             | _Microphone access needed_        | No     |
| No mic device                     | _No microphone found_             | Yes    |
| Mic in use by another app         | _Microphone is in use_            | Yes    |
| Insecure (non-HTTPS) context      | _Insecure context_                | No     |

---

## Tests

```bash
cd backend && pytest -q              # 9 tests: health, policy, ws_proxy relay
cd frontend && npm run typecheck     # tsc --noEmit
cd frontend && npm run build         # full production build
```

CI runs both on every push (`.github/workflows/ci.yml`). A dummy
`OPENAI_API_KEY` is injected so the FastAPI startup validator passes without
secrets.

---

## Deployment

### Backend — Linux VM (Oracle Cloud, DigitalOcean, etc.)

Ships with `backend/Procfile`, `backend/lumo.service`, `backend/nginx.conf`.

```bash
# On the VM, first time:
git clone https://github.com/Shreyas0Kumar/lumo-demo.git
cd lumo-demo/backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env && nano .env
# Set OPENAI_API_KEY and ALLOWED_ORIGINS=https://lumo.shreyas.space

# Service:
sudo cp lumo.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lumo
sudo systemctl status lumo
journalctl -u lumo -f                # live logs

# nginx (terminates HTTPS, upgrades WS):
sudo apt install -y nginx
sudo cp nginx.conf /etc/nginx/sites-available/lumo
sudo ln -s /etc/nginx/sites-available/lumo /etc/nginx/sites-enabled/lumo
sudo nginx -t && sudo systemctl reload nginx

# HTTPS (required for AudioWorklet on non-localhost):
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.your-domain.com

# Updates:
git pull && sudo systemctl restart lumo
```

Security list: open 80 and 443 publicly. **Keep 8000 closed** — nginx fronts it.

`workers=1` in the systemd unit is intentional. The in-memory session store
is per-process; multi-worker would split sessions across workers. Summaries
persist only until the process restarts.

### Frontend — Cloudflare Pages

Multi-page Vite build:

- `/` → `dist/index.html` (landing, Tailwind CDN)
- `/demo` → `dist/demo.html` (PIN + age gate + voice + summary)
- `/summary/<uuid>` → also served from `dist/demo.html` (handled by `_redirects`)

In the Cloudflare Pages dashboard:

| Setting                | Value                            |
| ---------------------- | -------------------------------- |
| Framework preset       | None                             |
| Build command          | `npm install && npm run build`   |
| Build output directory | `dist`                           |
| Root directory         | `frontend`                       |

Environment variables (Production):

| Variable             | Value                                       |
| -------------------- | ------------------------------------------- |
| `VITE_DEMO_PIN`      | _your 4-digit PIN_                          |
| `VITE_BACKEND_WS`    | `wss://api.your-domain.com`                 |
| `VITE_BACKEND_HTTP`  | `https://api.your-domain.com`               |

`frontend/public/_redirects` maps `/demo` and `/summary/*` to `/demo.html`.
`frontend/public/_headers` sets `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

---

## Project layout

```
lumo-demo/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app + startup validation
│   │   ├── config.py            # Settings from .env
│   │   ├── ws_proxy.py          # Browser ↔ OpenAI relay + safety hook
│   │   ├── prompts.py           # Per-age-band system prompts
│   │   ├── session_store.py     # In-memory SessionRecord store
│   │   ├── routers/
│   │   │   ├── session.py       # /session/ws, /session/<id>/end, /summary
│   │   │   └── debug.py         # /debug/events/<id>, /debug/config (DEBUG=true)
│   │   └── services/safety/
│   │       ├── policy_engine.py # check(transcript, age_band) → SafetyResult
│   │       ├── reason_codes.py
│   │       ├── age_bands.py
│   │       └── parent_summary.py
│   ├── scripts/                 # Standalone OpenAI smoke + proxy e2e drivers
│   ├── tests/                   # pytest suite
│   ├── pyproject.toml
│   ├── Procfile
│   ├── lumo.service             # systemd unit
│   └── nginx.conf
├── frontend/
│   ├── index.html               # Landing page (Tailwind CDN)
│   ├── demo.html                # PIN + age + voice + summary screens
│   ├── src/
│   │   ├── main.ts              # Routing, lifecycle, error mappers, PIN
│   │   ├── ui.ts                # DOM helpers (screens, bubbles, fatal error)
│   │   ├── ws.ts                # LumoSocket with 5s connect timeout
│   │   ├── audio.ts             # AudioWorklet mic + queued AudioPlayer
│   │   └── summary.ts           # SVG donut, bar chart, topic extractor
│   ├── public/
│   │   ├── _redirects           # /demo + /summary/* → demo.html
│   │   ├── _headers             # Security headers
│   │   └── mic-processor.js     # AudioWorklet (Float32 → main thread)
│   ├── vite.config.ts           # MPA build, dev URL rewrites
│   └── package.json
├── .github/workflows/ci.yml
└── README.md
```

---

## License

MIT.
