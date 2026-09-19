# ◈ Cryptic — Script Hub

An elegant, fast pastebin site for **Lua script uploads** and **1-click Roblox loadstrings**, with Google login, per-script execution stats, and a modern UI.

Runs **100% free on Cloudflare Pages**. Since Cloudflare is connected directly to your GitHub repository, every push automatically redeploys the site.

---

## 🔐 Login: Google instead of a password

There's **no fixed password anymore**. Login happens through "Sign in with Google" (Google Identity Services). The server then checks whether the signed-in Google email is listed in `ADMIN_MAIL` — only those addresses get into the dashboard.

### Required environment variables in Cloudflare

Cloudflare Pages → **Settings** → **Environment variables** → **Add variable**:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `GOOGLE_CLIENT_ID` | OAuth client ID from Google Cloud Console | `123456789-abc.apps.googleusercontent.com` |
| `ADMIN_MAIL` | Allowed Google emails, comma-separated | `you@gmail.com,partner@gmail.com` |
| `SESSION_SECRET` | Random secret string used to sign sessions | a long random string (e.g. from a password generator) |

`GOOGLE_CLIENT_ID` is **not secret** (Google client IDs are public by design), so a regular variable is fine. `SESSION_SECRET`, on the other hand, should be added as a **Secret** (not a plaintext variable, if Cloudflare distinguishes the two).

No new required environment variables were added by the security rework below — rate limits and log retention use sane hardcoded defaults (see `functions/api/_lib/ratelimit.js` and `_lib/log.js`) so deployment stays a 3-variable setup.

### Getting a Google Client ID

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → create a project (if you don't have one yet).
2. Set up the **OAuth consent screen** (External is fine, doesn't need to be published — test users/owner access is enough for private use).
3. **Create credentials** → **OAuth client ID** → type **Web application**.
4. Under **Authorized JavaScript origins**, add your domain, e.g. `https://your-domain.pages.dev`.
5. Put the generated client ID into `GOOGLE_CLIENT_ID` in Cloudflare.

Then trigger a **redeploy** in Cloudflare so the variables take effect.

---

## 🧩 How scripts are stored and served

Every script lives exclusively in Cloudflare KV, under three keys:

- `script:<scriptId>` — metadata (filename, `publicId`, `enabled`, timestamps)
- `scriptcode:<scriptId>` — the actual Lua source
- `publicid:<publicId>` — a lookup from the public loader id to the internal `scriptId`

`scriptId` is an internal, never-exposed identifier. `publicId` is the only thing that ever appears in a loadstring — it's a random 32-hex-character id (`crypto.randomUUID()`), unrelated to the filename or the code, and can be **rotated** from the dashboard at any time, which instantly invalidates every loadstring built from the old id without touching the script itself.

Nothing is served from `public/scripts/` anymore — don't put `.lua` files there. Cloudflare Pages serves anything under `public/` as a static asset with no auth, rate limiting or enable/disable check, which would bypass everything below.

---

## 📊 Execution counter

Every successful call to `/api/loader/<id>` (i.e. every `loadstring` call from Roblox) is counted and stored in Cloudflare KV — per script and as a total. In the dashboard you'll see:

- Total executions across all scripts
- Executions per script (badge on every script card)
- The most-used script

---

## 📁 Managing scripts

Everything goes through the authenticated dashboard now:

- **Upload / Save** creates or updates a script (`POST` / `PUT /api/scripts`).
- **Edit** loads the current code into the editor via an authenticated fetch — the editor never reads code through the public loader endpoint.
- **Enable / Disable** flips whether the loader will serve the script at all; a disabled script returns the same generic 404 as a script that doesn't exist.
- **Rotate link** issues a new `publicId` and drops the old mapping, so a leaked or over-shared loadstring can be cut off in one click without losing the script or its stats.
- **Delete** removes the metadata, code, public-id mapping and counter.

---

## 🎮 Usage in a Roblox script (loadstring)

```lua
loadstring(game:HttpGet("https://your-domain.pages.dev/api/loader/<public-id>"))()
```

Copy the ready-made loadstring straight from a script card in the dashboard — it already has the current `publicId` baked in. `/api/loader/<id>` deliberately stays reachable without login (`text/plain`, CORS open) — otherwise Roblox couldn't load the loadstring at all — but it never accepts or needs anything beyond that opaque id. Every dashboard endpoint (`/api/scripts*`, `/api/scripts/:id/toggle`, `/api/scripts/:id/rotate`) requires a valid Google session.

The old `/api/raw?file=...` endpoint (filename-based, no rate limiting, no enable/disable) is **retired** and now answers `410 Gone`. Any loadstring generated before this update needs to be regenerated from the dashboard.

---

## 🚦 Abuse protection

`/api/loader/:id`, `/api/login` and script creation are rate-limited per IP (and per script id for the loader) using fixed-size counters in Cloudflare KV. This is **best-effort**: KV is eventually consistent and counter increments aren't atomic, so a genuinely concurrent burst can let a handful of extra requests through a shared window. For this project's scale (a small admin group, no paid Redis/Durable Objects backend) that's an acceptable tradeoff — it deters casual abuse and scraping, it does not guarantee a hard ceiling.

Security-relevant events (logins, denials, script create/update/delete/toggle/rotate, rate-limit hits, invalid loader requests) are written to KV under a `log:` prefix with a 30-day TTL, for after-the-fact inspection via `wrangler kv key list` — no full tokens or secrets are ever logged.

A request to `/api/loader/:id` that looks like a normal browser page-load (`Sec-Fetch-Mode: navigate` + `Accept: text/html`) gets a neutral "not intended for direct viewing" message instead of the script body. This is a UX nicety, **not** a security control — it's a heuristic on client-supplied headers, which can be spoofed, so the actual access decision (exists / enabled / rate limit) never depends on it.

---

## 🔒 How secure is this really? (an honest answer)

**Access to the dashboard:** solid. No more fixed password, Google handles authentication, the server checks the email against `ADMIN_MAIL` on *every* request (not just at login) — revoking access is as simple as removing the email from `ADMIN_MAIL`.

**"Being able to run code without anyone ever seeing it":** that doesn't really exist in the form it's often sold as. A Lua script loaded by an executor via `loadstring(game:HttpGet(...))()` necessarily has to arrive on the client as plain text (or at least as bytecode the executor can read) in order to run there. Anyone running it through an executor can, in principle, capture whatever it loads and runs. No web technique changes that once a request has been authorized — that's true no matter how the server-side access control is built.

What this update actually changes:
- The code is no longer reachable through a guessable/known filename — you need the current, rotatable `publicId`, which the server, not the URL, decides to hand out.
- A leaked link can be killed in one click (rotate) without redeploying or losing the script.
- Casual scraping/abuse is rate-limited and logged instead of being unlimited and invisible.
- What was previously sold as "protection" — the anti-debug snippet that called `game:Shutdown()` and looped forever on any client showing common executor globals — has been **removed**. It was a destructive trick against whoever happened to be running the script (including legitimate users on weaker or misconfigured executors), not a security control, and is exactly the kind of anti-analysis behavior this rework deliberately avoids.

Anyone claiming "runs fine, but the source is guaranteed to never be visible" is selling you something that doesn't technically exist — it's always an arms race (more effort required from the attacker), not a lock without a key. If you still want to raise the human-readability bar, an external obfuscator (Luraph, Moonsec, …) applied to the code before upload is the honest way to do it — it doesn't belong in this app's own security layer.

---

## ✅ What this update fixed/improved

- **Removed the "Insert protection snippet" feature** entirely — button, JS, generated snippet, and the docs praising it. It shipped a client-crashing/infinite-loop payload as a "security feature"; that's gone from the UI, the generator, and the copy.
- **Retired filename-based delivery** (`/api/raw?file=...`, and the `public/scripts/` static fallback) in favor of opaque, rotatable, server-authorized `publicId`s via `/api/loader/:id`.
- **Script CRUD moved to a proper resource API** (`/api/scripts`, `/api/scripts/:id`, `/.../toggle`, `/.../rotate`), all admin-only, all input-validated (filename pattern, max content size, `Content-Type` check).
- **Rate limiting** added on the loader (per IP and per script), on login, and on script creation.
- **Enable/disable per script**, enforced server-side by the loader, not just hidden in the UI.
- **Generic error responses** everywhere — no more `err.message`, stack traces or internal details reaching the client; real errors go to `console.error` (Cloudflare's function logs) only.
- **Security headers** via `public/_headers`: CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS, and `no-store` caching on every `/api/*` response.
- **Audit logging** for logins (success/denied/rate-limited), script create/update/delete/toggle/rotate, and loader abuse, capped at 30 days retention in KV.
- Per-script and total execution counter (unchanged behavior, now keyed by internal id instead of filename).

### Known limits (unchanged by this update, stated plainly)

- Cloudflare KV rate limiting is best-effort/eventually-consistent, not a hard atomic limiter — see "Abuse protection" above.
- The browser-vs-executor distinction on the loader is cosmetic (header-based), not a security boundary.
- Once a `loadstring` is authorized, the receiving executor can read what it just executed. No server-side change can prevent that.
