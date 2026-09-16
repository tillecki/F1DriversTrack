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

const DEFAULT_SCORING = { exact: 25, off1: 18, off2: 12, off3: 8, off45: 4, off6: 0, podium: 5, points: 3 };

async function getSettings(env) {
  const rows = await env.DB.prepare("SELECT k, v FROM settings").all();
  const out = {};
  for (const r of rows.results || []) {
    try { out[r.k] = JSON.parse(r.v); } catch { out[r.k] = r.v; }
  }
  return {
    scoring: { ...DEFAULT_SCORING, ...(out.scoring || {}) },
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
   Browsers refuse to set that header, which is exactly why these calls
   happen here in the Worker rather than in the app. */
async function jolpica(env, path) {
  const res = await fetch("https://api.jolpi.ca/ergast/f1/" + path, {
    headers: {
      "User-Agent": env.USER_AGENT || "GridCall/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error("Jolpica returned " + res.status);
  return res.json();
}

const TEAM_ALIASES = {
  red_bull: "redbull", aston_martin: "aston", racing_bulls: "rb", rb: "rb",
  alphatauri: "rb", sauber: "audi", kick_sauber: "audi", audi: "audi",
  alfa: "audi", cadillac: "cadillac", haas: "haas", alpine: "alpine",
  williams: "williams", mercedes: "mercedes", ferrari: "ferrari", mclaren: "mclaren",
};

function teamSlug(constructorId) {
  const id = String(constructorId || "").toLowerCase();
  return TEAM_ALIASES[id] || id;
}

async function syncSchedule(env, season) {
  const data = await jolpica(env, season + "/races/?limit=100");
  const races = data?.MRData?.RaceTable?.Races || [];
  if (!races.length) return 0;
  const stmts = races.map((r) =>
    env.DB.prepare(
      `INSERT INTO rounds (season, round, name, circuit, cc, start)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(season, round) DO UPDATE SET name=?3, circuit=?4, cc=?5, start=?6`
    ).bind(
      Number(season),
      Number(r.round),
      r.raceName || "Round " + r.round,
      r.Circuit?.circuitName || "",
      countryToCC(r.Circuit?.Location?.country),
      (r.date || "") + "T" + (r.time || "13:00:00Z")
    )
  );
  await env.DB.batch(stmts);
  return races.length;
}

async function syncDrivers(env, season) {
  /* driverStandings carries the constructor alongside each driver, which the
     plain drivers endpoint does not. Early in a season it can be empty, so
     fall back to the driver list with no team attached. */
  let rows = [];
  try {
    const d = await jolpica(env, season + "/driverStandings/?limit=100");
    const list = d?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
    rows = list.map((s) => ({ d: s.Driver, team: teamSlug(s.Constructors?.[0]?.constructorId) }));
  } catch { /* fall through */ }
  if (!rows.length) {
    const d = await jolpica(env, season + "/drivers/?limit=100");
    rows = (d?.MRData?.DriverTable?.Drivers || []).map((dr) => ({ d: dr, team: null }));
  }
  if (!rows.length) return 0;
  const stmts = rows.map(({ d, team }) =>
    env.DB.prepare(
      `INSERT INTO drivers (id, season, first, last, code, no, team)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET season=?2, first=?3, last=?4, code=?5, no=?6, team=COALESCE(?7, team)`
    ).bind(
      d.driverId,
      Number(season),
      d.givenName || "",
      d.familyName || "",
      d.code || null,
      d.permanentNumber ? Number(d.permanentNumber) : null,
      team
    )
  );
  await env.DB.batch(stmts);
  return rows.length;
}

async function syncResult(env, season, round) {
  const data = await jolpica(env, season + "/" + round + "/results/?limit=100");
  const race = data?.MRData?.RaceTable?.Races?.[0];
  const results = race?.Results || [];
  if (!results.length) return 0;
  await env.DB.prepare("DELETE FROM results WHERE season = ?1 AND round = ?2").bind(Number(season), Number(round)).run();
  const stmts = results.map((r) =>
    env.DB.prepare("INSERT INTO results (season, round, pos, driver_id) VALUES (?1, ?2, ?3, ?4)")
      .bind(Number(season), Number(round), Number(r.position), r.Driver.driverId)
  );
  await env.DB.batch(stmts);
  return results.length;
}

/** Pull anything that's missing. Safe to call as often as you like. */
async function syncAll(env, season) {
  const report = { schedule: 0, drivers: 0, results: [] };
  report.schedule = await syncSchedule(env, season);
  report.drivers = await syncDrivers(env, season);
  const due = await env.DB.prepare(
    `SELECT r.round FROM rounds r
     WHERE r.season = ?1 AND r.start <= ?2
       AND NOT EXISTS (SELECT 1 FROM results x WHERE x.season = r.season AND x.round = r.round)
     ORDER BY r.round`
  ).bind(Number(season), new Date().toISOString()).all();
  for (const row of due.results || []) {
    try {
      const n = await syncResult(env, season, row.round);
      if (n) report.results.push({ round: row.round, positions: n });
    } catch (e) {
      report.results.push({ round: row.round, error: String(e.message || e) });
    }
  }
  return report;
}

const CC_BY_COUNTRY = {
  australia: "AU", china: "CN", japan: "JP", bahrain: "BH", "saudi arabia": "SA",
  usa: "US", "united states": "US", canada: "CA", monaco: "MC", spain: "ES",
  austria: "AT", uk: "GB", "united kingdom": "GB", belgium: "BE", hungary: "HU",
  netherlands: "NL", italy: "IT", azerbaijan: "AZ", singapore: "SG", mexico: "MX",
  brazil: "BR", qatar: "QA", uae: "AE", "united arab emirates": "AE", france: "FR",
  germany: "DE", portugal: "PT", turkey: "TR", russia: "RU", malaysia: "MY",
};

function countryToCC(country) {
  return CC_BY_COUNTRY[String(country || "").toLowerCase()] || "";
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
  const [playersQ, driversQ, roundsQ, resultsQ, picksQ] = await Promise.all([
    env.DB.prepare("SELECT id, name, photo, color, is_admin FROM players ORDER BY joined").all(),
    env.DB.prepare("SELECT id, first, last, code, no, team FROM drivers WHERE season = ?1 ORDER BY id").bind(season).all(),
    env.DB.prepare("SELECT round, name, circuit, cc, start FROM rounds WHERE season = ?1 ORDER BY round").bind(season).all(),
    env.DB.prepare("SELECT round, pos, driver_id FROM results WHERE season = ?1 ORDER BY round, pos").bind(season).all(),
    env.DB.prepare("SELECT round, player_id, pos FROM picks WHERE season = ?1").bind(season).all(),
  ]);

  const players = (playersQ.results || []).map((p) => ({
    id: p.id, name: p.name, photo: p.photo, color: p.color, isAdmin: !!p.is_admin,
  }));
  const drivers = driversQ.results || [];
  const driverIds = drivers.map((d) => d.id);

  const resultByRound = {};
  for (const r of resultsQ.results || []) (resultByRound[r.round] ||= [])[r.pos - 1] = r.driver_id;

  const pickByRound = {};
  for (const p of picksQ.results || []) (pickByRound[p.round] ||= {})[p.player_id] = p.pos;

  const now = Date.now();
  const all = roundsQ.results || [];
  const startRound = cfg.startRound || (all.find((r) => new Date(r.start) > now)?.round ?? all[0]?.round ?? 1);
  const inPlay = all.filter((r) => r.round >= startRound);

  const rounds = inPlay.map((r, i) => {
    const result = resultByRound[r.round] || null;
    const locked = new Date(r.start).getTime() <= now || !!result;
    const raw = pickByRound[r.round] || {};
    return {
      round: r.round,
      gi: i,
      name: r.name,
      circuit: r.circuit,
      cc: r.cc,
      start: r.start,
      driverId: drawFor(driverIds, cfg.seed, i),
      locked,
      result,
      /* Before lights out, all anyone gets is a count and their own call. */
      picks: locked ? raw : { count: Object.keys(raw).length, mine: meId ? raw[meId] ?? null : null },
    };
  });

  const acc = {};
  for (const p of players) acc[p.id] = { id: p.id, pts: 0, exact: 0, called: 0, offSum: 0, offN: 0 };
  for (const r of rounds) {
    if (!r.result || !r.driverId) continue;
    const actual = r.result.indexOf(r.driverId) + 1;
    if (!actual) continue;
    for (const [pid, pos] of Object.entries(pickByRound[r.round] || {})) {
      const a = acc[pid];
      if (!a) continue;
      a.pts += scoreFor(pos, actual, cfg.scoring);
      a.called += 1;
      if (pos === actual) a.exact += 1;
      a.offSum += Math.abs(pos - actual);
      a.offN += 1;
    }
  }
  const standings = Object.values(acc)
    .map((a) => ({ ...a, avgOff: a.offN ? a.offSum / a.offN : null }))
    .sort((a, b) => b.pts - a.pts || b.exact - a.exact || a.id.localeCompare(b.id));

  const me = meId ? players.find((p) => p.id === meId) || null : null;
  return { season, me, players, drivers, rounds, standings, scoring: cfg.scoring, startRound, allRounds: all.map((r) => ({ round: r.round, name: r.name })) };
}

/* ---------- routes ---------- */

async function handleApi(request, env, url) {
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
    const round = Number(body.round), pos = Number(body.pos);
    if (!round || !pos || pos < 1 || pos > 30) return bad("That isn't a valid call.");
    const r = await env.DB.prepare("SELECT start FROM rounds WHERE season = ?1 AND round = ?2").bind(season, round).first();
    if (!r) return bad("No such round.", 404);
    /* The real lock. The app hides the grid too, but this is what enforces it. */
    if (new Date(r.start).getTime() <= Date.now()) return bad("That race has started. Calls are closed.", 409);
    await env.DB.prepare(
      `INSERT INTO picks (season, round, player_id, pos, at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(season, round, player_id) DO UPDATE SET pos = ?4, at = ?5`
    ).bind(season, round, me.id, pos, Date.now()).run();
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
    if (password) {
      if (String(password).length < 8) return bad("Passwords need at least 8 characters.");
      const { hash, salt } = await hashPassword(String(password));
      await env.DB.prepare("UPDATE players SET pw_hash = ?1, pw_salt = ?2 WHERE id = ?3").bind(hash, salt, me.id).run();
    }
    return json(await buildState(env, season, me.id));
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
      try {
        const report = await syncAll(env, season);
        return json({ ok: true, report, state: await buildState(env, season, me.id) });
      } catch (e) {
        return bad("Jolpica didn't answer: " + (e.message || e), 502);
      }
    }

    if (path === "/admin/settings" && method === "POST") {
      if (body.scoring) {
        const clean = {};
        for (const k of Object.keys(DEFAULT_SCORING)) clean[k] = Number(body.scoring[k]) || 0;
        await putSetting(env, "scoring", clean);
      }
      if (body.startRound !== undefined) await putSetting(env, "startRound", Number(body.startRound) || 0);
      if (body.reshuffle) await putSetting(env, "seed", Math.floor(Math.random() * 1e9));
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
        return await handleApi(request, env, url);
      } catch (e) {
        console.error(e);
        return bad("Something broke on the server: " + (e.message || e), 500);
      }
    }

    /* Everything else is the app itself. not_found_handling in wrangler.toml
       sends unknown paths to index.html so client routing works. */
    return env.ASSETS.fetch(request);
  },

  /* Four-hourly: refresh the calendar and pull in any finished race.
     Nobody has to remember to press a button. */
  async scheduled(event, env, ctx) {
    const season = Number(env.SEASON) || new Date().getUTCFullYear();
    ctx.waitUntil(
      syncAll(env, season).catch((e) => console.error("scheduled sync failed", e))
    );
  },
};
