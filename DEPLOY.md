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
| `ROOKERY_BACKUP_REPO`, `ROOKERY_BACKUP_TOKEN`, `ROOKERY_BACKUP_KEY` | Free automatic backup to a private GitHub repo (see below) |
| `ROOKERY_MAIL_WEBHOOK` | Optional URL that receives password-reset emails |

## Keeping accounts for free (automatic backup to GitHub)
Render's free disk is wiped on every deploy and restart, so Rookery can copy its database to a **private GitHub repository** and restore it on start-up. A copy is saved about a minute after any change and again when the server is told to stop. The last 3 copies are kept as a "release" file, so the repository does not grow.

One-time setup:
1. On GitHub create a **new private repository** (for example `rookery-data`) and tick **Add a README** (it needs one file).
2. GitHub > Settings > Developer settings > Personal access tokens > **Fine-grained tokens** > Generate new token. Under *Repository access* choose **Only select repositories** and pick `rookery-data`. Under *Permissions > Repository permissions* set **Contents** to **Read and write**. Generate it and copy the token.
3. In Render > your service > Environment, add:
   - `ROOKERY_BACKUP_REPO` = `your-github-name/rookery-data`
   - `ROOKERY_BACKUP_TOKEN` = the token
   - `ROOKERY_BACKUP_KEY` = a long random phrase (encrypts the saved copies; keep it somewhere safe, because without it a backup cannot be read)
4. Save. Render redeploys. Open `https://<your-service>.onrender.com/api/healthz`: it should show `"backup":{"enabled":true,...}` and a `lastBackupAt` time after you register an account.

If a backup exists but cannot be read (wrong key, expired token, GitHub down), the server refuses to start instead of starting empty, so it can never overwrite good data. Fix the setting and redeploy.
Limits: up to about a minute of the newest changes can be lost if the server crashes without warning. Free services still sleep when idle (first visit afterwards takes about a minute), but data is restored each time. Games in progress at the moment of a restart are lost.

## Other ways to keep data
Use a paid plan, add a disk mounted at `/var/data` (see the commented lines in `render.yaml`) and set `ROOKERY_DB=/var/data/rookery.db`. Backups to GitHub still work alongside it.

## Health check
`GET /api/healthz` returns `{"ok":true}`.
