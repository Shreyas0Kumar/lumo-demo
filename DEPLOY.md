# Lumo — Deployment Guide

A self-contained walkthrough for taking the **`Shreyas0Kumar/lumo-demo`**
repo from "code on GitHub" to "live at `https://lumo.shreyas.space`". Paste
this whole file into a new Claude chat if you want help executing any step.

---

## Project context (read this first if you're a new helper)

Lumo is a child-safe voice AI demo built on the OpenAI Realtime API (GA,
model `gpt-realtime-2`).

- **Frontend**: Vite multi-page app (vanilla TypeScript, no framework). Builds to two HTML entries.
  - `/` → marketing landing (Tailwind CDN, warm paper palette)
  - `/demo` → PIN gate → age gate → voice session → shareable summary screen
  - `/summary/<uuid>` → also rendered by the demo bundle (SPA route)
- **Backend**: FastAPI app that proxies a WebSocket from the browser to OpenAI's Realtime API, running a deterministic safety policy on every transcript before any audio is returned. In-memory session store.

The browser **never** talks to OpenAI directly — the API key lives on the backend.

### What needs to be hosted

1. **Static frontend** → Cloudflare Pages (free)
2. **Long-lived WebSocket backend** → a Linux VM with a public IP + HTTPS

### Domain plan

- `lumo.shreyas.space` → Cloudflare Pages (frontend)
- `api.lumo.shreyas.space` → Oracle VM running uvicorn behind nginx (backend)

Two subdomains so the frontend can be a static CDN and the backend can be a long-running WebSocket server. They are joined by `VITE_BACKEND_WS` / `VITE_BACKEND_HTTP` env vars baked into the frontend bundle at build time.

### Env vars cheat sheet

**Backend (set on the VM in `/home/ubuntu/lumo-demo/backend/.env`)**

| Variable                | Value for production                                       |
| ----------------------- | ---------------------------------------------------------- |
| `OPENAI_API_KEY`        | `sk-proj-…` (from platform.openai.com)                     |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime-2`                                           |
| `TTS_VOICE`             | `alloy`                                                    |
| `SESSION_MAX_DURATION_S`| `300`                                                      |
| `DEBUG`                 | `false`                                                    |
| `ALLOWED_ORIGINS`       | `https://lumo.shreyas.space`                               |

**Frontend (set in Cloudflare Pages dashboard → Settings → Environment variables → Production)**

| Variable             | Value for production              |
| -------------------- | --------------------------------- |
| `VITE_DEMO_PIN`      | `6787` (or whatever PIN you want) |
| `VITE_BACKEND_WS`    | `wss://api.lumo.shreyas.space`    |
| `VITE_BACKEND_HTTP`  | `https://api.lumo.shreyas.space`  |

---

## Step 0 — Make the repo public

Cloudflare Pages can build from a private repo (with OAuth), but going public removes friction and lets GitHub Actions run on every push without paid private-repo minutes (free for public).

1. Open https://github.com/Shreyas0Kumar/lumo-demo/settings
2. Scroll all the way to the bottom → **Danger Zone**
3. Click **Change repository visibility** → **Change to public**
4. Type the repo name to confirm.
5. The `.github/workflows/ci.yml` will now run on every push. If you haven't already, run a sanity push to trigger it once.

The repo doesn't contain any secrets:
- `backend/.env` is gitignored
- `frontend/.env` is gitignored
- `frontend/.env.production` only has placeholders (real values come from Cloudflare dashboard at build time)
- The OpenAI key is **never** in git — verify with: `git log --all -p | grep -i sk-proj` (should return nothing)

---

## Step 1 — Provision the backend VM (Oracle Cloud Free Tier)

You can use any Linux VM with a public IP. These instructions assume **Oracle Cloud Always Free** tier (the most generous free option — 4 cores, 24 GB RAM on Ampere ARM).

### 1a. Create the Oracle account + VM

1. Sign up at https://www.oracle.com/cloud/free/ (requires a credit card for verification but won't charge for Always-Free resources).
2. Once logged in: **Compute → Instances → Create Instance**.
3. Configuration:
   - **Name**: `lumo-backend`
   - **Image**: Ubuntu 22.04 (Canonical)
   - **Shape**: `VM.Standard.A1.Flex` → 1 OCPU, 6 GB RAM (well within Always-Free)
   - **Networking**: leave defaults (a new VCN and public subnet are created)
   - **Add SSH keys**: generate locally with `ssh-keygen -t ed25519 -f ~/.ssh/lumo-oracle`, then paste the **public** key (`~/.ssh/lumo-oracle.pub`) into the form
4. Click **Create**. Wait ~1 minute for "RUNNING" status. Note the public IP shown.

### 1b. Open ports 80 and 443 in Oracle's Security List

Oracle's VCN has a virtual firewall in addition to the OS firewall.

1. Click the instance → scroll to **Primary VNIC** → click the **Subnet** name.
2. Click the **Default Security List** for that VCN.
3. **Add Ingress Rules**:
   - Source CIDR `0.0.0.0/0`, IP protocol **TCP**, Destination port range `80`
   - Source CIDR `0.0.0.0/0`, IP protocol **TCP**, Destination port range `443`

(Port 22 for SSH is already open by default.)

### 1c. SSH in and open the OS firewall

```bash
ssh -i ~/.ssh/lumo-oracle ubuntu@<VM_PUBLIC_IP>

# Oracle Ubuntu images ship with iptables locked down. Open 80 and 443:
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Sanity check (from your laptop): `curl -v http://<VM_PUBLIC_IP>` should connect (will return nothing yet since nothing is listening — that's fine, the connection is what we're testing).

### 1d. Install the backend

```bash
# On the VM:
sudo apt update && sudo apt install -y python3-venv python3-pip git nginx
git clone https://github.com/Shreyas0Kumar/lumo-demo.git
cd lumo-demo/backend

python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -e ".[dev]"

# Smoke test (will fail without env, that's expected):
.venv/bin/python -c "from app.config import settings; print('ok')"

# Create .env from template:
cp .env.example .env
nano .env
```

In `nano`, fill in:
```
OPENAI_API_KEY=sk-proj-...   ← from platform.openai.com
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_REALTIME_URL=wss://api.openai.com/v1/realtime
TTS_VOICE=alloy
SESSION_MAX_DURATION_S=300
DEBUG=false
ALLOWED_ORIGINS=https://lumo.shreyas.space
```

Save with `Ctrl+O`, `Enter`, `Ctrl+X`.

### 1e. Install the systemd service

```bash
sudo cp lumo.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lumo
sudo systemctl status lumo
```

You should see `active (running)`. If not, check logs: `journalctl -u lumo -n 50`. Most common failure: `OPENAI_API_KEY is not set` → fix the `.env` and `sudo systemctl restart lumo`.

Sanity check on the VM: `curl http://127.0.0.1:8000/health` should return `{"status":"ok","version":"0.1.0"}`.

### 1f. Install the nginx reverse proxy

```bash
sudo cp nginx.conf /etc/nginx/sites-available/lumo
sudo ln -s /etc/nginx/sites-available/lumo /etc/nginx/sites-enabled/lumo
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

From your laptop: `curl -v http://<VM_PUBLIC_IP>/health` should now return the JSON.

---

## Step 2 — Point `api.lumo.shreyas.space` at the VM

In your Cloudflare dashboard (`shreyas.space` zone):

1. **DNS → Records → Add record**
   - Type: `A`
   - Name: `api.lumo`
   - IPv4 address: `<VM_PUBLIC_IP>` (from Oracle)
   - Proxy status: **DNS only (grey cloud)** for now (Cloudflare-proxied WebSockets work, but we want certbot's HTTP challenge to reach the VM directly first; we can flip to orange-cloud after the cert is issued if you want Cloudflare's WAF/CDN in front)
   - TTL: Auto
2. Wait ~30 seconds, then verify: `dig +short api.lumo.shreyas.space` should return your VM IP.

---

## Step 3 — Get HTTPS on the backend

```bash
# On the VM:
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.lumo.shreyas.space
```

Follow prompts: enter your email, agree to TOS, choose **2: redirect HTTP to HTTPS**.

If certbot fails with "DNS problem" → wait another minute for the A record to propagate, then retry.

If it fails with "Connection refused" → port 80 isn't reachable. Re-check Oracle Security List (Step 1b) and `sudo iptables -L INPUT` on the VM.

Sanity check: `curl https://api.lumo.shreyas.space/health` should return the JSON over HTTPS.

(Optional) After cert is issued you can flip the Cloudflare DNS record to **Proxied (orange cloud)** if you want WAF/DDoS protection. WebSockets work through Cloudflare's free plan with no idle timeout for active connections, so this is safe. If you do this, also set Cloudflare's SSL/TLS mode for the zone to **Full (strict)** so it validates the Let's Encrypt cert.

---

## Step 4 — Deploy the frontend to Cloudflare Pages

### 4a. Create or reconnect the Pages project

If `lumo.shreyas.space` is currently served by the **`Lumo product page`** repo, you have two choices. Pick one:

**Option A — swap the existing project** (simpler if it's already set up):
1. Cloudflare dashboard → **Workers & Pages** → click the project serving `lumo.shreyas.space`.
2. **Settings → Builds & deployments → Source → Configure production deployments → Disconnect**.
3. Reconnect to **`Shreyas0Kumar/lumo-demo`** instead.

**Option B — fresh project**:
1. **Workers & Pages → Create application → Pages → Connect to Git**.
2. Pick **`Shreyas0Kumar/lumo-demo`**.

### 4b. Build settings

| Setting                | Value                            |
| ---------------------- | -------------------------------- |
| Framework preset       | None                             |
| Build command          | `npm install && npm run build`   |
| Build output directory | `dist`                           |
| Root directory         | `frontend`                       |
| Node version           | 20 (defaults are fine)           |

### 4c. Environment variables (Production)

Add three variables under **Settings → Environment variables**:

| Variable             | Value                              |
| -------------------- | ---------------------------------- |
| `VITE_DEMO_PIN`      | `6787` (or your chosen PIN)        |
| `VITE_BACKEND_WS`    | `wss://api.lumo.shreyas.space`     |
| `VITE_BACKEND_HTTP`  | `https://api.lumo.shreyas.space`   |

Save. Then **Deployments → Retry deployment** so the new env vars are baked in.

### 4d. Custom domain

**Settings → Custom domains → Set up a custom domain** → `lumo.shreyas.space`. Cloudflare auto-configures the DNS record (this replaces whatever was previously serving the domain).

First build takes ~1 minute. When it's green, visit `https://lumo.shreyas.space` — you should see the landing page.

---

## Step 5 — Smoke test

1. Open `https://lumo.shreyas.space` → landing should load.
2. Click **Try Demo →** → should land on `/demo`.
3. PIN gate should appear. Enter your `VITE_DEMO_PIN`.
4. Age gate → pick any band.
5. Browser prompts for microphone → allow.
6. Orb pulses → say "hi" → Lumo responds.
7. Click **End session** → you should see the summary screen with stats + donut chart.
8. Copy the URL (`https://lumo.shreyas.space/summary/<uuid>`) → open in a new tab → summary should load again (PIN bypassed because parents need to share these).

If anything fails, see Troubleshooting below.

---

## Step 6 — Archive the old repo

Once Step 5 passes:

1. Open https://github.com/Shreyas0Kumar/Lumo-product-page/settings (or whatever the old repo is named).
2. Scroll to **Danger Zone → Archive this repository**.

The content is preserved in `lumo-demo/frontend/index.html` and is now under active development there.

---

## Troubleshooting

### "Can't reach Lumo" overlay when clicking Try Demo

- Open browser devtools → Network → filter on `ws://` or `wss://`. The WebSocket should connect to `wss://api.lumo.shreyas.space/session/ws?…`.
- If it fails: `curl https://api.lumo.shreyas.space/health` from your laptop. If that fails, the backend isn't reachable — back to Step 3.
- If `/health` works but the WS doesn't: nginx is missing the WS upgrade headers. Verify `/etc/nginx/sites-enabled/lumo` matches `backend/nginx.conf` exactly.

### "Lumo is misconfigured" → API key issue

- SSH to the VM: `journalctl -u lumo -n 50` will show the OpenAI error.
- Most likely: key has expired, hit quota, or is missing project scope. Get a new key from platform.openai.com → Project API Keys → make sure it has Realtime API access.
- After updating `.env`: `sudo systemctl restart lumo`.

### CORS errors in browser console

- The backend's `ALLOWED_ORIGINS` env var must include the exact frontend origin including scheme. For `lumo.shreyas.space`, set `ALLOWED_ORIGINS=https://lumo.shreyas.space`. No trailing slash.
- Restart the backend: `sudo systemctl restart lumo`.

### "Microphone access needed" overlay

- The browser is blocking the mic. Click the lock/info icon next to the URL → Site settings → Microphone → Allow.
- AudioWorklet **requires HTTPS** in production (it works on `localhost` exempt-for-dev). If you're seeing an `Insecure context` error, your `VITE_BACKEND_*` env vars are probably set to `http://` instead of `https://`.

### Cloudflare Pages build fails

- Check the build log. Most common: forgot to set the **Root directory** to `frontend`.
- If `npm install` fails on the `package-lock.json`: switch to `npm ci` in the build command, or delete `node_modules/` locally and commit a fresh `package-lock.json`.

### Backend systemd service won't start

- `sudo systemctl status lumo` shows the error line.
- `journalctl -u lumo -n 80 --no-pager` shows full traceback.
- Common: bad path in `lumo.service` (the unit assumes `/home/ubuntu/lumo-demo/backend/.venv/bin/uvicorn`). If you cloned to a different path, edit the unit file before `daemon-reload`.

### Session disconnects after ~100 seconds

- Only happens if you proxy WebSockets through Cloudflare's free plan **and** the session has zero audio activity. Active voice sessions stream constantly so this shouldn't trigger.
- If it does: flip the Cloudflare DNS record for `api.lumo.shreyas.space` to **DNS only (grey cloud)** so traffic goes direct to the VM, bypassing Cloudflare's WS timeout entirely.

---

## Maintenance

### Pushing updates

```bash
git push origin main
```

Cloudflare auto-builds on push (1 min). Backend updates:

```bash
ssh -i ~/.ssh/lumo-oracle ubuntu@<VM_PUBLIC_IP>
cd lumo-demo
git pull
sudo systemctl restart lumo
```

### Changing the PIN

Cloudflare dashboard → Pages project → Settings → Environment variables → edit `VITE_DEMO_PIN` → **Deployments → Retry deployment**.

### Rotating the OpenAI key

SSH to VM → `nano backend/.env` → update `OPENAI_API_KEY` → `sudo systemctl restart lumo`.

### Watching live logs

```bash
journalctl -u lumo -f             # backend
sudo tail -f /var/log/nginx/access.log   # nginx
```

---

## Costs

| Thing                    | Cost                                        |
| ------------------------ | ------------------------------------------- |
| Oracle Cloud Free Tier   | $0 forever (within Always-Free limits)      |
| Cloudflare Pages         | $0 (free plan, unlimited bandwidth)         |
| Cloudflare DNS           | $0                                          |
| Let's Encrypt cert       | $0 (auto-renews every 90 days)              |
| OpenAI Realtime API      | ~$0.06/min input + $0.24/min output audio   |
| Domain (shreyas.space)   | ~$10/year (already owned)                   |

A 5-minute demo session is roughly $1.50 in OpenAI charges. Set a hard usage cap at platform.openai.com → Settings → Billing → Usage limits.

---

## What's intentionally not done

- **No backend-side rate limit.** Anyone with the PIN can drain your OpenAI budget. If you share the link widely, either add a rate limiter or rotate the PIN often.
- **No persistent storage.** Sessions vanish when the backend restarts (in-memory store). Fine for a demo; would need Postgres for production.
- **`workers=1` in systemd.** Multiple workers would split the session store across processes. Keep it at 1 unless you add Redis or similar.
- **No mobile-app version.** Browser only.

---

## Repo

https://github.com/Shreyas0Kumar/lumo-demo

If you're a Claude helping with deployment from this point, you can run `gh repo view Shreyas0Kumar/lumo-demo` for current state, or `git clone` to inspect the code. The main README has architecture details; this DEPLOY.md is the deployment recipe.
