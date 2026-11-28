# Deploying Rookery on Render

Rookery's server edition (accounts, real admin dashboard, live games) needs a Node host. GitHub Pages cannot run it; Render can.

## Steps
1. Put this project in a GitHub repository (the server files, not just `index.html`).
2. In Render: **New > Blueprint**, pick the repository. It reads `render.yaml`.
3. When asked for `ROOKERY_ADMIN_USERNAME`, type the username you will register with (for example `lewis`).
4. Deploy. Open `https://<your-service>.onrender.com`.
5. **Register that exact username straight away.** Only that name becomes admin. If the variable is left empty, the first account to register becomes admin, so do not leave it empty on a public URL.
6. Open `https://<your-service>.onrender.com/#/admin` for the real dashboard.

Optional: in the static site's hidden `#/admin` page, use the **Server (Render)** card to save your address and open the dashboard in one click.

## Settings (environment variables)
| Name | Purpose |
|---|---|
| `NODE_VERSION` | `22` (the server needs Node 22.5 or newer) |
| `ROOKERY_TRUST_PROXY` | `1` on Render, so rate limits see real visitor IPs |
| `ROOKERY_ADMIN_USERNAME` | The only username that can become admin |
| `ROOKERY_DB` | Database path. Use `/var/data/rookery.db` with a persistent disk |
| `ROOKERY_MAIL_WEBHOOK` | Optional URL that receives password-reset emails |

## Data warning
The free plan has an **ephemeral disk**: the SQLite database is erased on every deploy and whenever the service restarts, and free services sleep after inactivity (first load then takes about a minute). Accounts and games will vanish. To keep data, use a paid plan, add a disk mounted at `/var/data` (see the commented lines in `render.yaml`) and set `ROOKERY_DB=/var/data/rookery.db`.

## Health check
`GET /api/healthz` returns `{"ok":true}`.
