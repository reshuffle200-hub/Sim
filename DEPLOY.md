# Multiplayer deploy — Westinghouse PWR control room

This turns the single-player simulator into a shared control room: one
authoritative plant runs on a server, everyone connects to it live, and
you hand out **operator** access to whoever should be allowed to actuate
the board. Everyone else is a view-only **observer** on the same plant.

## How it fits together

```
Browser (boards)  ──login──►  Azure Static Web Apps  ──/api/ticket──►  signed ticket
        │                         (hosts the UI + login + operator role)
        └──── WebSocket (wss, ticket in query) ────►  Azure App Service
                                                       (Node: runs the ONE plant +
                                                        stepPlant loop, broadcasts
                                                        state ~7×/s, applies operator
                                                        commands)
```

- The browser no longer simulates. It restores the plant from each state
  frame and sends operator inputs up as commands.
- Static Web Apps can't proxy WebSockets, so the socket goes straight to
  App Service. Auth is carried by a short-lived HMAC **ticket** minted by
  `/api/ticket` from your logged-in identity + role. The server verifies
  it, so a client can't forge or elevate its role.

## What's new in this tree

| Path | Purpose |
|------|---------|
| `server/sim-server.mjs` | Authoritative Node server: plant + step loop + WebSocket |
| `lib/actions.mjs` | Every operator command, applied server-side |
| `ui/net.mjs` | Client: ticket → WebSocket → restore state → send commands |
| `api/ticket/` | Static Web Apps function that mints the signed ticket |
| `staticwebapp.config.json` | Requires login; routes; login redirect |
| `.github/workflows/azure-static-web-apps.yml` | Frontend + api deploy |
| `package.json` (root) | Declares `ws`, starts the server, marks the tree ESM |
| `index.html` | Patched: routes inputs to the server, stops local stepping when connected |

---

## 0. Push to GitHub

Create a repo and push this whole folder to `main`.

## 1. Sim server → Azure App Service (Linux, Node 20)

```bash
az group create -n pwr-sim -l eastus
az appservice plan create -g pwr-sim -n pwr-plan --is-linux --sku B1
az webapp create -g pwr-sim -p pwr-plan -n <SIM_APP> --runtime "NODE:20-lts"

# a shared secret used to sign/verify tickets — SAVE THIS, you need it again in step 2
SECRET=$(openssl rand -hex 32); echo "$SECRET"

az webapp config appsettings set -g pwr-sim -n <SIM_APP> --settings \
  TICKET_SECRET="$SECRET" START_LOAD=1.0 SCM_DO_BUILD_DURING_DEPLOYMENT=true
az webapp config set -g pwr-sim -n <SIM_APP> \
  --always-on true --web-sockets-enabled true --startup-file "npm start"

# deploy the repo (App Service installs ws and runs `npm start` = the server)
zip -r ../app.zip . -x '.git/*'
az webapp deploy -g pwr-sim -n <SIM_APP> --src-path ../app.zip --type zip
```

Your socket URL is **`wss://<SIM_APP>.azurewebsites.net/ws`** — note it for step 2.

## 2. Frontend + login → Azure Static Web Apps

Portal → **Create Static Web App** → link your GitHub repo + `main` branch →
Build details = **Custom**: App location `/`, Api location `api`, Output
location empty. It commits a workflow and deploys. (You can also use the
workflow already in this repo — add the deployment token as the
`AZURE_STATIC_WEB_APPS_API_TOKEN` secret.)

Then set the ticket function's environment (SWA → **Environment variables**):

- `TICKET_SECRET` = the same secret from step 1
- `SIM_WS_URL` = `wss://<SIM_APP>.azurewebsites.net/ws`

And lock the socket to your site's origin:

```bash
az webapp config appsettings set -g pwr-sim -n <SIM_APP> --settings \
  ALLOWED_ORIGIN="https://<YOUR_SWA>.azurestaticapps.net"
```

## 3. Login provider + operator access

- Login defaults to **GitHub** (see the redirect in `staticwebapp.config.json`
  and the login URL in `ui/net.mjs`). Switch to Microsoft/Google by changing
  both `/.auth/login/github` → `/.auth/login/aad` (or `google`), or wire
  **Entra External ID** for branded email/password.
- Make someone an operator: SWA → **Role management** → **Invite** → pick the
  provider, enter their username/email, role = `operator`, send the link.
  Anyone who logs in **without** that role is automatically an observer
  (view-only). That's the whole access model.

## 4. Try it

Open the SWA URL, log in. If you invited yourself as operator you'll see an
**OPERATOR** badge and can drive the board. Log in from another browser as a
non-invited user → **OBSERVER** badge, controls dimmed, same live plant.

---

## Local single-player (no server)

```bash
python3 -m http.server 8000   # → http://localhost:8000
```

`/api/ticket` isn't reachable locally, so `net.mjs` shows **OFFLINE** and the
browser runs its own simulation exactly as before. Nothing to configure.

## Knobs & notes

- **Broadcast rate / size**: `server/sim-server.mjs` → `BROADCAST_MS` (150 ≈ 7
  frames/s); each state frame is ~25 KB. Fine for a control room; for large
  audiences, send deltas instead of full snapshots (a good next step).
- **Start condition**: `START_LOAD` env (1.0 = 100% power). Operators can
  restore to any snapshot live from the Initial-conditions panel.
- **Pause** is operator-global. **Annunciator ack/silence/reset** stay
  per-viewer by design — each operator manages their own alarm acknowledgement.
- **Caching**: `staticwebapp.config.json` sets `Cache-Control: no-store`, which
  removes the stale-module problem `tools/stamp.mjs` was built to solve, so you
  don't need to stamp for SWA. (Switch to stamping + normal caching later if you
  want edge caching.)

## v1 limitations (deliberate, easy follow-ups)

- One shared plant, no rooms (as chosen). Rooms = a `sessionId → plant` map on
  the server plus a room id in the ticket.
- Full-state broadcast, no deltas yet.
- No client-side prediction: an input shows up on the next server frame
  (~150 ms). Imperceptible for a plant; add prediction later if you want.

## Security recap

Only the `operator` role can move the plant, enforced **on the server**, not
just the UI. Tickets are HMAC-signed, expire in 2 minutes, and only get a
client connected once; the role is inside the signed payload and can't be
tampered with. The server rejects any socket without a valid ticket (and, if
`ALLOWED_ORIGIN` is set, from the wrong origin).
