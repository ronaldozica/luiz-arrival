const express = require("express");
const { Redis } = require("@upstash/redis");
const app = express();

app.use(express.json());
app.use(require("cors")());

// ─── Redis Client (Upstash) ──────────────────────────────────────────────────
function getKV() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

// ─── Config ───────────────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const PRESET_USERS = [
  { name: "Ronaldo", password: "rolando", photo: "ronaldo.jpg" },
  { name: "Jorge", password: "jog", photo: "jorge.jpg" },
  { name: "Alexandre", password: "rock", photo: "alexandre.jpg" },
  { name: "João Paulo", password: "joaoPedro", photo: "joaopaulo.jpg" },
  { name: "Julio", password: "julho", photo: "julio.jpg" },
  { name: "Pedro", password: "pedrao", photo: "pedro.jpg" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getBrasiliaDate() {
  // UTC-3
  const now = new Date();
  const offset = -3 * 60;
  const local = new Date(now.getTime() + (offset + now.getTimezoneOffset()) * 60000);
  return local;
}

function todayKey() {
  const d = getBrasiliaDate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
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

function absDiff(a, b) {
  return Math.abs(a - b);
}

// Keep only last ~22 business days (≈ 1 month)
const MAX_DAYS = 22;

async function getUsers(kv) {
  const stored = await kv.get("users");
  const extra = stored ? stored : [];
  // Merge preset + extra (extra can override if same name — won't happen in practice)
  const allNames = new Set(PRESET_USERS.map((u) => u.name.toLowerCase()));
  const filtered = extra.filter((u) => !allNames.has(u.name.toLowerCase()));
  return [...PRESET_USERS, ...filtered];
}

async function saveExtraUsers(kv, users) {
  // Only save non-preset users
  const presetNames = new Set(PRESET_USERS.map((u) => u.name.toLowerCase()));
  const extra = users.filter((u) => !presetNames.has(u.name.toLowerCase()));
  await kv.set("users", extra);
}

async function getDayData(kv, dateKey) {
  const data = await kv.get(`day:${dateKey}`);
  return data || { guesses: [], arrival: null };
}

async function setDayData(kv, dateKey, data) {
  await kv.set(`day:${dateKey}`, data);

  // Maintain index of all day keys
  let index = (await kv.get("days_index")) || [];
  if (!index.includes(dateKey)) {
    index.push(dateKey);
    index.sort();
    // Keep only last MAX_DAYS weekdays
    const weekdays = index.filter(isWeekday);
    if (weekdays.length > MAX_DAYS) {
      const toRemove = weekdays.slice(0, weekdays.length - MAX_DAYS);
      for (const k of toRemove) {
        await kv.del(`day:${k}`);
      }
      index = index.filter((d) => !toRemove.includes(d));
    }
    await kv.set("days_index", index);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/users — list users (names + photo filenames, no passwords)
app.get("/api/users", async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    res.json(users.map((u) => ({ name: u.name, photo: u.photo || null })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/login — validate user credentials
app.post("/api/login", async (req, res) => {
  try {
    const { name, password } = req.body;
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find(
      (u) => u.name.toLowerCase() === name.toLowerCase() && u.password === password
    );
    if (!user) return res.status(401).json({ error: "Nome ou senha incorretos." });
    res.json({ name: user.name, photo: user.photo || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/register — create new user
app.post("/api/register", async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) return res.status(400).json({ error: "Nome e senha são obrigatórios." });

    const kv = getKV();
    const users = await getUsers(kv);
    const exists = users.find((u) => u.name.toLowerCase() === name.toLowerCase());
    if (exists) return res.status(409).json({ error: "Usuário já existe." });

    const newUser = { name: name.trim(), password, photo: null };
    const presetNames = new Set(PRESET_USERS.map((u) => u.name.toLowerCase()));
    const extra = users.filter((u) => !presetNames.has(u.name.toLowerCase()));
    extra.push(newUser);
    await saveExtraUsers(kv, extra);

    res.json({ name: newUser.name, photo: null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/today — get today's status (guesses + arrival, if set)
app.get("/api/today", async (req, res) => {
  try {
    const kv = getKV();
    const key = todayKey();
    const day = await getDayData(kv, key);
    const nowMins = currentTimeMinutes();
    const cutoffMins = timeStrToMinutes("10:00");

    // Betting is open if before 10h AND Luiz hasn't arrived
    const bettingOpen = !day.arrival && nowMins < cutoffMins;

    res.json({
      date: key,
      guesses: day.guesses,
      arrival: day.arrival || null,
      bettingOpen,
      currentTime: minutesToTimeStr(nowMins),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/guess — submit a guess
app.post("/api/guess", async (req, res) => {
  try {
    const { name, password, time } = req.body;

    // Validate user
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find(
      (u) => u.name.toLowerCase() === name.toLowerCase() && u.password === password
    );
    if (!user) return res.status(401).json({ error: "Nome ou senha incorretos." });

    // Validate time format HH:MM
    if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: "Horário inválido." });

    const key = todayKey();

    // Check it's a weekday
    if (!isWeekday(key))
      return res.status(400).json({ error: "Apostas só são permitidas em dias úteis." });

    const day = await getDayData(kv, key);

    // Check betting is still open
    const nowMins = currentTimeMinutes();
    if (day.arrival)
      return res.status(400).json({ error: "O Luiz já chegou! Apostas encerradas." });
    if (nowMins >= timeStrToMinutes("10:00"))
      return res.status(400).json({ error: "Apostas encerradas após 10h." });

    // Check for duplicate guess from same user today
    const existing = day.guesses.findIndex((g) => g.name.toLowerCase() === name.toLowerCase());
    if (existing >= 0) {
      // Update existing guess
      day.guesses[existing].time = time;
      day.guesses[existing].updatedAt = new Date().toISOString();
    } else {
      day.guesses.push({ name: user.name, time, createdAt: new Date().toISOString() });
    }

    await setDayData(kv, key, day);
    res.json({ success: true, guesses: day.guesses });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/arrival — set Luiz's arrival time (admin only)
app.post("/api/admin/arrival", async (req, res) => {
  try {
    const { password, time, date } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Senha incorreta." });

    if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: "Horário inválido." });

    const kv = getKV();
    const key = date || todayKey();
    const day = await getDayData(kv, key);

    day.arrival = time;

    // Calculate rankings
    if (day.guesses.length > 0) {
      const arrivalMins = timeStrToMinutes(time);
      const ranked = day.guesses
        .map((g) => ({
          ...g,
          diff: absDiff(timeStrToMinutes(g.time), arrivalMins),
        }))
        .sort((a, b) => a.diff - b.diff);

      // Assign positions (handle ties)
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/history — list past days with results
app.get("/api/history", async (req, res) => {
  try {
    const kv = getKV();
    let index = (await kv.get("days_index")) || [];

    // Only weekdays with arrival set
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/overall-rank — cumulative ranking across all stored days
app.get("/api/overall-rank", async (req, res) => {
  try {
    const kv = getKV();
    let index = (await kv.get("days_index")) || [];

    const scores = {}; // name -> { points, wins, days }

    for (const dateKey of index) {
      if (!isWeekday(dateKey)) continue;
      const day = await getDayData(kv, dateKey);
      if (!day.arrival || !day.rankings) continue;

      const total = day.rankings.length;
      for (const r of day.rankings) {
        if (!scores[r.name]) scores[r.name] = { name: r.name, points: 0, wins: 0, days: 0, avgDiffMins: 0, totalDiff: 0 };
        // Points: reverse rank (1st gets most points)
        const pts = total - r.position + 1;
        scores[r.name].points += pts;
        scores[r.name].totalDiff += r.diff;
        scores[r.name].days += 1;
        if (r.position === 1) scores[r.name].wins += 1;
      }
    }

    const ranked = Object.values(scores)
      .map((s) => ({ ...s, avgDiffMins: s.days > 0 ? Math.round(s.totalDiff / s.days) : 0 }))
      .sort((a, b) => b.points - a.points || a.avgDiffMins - b.avgDiffMins);

    res.json(ranked);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Export for Vercel ────────────────────────────────────────────────────────
module.exports = app;
