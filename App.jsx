import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";

/* Grid Call — the app. UI shared with the original prototype; all state now
   comes from the Worker, which is also what enforces the lock. */

const CSS = `

.gc * { box-sizing: border-box; margin: 0; padding: 0; }
.gc {
  --ink: #05080E;
  --panel: #0C121C;
  --raise: #141D2B;
  --line: #222E40;
  --text: #EAEFF6;
  --dim: #7C8CA3;
  --faint: #4A5768;
  --go: #37D67A;
  --caution: #F2C94C;
  --stop: #EB5757;
  --font-d: 'Barlow Condensed', 'Oswald', 'Arial Narrow', sans-serif;
  --font-b: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--ink);
  color: var(--text);
  font-family: var(--font-b);
  min-height: 100vh;
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.gc .wrap { max-width: 560px; margin: 0 auto; padding: 0 0 92px; }

/* ---- typography ---- */
.gc h1, .gc h2, .gc h3, .gc .disp {
  font-family: var(--font-d);
  font-weight: 700;
  letter-spacing: -0.005em;
  line-height: 1.05;
}
.gc h1 { font-size: 34px; }
.gc h2 { font-size: 25px; }
.gc h3 { font-size: 19px; font-weight: 600; }
.gc .num { font-family: var(--font-d); font-weight: 700; font-variant-numeric: tabular-nums; }
.gc .meta { font-size: 13px; color: var(--dim); }
.gc .tiny { font-size: 11.5px; color: var(--faint); }

/* ---- structure ---- */
.gc .strip {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; gap: 10px;
  padding: 11px 16px;
  background: rgba(5,8,14,0.93);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}
.gc .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.gc .dot.pulse { animation: gcpulse 2.4s ease-in-out infinite; }
@keyframes gcpulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
@media (prefers-reduced-motion: reduce) { .gc .dot.pulse { animation: none } }

.gc .panel { background: var(--panel); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.gc .pad { padding: 18px 16px; }
.gc .sep { height: 1px; background: var(--line); }
.gc .row { display: flex; align-items: center; gap: 12px; }
.gc .spread { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.gc .stack { display: flex; flex-direction: column; }

/* ---- buttons ---- */
.gc button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
.gc button:focus-visible, .gc input:focus-visible, .gc select:focus-visible {
  outline: 2px solid var(--go); outline-offset: 2px;
}
.gc .btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; padding: 15px 18px;
  background: var(--go); color: #04120A;
  font-family: var(--font-d); font-size: 19px; font-weight: 700;
  letter-spacing: 0.01em;
  border-radius: 3px;
  transition: opacity .15s ease, transform .1s ease;
}
.gc .btn:active { transform: scale(0.985); }
.gc .btn[disabled] { opacity: .3; cursor: not-allowed; }
.gc .btn.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); }
.gc .btn.warn { background: var(--caution); color: #1A1400; }
.gc .btn.danger { background: transparent; color: var(--stop); border: 1px solid var(--stop); }
.gc .btn.sm { padding: 9px 14px; font-size: 15px; width: auto; }

/* ---- inputs ---- */
.gc input[type=text], .gc input[type=number], .gc input[type=password], .gc select, .gc textarea {
  width: 100%; padding: 11px 13px;
  background: var(--raise); color: var(--text);
  border: 1px solid var(--line); border-radius: 3px;
  font-family: var(--font-b); font-size: 15px;
}
.gc label.fld { display: block; margin-bottom: 14px; }
.gc label.fld > span { display: block; font-size: 13px; color: var(--dim); margin-bottom: 5px; }

/* ---- position grid ---- */
.gc .posgrid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.gc .pos {
  aspect-ratio: 1 / 1;
  display: flex; align-items: center; justify-content: center;
  background: var(--raise); border: 1px solid transparent; border-radius: 3px;
  font-family: var(--font-d); font-weight: 700; font-size: 20px;
  color: var(--dim);
  transition: background .12s ease, color .12s ease;
}
.gc .pos.on { background: var(--text); color: var(--ink); }
.gc .pos.taken { border-color: var(--line); }
.gc .pos[disabled] { opacity: .4; }

/* ---- timing tower ---- */
.gc .trow { display: grid; grid-template-columns: 34px 1fr auto; align-items: center; gap: 12px; padding: 11px 16px; border-bottom: 1px solid var(--line); }
.gc .trow .tp { font-family: var(--font-d); font-size: 22px; font-weight: 700; color: var(--dim); text-align: right; }
.gc .trow.lead .tp { color: var(--text); }
.gc .trow.me { background: var(--raise); }

/* ---- avatar ---- */
.gc .av { width: 34px; height: 34px; border-radius: 50%; flex: none; display: flex; align-items: center; justify-content: center; font-family: var(--font-d); font-weight: 700; font-size: 15px; color: #06090F; overflow: hidden; }
.gc .av img { width: 100%; height: 100%; object-fit: cover; }
.gc .av.lg { width: 60px; height: 60px; font-size: 25px; }

/* ---- driver card ---- */
.gc .dcard { display: flex; align-items: stretch; background: var(--raise); border-radius: 3px; overflow: hidden; }
.gc .dcard .bar { width: 6px; flex: none; }
.gc .dcard .body { padding: 14px 16px; flex: 1; }

/* ---- tabs ---- */
.gc .tabs {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
  display: flex; max-width: 560px; margin: 0 auto;
  background: rgba(5,8,14,0.96);
  backdrop-filter: blur(12px);
  border-top: 1px solid var(--line);
  padding-bottom: env(safe-area-inset-bottom);
}
.gc .tab { flex: 1; padding: 11px 4px 13px; display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--faint); font-size: 10.5px; letter-spacing: .02em; }
.gc .tab.on { color: var(--text); }
.gc .tab .ic { font-size: 17px; line-height: 1; }

/* ---- misc ---- */
.gc .chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 2px; font-size: 12px; font-weight: 500; background: var(--raise); color: var(--dim); }
.gc .track { width: 100%; height: auto; display: block; }
.gc .scroller { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.gc .modal { position: fixed; inset: 0; z-index: 60; background: rgba(2,4,8,.8); display: flex; align-items: flex-end; justify-content: center; }
.gc .sheet { width: 100%; max-width: 560px; background: var(--panel); border-top: 1px solid var(--line); max-height: 88vh; overflow-y: auto; padding: 20px 16px calc(28px + env(safe-area-inset-bottom)); }
.gc .fade { animation: gcfade .22s ease both; }
@keyframes gcfade { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) { .gc .fade { animation: none } }
`;

/* ===================== reference data ===================== */


const TEAMS = {
  mclaren:   { name: "McLaren",      color: "#FF8000" },
  ferrari:   { name: "Ferrari",      color: "#E8002D" },
  redbull:   { name: "Red Bull",     color: "#3671C6" },
  mercedes:  { name: "Mercedes",     color: "#27F4D2" },
  aston:     { name: "Aston Martin", color: "#229971" },
  williams:  { name: "Williams",     color: "#1868DB" },
  audi:      { name: "Audi",         color: "#D6203A" },
  alpine:    { name: "Alpine",       color: "#0093CC" },
  haas:      { name: "Haas",         color: "#E3E6E9" },
  rb:        { name: "Racing Bulls", color: "#6692FF" },
  cadillac:  { name: "Cadillac",     color: "#98A2AE" },
};


/* Stylised circuit outlines — recognisable shapes, not survey-accurate maps.
   viewBox 0 0 200 110. Keyed by a loose match on circuit name. */
const TRACK_PATHS = {
  monza:      "M18,88 L150,88 L168,80 L172,68 L160,62 L120,62 L112,55 L120,48 L158,48 L168,40 L164,28 L150,24 L44,24 L26,30 L20,42 L26,54 L44,58 L52,66 L44,76 L24,78 Z",
  baku:       "M22,92 L172,92 L182,84 L182,46 L168,38 L96,38 L88,31 L96,24 L132,24 L138,30 L130,36 L70,36 L58,30 L44,34 L38,46 L44,58 L34,66 L22,74 Z",
  marina:     "M26,86 L60,86 L68,78 L68,62 L86,62 L92,70 L128,70 L136,62 L166,62 L174,54 L174,34 L160,26 L96,26 L88,34 L60,34 L48,26 L32,32 L26,46 L34,56 L24,68 Z",
  americas:   "M28,84 L34,50 L46,32 L64,26 L78,34 L86,50 L98,40 L112,50 L124,40 L138,50 L152,42 L170,48 L178,62 L168,76 L140,82 L120,74 L96,80 L72,74 L52,82 Z",
  rodriguez:  "M24,88 L160,88 L176,80 L178,62 L164,54 L128,54 L118,46 L128,38 L152,38 L158,30 L148,24 L62,24 L48,30 L44,42 L54,50 L42,58 L26,68 Z",
  interlagos: "M36,30 L120,24 L154,32 L172,50 L164,68 L138,80 L96,86 L60,84 L34,74 L26,58 L44,52 L70,58 L86,52 L74,42 L46,42 Z",
  vegas:      "M20,90 L176,90 L186,82 L186,62 L174,54 L84,54 L74,46 L84,38 L164,38 L172,30 L162,22 L40,22 L24,30 L18,46 L28,58 L18,74 Z",
  lusail:     "M30,72 L44,42 L68,26 L100,24 L128,32 L144,26 L166,32 L178,50 L172,70 L152,82 L124,84 L104,74 L82,84 L54,86 Z",
  yas:        "M24,80 L28,44 L44,28 L92,24 L108,32 L108,52 L130,52 L142,44 L166,46 L178,58 L172,74 L146,84 L108,86 L76,80 L48,88 Z",
  suzuka:     "M28,82 L36,50 L56,30 L84,26 L100,38 L92,52 L108,58 L134,48 L160,52 L176,66 L168,82 L140,88 L112,82 L86,72 L58,78 Z",
  silverstone:"M30,40 L60,24 L110,22 L146,30 L172,46 L176,66 L158,80 L120,86 L84,80 L70,66 L88,58 L112,62 L126,52 L102,44 L64,48 L40,58 Z",
  spa:        "M34,84 L28,52 L44,28 L74,22 L92,34 L86,50 L112,44 L146,30 L172,40 L180,60 L164,78 L128,86 L92,82 L64,90 Z",
  zandvoort:  "M32,80 L30,44 L48,26 L86,22 L120,30 L134,44 L124,58 L146,56 L170,44 L182,58 L176,76 L146,86 L104,88 L66,84 Z",
  hungaroring:"M30,76 L32,44 L52,28 L88,26 L104,38 L96,52 L118,50 L140,34 L166,38 L178,56 L168,76 L136,86 L94,84 L58,88 Z",
  redbullring:"M36,86 L30,52 L46,30 L76,26 L96,40 L126,30 L158,36 L176,54 L166,74 L134,84 L102,76 L70,84 Z",
  monaco:     "M30,84 L34,52 L48,32 L76,26 L100,34 L104,50 L128,46 L156,52 L174,44 L182,58 L170,74 L140,82 L108,78 L74,86 Z",
  catalunya:  "M32,80 L34,46 L52,28 L90,24 L128,32 L160,28 L180,44 L174,64 L148,74 L118,70 L96,80 L64,86 Z",
  miami:      "M26,86 L26,52 L40,32 L70,24 L104,28 L118,40 L142,34 L172,44 L182,62 L166,80 L128,86 L92,80 L58,88 Z",
  albertpark: "M28,78 L36,44 L60,26 L98,22 L136,30 L166,44 L180,62 L168,80 L132,88 L96,84 L64,86 Z",
  shanghai:   "M30,42 L54,24 L96,22 L108,34 L92,46 L112,54 L148,44 L176,54 L180,72 L156,86 L112,88 L74,82 L44,86 L26,68 Z",
  jeddah:     "M22,90 L178,90 L188,80 L182,60 L166,52 L118,52 L106,44 L118,36 L160,36 L170,26 L156,18 L46,20 L26,30 L20,50 L32,62 L20,76 Z",
  bahrain:    "M30,84 L30,46 L46,28 L82,24 L100,36 L100,54 L124,54 L138,44 L168,48 L180,64 L164,80 L124,86 L82,80 L52,88 Z",
  villeneuve: "M24,84 L26,44 L44,26 L90,22 L136,28 L172,42 L182,60 L166,78 L128,86 L100,78 L72,84 L44,90 Z",
  madring:    "M28,80 L30,46 L48,28 L84,24 L118,30 L132,44 L120,58 L146,54 L172,46 L184,62 L172,80 L134,88 L94,82 L58,86 Z",
};

function trackKeyFor(circuit = "", country = "") {
  const s = (circuit + " " + country).toLowerCase();
  const map = [
    ["monza", "monza"], ["baku", "baku"], ["marina bay", "marina"], ["singapore", "marina"],
    ["americas", "americas"], ["cota", "americas"], ["rodr", "rodriguez"], ["mexic", "rodriguez"],
    ["interlagos", "interlagos"], ["paulo", "interlagos"], ["brazil", "interlagos"],
    ["vegas", "vegas"], ["lusail", "lusail"], ["qatar", "lusail"],
    ["yas", "yas"], ["abu dhabi", "yas"], ["suzuka", "suzuka"], ["japan", "suzuka"],
    ["silverstone", "silverstone"], ["britain", "silverstone"], ["spa", "spa"], ["belgium", "spa"],
    ["zandvoort", "zandvoort"], ["hungar", "hungaroring"], ["red bull ring", "redbullring"],
    ["spielberg", "redbullring"], ["austria", "redbullring"], ["monaco", "monaco"],
    ["catalunya", "catalunya"], ["barcelona", "catalunya"], ["miami", "miami"],
    ["albert", "albertpark"], ["australia", "albertpark"], ["shanghai", "shanghai"], ["china", "shanghai"],
    ["jeddah", "jeddah"], ["saudi", "jeddah"], ["bahrain", "bahrain"], ["sakhir", "bahrain"],
    ["villeneuve", "villeneuve"], ["canada", "villeneuve"], ["montreal", "villeneuve"],
    ["madring", "madring"], ["madrid", "madring"],
  ];
  for (const [needle, key] of map) if (s.includes(needle)) return key;
  return null;
}


const DEFAULT_SCORING = {
  exact: 25,
  off1: 18,
  off2: 12,
  off3: 8,
  off45: 4,
  off6: 0,
  podium: 5,
  points: 3,
};

const AVATAR_COLORS = ["#37D67A", "#F2C94C", "#EB5757", "#56CCF2", "#BB6BD9", "#F2994A", "#6FCF97", "#9AA2B1"];


function scoreFor(guess, actual, s) {
  if (!guess || !actual) return 0;
  const d = Math.abs(guess - actual);
  let p = d === 0 ? s.exact : d === 1 ? s.off1 : d === 2 ? s.off2 : d === 3 ? s.off3 : d <= 5 ? s.off45 : s.off6;
  if (guess <= 3 && actual <= 3) p += s.podium;
  if (guess <= 10 && actual <= 10) p += s.points;
  return p;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) +
    " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function countdown(iso, now) {
  const ms = new Date(iso) - now;
  if (isNaN(ms)) return null;
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 1) return d + "d " + (h % 24) + "h";
  if (h >= 1) return h + "h " + (m % 60) + "m";
  return m + "m";
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}


function ccToFlag(cc) {
  const c = String(cc || "").toUpperCase();
  if (c.length !== 2) return "🏁";
  return String.fromCodePoint(...c.split("").map((ch) => 127397 + ch.charCodeAt(0)));
}


function Avatar({ player, size }) {
  if (!player) return null;
  const cls = "av" + (size === "lg" ? " lg" : "");
  if (player.photo) return <div className={cls}><img src={player.photo} alt="" /></div>;
  return <div className={cls} style={{ background: player.color || "#9AA2B1" }}>{(player.name || "?").slice(0, 1).toUpperCase()}</div>;
}

function TrackMap({ circuit, country, color }) {
  const key = trackKeyFor(circuit, country);
  if (!key) {
    return (
      <div style={{ padding: "26px 0", textAlign: "center" }}>
        <div style={{ fontSize: 52, lineHeight: 1 }}>{ccToFlag(country)}</div>
        <div className="tiny" style={{ marginTop: 10 }}>No layout drawing for this circuit yet</div>
      </div>
    );
  }
  return (
    <svg className="track" viewBox="0 0 200 110" role="img" aria-label={"Stylised layout of " + circuit}>
      <path d={TRACK_PATHS[key]} fill="none" stroke="#1B2534" strokeWidth="11" strokeLinejoin="round" strokeLinecap="round" />
      <path d={TRACK_PATHS[key]} fill="none" stroke={color || "#EAEFF6"} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function DriverCard({ driver, sub }) {
  if (!driver) return null;
  const t = TEAMS[driver.team] || { name: "", color: "#9AA2B1" };
  return (
    <div className="dcard">
      <div className="bar" style={{ background: t.color }} />
      <div className="body spread">
        <div>
          <div className="disp" style={{ fontSize: 27 }}>{driver.first} {driver.last}</div>
          <div className="meta" style={{ marginTop: 2 }}>{t.name}{sub ? " · " + sub : ""}</div>
        </div>
        <div className="num" style={{ fontSize: 40, color: t.color, opacity: .9 }}>{driver.no}</div>
      </div>
    </div>
  );
}

function PositionGrid({ max, value, onChange, disabled, highlight }) {
  const cells = [];
  for (let i = 1; i <= max; i++) {
    const on = value === i;
    cells.push(
      <button
        key={i}
        className={"pos" + (on ? " on" : "") + (highlight === i ? " taken" : "")}
        disabled={disabled}
        aria-pressed={on}
        aria-label={"Finish position " + i}
        onClick={() => onChange(i)}
      >{i}</button>
    );
  }
  return <div className="posgrid">{cells}</div>;
}

function Sheet({ children, onClose, title }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet fade" onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 18 }}>
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Empty({ line, action }) {
  return (
    <div className="pad" style={{ textAlign: "center", padding: "48px 24px" }}>
      <div className="meta" style={{ marginBottom: action ? 18 : 0 }}>{line}</div>
      {action}
    </div>
  );
}

/* ===================== screens ===================== */

function RaceScreen({ round, drivers, me, players, picks, callCount, myPos, onPick, now, onOpenRound, onNeedProfile }) {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const rn = round ? round.round : 0;
  useEffect(() => { setDraft(null); }, [rn]);

  if (!round) return <Empty line="Every round has a result. That's the season done." />;
  if (!round.driver) return <Empty line="Waiting on the driver list. An organiser can press Sync now in Settings." />;

  const team = TEAMS[round.driver.team] || { color: "#EAEFF6", name: "" };
  const cd = countdown(round.start, now);
  const soon = cd && new Date(round.start) - now < 36 * 3600 * 1000;
  const myPick = myPos ? { pos: myPos } : null;
  const shown = draft != null ? draft : (myPick ? myPick.pos : null);
  const callers = callCount || 0;

  async function commit() {
    if (!draft) return;
    setSaving(true);
    await onPick(round.round, draft);
    setSaving(false);
    setDraft(null);
  }

  return (
    <div className="fade">
      <div className="panel pad" style={{ borderTop: "none" }}>
        <div className="meta">Round {round.round} · Game race {round.gi + 1}</div>
        <h1 style={{ marginTop: 4 }}>{round.flag} {round.name}</h1>
        <div className="meta" style={{ marginTop: 4 }}>{round.circuit}</div>
        <div style={{ margin: "14px -6px 8px" }}>
          <TrackMap circuit={round.circuit} country={round.cc} color={team.color} />
        </div>
        <div className="spread" style={{ paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          <div className="meta">{fmtDate(round.start)}</div>
          {round.locked
            ? <span className="chip" style={{ color: "var(--stop)" }}>Calls locked</span>
            : <span className="chip" style={{ color: soon ? "var(--caution)" : "var(--go)" }}>Locks in {cd}</span>}
        </div>
      </div>

      <div className="pad">
        <h3 style={{ marginBottom: 10 }}>The driver for this round</h3>
        <DriverCard driver={round.driver} />
        <div className="tiny" style={{ marginTop: 8 }}>
          Same driver for everyone. Every driver comes up once before any of them comes up again.
        </div>
      </div>
      {renderCallBlock()}
    </div>
  );

  function renderCallBlock() {
    if (!me) {
      return (
        <div className="panel pad">
          <h3 style={{ marginBottom: 6 }}>Join the game first</h3>
          <div className="meta" style={{ marginBottom: 14 }}>Add a name and a photo, then you can start calling races.</div>
          <button className="btn" onClick={onNeedProfile}>Create your profile</button>
        </div>
      );
    }
    if (round.locked) {
      return (
        <div className="panel">
          <div className="pad" style={{ paddingBottom: 8 }}>
            <h3>The calls</h3>
            <div className="meta">{callers === 0 ? "Nobody called this one." : callers + (callers === 1 ? " call is" : " calls are") + " in."}</div>
          </div>
          {Object.entries(picks).sort((a, b) => a[1].pos - b[1].pos).map(([pid, p]) => {
            const pl = players[pid];
            if (!pl) return null;
            return (
              <div key={pid} className={"trow" + (me && pid === me.id ? " me" : "")}>
                <div className="tp">{p.pos}</div>
                <div className="row"><Avatar player={pl} /><div>{pl.name}</div></div>
                <div className="meta">{ordinal(p.pos)}</div>
              </div>
            );
          })}
          <div className="pad">
            <button className="btn ghost" onClick={() => onOpenRound(round.round)}>
              {round.result ? "See the full result" : "Result not in yet"}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="panel pad">
        <h3 style={{ marginBottom: 4 }}>Where does {round.driver.last} finish?</h3>
        <div className="meta" style={{ marginBottom: 14 }}>
          {myPick ? "You called " + ordinal(myPick.pos) + ". Change it any time before lights out." : "Pick a finishing position."}
        </div>
        <PositionGrid max={drivers.length} value={shown} onChange={setDraft} />
        <div style={{ marginTop: 16 }}>
          <button className="btn" disabled={!draft || saving || (myPick && draft === myPick.pos)} onClick={commit}>
            {saving ? "Saving" : !draft ? "Pick a position" : myPick ? "Change to " + ordinal(draft) : "Lock in " + ordinal(draft)}
          </button>
        </div>
        <div className="tiny" style={{ marginTop: 12, textAlign: "center" }}>
          {callers} of {Object.keys(players).length} have called. Everyone's calls appear when the race starts.
        </div>
      </div>
    );
  }
}

function BoardScreen({ standings, players, me, rounds }) {
  const scored = rounds.filter((r) => r.result).length;
  if (!standings.length) return <Empty line="No points yet. The board fills in after the first result lands." />;
  const lead = standings[0].pts;
  return (
    <div className="fade">
      <div className="pad">
        <h1>Championship</h1>
        <div className="meta" style={{ marginTop: 4 }}>{scored} {scored === 1 ? "round" : "rounds"} scored</div>
      </div>
      <div className="panel">
        {standings.map((s, i) => {
          const pl = players[s.id];
          return (
            <div key={s.id} className={"trow" + (i === 0 ? " lead" : "") + (me && s.id === me.id ? " me" : "")}>
              <div className="tp">{i + 1}</div>
              <div className="row" style={{ minWidth: 0 }}>
                <Avatar player={pl} />
                <div className="stack" style={{ minWidth: 0 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pl ? pl.name : "Unknown"}</div>
                  <div className="tiny">{s.exact} spot on · {s.called} called</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="num" style={{ fontSize: 23 }}>{s.pts}</div>
                {i > 0 && <div className="tiny">−{lead - s.pts}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SeasonScreen({ rounds, me, picks, scoring, onOpenRound, now }) {
  return (
    <div className="fade">
      <div className="pad">
        <h1>Season</h1>
        <div className="meta" style={{ marginTop: 4 }}>{rounds.length} rounds in play</div>
      </div>
      <div className="panel">
        {rounds.map((r) => {
          const mine = picks[r.round] ? { pos: picks[r.round] } : null;
          const team = TEAMS[r.driver.team] || {};
          let right;
          if (r.result) {
            const actual = r.result.order.indexOf(r.driver.id) + 1;
            const pts = mine && actual ? scoreFor(mine.pos, actual, scoring) : 0;
            right = (
              <div style={{ textAlign: "right" }}>
                <div className="num" style={{ fontSize: 20 }}>{actual ? "P" + actual : "—"}</div>
                <div className="tiny">{mine ? "+" + pts : "no call"}</div>
              </div>
            );
          } else if (r.locked) {
            right = <span className="chip" style={{ color: "var(--caution)" }}>Under way</span>;
          } else {
            const cd = countdown(r.start, now);
            right = <div className="tiny" style={{ textAlign: "right" }}>{cd ? "in " + cd : "soon"}</div>;
          }
          return (
            <button key={r.round} className="trow" style={{ width: "100%", textAlign: "left" }} onClick={() => onOpenRound(r.round)}>
              <div className="tp" style={{ color: team.color }}>{r.gi + 1}</div>
              <div className="stack" style={{ minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.flag} {r.name}</div>
                <div className="tiny">{r.driver.last} · {team.name}</div>
              </div>
              {right}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RoundSheet({ round, drivers, players, picks, scoring, me, onClose }) {
  if (!round) return null;
  const order = round.result ? round.result.order : null;
  const actual = order ? order.indexOf(round.driver.id) + 1 : null;
  const team = TEAMS[round.driver.team] || {};
  const byPos = {};
  Object.entries(picks || {}).forEach(([pid, p]) => { (byPos[p.pos] = byPos[p.pos] || []).push(pid); });
  const entries = Object.entries(picks || {});

  return (
    <Sheet title={round.flag + " " + round.name} onClose={onClose}>
      <DriverCard driver={round.driver} sub={actual ? "finished " + ordinal(actual) : "result pending"} />
      {!order ? (
        <div className="meta" style={{ marginTop: 18 }}>
          No result yet. An organiser can pull it in from Settings once the race has finished.
        </div>
      ) : (
        <>
          <h3 style={{ margin: "22px 0 4px" }}>How everyone called it</h3>
          <div className="meta" style={{ marginBottom: 6 }}>{round.driver.last} finished {ordinal(actual)}.</div>
          {entries.length === 0 && <div className="meta">Nobody called this round.</div>}
          {entries.map(([pid, p]) => [pid, p, scoreFor(p.pos, actual, scoring)])
            .sort((a, b) => b[2] - a[2])
            .map(([pid, p, pts]) => {
              const pl = players[pid];
              if (!pl) return null;
              const off = Math.abs(p.pos - actual);
              return (
                <div key={pid} className={"trow" + (me && pid === me.id ? " me" : "")} style={{ marginLeft: -16, marginRight: -16 }}>
                  <div className="tp" style={{ color: off === 0 ? "var(--go)" : undefined }}>{p.pos}</div>
                  <div className="row">
                    <Avatar player={pl} />
                    <div className="stack">
                      <div>{pl.name}</div>
                      <div className="tiny">{off === 0 ? "spot on" : off + (off === 1 ? " place out" : " places out")}</div>
                    </div>
                  </div>
                  <div className="num" style={{ fontSize: 20 }}>+{pts}</div>
                </div>
              );
            })}
          <h3 style={{ margin: "26px 0 8px" }}>Final classification</h3>
          <div style={{ marginLeft: -16, marginRight: -16 }}>
            {order.map((did, i) => {
              const d = drivers.find((x) => x.id === did);
              if (!d) return null;
              const t = TEAMS[d.team] || {};
              const isDrawn = did === round.driver.id;
              const callers = (byPos[i + 1] || []).map((pid) => players[pid]).filter(Boolean);
              return (
                <div key={did} className="trow" style={{ background: isDrawn ? "var(--raise)" : undefined }}>
                  <div className="tp" style={{ color: isDrawn ? team.color : undefined }}>{i + 1}</div>
                  <div className="row" style={{ minWidth: 0 }}>
                    <div style={{ width: 3, height: 22, background: t.color, borderRadius: 2, flex: "none" }} />
                    <div className="stack" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: isDrawn ? 600 : 400 }}>{d.last}</div>
                      <div className="tiny">{t.name}</div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 3 }}>
                    {callers.slice(0, 4).map((pl, k) => <Avatar key={k} player={pl} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ===================== profile ===================== */

function resizePhoto(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = 160;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160);
      cb(c.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = () => cb(null);
    img.src = reader.result;
  };
  reader.onerror = () => cb(null);
  reader.readAsDataURL(file);
}


/* ===================== talking to the worker ===================== */

async function api(path, options = {}) {
  const res = await fetch("/api" + path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error((data && data.error) || "Request failed (" + res.status + ")");
  return data;
}

/* ===================== joining, signing in, your profile ===================== */

function ProfileScreen({ state, onState, onSignedOut }) {
  const me = state.me;
  const [mode, setMode] = useState("login");
  const [code, setCode] = useState("");
  const [name, setName] = useState(me ? me.name : "");
  const [password, setPassword] = useState("");
  const [photo, setPhoto] = useState(me ? me.photo : null);
  const [color, setColor] = useState(me ? me.color : AVATAR_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const fileRef = useRef(null);

  const mine = me ? state.standings.find((s) => s.id === me.id) : null;
  const rank = me ? state.standings.findIndex((s) => s.id === me.id) + 1 : 0;

  async function run(fn) {
    setErr(""); setDone(""); setBusy(true);
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const join = () => run(async () => {
    if (password.length < 8) throw new Error("Passwords need at least 8 characters.");
    await api("/auth/join", { method: "POST", body: { code, name, password, photo, color } });
    onState(await api("/state"));
    setPassword(""); setCode("");
  });

  const login = () => run(async () => {
    await api("/auth/login", { method: "POST", body: { name, password } });
    onState(await api("/state"));
    setPassword("");
  });

  const saveProfile = () => run(async () => {
    const patch = { name, photo, color };
    if (password) patch.password = password;
    onState(await api("/me", { method: "PATCH", body: patch }));
    setPassword("");
    setDone("Saved.");
  });

  const signOut = () => run(async () => {
    await api("/auth/logout", { method: "POST" });
    onSignedOut();
  });

  const photoPicker = (
    <div className="row" style={{ marginBottom: 18 }}>
      <Avatar player={{ name: name || "?", photo, color }} size="lg" />
      <div className="stack" style={{ gap: 6 }}>
        <button className="btn ghost sm" onClick={() => fileRef.current && fileRef.current.click()}>
          {photo ? "Change photo" : "Add a photo"}
        </button>
        {photo && <button className="btn ghost sm" onClick={() => setPhoto(null)}>Remove photo</button>}
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) resizePhoto(f, (d) => d && setPhoto(d)); }} />
    </div>
  );

  const colorPicker = !photo && (
    <label className="fld"><span>Badge colour</span>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {AVATAR_COLORS.map((c) => (
          <button key={c} aria-label={"Colour " + c} onClick={() => setColor(c)}
            style={{ width: 30, height: 30, borderRadius: "50%", background: c, border: color === c ? "2px solid #EAEFF6" : "2px solid transparent" }} />
        ))}
      </div>
    </label>
  );

  /* --- signed out --- */
  if (!me) {
    return (
      <div className="fade">
        <div className="pad">
          <h1>{mode === "join" ? "Join the game" : "Sign in"}</h1>
          <div className="meta" style={{ marginTop: 4 }}>
            {mode === "join" ? "You'll need the join code from whoever set this up." : "Welcome back."}
          </div>
        </div>
        <div className="pad">
          {mode === "join" && (
            <>
              {photoPicker}
              <label className="fld"><span>Join code</span>
                <input type="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
              </label>
            </>
          )}
          <label className="fld"><span>Name</span>
            <input type="text" value={name} maxLength={22} onChange={(e) => setName(e.target.value)}
              autoComplete="username" placeholder="How you show on the board" />
          </label>
          <label className="fld"><span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "join" ? "new-password" : "current-password"}
              placeholder={mode === "join" ? "At least 8 characters" : ""} />
          </label>
          {mode === "join" && colorPicker}
          {err && <div className="meta" style={{ color: "var(--stop)", marginBottom: 12 }}>{err}</div>}
          <button className="btn" disabled={busy} onClick={mode === "join" ? join : login}>
            {busy ? "Working" : mode === "join" ? "Join the game" : "Sign in"}
          </button>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => { setMode(mode === "join" ? "login" : "join"); setErr(""); }}>
            {mode === "join" ? "I already have an account" : "I'm new here"}
          </button>
        </div>
      </div>
    );
  }

  /* --- signed in --- */
  return (
    <div className="fade">
      <div className="pad"><h1>Your profile</h1></div>
      {mine && (
        <div className="panel">
          {[["Championship position", rank], ["Points", mine.pts], ["Spot on", mine.exact],
            ["Average miss", mine.avgOff == null ? "—" : mine.avgOff.toFixed(1)]].map(([label, val]) => (
            <div key={label} className="trow" style={{ gridTemplateColumns: "1fr auto" }}>
              <div className="meta">{label}</div>
              <div className="num" style={{ fontSize: 22 }}>{val}</div>
            </div>
          ))}
        </div>
      )}
      <div className="pad">
        {photoPicker}
        <label className="fld"><span>Name</span>
          <input type="text" value={name} maxLength={22} onChange={(e) => setName(e.target.value)} />
        </label>
        {colorPicker}
        <label className="fld"><span>New password</span>
          <input type="password" value={password} autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to keep the current one" />
        </label>
        {err && <div className="meta" style={{ color: "var(--stop)", marginBottom: 12 }}>{err}</div>}
        {done && <div className="meta" style={{ color: "var(--go)", marginBottom: 12 }}>{done}</div>}
        <button className="btn" disabled={busy} onClick={saveProfile}>{busy ? "Saving" : "Save changes"}</button>
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}

/* ===================== settings ===================== */

const SCORE_FIELDS = [
  ["exact", "Spot on"],
  ["off1", "One place out"],
  ["off2", "Two places out"],
  ["off3", "Three places out"],
  ["off45", "Four or five out"],
  ["off6", "Six or more out"],
  ["podium", "Podium bonus — called top three, finished top three"],
  ["points", "Points bonus — called top ten, finished top ten"],
];

function AdminScreen({ state, onState }) {
  const me = state.me;
  const [scoring, setScoring] = useState(state.scoring);
  const [startRound, setStartRound] = useState(state.startRound);
  const [elevateCode, setElevateCode] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [manual, setManual] = useState(null);
  const [manualText, setManualText] = useState("");
  const [confirming, setConfirming] = useState(null);

  function armed(key, run) {
    if (confirming === key) { setConfirming(null); run(); }
    else { setConfirming(key); setTimeout(() => setConfirming((c) => (c === key ? null : c)), 4000); }
  }

  async function run(tag, fn) {
    setBusy(tag); setErr(""); setNote("");
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(""); }
  }

  if (!me) return <Empty line="Sign in to reach the settings." />;

  if (!me.isAdmin) {
    return (
      <div className="fade pad">
        <h1>Settings</h1>
        <div className="meta" style={{ margin: "6px 0 18px" }}>
          Organisers can change the scoring and correct results. Enter the organiser code if that's you.
        </div>
        <label className="fld"><span>Organiser code</span>
          <input type="password" value={elevateCode} onChange={(e) => setElevateCode(e.target.value)} autoComplete="off" />
        </label>
        {err && <div className="meta" style={{ color: "var(--stop)", marginBottom: 12 }}>{err}</div>}
        <button className="btn" disabled={busy === "elev"} onClick={() => run("elev", async () => {
          onState(await api("/admin/elevate", { method: "POST", body: { code: elevateCode } }));
          setElevateCode("");
        })}>{busy === "elev" ? "Checking" : "Unlock settings"}</button>
      </div>
    );
  }

  const started = state.rounds.filter((r) => r.locked);

  const saveScoring = () => run("scoring", async () => {
    onState(await api("/admin/settings", { method: "POST", body: { scoring } }));
    setNote("Scoring saved. The whole season re-scored.");
  });

  const saveStart = () => run("start", async () => {
    onState(await api("/admin/settings", { method: "POST", body: { startRound } }));
    setNote("First round in play updated.");
  });

  const reshuffle = () => run("shuffle", async () => {
    onState(await api("/admin/settings", { method: "POST", body: { reshuffle: true } }));
    setNote("Drivers redrawn.");
  });

  const sync = () => run("sync", async () => {
    const r = await api("/admin/sync", { method: "POST" });
    onState(r.state);
    const got = (r.report.results || []).filter((x) => x.positions).length;
    setNote("Calendar: " + r.report.schedule + " rounds. Drivers: " + r.report.drivers + ". New results: " + got + ".");
  });

  const saveManual = () => run("manual", async () => {
    const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
    const names = manualText.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const order = [];
    const missed = [];
    names.forEach((n) => {
      const q = norm(n);
      const hit = state.drivers.find((d) => norm(d.last) === q)
        || state.drivers.find((d) => norm(d.code || "") === q)
        || state.drivers.find((d) => norm(d.last).startsWith(q))
        || state.drivers.find((d) => norm(d.first + d.last).includes(q));
      if (hit && !order.includes(hit.id)) order.push(hit.id); else missed.push(n);
    });
    if (!order.length) throw new Error("None of those names matched a driver.");
    onState(await api("/admin/result", { method: "POST", body: { round: manual, order } }));
    setNote("Saved " + order.length + " positions" + (missed.length ? ". Not recognised: " + missed.join(", ") : "."));
    setManual(null); setManualText("");
  });

  return (
    <div className="fade">
      <div className="pad"><h1>Settings</h1></div>
      {note && <div className="panel pad"><div className="meta">{note}</div></div>}
      {err && <div className="panel pad"><div className="meta" style={{ color: "var(--stop)" }}>{err}</div></div>}

      <div className="panel pad">
        <h3 style={{ marginBottom: 4 }}>Race data</h3>
        <div className="meta" style={{ marginBottom: 14 }}>
          The calendar and finished results come from the Jolpica F1 API and refresh on their own every four hours.
          This button does it now.
        </div>
        <button className="btn" disabled={busy === "sync"} onClick={sync}>
          {busy === "sync" ? "Fetching" : "Sync now"}
        </button>
      </div>

      <div className="pad">
        <h3 style={{ marginBottom: 4 }}>Points</h3>
        <div className="meta" style={{ marginBottom: 14 }}>Change these whenever. The season re-scores instantly.</div>
        {SCORE_FIELDS.map(([k, label]) => (
          <label className="fld" key={k}><span>{label}</span>
            <input type="number" value={scoring[k]} onChange={(e) => setScoring({ ...scoring, [k]: Number(e.target.value) || 0 })} />
          </label>
        ))}
        <div className="row">
          <button className="btn" disabled={busy === "scoring"} onClick={saveScoring}>
            {busy === "scoring" ? "Saving" : "Save points"}
          </button>
          <button className="btn ghost" onClick={() => setScoring(DEFAULT_SCORING)}>Reset</button>
        </div>
      </div>

      <div className="panel pad">
        <h3 style={{ marginBottom: 4 }}>Which rounds count</h3>
        <label className="fld" style={{ marginTop: 12 }}><span>Start the game at round</span>
          <select value={startRound} onChange={(e) => setStartRound(Number(e.target.value))}>
            {state.allRounds.map((r) => <option key={r.round} value={r.round}>Round {r.round} — {r.name}</option>)}
          </select>
        </label>
        <button className="btn ghost" disabled={busy === "start"} onClick={saveStart}>Save</button>
        <button className={"btn " + (confirming === "shuffle" ? "warn" : "ghost")} style={{ marginTop: 10 }}
          onClick={() => armed("shuffle", reshuffle)}>
          {confirming === "shuffle" ? "Tap again to redraw" : "Redraw the driver order"}
        </button>
        <div className="tiny" style={{ marginTop: 8 }}>
          Redrawing changes which driver belongs to which round, including rounds already run.
        </div>
      </div>

      <div className="pad">
        <h3 style={{ marginBottom: 4 }}>Corrections</h3>
        <div className="meta" style={{ marginBottom: 12 }}>
          {started.length ? "Results arrive on their own. Override one here if it's wrong or late." : "Nothing has been run yet."}
        </div>
        {started.slice().reverse().map((r) => (
          <div key={r.round} className="spread" style={{ padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
            <div className="stack" style={{ minWidth: 0 }}>
              <div>{r.flag} {r.name}</div>
              <div className="tiny">{r.result ? r.result.order.length + " positions" : "no result yet"}</div>
            </div>
            <button className="btn ghost sm" onClick={() => { setManual(r.round); setManualText(""); }}>Type it in</button>
          </div>
        ))}
      </div>

      <div className="panel pad">
        <h3 style={{ marginBottom: 4 }}>Players</h3>
        <div className="meta" style={{ marginBottom: 10 }}>{state.players.length} in the game.</div>
        {state.players.map((p) => (
          <div key={p.id} className="spread" style={{ padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
            <div className="row"><Avatar player={p} /><div>{p.name}{p.isAdmin ? " · organiser" : ""}</div></div>
            {p.id !== me.id && (
              <button className={"btn sm " + (confirming === "rm" + p.id ? "danger" : "ghost")}
                onClick={() => armed("rm" + p.id, () => run("rm", async () => {
                  onState(await api("/admin/player", { method: "DELETE", body: { id: p.id } }));
                }))}>
                {confirming === "rm" + p.id ? "Confirm" : "Remove"}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="pad">
        <h3 style={{ marginBottom: 4 }}>Start over</h3>
        <div className="meta" style={{ marginBottom: 12 }}>
          Removes every other player and every call. Results and the calendar stay.
        </div>
        <button className="btn danger" onClick={() => armed("reset", () => run("reset", async () => {
          onState(await api("/admin/reset", { method: "POST" }));
          setNote("Cleared.");
        }))}>
          {confirming === "reset" ? "Tap again to wipe it" : "Reset the season"}
        </button>
      </div>

      {manual && (
        <Sheet title="Type in a result" onClose={() => setManual(null)}>
          <div className="meta" style={{ marginBottom: 12 }}>
            Surnames in finishing order, first to last. One per line or comma separated. Retirements at the bottom.
          </div>
          <textarea rows={10} value={manualText} onChange={(e) => setManualText(e.target.value)}
            placeholder={"Verstappen\nNorris\nLeclerc"} />
          <button className="btn" style={{ marginTop: 14 }} disabled={busy === "manual"} onClick={saveManual}>Save result</button>
        </Sheet>
      )}
    </div>
  );
}

/* ===================== app ===================== */

export default function App() {
  const [st, setSt] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [fatal, setFatal] = useState("");
  const [tab, setTab] = useState("race");
  const [openRound, setOpenRound] = useState(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    const data = await api("/state");
    setSt(data);
    return data;
  }, []);

  useEffect(() => {
    load().then(() => setPhase("ready")).catch((e) => { setFatal(e.message); setPhase("error"); });
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  /* Quiet refresh so everyone sees calls and results land. */
  useEffect(() => {
    if (phase !== "ready") return;
    const t = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 25000);
    return () => clearInterval(t);
  }, [phase, load]);

  const driverById = useMemo(
    () => Object.fromEntries((st?.drivers || []).map((d) => [d.id, d])), [st]);
  const playersById = useMemo(
    () => Object.fromEntries((st?.players || []).map((p) => [p.id, p])), [st]);

  const rounds = useMemo(() => (st?.rounds || []).map((r) => {
    const locked = r.locked;
    const raw = r.picks || {};
    return {
      ...r,
      flag: ccToFlag(r.cc),
      driver: driverById[r.driverId] || null,
      result: r.result ? { order: r.result } : null,
      pickMap: locked ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, { pos: v }])) : {},
      callCount: locked ? Object.keys(raw).length : raw.count || 0,
      myPos: locked ? (st.me ? raw[st.me.id] ?? null : null) : raw.mine ?? null,
    };
  }), [st, driverById]);

  const myPicks = useMemo(() => {
    const m = {};
    rounds.forEach((r) => { if (r.myPos) m[r.round] = r.myPos; });
    return m;
  }, [rounds]);

  const activeRound = useMemo(() => rounds.find((r) => !r.result) || null, [rounds]);

  const savePick = useCallback(async (round, pos) => {
    try { setSt(await api("/pick", { method: "POST", body: { round, pos } })); return true; }
    catch (e) { alert(e.message); return false; }
  }, []);

  if (phase === "loading") {
    return <Shell><div className="pad" style={{ paddingTop: 80, textAlign: "center" }}><div className="meta">Warming up</div></div></Shell>;
  }
  if (phase === "error") {
    return <Shell><Empty line={"Couldn't reach the server. " + fatal} /></Shell>;
  }

  const needsSetup = !st.rounds.length || !st.drivers.length;
  const sheetRound = openRound != null ? rounds.find((r) => r.round === openRound) : null;
  const flagColor = !activeRound ? "var(--faint)" : activeRound.locked ? "var(--stop)" : "var(--go)";
  const flagText = !activeRound ? "Season complete"
    : activeRound.locked ? (activeRound.result ? "Result in" : "Calls locked") : "Calls open";

  const TABS = [
    ["race", "Race", "🏁"], ["board", "Board", "📊"], ["season", "Season", "🗓"],
    ["you", st.me ? "You" : "Join", "👤"], ["settings", "Settings", "⚙"],
  ];

  return (
    <Shell>
      <div className="strip">
        <span className={"dot" + (flagText === "Calls open" ? " pulse" : "")} style={{ background: flagColor }} />
        <div className="disp" style={{ fontSize: 17, letterSpacing: ".02em" }}>Grid Call</div>
        <div style={{ flex: 1 }} />
        <div className="meta">{flagText}</div>
      </div>

      {tab === "race" && (needsSetup ? (
        <Empty line="No calendar yet. An organiser needs to open Settings and press Sync now." />
      ) : (
        <RaceScreen
          round={activeRound} drivers={st.drivers} me={st.me} players={playersById}
          picks={activeRound ? activeRound.pickMap : {}}
          callCount={activeRound ? activeRound.callCount : 0}
          myPos={activeRound ? activeRound.myPos : null}
          onPick={savePick} now={now}
          onOpenRound={setOpenRound} onNeedProfile={() => setTab("you")}
        />
      ))}

      {tab === "board" && <BoardScreen standings={st.standings} players={playersById} me={st.me} rounds={rounds} />}
      {tab === "season" && <SeasonScreen rounds={rounds} me={st.me} picks={myPicks} scoring={st.scoring} onOpenRound={setOpenRound} now={now} />}
      {tab === "you" && <ProfileScreen key={st.me ? st.me.id : "anon"} state={st} onState={setSt} onSignedOut={() => load()} />}
      {tab === "settings" && <AdminScreen key={st.me ? st.me.id : "anon"} state={st} onState={setSt} />}

      {sheetRound && (
        <RoundSheet round={sheetRound} drivers={st.drivers} players={playersById}
          picks={sheetRound.pickMap} scoring={st.scoring} me={st.me}
          onClose={() => setOpenRound(null)} />
      )}

      <nav className="tabs">
        {TABS.map(([k, label, ic]) => (
          <button key={k} className={"tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)} aria-current={tab === k}>
            <span className="ic">{ic}</span>{label}
          </button>
        ))}
      </nav>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="gc">
      <style>{CSS}</style>
      <div className="wrap">{children}</div>
    </div>
  );
}
