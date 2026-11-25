# Rookery

A completely free chess platform: live online play, computer opponents, puzzles, lessons, openings, game analysis, tournaments, clubs and friends. No ads, no premium tier, no locked features.

Rookery is a working application with a real backend and a real database. This README says plainly what is built and what is not.

## Run it

Requires Node 22.5+ (it uses the built-in `node:sqlite`). The only dependency is `ws`.

```bash
npm install
npm run start            # http://localhost:3000
```

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address |
| `ROOKERY_DB` | `data/rookery.db` | SQLite file (migrations and seed data run on start) |
| `ROOKERY_TRUST_PROXY` | off | Set to `1` behind a reverse proxy so client IPs, HTTPS and Secure cookies are detected correctly |
| `ROOKERY_MAIL_WEBHOOK` | none | URL that receives password-reset emails as JSON. Without it, reset messages are written to `data/outbox/` |

**Admin:** the first account registered becomes an administrator. For anyone else: `npm run make-admin -- <username>`.

**Tests:** `npm test` (rules, perft, engine, 66 server end-to-end checks). Browser suites need Playwright installed globally: `node test/ui.test.cjs` and `node test/ui-community.test.cjs` (each expects a fresh server; see the headers in the files for ports). `npm run validate-content` re-checks every lesson and puzzle.

## What is in it

- **Play:** full rules (castling, en passant, promotion, draws by repetition / 50 moves / insufficient material), server-authoritative clocks, quick match with a widening rating window, lobby seeks, direct challenges, invite links, spectators, draw offers, rematches, reconnect handling, move list, PGN export.
- **Computer:** six levels, plays in a Web Worker.
- **Puzzles:** daily, rush, survival, streak and themed. Solutions are checked on the server and are not sent to the client until the puzzle is failed.
- **Learn:** 34 lessons with interactive exercises. **Openings:** explorer with ECO codes, trainer, repertoire builder, PGN import/export.
- **Analysis:** per-move classification (best through blunder, brilliant, missed win), accuracy, key moments, eval graph, suggestions, with a depth selector.
- **Accounts:** register / login / logout, password change, password reset by link, one-time recovery code, avatars, bios, profiles, achievements.
- **Ratings:** Glicko-2 per category (bullet, blitz, rapid, classical, puzzle), applied on the server only. Leaderboards: all-time, month, week, day, friends.
- **Social:** friends, direct messages, clubs with chat and roles, block and report.
- **Tournaments:** Arena, Swiss and knockout; public, private (invite code) and club-only.
- **Customisation:** 12 boards, 4 piece sets, backgrounds, accent colours, 3 sound packs, dark / light / system theme. Saved to your account.
- **Admin:** stats, health, user search with suspend / ban / role changes and reset links, report queue, fair-play flags, tournament control, puzzle and lesson management, audit log.
- **Security:** scrypt password hashing, hashed session tokens in HttpOnly SameSite cookies, CSRF header plus Origin check, CSP and security headers, rate limits and login lockout, WebSocket Origin check and per-socket throttling, parameterised SQL, escaped output, validated avatar uploads. Fair-play heuristics (move timing, engine-match rate) flag games for human review; they never act automatically.

## Where it differs from a typical "Chess.com clone" spec

I would rather you read these here than discover them.

- **The engine is not Stockfish.** The shell this was built in had no network access, so Stockfish WASM could not be fetched. Rookery uses its own engine (`shared/engine.js`: alpha-beta with quiescence, transposition table and pruning). It is roughly club strength. The Elo labels on the six levels are estimates, and analysis can miss deep tactics. To use Stockfish, drop its WASM build into `public/` and replace the calls in `public/js/engine-client.js` and `engine-worker.js`.
- **SQLite, not Postgres.** One file, with real migrations (`server/migrations`) and seed data. Fine for a single server; a large deployment would want Postgres.
- **Vanilla JavaScript front end,** no React or Tailwind (no package installs were possible).
- **Computer games are played in the browser** and saved as *unrated* after the server replays them through the rules engine.
- **Lesson exercises are checked in the browser,** so they are practice, not tracked competition.
- **The puzzle pool is finite** (223 generated and verified puzzles). Admins can add more; each is verified before saving.
- **No email server.** Reset links go to `data/outbox/` or your webhook. Recovery codes (shown once at sign-up) work without email.
- **Not load-tested.** Tested with a handful of simultaneous browser sessions, not thousands.

## Deploying and a domain

Nothing is deployed and no domain exists. Run it on any machine with Node 22.5+, put it behind a reverse proxy that terminates HTTPS and forwards WebSockets (`/ws`), and set `ROOKERY_TRUST_PROXY=1`. Back up the SQLite file.

## Layout

`shared/` rules, engine, Glicko-2, PGN, openings (used by server and browser) · `server/` HTTP, WebSocket, game manager, tournaments, API · `public/` single-page app · `data/` lessons and puzzles · `scripts/` · `test/`
