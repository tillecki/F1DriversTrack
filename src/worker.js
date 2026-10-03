/**
 * Grid Call — Cloudflare Worker.
 *
 * Serves the built SPA from ASSETS and handles /api/*.
 * Two rules are enforced here rather than in the browser, because the browser
 * is not trustworthy: nobody can see anyone else's call before lights out,
 * and nobody can submit a call after lights out.
 */

const SESSION_DAYS = 90;

/* PBKDF2 rounds. Higher is better but costs CPU time per login, and the
   Workers free plan is tight on CPU. Drop this to 50_000 if logins start
   failing with a CPU limit error, or move to a paid plan and raise it. */
const PBKDF2_ITERATIONS = 100_000;

/* ---------- tiny helpers ---------- */

const enc = new TextEncoder();

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function bad(message, status = 400) {
  return json({ error: message }, status);
}

function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function unb64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

function uid() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function nameKey(name) {
  return String(name).trim().toLowerCase().normalize("NFKD").replace(/\s+/g, " ");
}

/** Constant-time string compare, so signature checks don't leak by timing. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- passwords ---------- */

async function hashPassword(password, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return { hash: b64(bits), salt: b64(salt) };
}

async function checkPassword(password, hash, salt) {
  const got = await hashPassword(password, salt);
  return safeEqual(got.hash, hash);
}

/* ---------- sessions ---------- */

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(env, payload) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env.SESSION_SECRET), enc.encode(payload));
  return b64(sig).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" }[c]));
}

async function signSession(env, playerId) {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const payload = playerId + "." + exp;
  return payload + "." + (await sign(env, payload));
}

async function readSession(env, request) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)gc_session=([^;]+)/);
  if (!m) return null;
  const parts = decodeURIComponent(m[1]).split(".");
  if (parts.length !== 3) return null;
  const [playerId, exp, sig] = parts;
  if (!Number(exp) || Number(exp) < Date.now()) return null;
  if (!safeEqual(sig, await sign(env, playerId + "." + exp))) return null;
  return playerId;
}

function sessionCookie(token) {
  return `gc_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}

const CLEAR_COOKIE = "gc_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";

/* ---------- settings ---------- */

const DEFAULT_SCORING = {
  exact: 25, off1: 18, off2: 12, off3: 8, off45: 4, off6: 0, podium: 5, points: 3,
  favScale: 50,      // your favourite driver scores this percentage of the main curve
  poleExact: 15,     // named the pole-sitter
  poleFrontRow: 5,   // your pick qualified second
  sprintScale: 40,   // sprint call scores this percentage of the main curve
};

const DEFAULT_MODES = { favourite: false, pole: false, sprint: false };

async function getSettings(env) {
  const rows = await env.DB.prepare("SELECT k, v FROM settings").all();
  const out = {};
  for (const r of rows.results || []) {
    try { out[r.k] = JSON.parse(r.v); } catch { out[r.k] = r.v; }
  }
  return {
    scoring: { ...DEFAULT_SCORING, ...(out.scoring || {}) },
    modes: { ...DEFAULT_MODES, ...(out.modes || {}) },
    syncState: out.syncState || {},
    seed: Number(out.seed) || 0,
    startRound: Number(out.startRound) || 0,
  };
}

async function putSetting(env, k, v) {
  await env.DB.prepare("INSERT INTO settings (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2")
    .bind(k, JSON.stringify(v)).run();
}

/* ---------- Jolpica (the Ergast successor) ---------- */

/* Jolpica asks every caller to identify itself with a custom User-Agent.
   Browsers refuse to set that header, which is why these calls live here.
   Routes are lower-case and case-sensitive, and the default page size is 30,
   so every call passes an explicit limit. */
async function jolpica(env, path) {
  const res = await fetch("https://api.jolpi.ca/ergast/f1/" + path, {
    headers: { "User-Agent": env.USER_AGENT || "GridCall/1.0", Accept: "application/json" },
  });
  if (!res.ok) throw new Error("Jolpica returned " + res.status + " for " + path);
  return res.json();
}

const TEAM_ALIASES = {
  red_bull: "redbull", aston_martin: "aston", racing_bulls: "rb", rb: "rb",
  alphatauri: "rb", sauber: "audi", kick_sauber: "audi", audi: "audi",
  alfa: "audi", cadillac: "cadillac", haas: "haas", alpine: "alpine",
  williams: "williams", mercedes: "mercedes", ferrari: "ferrari", mclaren: "mclaren",
};

const teamSlug = (id) => TEAM_ALIASES[String(id || "").toLowerCase()] || String(id || "").toLowerCase();

async function syncSchedule(env, season) {
  const data = await jolpica(env, season + "/races/?limit=100");
  const races = data?.MRData?.RaceTable?.Races || [];
  if (!races.length) return 0;
  await env.DB.batch(races.map((r) =>
    env.DB.prepare(
      `INSERT INTO rounds (season, round, name, circuit, cc, start, quali_at, sprint_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(season, round) DO UPDATE SET name=?3, circuit=?4, cc=?5, start=?6,
         quali_at=?7, sprint_at=?8`
    ).bind(
      Number(season), Number(r.round),
      r.raceName || "Round " + r.round,
      r.Circuit?.circuitName || "",
      countryToCC(r.Circuit?.Location?.country),
      (r.date || "") + "T" + (r.time || "13:00:00Z"),
      r.Qualifying?.date ? r.Qualifying.date + "T" + (r.Qualifying.time || "14:00:00Z") : null,
      r.Sprint?.date ? r.Sprint.date + "T" + (r.Sprint.time || "14:00:00Z") : null
    )
  ));
  return races.length;
}

/* Who is actually racing. Taken from race entry lists rather than the driver
   list, because the driver list includes reserves and drivers who have left —
   which is what previously let the draw pick someone who never started. */
async function syncDrivers(env, season) {
  const rounds = await env.DB.prepare(
    "SELECT round FROM rounds WHERE season = ?1 AND start <= ?2 ORDER BY round DESC LIMIT 4"
  ).bind(Number(season), new Date().toISOString()).all();

  const seen = new Map();
  for (const { round } of rounds.results || []) {
    try {
      const d = await jolpica(env, season + "/" + round + "/results/?limit=100");
      for (const r of d?.MRData?.RaceTable?.Races?.[0]?.Results || []) {
        const prev = seen.get(r.Driver.driverId);
        seen.set(r.Driver.driverId, {
          d: r.Driver,
          team: teamSlug(r.Constructor?.constructorId),
          no: Number(r.number) || Number(r.Driver.permanentNumber) || null,
          starts: (prev?.starts || 0) + 1,
        });
      }
    } catch { /* one bad round shouldn't sink the sync */ }
  }

  /* Nothing has been run yet: fall back to the standings, then the roster. */
  if (!seen.size) {
    for (const path of [season + "/driverstandings/?limit=100", season + "/drivers/?limit=100"]) {
      try {
        const d = await jolpica(env, path);
        const standing = d?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings;
        if (standing?.length) {
          for (const st of standing) {
            seen.set(st.Driver.driverId, {
              d: st.Driver, team: teamSlug(st.Constructors?.[0]?.constructorId),
              no: Number(st.Driver.permanentNumber) || null, starts: 0,
            });
          }
          break;
        }
        const roster = d?.MRData?.DriverTable?.Drivers;
        if (roster?.length) {
          for (const dr of roster) {
            seen.set(dr.driverId, { d: dr, team: null, no: Number(dr.permanentNumber) || null, starts: 0 });
          }
          break;
        }
      } catch { /* try the next one */ }
    }
  }
  if (!seen.size) return 0;

  /* A driver counts as active if they started the most recent race we looked
     at, or at least half of them. One-off stand-ins stay out of the pool. */
  const maxStarts = Math.max(...[...seen.values()].map((v) => v.starts), 0);
  await env.DB.batch([...seen.entries()].map(([id, v]) =>
    env.DB.prepare(
      `INSERT INTO drivers (id, season, first, last, code, no, team, starts, active, wiki)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(id) DO UPDATE SET season=?2, first=?3, last=?4, code=?5,
         no=COALESCE(?6, no), team=COALESCE(?7, team), starts=?8, wiki=COALESCE(?10, wiki)`
    ).bind(
      id, Number(season), v.d.givenName || "", v.d.familyName || "", v.d.code || null,
      v.no, v.team, v.starts,
      maxStarts === 0 || v.starts * 2 >= maxStarts ? 1 : 0,
      v.d.url || null
    )
  ));
  return seen.size;
}

/* Driver portraits. Ergast hands us each driver's Wikipedia page, so the photo
   comes from Wikimedia, where it is freely licensed. We store the URL, not the
   image, and keep the page link so the credit can be shown. */
async function syncPhotos(env, season) {
  const rows = await env.DB.prepare(
    "SELECT id, wiki, first, last FROM drivers WHERE season = ?1 AND photo IS NULL AND active = 1"
  ).bind(Number(season)).all();
  let got = 0;
  for (const d of rows.results || []) {
    const title = d.wiki
      ? decodeURIComponent(String(d.wiki).split("/wiki/")[1] || "")
      : (d.first + "_" + d.last).replace(/\s+/g, "_");
    if (!title) continue;
    try {
      const res = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title), {
        headers: { "User-Agent": env.USER_AGENT || "GridCall/1.0", Accept: "application/json" },
      });
      if (!res.ok) continue;
      const j = await res.json();
      const url = j?.thumbnail?.source || j?.originalimage?.source;
      if (!url) continue;
      await env.DB.prepare("UPDATE drivers SET photo = ?1, wiki = COALESCE(?2, wiki) WHERE id = ?3")
        .bind(url, j?.content_urls?.desktop?.page || null, d.id).run();
      got++;
    } catch { /* a missing portrait is not worth failing the sync for */ }
  }
  return got;
}

async function syncResult(env, season, round) {
  const data = await jolpica(env, season + "/" + round + "/results/?limit=100");
  const results = data?.MRData?.RaceTable?.Races?.[0]?.Results || [];
  if (!results.length) return 0;
  await env.DB.prepare("DELETE FROM results WHERE season = ?1 AND round = ?2").bind(Number(season), Number(round)).run();
  await env.DB.batch(results.map((r) =>
    env.DB.prepare("INSERT INTO results (season, round, pos, driver_id) VALUES (?1, ?2, ?3, ?4)")
      .bind(Number(season), Number(round), Number(r.position), r.Driver.driverId)
  ));
  return results.length;
}

async function syncSprint(env, season, round) {
  const data = await jolpica(env, season + "/" + round + "/sprint/?limit=100");
  const sp = data?.MRData?.RaceTable?.Races?.[0]?.SprintResults || [];
  if (!sp.length) return 0;
  await env.DB.prepare("DELETE FROM sprint WHERE season = ?1 AND round = ?2").bind(Number(season), Number(round)).run();
  await env.DB.batch(sp.map((r) =>
    env.DB.prepare("INSERT INTO sprint (season, round, pos, driver_id) VALUES (?1, ?2, ?3, ?4)")
      .bind(Number(season), Number(round), Number(r.position), r.Driver.driverId)
  ));
  return sp.length;
}

async function syncQuali(env, season, round) {
  const data = await jolpica(env, season + "/" + round + "/qualifying/?limit=100");
  const q = data?.MRData?.RaceTable?.Races?.[0]?.QualifyingResults || [];
  if (!q.length) return 0;
  await env.DB.prepare("DELETE FROM quali WHERE season = ?1 AND round = ?2").bind(Number(season), Number(round)).run();
  await env.DB.batch(q.map((r) =>
    env.DB.prepare("INSERT INTO quali (season, round, pos, driver_id) VALUES (?1, ?2, ?3, ?4)")
      .bind(Number(season), Number(round), Number(r.position), r.Driver.driverId)
  ));
  return q.length;
}

/** Pull anything missing. Runs in the background; progress lands in settings. */
async function syncAll(env, season) {
  const note = async (o) => putSetting(env, "syncState", { at: Date.now(), ...o });
  try {
    await note({ busy: true, step: "calendar" });
    const schedule = await syncSchedule(env, season);

    await note({ busy: true, step: "drivers" });
    const drivers = await syncDrivers(env, season);

    await note({ busy: true, step: "results" });
    const due = await env.DB.prepare(
      `SELECT round FROM rounds WHERE season = ?1 AND start <= ?2
         AND round NOT IN (SELECT round FROM results WHERE season = ?1)
       ORDER BY round`
    ).bind(Number(season), new Date().toISOString()).all();
    let races = 0;
    for (const row of due.results || []) {
      try { if (await syncResult(env, season, row.round)) races++; } catch { /* skip */ }
    }

    await note({ busy: true, step: "qualifying" });
    const qdue = await env.DB.prepare(
      `SELECT round FROM rounds WHERE season = ?1 AND start <= ?2
         AND round NOT IN (SELECT round FROM quali WHERE season = ?1)
       ORDER BY round`
    ).bind(Number(season), new Date().toISOString()).all();
    let qualis = 0;
    for (const row of qdue.results || []) {
      try { if (await syncQuali(env, season, row.round)) qualis++; } catch { /* skip */ }
    }

    /* Sprints only exist on some weekends, so a 404 here is normal. */
    await note({ busy: true, step: "sprints" });
    const sdue = await env.DB.prepare(
      `SELECT round FROM rounds WHERE season = ?1 AND sprint_at IS NOT NULL AND sprint_at <= ?2
         AND round NOT IN (SELECT round FROM sprint WHERE season = ?1)
       ORDER BY round`
    ).bind(Number(season), new Date().toISOString()).all();
    let sprints = 0;
    for (const row of sdue.results || []) {
      try { if (await syncSprint(env, season, row.round)) sprints++; } catch { /* skip */ }
    }

    await note({ busy: true, step: "portraits" });
    const photos = await syncPhotos(env, season);

    /* Starts are what decide the pool, so recount once everything is in. */
    await env.DB.prepare(
      `UPDATE drivers SET starts = (
         SELECT COUNT(*) FROM results r WHERE r.driver_id = drivers.id AND r.season = drivers.season
       ) WHERE season = ?1`
    ).bind(Number(season)).run();

    await note({ busy: false, ok: true, schedule, drivers, races, qualis, sprints, photos });
  } catch (e) {
    await note({ busy: false, ok: false, error: String(e.message || e) });
  }
}

const CC_BY_COUNTRY = {
  australia: "AU", china: "CN", japan: "JP", bahrain: "BH", "saudi arabia": "SA",
  usa: "US", "united states": "US", canada: "CA", monaco: "MC", spain: "ES",
  austria: "AT", uk: "GB", "united kingdom": "GB", belgium: "BE", hungary: "HU",
  netherlands: "NL", italy: "IT", azerbaijan: "AZ", singapore: "SG", mexico: "MX",
  brazil: "BR", qatar: "QA", uae: "AE", "united arab emirates": "AE", france: "FR",
  germany: "DE", portugal: "PT", turkey: "TR", russia: "RU", malaysia: "MY",
};

const countryToCC = (c) => CC_BY_COUNTRY[String(c || "").toLowerCase()] || "";

/* ---------- web push ---------- */

/* Push is sent without a payload. That avoids the whole aes128gcm encryption
   dance in RFC 8291 — the service worker just wakes up and asks the server
   what happened. Only the VAPID signature is needed. */

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function vapidHeader(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:admin@example.com",
  })));
  const key = await crypto.subtle.importKey(
    "jwk", JSON.parse(env.VAPID_PRIVATE_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );
  /* WebCrypto returns r||s raw, which is exactly what JWS ES256 wants. */
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body));
  return "vapid t=" + head + "." + body + "." + b64url(sig) + ", k=" + env.VAPID_PUBLIC_KEY;
}

/** Wake up some players' browsers. Dead subscriptions are pruned as we go. */
async function pushTo(env, playerIds) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY) return 0;
  if (!playerIds.length) return 0;
  const marks = playerIds.map((_, i) => "?" + (i + 1)).join(",");
  const subs = await env.DB.prepare("SELECT endpoint FROM push_subs WHERE player_id IN (" + marks + ")")
    .bind(...playerIds).all();
  let sent = 0;
  for (const sub of subs.results || []) {
    try {
      const res = await fetch(sub.endpoint, {
        method: "POST",
        headers: { TTL: "10800", Authorization: await vapidHeader(env, sub.endpoint) },
      });
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?1").bind(sub.endpoint).run();
      } else if (res.ok) sent++;
    } catch { /* one bad endpoint shouldn't stop the rest */ }
  }
  return sent;
}

/** What the service worker shows, worked out when the browser asks. */
async function pendingNotice(env, season, meId) {
  const st = await buildState(env, season, meId);
  const next = st.rounds.find((r) => !r.locked);
  const justDone = [...st.rounds].reverse().find((r) => r.result);

  if (next) {
    const mine = next.picks && next.picks.mine;
    const hrs = Math.round((new Date(next.start) - Date.now()) / 3600000);
    if (!mine || !mine.pos) {
      return {
        title: next.name,
        body: hrs <= 48
          ? "Calls close in " + (hrs < 1 ? "under an hour" : hrs + " hours") + " and yours isn't in yet."
          : "A new round is open. Make your call.",
        tag: "call-" + next.round,
      };
    }
  }
  if (justDone) {
    const lead = st.standings[0];
    const who = lead ? st.players.find((p) => p.id === lead.id) : null;
    return {
      title: justDone.name + " result is in",
      body: who ? who.name + " leads on " + lead.pts + " points." : "See how everyone did.",
      tag: "result-" + justDone.round,
    };
  }
  return { title: "Grid Call", body: "Something has changed.", tag: "general" };
}

/** Cron decides who to nudge. Each nudge is sent once, tracked in settings. */
async function runNotifications(env, season) {
  if (!env.VAPID_PRIVATE_JWK) return;
  const cfg = await getSettings(env);
  const done = cfg.notified || {};
  const st = await buildState(env, season, null);
  const now = Date.now();
  let changed = false;

  /* Three hours before lights out, nudge whoever hasn't called. */
  const next = st.rounds.find((r) => !r.locked);
  if (next) {
    const hrs = (new Date(next.start) - now) / 3600000;
    const key = "call-" + next.round;
    if (hrs > 0 && hrs <= 3 && !done[key]) {
      const q = await env.DB.prepare(
        "SELECT player_id FROM picks WHERE season = ?1 AND round = ?2 AND pos IS NOT NULL"
      ).bind(season, next.round).all();
      const called = new Set((q.results || []).map((r) => r.player_id));
      const silent = st.players.filter((p) => !called.has(p.id)).map((p) => p.id);
      await pushTo(env, silent);
      done[key] = now; changed = true;
    }
  }

  /* And tell everyone when a result lands. */
  const fresh = [...st.rounds].reverse().find((r) => r.result);
  if (fresh) {
    const key = "result-" + fresh.round;
    if (!done[key]) {
      await pushTo(env, st.players.map((p) => p.id));
      done[key] = now; changed = true;
    }
  }

  if (changed) {
    for (const k of Object.keys(done)) if (now - done[k] > 30 * 86400_000) delete done[k];
    await putSetting(env, "notified", done);
  }
}

/* ---------- the game model ---------- */

function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(arr, seed) {
  const a = arr.slice();
  const r = rng(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Every driver comes up once before any repeats; each new pass reshuffles. */
function drawFor(driverIds, seed, n) {
  if (!driverIds.length) return null;
  const cycle = Math.floor(n / driverIds.length);
  return shuffled(driverIds, (seed + cycle * 7919) >>> 0)[n % driverIds.length];
}

function scoreFor(guess, actual, s) {
  if (!guess || !actual) return 0;
  const d = Math.abs(guess - actual);
  let p = d === 0 ? s.exact : d === 1 ? s.off1 : d === 2 ? s.off2 : d === 3 ? s.off3 : d <= 5 ? s.off45 : s.off6;
  if (guess <= 3 && actual <= 3) p += s.podium;
  if (guess <= 10 && actual <= 10) p += s.points;
  return p;
}

/** Everything the app needs, assembled once. */
async function buildState(env, season, meId) {
  const cfg = await getSettings(env);
  const [playersQ, driversQ, roundsQ, resultsQ, qualiQ, sprintQ, picksQ] = await Promise.all([
    env.DB.prepare("SELECT id, name, photo, color, favourite, is_admin FROM players ORDER BY joined").all(),
    env.DB.prepare("SELECT id, first, last, code, no, team, photo, wiki, active, starts FROM drivers WHERE season = ?1 ORDER BY id").bind(season).all(),
    env.DB.prepare("SELECT round, name, circuit, cc, start, quali_at, sprint_at FROM rounds WHERE season = ?1 ORDER BY round").bind(season).all(),
    env.DB.prepare("SELECT round, pos, driver_id FROM results WHERE season = ?1 ORDER BY round, pos").bind(season).all(),
    env.DB.prepare("SELECT round, pos, driver_id FROM quali WHERE season = ?1 ORDER BY round, pos").bind(season).all(),
    env.DB.prepare("SELECT round, pos, driver_id FROM sprint WHERE season = ?1 ORDER BY round, pos").bind(season).all(),
    env.DB.prepare("SELECT round, player_id, pos, fav_pos, pole_driver, sprint_pos FROM picks WHERE season = ?1").bind(season).all(),
  ]);

  const players = (playersQ.results || []).map((p) => ({
    id: p.id, name: p.name, photo: p.photo, color: p.color,
    favourite: p.favourite, isAdmin: !!p.is_admin,
  }));
  const drivers = (driversQ.results || []).map((d) => ({ ...d, active: !!d.active }));
  /* Only drivers who are actually racing go in the draw. */
  const pool = drivers.filter((d) => d.active).map((d) => d.id);

  const resultByRound = {}, poleByRound = {}, qualiByRound = {}, sprintByRound = {};
  for (const r of resultsQ.results || []) (resultByRound[r.round] ||= [])[r.pos - 1] = r.driver_id;
  for (const q of qualiQ.results || []) {
    (qualiByRound[q.round] ||= [])[q.pos - 1] = q.driver_id;
    if (q.pos === 1) poleByRound[q.round] = q.driver_id;
  }
  for (const r of sprintQ.results || []) (sprintByRound[r.round] ||= [])[r.pos - 1] = r.driver_id;

  const pickByRound = {};
  for (const p of picksQ.results || []) {
    (pickByRound[p.round] ||= {})[p.player_id] =
      { pos: p.pos, favPos: p.fav_pos, pole: p.pole_driver, sprintPos: p.sprint_pos };
  }

  const now = Date.now();
  const all = roundsQ.results || [];
  const startRound = cfg.startRound || (all.find((r) => new Date(r.start) > now)?.round ?? all[0]?.round ?? 1);
  const inPlay = all.filter((r) => r.round >= startRound);

  const rounds = inPlay.map((r, i) => {
    const result = resultByRound[r.round] || null;
    const locked = new Date(r.start).getTime() <= now || !!result;
    const driverId = drawFor(pool, cfg.seed, i);
    const raw = pickByRound[r.round] || {};
    const mine = meId ? raw[meId] || null : null;
    /* If the drawn driver never took the start, say so rather than silently
       scoring everyone zero — which is exactly what used to happen. */
    const voided = !!result && !!driverId && result.indexOf(driverId) === -1;
    return {
      round: r.round, gi: i, name: r.name, circuit: r.circuit, cc: r.cc,
      start: r.start, qualiAt: r.quali_at, sprintAt: r.sprint_at,
      driverId, locked, result, voided,
      pole: poleByRound[r.round] || null,
      quali: qualiByRound[r.round] || null,
      sprint: sprintByRound[r.round] || null,
      sprintLocked: !!r.sprint_at && new Date(r.sprint_at).getTime() <= now,
      picks: locked ? raw : { count: Object.keys(raw).length, mine },
    };
  });

  const acc = {};
  for (const p of players) acc[p.id] = { id: p.id, pts: 0, exact: 0, called: 0, offSum: 0, offN: 0, poles: 0 };
  const favOf = Object.fromEntries(players.map((p) => [p.id, p.favourite]));

  for (const r of rounds) {
    if (!r.result) continue;
    const actual = r.driverId ? r.result.indexOf(r.driverId) + 1 : 0;
    for (const [pid, pick] of Object.entries(pickByRound[r.round] || {})) {
      const a = acc[pid];
      if (!a) continue;
      if (actual && pick.pos) {
        a.pts += scoreFor(pick.pos, actual, cfg.scoring);
        a.called += 1;
        if (pick.pos === actual) a.exact += 1;
        a.offSum += Math.abs(pick.pos - actual); a.offN += 1;
      }
      if (cfg.modes.favourite && pick.favPos && favOf[pid]) {
        const favActual = r.result.indexOf(favOf[pid]) + 1;
        if (favActual) {
          a.pts += Math.round(scoreFor(pick.favPos, favActual, cfg.scoring) * (cfg.scoring.favScale / 100));
        }
      }
      if (cfg.modes.sprint && pick.sprintPos && r.sprint && r.driverId) {
        const sActual = r.sprint.indexOf(r.driverId) + 1;
        if (sActual) {
          a.pts += Math.round(scoreFor(pick.sprintPos, sActual, cfg.scoring) * (cfg.scoring.sprintScale / 100));
        }
      }
      if (cfg.modes.pole && pick.pole && r.pole) {
        if (pick.pole === r.pole) { a.pts += cfg.scoring.poleExact; a.poles += 1; }
        else {
          const qp = (qualiQ.results || []).find((q) => q.round === r.round && q.driver_id === pick.pole);
          if (qp && qp.pos === 2) a.pts += cfg.scoring.poleFrontRow;
        }
      }
    }
  }

  const standings = Object.values(acc)
    .map((a) => ({ ...a, avgOff: a.offN ? a.offSum / a.offN : null }))
    .sort((a, b) => b.pts - a.pts || b.exact - a.exact || a.id.localeCompare(b.id));

  return {
    season, me: meId ? players.find((p) => p.id === meId) || null : null,
    players, drivers, rounds, standings,
    scoring: cfg.scoring, modes: cfg.modes, syncState: cfg.syncState, startRound,
    allRounds: all.map((r) => ({ round: r.round, name: r.name })),
  };
}

/* ---------- routes ---------- */

async function handleApi(request, env, url, ctx) {
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const method = request.method;
  const season = Number(env.SEASON) || new Date().getUTCFullYear();
  const body = method === "GET" || method === "DELETE" ? {} : await request.json().catch(() => ({}));
  const meId = await readSession(env, request);

  const requireMe = async () => {
    if (!meId) return null;
    return env.DB.prepare("SELECT id, name, is_admin FROM players WHERE id = ?1").bind(meId).first();
  };

  /* --- joining and signing in --- */

  if (path === "/auth/join" && method === "POST") {
    const { code, name, password, photo, color } = body;
    if (!env.JOIN_CODE || code !== env.JOIN_CODE) return bad("That join code isn't right.", 403);
    if (!name || !String(name).trim()) return bad("Pick a name.");
    if (!password || String(password).length < 8) return bad("Passwords need at least 8 characters.");
    if (photo && String(photo).length > 60000) return bad("That photo is too large.");
    const key = nameKey(name);
    const taken = await env.DB.prepare("SELECT id FROM players WHERE name_key = ?1").bind(key).first();
    if (taken) return bad("Someone is already using that name. Sign in instead, or pick another.", 409);
    const { hash, salt } = await hashPassword(password);
    const id = uid();
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM players").first();
    const first = (count?.n || 0) === 0;
    await env.DB.prepare(
      `INSERT INTO players (id, name, name_key, photo, color, pw_hash, pw_salt, is_admin, joined)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    ).bind(id, String(name).trim(), key, photo || null, color || "#37D67A", hash, salt, first ? 1 : 0, Date.now()).run();
    return json({ ok: true, firstPlayer: first }, 200, { "Set-Cookie": sessionCookie(await signSession(env, id)) });
  }

  if (path === "/auth/login" && method === "POST") {
    const { name, password } = body;
    const row = await env.DB.prepare("SELECT id, pw_hash, pw_salt FROM players WHERE name_key = ?1")
      .bind(nameKey(name || "")).first();
    /* Hash regardless, so a wrong name and a wrong password take the same time. */
    const ok = row ? await checkPassword(String(password || ""), row.pw_hash, row.pw_salt)
                   : (await hashPassword(String(password || "x")), false);
    if (!ok) return bad("That name and password don't match.", 401);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(await signSession(env, row.id)) });
  }

  if (path === "/auth/logout" && method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": CLEAR_COOKIE });
  }

  /* --- the game --- */

  if (path === "/state" && method === "GET") {
    return json(await buildState(env, season, meId));
  }

  if (path === "/pick" && method === "POST") {
    const me = await requireMe();
    if (!me) return bad("Sign in first.", 401);
    const round = Number(body.round);
    const r = await env.DB.prepare("SELECT start, quali_at, sprint_at FROM rounds WHERE season = ?1 AND round = ?2")
      .bind(season, round).first();
    if (!r) return bad("No such round.", 404);
    /* The real lock. The app hides the grid too, but this is what enforces it. */
    if (new Date(r.start).getTime() <= Date.now()) return bad("That race has started. Calls are closed.", 409);

    const cfg = await getSettings(env);
    const prev = await env.DB.prepare("SELECT pos, fav_pos, pole_driver, sprint_pos FROM picks WHERE season=?1 AND round=?2 AND player_id=?3")
      .bind(season, round, me.id).first();

    const num = (v, fallback) => (v === undefined ? fallback : v === null ? null : Number(v) || null);
    const pos = num(body.pos, prev?.pos ?? null);
    const favPos = cfg.modes.favourite ? num(body.favPos, prev?.fav_pos ?? null) : null;
    let pole = cfg.modes.pole ? (body.pole === undefined ? prev?.pole_driver ?? null : body.pole || null) : null;

    const sprintPos = cfg.modes.sprint ? num(body.sprintPos, prev?.sprint_pos ?? null) : null;
    if (sprintPos !== null && r.sprint_at && new Date(r.sprint_at).getTime() <= Date.now()
        && sprintPos !== (prev?.sprint_pos ?? null)) {
      return bad("The sprint has started. Sprint calls are closed.", 409);
    }
    if (pos !== null && (pos < 1 || pos > 30)) return bad("That isn't a valid call.");
    if (favPos !== null && (favPos < 1 || favPos > 30)) return bad("That isn't a valid call.");
    /* Pole closes when qualifying starts, not when the race does. */
    if (pole && r.quali_at && new Date(r.quali_at).getTime() <= Date.now() && pole !== (prev?.pole_driver ?? null)) {
      return bad("Qualifying has started. Pole calls are closed.", 409);
    }

    await env.DB.prepare(
      `INSERT INTO picks (season, round, player_id, pos, fav_pos, pole_driver, sprint_pos, at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(season, round, player_id)
       DO UPDATE SET pos = ?4, fav_pos = ?5, pole_driver = ?6, sprint_pos = ?7, at = ?8`
    ).bind(season, round, me.id, pos, favPos, pole, sprintPos, Date.now()).run();
    return json(await buildState(env, season, me.id));
  }

  if (path === "/me" && method === "PATCH") {
    const me = await requireMe();
    if (!me) return bad("Sign in first.", 401);
    const { name, photo, color, password } = body;
    if (name && nameKey(name) !== nameKey(me.name)) {
      const taken = await env.DB.prepare("SELECT id FROM players WHERE name_key = ?1 AND id <> ?2")
        .bind(nameKey(name), me.id).first();
      if (taken) return bad("That name is taken.", 409);
      await env.DB.prepare("UPDATE players SET name = ?1, name_key = ?2 WHERE id = ?3")
        .bind(String(name).trim(), nameKey(name), me.id).run();
    }
    if (photo !== undefined) {
      if (photo && String(photo).length > 60000) return bad("That photo is too large.");
      await env.DB.prepare("UPDATE players SET photo = ?1 WHERE id = ?2").bind(photo || null, me.id).run();
    }
    if (color) await env.DB.prepare("UPDATE players SET color = ?1 WHERE id = ?2").bind(color, me.id).run();
    if (body.favourite !== undefined) {
      await env.DB.prepare("UPDATE players SET favourite = ?1 WHERE id = ?2").bind(body.favourite || null, me.id).run();
    }
    if (password) {
      if (String(password).length < 8) return bad("Passwords need at least 8 characters.");
      const { hash, salt } = await hashPassword(String(password));
      await env.DB.prepare("UPDATE players SET pw_hash = ?1, pw_salt = ?2 WHERE id = ?3").bind(hash, salt, me.id).run();
    }
    return json(await buildState(env, season, me.id));
  }

  /* --- notifications --- */

  if (path === "/push/key" && method === "GET") {
    return json({ key: env.VAPID_PUBLIC_KEY || null });
  }

  if (path === "/push/subscribe" && method === "POST") {
    const me = await requireMe();
    if (!me) return bad("Sign in first.", 401);
    const sub = body.subscription;
    if (!sub || !sub.endpoint) return bad("No subscription given.");
    await env.DB.prepare(
      `INSERT INTO push_subs (endpoint, player_id, p256dh, auth, created)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(endpoint) DO UPDATE SET player_id = ?2, p256dh = ?3, auth = ?4`
    ).bind(sub.endpoint, me.id, sub.keys?.p256dh || null, sub.keys?.auth || null, Date.now()).run();
    return json({ ok: true });
  }

  if (path === "/push/unsubscribe" && method === "POST") {
    if (body.endpoint) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?1").bind(body.endpoint).run();
    return json({ ok: true });
  }

  /* The service worker asks what to show, because the push itself has no payload. */
  if (path === "/push/pending" && method === "GET") {
    return json(await pendingNotice(env, season, meId));
  }

  if (path === "/push/test" && method === "POST") {
    const me = await requireMe();
    if (!me) return bad("Sign in first.", 401);
    const sent = await pushTo(env, [me.id]);
    return json({ ok: true, sent });
  }

  /* --- organiser only --- */

  if (path === "/admin/elevate" && method === "POST") {
    const me = await requireMe();
    if (!me) return bad("Sign in first.", 401);
    if (!env.ADMIN_CODE || body.code !== env.ADMIN_CODE) return bad("That organiser code isn't right.", 403);
    await env.DB.prepare("UPDATE players SET is_admin = 1 WHERE id = ?1").bind(me.id).run();
    return json(await buildState(env, season, me.id));
  }

  if (path.startsWith("/admin/")) {
    const me = await requireMe();
    if (!me) return bad("Sign in first.", 401);
    if (!me.is_admin) return bad("Organisers only.", 403);

    if (path === "/admin/sync" && method === "POST") {
      /* Jolpica is slow and a full pull is many requests, so this returns
         immediately and the app watches syncState for progress. */
      await putSetting(env, "syncState", { at: Date.now(), busy: true, step: "starting" });
      ctx.waitUntil(syncAll(env, season));
      return json(await buildState(env, season, me.id));
    }

    if (path === "/admin/settings" && method === "POST") {
      if (body.scoring) {
        const clean = {};
        for (const k of Object.keys(DEFAULT_SCORING)) clean[k] = Number(body.scoring[k]) || 0;
        await putSetting(env, "scoring", clean);
      }
      if (body.modes) {
        const cur = (await getSettings(env)).modes;
        await putSetting(env, "modes", { ...cur, ...body.modes });
      }
      if (body.startRound !== undefined) await putSetting(env, "startRound", Number(body.startRound) || 0);
      if (body.reshuffle) await putSetting(env, "seed", Math.floor(Math.random() * 1e9));
      return json(await buildState(env, season, me.id));
    }

    if (path === "/admin/driver" && method === "POST") {
      /* Override the automatic pool, for when a mid-season change confuses it. */
      if (!body.id) return bad("Which driver?");
      await env.DB.prepare("UPDATE drivers SET active = ?1 WHERE id = ?2")
        .bind(body.active ? 1 : 0, body.id).run();
      return json(await buildState(env, season, me.id));
    }

    if (path === "/admin/result" && method === "POST") {
      const round = Number(body.round);
      const order = Array.isArray(body.order) ? body.order : [];
      if (!round || !order.length) return bad("Give a round and a finishing order.");
      await env.DB.prepare("DELETE FROM results WHERE season = ?1 AND round = ?2").bind(season, round).run();
      await env.DB.batch(order.map((did, i) =>
        env.DB.prepare("INSERT INTO results (season, round, pos, driver_id) VALUES (?1, ?2, ?3, ?4)")
          .bind(season, round, i + 1, did)
      ));
      return json(await buildState(env, season, me.id));
    }

    if (path === "/admin/player" && method === "DELETE") {
      const id = String(body.id || new URL(request.url).searchParams.get("id") || "");
      if (!id) return bad("Which player?");
      if (id === me.id) return bad("You can't remove yourself.");
      await env.DB.batch([
        env.DB.prepare("DELETE FROM picks WHERE player_id = ?1").bind(id),
        env.DB.prepare("DELETE FROM players WHERE id = ?1").bind(id),
      ]);
      return json(await buildState(env, season, me.id));
    }

    if (path === "/admin/reset" && method === "POST") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM picks"),
        env.DB.prepare("DELETE FROM players WHERE id <> ?1").bind(me.id),
      ]);
      return json(await buildState(env, season, me.id), 200);
    }
  }

  return bad("No such endpoint.", 404);
}

/* ---------- entry points ---------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (!env.SESSION_SECRET) {
        return bad("SESSION_SECRET is not set. Run: wrangler secret put SESSION_SECRET", 500);
      }
      try {
        return await handleApi(request, env, url, ctx);
      } catch (e) {
        console.error(e);
        return bad("Something broke on the server: " + (e.message || e), 500);
      }
    }

    /* Everything else is the app itself. not_found_handling in wrangler.toml
       sends unknown paths to index.html so client routing works. */
    return env.ASSETS.fetch(request);
  },

  /* Hourly: pull anything new, then send whatever notifications are due.
     Everything already present is skipped, so a quiet hour costs one request. */
  async scheduled(event, env, ctx) {
    const season = Number(env.SEASON) || new Date().getUTCFullYear();
    ctx.waitUntil((async () => {
      try { await syncAll(env, season); } catch (e) { console.error("sync failed", e); }
      try { await runNotifications(env, season); } catch (e) { console.error("notify failed", e); }
    })());
  },
};
