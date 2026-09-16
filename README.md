# Grid Call

A private Formula 1 prediction game for a small group.

One driver is drawn per race. Everyone calls where they think he'll finish.
Calls lock when the lights go out, points are awarded on how close you were,
and results arrive on their own from the [Jolpica F1 API](https://github.com/jolpica/jolpica-f1).

Runs as a single Cloudflare Worker: static app, API and cron in one deploy,
with D1 (SQLite) for storage. Free tier is comfortably enough for a group of friends.

## Setup

```bash
npm install
npx wrangler login
```

Create the database and paste the id it prints into `wrangler.toml`
(`database_id`, which is currently a placeholder):

```bash
npx wrangler d1 create grid-call
npm run db:init
```

Set the three secrets. These never go in the repo:

```bash
npx wrangler secret put JOIN_CODE        # what friends type to join
npx wrangler secret put SESSION_SECRET   # e.g. openssl rand -base64 32
npx wrangler secret put ADMIN_CODE       # promotes a player to organiser
```

Deploy:

```bash
npm run deploy
```

Open the URL, create the first account — **whoever signs up first becomes the
organiser** — then go to Settings and press *Sync now*. That pulls the calendar,
the driver list and any races already run. Pick which round the game starts at,
and share the URL plus the join code.

## Deploying on push

Two ways, pick one.

**Cloudflare Workers Builds.** In the dashboard, go to Workers & Pages → your
worker → Settings → Build, and connect the GitHub repo. Every push to `main`
builds and deploys. Nothing else to configure.

**GitHub Actions.** `.github/workflows/deploy.yml` is included. Add a repository
secret called `CLOUDFLARE_API_TOKEN` (create one with the *Edit Cloudflare
Workers* template) and pushes to `main` will deploy.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in the three values
npx wrangler dev                 # API + worker on :8787
npm run dev                      # app on :5173, proxies /api to :8787
```

## How the game works

- **The draw.** Drivers are shuffled with a stored seed. Every driver comes up
  once before any of them repeats; when the pool runs out it reshuffles with a
  derived seed, so a 24-race season over 22 drivers works cleanly. Redrawing
  from Settings changes every round, so do it before you start.
- **Scoring.** Spot on 25, one out 18, two out 12, three out 8, four or five 4,
  six or more 0. Plus 5 if you called a podium and got one, plus 3 for a points
  finish. All eight numbers are editable and the whole season re-scores the
  moment you save.
- **Results.** A cron trigger runs every four hours, refreshes the calendar and
  pulls the finishing order for any race that's been run. There's a manual
  override in Settings if a result is wrong or late.

Jolpica is run by volunteers and rate-limited. Four-hourly polling is well
inside their limits. They ask callers to identify themselves with a custom
User-Agent, which is set in `wrangler.toml` — put your own repo URL in it.

## Privacy

Worth being precise, since this is the reason the game moved off a shared link.

**What's stored.** Names, an optional 160px profile photo, a colour, a password
hash, and every call. That's all. No email, no analytics, no third-party
scripts. The only outbound request the server makes is to Jolpica for race data.

**Where it lives.** Your Cloudflare account, in a D1 database only your Worker
can reach. You can pin it to the EU with a location hint when you create it:
`npx wrangler d1 create grid-call --location weur`.

**Who can see what.** Nothing is readable without signing in. Other players'
calls are withheld by the server until the race has started, so the hiding is
real rather than cosmetic. Calls submitted after lights out are rejected server
side. Passwords are PBKDF2-SHA256 with a per-user salt; sessions are HMAC-signed
cookies marked HttpOnly, Secure and SameSite=Lax.

**The public repo is fine.** Nothing here is a secret. The join code, session
secret and organiser code live in Cloudflare's secret store, and `.dev.vars` is
gitignored. If someone finds the URL without the join code, they can't get in.

One knob worth knowing about: `PBKDF2_ITERATIONS` at the top of `src/worker.js`
is set to 100,000. If logins ever fail with a CPU limit error on the free plan,
lower it; on a paid plan you can raise it.

## Layout

```
src/worker.js   API, auth, Jolpica sync, cron. All the rules live here.
src/App.jsx     The whole front end, one file.
schema.sql      D1 tables. Run once.
wrangler.toml   Bindings, cron schedule, non-secret vars.
```
