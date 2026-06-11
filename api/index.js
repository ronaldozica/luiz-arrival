require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });

const express = require("express");
const { Redis } = require("@upstash/redis");
const app = express();

app.use(express.json());
app.use(require("cors")());

// ─── Redis Client (Upstash) ──────────────────────────────────────────────────
function getKV() {
  return new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
}

// ─── Config ───────────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const PRESET_USERS = [
  { name: "Ronaldo",    password: "rolando",   photo: "ronaldo.jpg"   },
  { name: "Jorge",      password: "jog",       photo: "jorge.jpg"     },
  { name: "Alexandre",  password: "rock",      photo: "alexandre.jpg" },
  { name: "João Paulo", password: "joaoPedro", photo: "joaopaulo.jpg" },
  { name: "Julio",      password: "julho",     photo: "julio.jpg"     },
  { name: "Pedro",      password: "pedrao",    photo: "pedro.jpg"     },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getBrasiliaDate() {
  const now = new Date();
  const offset = -3 * 60;
  const local = new Date(now.getTime() + (offset + now.getTimezoneOffset()) * 60000);
  return local;
}

function todayKey() {
  const d = getBrasiliaDate();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isWeekday(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day >= 1 && day <= 5;
}

function currentTimeMinutes() {
  const d = getBrasiliaDate();
  return d.getHours() * 60 + d.getMinutes();
}

function timeStrToMinutes(str) {
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTimeStr(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function absDiff(a, b) { return Math.abs(a - b); }
function userKey(name) { return String(name || "").trim().toLowerCase(); }

function normalizeUsers(value) {
  if (!value) return [];
  let users = value;
  if (typeof users === "string") {
    try { users = JSON.parse(users); } catch { return []; }
  }
  return Array.isArray(users)
    ? users.filter((u) => u && typeof u.name === "string" && typeof u.password === "string")
    : [];
}

const MAX_DAYS = 22;

async function getUsers(kv) {
  let extra = [];
  if (kv) {
    try { extra = normalizeUsers(await kv.get("users")); } catch { extra = []; }
  }
  const allNames = new Set(PRESET_USERS.map((u) => userKey(u.name)));
  const filtered = extra.filter((u) => !allNames.has(userKey(u.name)));
  return [...PRESET_USERS, ...filtered];
}

async function saveExtraUsers(kv, users) {
  const presetNames = new Set(PRESET_USERS.map((u) => userKey(u.name)));
  const extra = normalizeUsers(users).filter((u) => !presetNames.has(userKey(u.name)));
  await kv.set("users", extra);
}

async function getDayData(kv, dateKey) {
  if (!kv) return { guesses: [], arrival: null };
  const data = await kv.get(`day:${dateKey}`);
  return data || { guesses: [], arrival: null };
}

async function setDayData(kv, dateKey, data) {
  await kv.set(`day:${dateKey}`, data);
  let index = (await kv.get("days_index")) || [];
  if (!index.includes(dateKey)) {
    index.push(dateKey);
    index.sort();
    const weekdays = index.filter(isWeekday);
    if (weekdays.length > MAX_DAYS) {
      const toRemove = weekdays.slice(0, weekdays.length - MAX_DAYS);
      for (const k of toRemove) await kv.del(`day:${k}`);
      index = index.filter((d) => !toRemove.includes(d));
    }
    await kv.set("days_index", index);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/users
app.get("/api/users", async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    res.json(users.map((u) => ({ name: u.name, photo: u.photo || null })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/login
app.post("/api/login", async (req, res) => {
  try {
    const { name, password } = req.body;
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find(
      (u) => userKey(u.name) === userKey(name) && u.password === password
    );
    if (!user) return res.status(401).json({ error: "Nome ou senha incorretos." });
    res.json({ name: user.name, photo: user.photo || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/register
app.post("/api/register", async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) return res.status(400).json({ error: "Nome e senha são obrigatórios." });
    const kv = getKV();
    const users = await getUsers(kv);
    const exists = users.find((u) => userKey(u.name) === userKey(name));
    if (exists) return res.status(409).json({ error: "Usuário já existe." });
    const newUser = { name: name.trim(), password, photo: null };
    const presetNames = new Set(PRESET_USERS.map((u) => userKey(u.name)));
    const extra = users.filter((u) => !presetNames.has(userKey(u.name)));
    extra.push(newUser);
    await saveExtraUsers(kv, extra);
    res.json({ name: newUser.name, photo: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/today
// Query param: ?viewer=<name>&password=<pass>  (optional — used to reveal own guess)
app.get("/api/today", async (req, res) => {
  try {
    const kv = getKV();
    const key = todayKey();
    const day = await getDayData(kv, key);
    const nowMins = currentTimeMinutes();
    const cutoffMins = timeStrToMinutes("10:00");
    const bettingOpen = !day.arrival && nowMins < cutoffMins;

    // Validate viewer identity if provided
    let viewerName = null;
    const { viewer, password } = req.query;
    if (viewer && password) {
      const users = await getUsers(kv);
      const user = users.find(
        (u) => userKey(u.name) === userKey(viewer) && u.password === password
      );
      if (user) viewerName = user.name;
    }

    // Determine what guesses to expose
    // - If arrival is set (game over): show all guesses/rankings
    // - If betting open: only show viewer's own guess (hide count too — just "X já apostaram")
    // - If past 10h but no arrival yet: show count only, not guesses
    let exposedGuesses = [];
    let hiddenCount = 0;
    const viewerGuess = day.guesses.find(
      (g) => viewerName && userKey(g.name) === userKey(viewerName)
    );

    if (day.arrival) {
      // Game over — show everything
      exposedGuesses = day.guesses;
    } else if (bettingOpen) {
      // Betting phase — only own guess visible
      hiddenCount = day.guesses.filter(
        (g) => !viewerName || userKey(g.name) !== userKey(viewerName)
      ).length;
      exposedGuesses = viewerGuess ? [viewerGuess] : [];
    } else {
      // After 10h, no arrival yet — show count, not times
      hiddenCount = day.guesses.length;
      exposedGuesses = [];
    }

    // Has the viewer already guessed today?
    const viewerHasGuessed = !!viewerGuess;

    res.json({
      date: key,
      guesses: exposedGuesses,
      hiddenCount,
      viewerHasGuessed,
      viewerGuess: viewerGuess || null,
      arrival: day.arrival || null,
      rankings: day.rankings || null,
      bettingOpen,
      currentTime: minutesToTimeStr(nowMins),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/guess
app.post("/api/guess", async (req, res) => {
  try {
    const { name, password, time } = req.body;
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find(
      (u) => userKey(u.name) === userKey(name) && u.password === password
    );
    if (!user) return res.status(401).json({ error: "Nome ou senha incorretos." });

    if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: "Horário inválido." });

    const key = todayKey();
    if (!isWeekday(key))
      return res.status(400).json({ error: "Apostas só são permitidas em dias úteis." });

    const day = await getDayData(kv, key);
    const nowMins = currentTimeMinutes();

    if (day.arrival)
      return res.status(400).json({ error: "O Luiz já chegou! Apostas encerradas." });
    if (nowMins >= timeStrToMinutes("10:00"))
      return res.status(400).json({ error: "Apostas encerradas após 10h." });

    const existing = day.guesses.findIndex((g) => userKey(g.name) === userKey(name));
    if (existing >= 0) {
      // ── BLOCK re-guess: only 1 guess per person per day ──
      return res.status(409).json({ error: "Você já apostou hoje! Só é permitido um palpite por dia." });
    }

    day.guesses.push({ name: user.name, time, createdAt: new Date().toISOString() });
    await setDayData(kv, key, day);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/login
app.post("/api/admin/login", async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Senha é obrigatória." });
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Senha incorreta." });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/arrival
app.post("/api/admin/arrival", async (req, res) => {
  try {
    const { password, time, date } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Senha incorreta." });
    if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: "Horário inválido." });

    const kv = getKV();
    const key = date || todayKey();
    const day = await getDayData(kv, key);
    day.arrival = time;

    if (day.guesses.length > 0) {
      const arrivalMins = timeStrToMinutes(time);
      const ranked = day.guesses
        .map((g) => ({ ...g, diff: absDiff(timeStrToMinutes(g.time), arrivalMins) }))
        .sort((a, b) => a.diff - b.diff);
      let pos = 1;
      for (let i = 0; i < ranked.length; i++) {
        if (i > 0 && ranked[i].diff === ranked[i - 1].diff) {
          ranked[i].position = ranked[i - 1].position;
        } else {
          ranked[i].position = pos;
        }
        pos++;
      }
      day.rankings = ranked;
    } else {
      day.rankings = [];
    }

    await setDayData(kv, key, day);
    res.json({ success: true, arrival: time, rankings: day.rankings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/history
app.get("/api/history", async (req, res) => {
  try {
    const kv = getKV();
    let index = (await kv.get("days_index")) || [];
    const results = [];
    for (const dateKey of index.reverse()) {
      if (!isWeekday(dateKey)) continue;
      const day = await getDayData(kv, dateKey);
      if (day.arrival) {
        results.push({
          date: dateKey,
          arrival: day.arrival,
          rankings: day.rankings || [],
          guesses: day.guesses || [],
        });
      }
      if (results.length >= MAX_DAYS) break;
    }
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/overall-rank
app.get("/api/overall-rank", async (req, res) => {
  try {
    const kv = getKV();
    let index = (await kv.get("days_index")) || [];
    const scores = {};
    for (const dateKey of index) {
      if (!isWeekday(dateKey)) continue;
      const day = await getDayData(kv, dateKey);
      if (!day.arrival || !day.rankings) continue;
      const total = day.rankings.length;
      for (const r of day.rankings) {
        if (!scores[r.name]) scores[r.name] = { name: r.name, points: 0, wins: 0, days: 0, totalDiff: 0 };
        scores[r.name].points   += total - r.position + 1;
        scores[r.name].totalDiff += r.diff;
        scores[r.name].days     += 1;
        if (r.position === 1) scores[r.name].wins += 1;
      }
    }
    const ranked = Object.values(scores)
      .map((s) => ({ ...s, avgDiffMins: s.days > 0 ? Math.round(s.totalDiff / s.days) : 0 }))
      .sort((a, b) => b.points - a.points || a.avgDiffMins - b.avgDiffMins);
    res.json(ranked);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Export for Vercel ────────────────────────────────────────────────────────
module.exports = app;
