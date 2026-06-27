require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env.local"),
});

const express = require("express");
const { Redis } = require("@upstash/redis");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
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
// A senha de admin deve ser forte e definida via variável de ambiente.
// Exemplo: ADMIN_PASSWORD=xK#9mP!vQ2rL@nZ
// Nunca use "admin123" ou qualquer senha fraca em produção.
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
if (!ADMIN_PASSWORD_HASH) {
  console.warn(
    "[AVISO] ADMIN_PASSWORD_HASH não definida no .env.local. " +
    "Gere com: node -e \"const b=require('bcryptjs'); console.log(b.hashSync(process.env.ADMIN_PW, 12))\" ADMIN_PW=suaSenhaForte"
  );
}

// ─── Session tokens ──────────────────────────────────────────────────────────
// Tokens de sessão persistidos no Redis para suportar execução serverless.
// Sessões são permanentes: só são removidas no logout explícito.
const SESSION_PREFIX = "session:";
const ADMIN_SESSION_KEY = "admin_session";
const ADMIN_SESSION_EXPIRY_KEY = "admin_session_expiry";

async function createUserSession(kv, name) {
  const token = crypto.randomBytes(32).toString("hex");
  const session = { name };
  await kv.set(`${SESSION_PREFIX}${token}`, JSON.stringify(session));
  console.log("[SESSION CREATE]", token, session);
  return token;
}

async function resolveUserSession(kv, token) {
  if (!token) {
    console.log("[SESSION RESOLVE] missing token");
    return null;
  }
  const raw = await kv.get(`${SESSION_PREFIX}${token}`);
  console.log("[SESSION RESOLVE] raw", token, raw);
  if (!raw) return null;
  let session;
  try {
    session = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    console.log("[SESSION RESOLVE] invalid session payload", error);
    return null;
  }
  if (!session) return null;
  return session.name;
}

async function setAdminSession(kv, token, expiresAt) {
  await kv.set(ADMIN_SESSION_KEY, token);
  await kv.set(ADMIN_SESSION_EXPIRY_KEY, String(expiresAt));
}

async function resolveAdminSession(kv, token) {
  if (!token) return false;
  const storedToken = await kv.get(ADMIN_SESSION_KEY);
  const expiry = Number(await kv.get(ADMIN_SESSION_EXPIRY_KEY));
  return token === storedToken && Number.isFinite(expiry) && Date.now() <= expiry;
}

// Extrai o token do header Authorization: Bearer <token>
function getBearerToken(req) {
  const auth = req.headers["authorization"] || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getBrasiliaDate() {
  const now = new Date();
  const offset = -3 * 60;
  const local = new Date(
    now.getTime() + (offset + now.getTimezoneOffset()) * 60000,
  );
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

function userKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

function normalizeUsers(value) {
  if (!value) return [];
  let users = value;
  if (typeof users === "string") {
    try {
      users = JSON.parse(users);
    } catch {
      return [];
    }
  }
  // A partir de agora, os usuários têm passwordHash em vez de password
  return Array.isArray(users)
    ? users.filter(
        (u) =>
          u && typeof u.name === "string" && (typeof u.passwordHash === "string" || typeof u.password === "string"),
      )
    : [];
}

function parseRedisNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function parseRedisArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value ? [value] : [];
    }
  }
  return [];
}

const MAX_DAYS = 22;

// ─── Gestão de usuários (sem PRESET_USERS hardcoded) ─────────────────────────
// Os usuários HCM agora são definidos pelo campo isHCM=true no banco (Redis),
// gerenciado pelo admin via /api/admin/users. Não há mais usuários hardcoded.

async function getUsers(kv) {
  try {
    const value = await kv.get("users");
    return normalizeUsers(value);
  } catch {
    return [];
  }
}

async function saveUsers(kv, users) {
  // Nunca salva a senha em texto plano — apenas passwordHash
  const sanitized = users.map(({ password, ...rest }) => rest);
  await kv.set("users", sanitized);
  await invalidateCache(kv, "cache:overall_rank", "cache:profiles");
}

// ─── Cache de leituras pesadas ────────────────────────────────────────────────
// Os endpoints de ranking/histórico/perfis fazem fan-out (1 leitura por dia ou
// por usuário). Para não estourar o limite de comandos do plano gratuito do
// Redis, o resultado computado é guardado sob uma única chave e só é
// recalculado quando os dados de origem mudam (ver invalidateCache nos pontos
// de escrita: setDayData, saveUsers e as rotas de perfil).
async function getCachedOrCompute(kv, cacheKey, computeFn) {
  const cached = await kv.get(cacheKey);
  if (cached !== null && cached !== undefined) return cached;
  const value = await computeFn();
  await kv.set(cacheKey, value);
  return value;
}

async function invalidateCache(kv, ...keys) {
  if (keys.length) await kv.del(...keys);
}

// Verifica a senha de um usuário comparando com o hash armazenado.
// Suporta migração: se o usuário ainda tem 'password' em texto plano (legado),
// verifica em texto plano, depois migra para hash automaticamente.
async function verifyUserPassword(kv, user, plainPassword) {
  if (user.passwordHash) {
    return bcrypt.compare(plainPassword, user.passwordHash);
  }
  // Migração legada: usuário tem password em texto plano
  if (user.password && user.password === plainPassword) {
    // Migra para hash automaticamente
    const hash = await bcrypt.hash(plainPassword, 12);
    const allUsers = await getUsers(kv);
    const idx = allUsers.findIndex((u) => userKey(u.name) === userKey(user.name));
    if (idx >= 0) {
      allUsers[idx].passwordHash = hash;
      delete allUsers[idx].password;
      await saveUsers(kv, allUsers);
    }
    return true;
  }
  return false;
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
  await invalidateCache(kv, "cache:history", "cache:overall_rank");
}

function getNextWeekdayStr() {
  const d = getBrasiliaDate();
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ─── Middleware de autenticação ───────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  const kv = getKV();
  const name = await resolveUserSession(kv, token);

  if (!name) return res.status(401).json({ error: "Sessão inválida ou expirada. Faça login novamente." });
  req.sessionName = name;
  next();
}

async function requireAdminAuth(req, res, next) {
  const token = getBearerToken(req);
  const kv = getKV();
  const valid = await resolveAdminSession(kv, token);
  if (!valid) {
    return res.status(401).json({ error: "Acesso de admin negado." });
  }
  next();
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/users — retorna apenas nome e isHCM (sem senha)
app.get("/api/users", async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    res.json(
      users.map((u) => ({
        name: u.name,
        isHCM: !!u.isHCM,
      })),
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/login — retorna um token de sessão em vez de repassar a senha
app.post("/api/login", async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password)
      return res.status(400).json({ error: "Nome e senha são obrigatórios." });

    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(name));
    if (!user) return res.status(401).json({ error: "Nome ou senha incorretos." });

    const valid = await verifyUserPassword(kv, user, password);
    if (!valid) return res.status(401).json({ error: "Nome ou senha incorretos." });

    const token = await createUserSession(kv, user.name);
    res.json({
      token,
      name: user.name,
      isHCM: !!user.isHCM,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/logout
app.post("/api/logout", async (req, res) => {
  const token = getBearerToken(req);
  if (token) {
    const kv = getKV();
    await kv.del(`${SESSION_PREFIX}${token}`);
  }
  res.json({ success: true });
});

// POST /api/register
app.post("/api/register", async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password)
      return res.status(400).json({ error: "Nome e senha são obrigatórios." });

    const kv = getKV();
    const users = await getUsers(kv);
    const exists = users.find((u) => userKey(u.name) === userKey(name));
    if (exists) return res.status(409).json({ error: "Usuário já existe." });

    const passwordHash = await bcrypt.hash(password, 12);
    const newUser = { name: name.trim(), passwordHash, isHCM: false };
    users.push(newUser);
    await saveUsers(kv, users);

    const coinsKey = `gamecoins:${userKey(newUser.name)}`;
    await kv.set(coinsKey, String(125));

    res.json({ success: true, name: newUser.name, isHCM: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/today
app.get("/api/today", async (req, res) => {
  try {
    const kv = getKV();
    const key = todayKey();
    const todayDay = await getDayData(kv, key);
    const nowMins = currentTimeMinutes();
    const cutoffMins = timeStrToMinutes("10:00");

    let activeBetDate = key;
    if (!isWeekday(key) || todayDay.arrival || nowMins >= cutoffMins) {
      activeBetDate = getNextWeekdayStr();
    }

    const isNextDay = activeBetDate !== key;
    const targetDate = activeBetDate;
    const targetDayData = isNextDay ? await getDayData(kv, targetDate) : todayDay;

    // Identifica o viewer pelo token de sessão
    let viewerName = null;
    const token = getBearerToken(req);
    if (token) {
      const kv = getKV();
      viewerName = await resolveUserSession(kv, token) || null;
    }

    const targetViewerGuess = targetDayData.guesses.find(
      (g) => viewerName && userKey(g.name) === userKey(viewerName)
    );

    let exposedGuesses = [];
    let hiddenCount = 0;

    if (targetViewerGuess) {
      exposedGuesses = targetDayData.guesses;
    } else if (isNextDay) {
      hiddenCount = targetDayData.guesses.filter(
        (g) => !viewerName || userKey(g.name) !== userKey(viewerName)
      ).length;
      exposedGuesses = [];
    } else {
      const bettingOpenForToday = !todayDay.arrival && nowMins < cutoffMins && isWeekday(key);
      if (todayDay.arrival) {
        exposedGuesses = todayDay.guesses;
      } else if (bettingOpenForToday) {
        hiddenCount = todayDay.guesses.filter(
          (g) => !viewerName || userKey(g.name) !== userKey(viewerName)
        ).length;
        exposedGuesses = [];
      } else {
        hiddenCount = todayDay.guesses.length;
        exposedGuesses = [];
      }
    }

    res.json({
      date: key,
      displayDate: targetDate,
      guesses: exposedGuesses,
      hiddenCount,
      arrival: isNextDay ? null : (todayDay.arrival || null),
      rankings: isNextDay ? null : (todayDay.rankings || null),
      currentTime: minutesToTimeStr(nowMins),
      activeBetDate,
      viewerHasGuessed: !!targetViewerGuess,
      viewerGuess: targetViewerGuess || null,
      bettingOpen: true
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/guess — requer sessão válida
app.post("/api/guess", requireAuth, async (req, res) => {
  try {
    const { time } = req.body;
    const name = req.sessionName;

    if (!time) {
      return res.status(400).json({ error: "Campo 'time' é obrigatório." });
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return res.status(400).json({ error: "Formato de hora inválido. Use HH:MM." });
    }

    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(name));
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado." });
    }

    let activeBetDate = todayKey();
    const todayDay = await getDayData(kv, activeBetDate);
    const nowMins = currentTimeMinutes();

    if (!isWeekday(activeBetDate) || todayDay.arrival || nowMins >= timeStrToMinutes("10:00")) {
      activeBetDate = getNextWeekdayStr();
    }

    const day = await getDayData(kv, activeBetDate);

    if (day.arrival) {
      return res.status(400).json({ error: "Apostas já foram encerradas para este dia." });
    }

    if (activeBetDate === todayKey() && nowMins >= timeStrToMinutes("10:00")) {
      return res.status(400).json({ error: "Apostas encerradas após 10h." });
    }

    const existing = day.guesses.findIndex(g => userKey(g.name) === userKey(name));
    if (existing >= 0) {
      return res.status(409).json({
        error: "Você já apostou! Só é permitido um palpite por dia.",
      });
    }

    day.guesses.push({
      name: user.name,
      time,
      createdAt: new Date().toISOString(),
    });

    await setDayData(kv, activeBetDate, day);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/login — autentica com bcrypt e retorna token de admin
app.post("/api/admin/login", async (req, res) => {
  try {
    const { password } = req.body;
    if (!password)
      return res.status(400).json({ error: "Senha é obrigatória." });

    if (!ADMIN_PASSWORD_HASH) {
      return res.status(500).json({ error: "Senha de admin não configurada no servidor." });
    }

    const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!valid)
      return res.status(401).json({ error: "Senha incorreta." });

    // Gera um token de sessão de admin com expiração de 4 horas
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 4 * 60 * 60 * 1000;
    const kv = getKV();
    await setAdminSession(kv, token, expiresAt);

    res.json({ success: true, token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/arrival — requer token de admin
app.post("/api/admin/arrival", requireAdminAuth, async (req, res) => {
  try {
    const { time, date } = req.body;
    if (!/^\d{2}:\d{2}$/.test(time))
      return res.status(400).json({ error: "Horário inválido." });

    const kv = getKV();
    const key = date || todayKey();
    const day = await getDayData(kv, key);
    day.arrival = time;

    if (day.guesses.length > 0) {
      const arrivalMins = timeStrToMinutes(time);
      const ranked = day.guesses
        .map((g) => ({
          ...g,
          diff: absDiff(timeStrToMinutes(g.time), arrivalMins),
        }))
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

    // Auto-unlock bet_winner achievement for 1st place winner(s)
    if (day.rankings && day.rankings.length > 0) {
      const winners = day.rankings.filter((r) => r.position === 1);
      for (const winner of winners) {
        const unlockedKey = `achievements:${userKey(winner.name)}`;
        const unlocked = parseRedisArray(await kv.get(unlockedKey));
        if (!unlocked.includes("bet_winner")) {
          unlocked.push("bet_winner");
          await kv.set(unlockedKey, JSON.stringify(unlocked));
        }
      }
    }

    res.json({ success: true, arrival: time, rankings: day.rankings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/users — lista todos os usuários (admin only, sem hashes)
app.get("/api/admin/users", requireAdminAuth, async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    res.json(users.map(({ passwordHash, password, ...rest }) => rest));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/users — cria ou atualiza um usuário (admin only)
// Body: { name, password?, isHCM? }
// Se password não vier, mantém o hash existente.
app.post("/api/admin/users", requireAdminAuth, async (req, res) => {
  try {
    const { name, password, isHCM } = req.body;
    if (!name) return res.status(400).json({ error: "Nome é obrigatório." });

    const kv = getKV();
    const users = await getUsers(kv);
    const idx = users.findIndex((u) => userKey(u.name) === userKey(name));

    if (idx >= 0) {
      // Atualiza usuário existente
      if (typeof isHCM === "boolean") users[idx].isHCM = isHCM;
      if (password) {
        users[idx].passwordHash = await bcrypt.hash(password, 12);
        delete users[idx].password;
      }
    } else {
      // Cria novo usuário
      if (!password) return res.status(400).json({ error: "Senha obrigatória para novo usuário." });
      const passwordHash = await bcrypt.hash(password, 12);
      users.push({ name: name.trim(), passwordHash, isHCM: !!isHCM });
    }

    await saveUsers(kv, users);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/coins/adjust — adiciona ou remove luizCoins de um jogador (admin only)
// Body: { name, amount } — amount pode ser negativo para remover moedas.
app.post("/api/admin/coins/adjust", requireAdminAuth, async (req, res) => {
  try {
    const { name, amount } = req.body;
    const amountNum = Number(amount);
    if (!name || !Number.isFinite(amountNum) || amountNum === 0) {
      return res.status(400).json({ error: "name e amount (≠ 0) são obrigatórios." });
    }

    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(name));
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    const coinsKey = `gamecoins:${userKey(user.name)}`;
    const currentCoins = parseRedisNumber(await kv.get(coinsKey));
    const newCoins = Math.max(0, currentCoins + amountNum);
    await kv.set(coinsKey, String(newCoins));

    res.json({ success: true, gameCoins: newCoins });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/users/:name — remove um usuário (admin only)
app.delete("/api/admin/users/:name", requireAdminAuth, async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    const filtered = users.filter((u) => userKey(u.name) !== userKey(req.params.name));
    if (filtered.length === users.length)
      return res.status(404).json({ error: "Usuário não encontrado." });
    await saveUsers(kv, filtered);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/history
app.get("/api/history", async (req, res) => {
  try {
    const kv = getKV();
    const results = await getCachedOrCompute(kv, "cache:history", async () => {
      let index = (await kv.get("days_index")) || [];
      const computed = [];
      for (const dateKey of index.reverse()) {
        if (!isWeekday(dateKey)) continue;
        const day = await getDayData(kv, dateKey);
        if (day.arrival) {
          computed.push({
            date: dateKey,
            arrival: day.arrival,
            rankings: day.rankings || [],
            guesses: day.guesses || [],
          });
        }
        if (computed.length >= MAX_DAYS) break;
      }
      return computed;
    });
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/overall-rank
app.get("/api/overall-rank", async (req, res) => {
  try {
    const kv = getKV();
    const ranked = await getCachedOrCompute(kv, "cache:overall_rank", async () => {
      let index = (await kv.get("days_index")) || [];
      const scores = {};
      const users = await getUsers(kv);
      const hcmNames = new Set(
        users.filter((u) => u.isHCM).map((u) => userKey(u.name)),
      );

      for (const dateKey of index) {
        if (!isWeekday(dateKey)) continue;
        const day = await getDayData(kv, dateKey);
        if (!day.arrival || !day.rankings) continue;
        const total = day.rankings.length;
        for (const r of day.rankings) {
          const key = r.name;
          if (!scores[key])
            scores[key] = {
              name: r.name,
              points: 0,
              wins: 0,
              days: 0,
              totalDiff: 0,
              isHCM: hcmNames.has(userKey(r.name)),
            };
          scores[key].points += total - r.position + 1;
          scores[key].totalDiff += r.diff;
          scores[key].days += 1;
          if (r.position === 1) scores[key].wins += 1;
        }
      }
      return Object.values(scores)
        .map((s) => ({
          ...s,
          avgDiffMins: s.days > 0 ? Math.round(s.totalDiff / s.days) : 0,
        }))
        .sort((a, b) => b.points - a.points || a.avgDiffMins - b.avgDiffMins);
    });
    res.json(ranked);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/session-check — verifica se o token de sessão atual ainda é válido
app.get("/api/session-check", requireAuth, async (req, res) => {
  res.json({ valid: true });
});

// GET /api/game-rank
app.get("/api/game-rank", async (req, res) => {
  try {
    const { game, difficulty } = req.query;
    if (!game) return res.status(400).json({ error: "game é obrigatório." });
    const rankKey = difficulty
      ? `gamerank:${game}:${difficulty}`
      : `gamerank:${game}`;
    const kv = getKV();
    const scores = (await kv.get(rankKey)) || [];
    res.json(scores);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/game-rank/delete — remove o recorde de um jogador (anti-trapaça)
// Funciona para qualquer jogo (game[:difficulty]) presente ou futuro.
app.post("/api/admin/game-rank/delete", requireAdminAuth, async (req, res) => {
  try {
    const { game, difficulty, name } = req.body;
    if (!game || !name) {
      return res.status(400).json({ error: "game e name são obrigatórios." });
    }
    const rankKey = difficulty
      ? `gamerank:${game}:${difficulty}`
      : `gamerank:${game}`;
    const kv = getKV();
    let scores = (await kv.get(rankKey)) || [];
    scores = scores.filter(
      (s) => String(s.name).toLowerCase() !== String(name).toLowerCase(),
    );
    await kv.set(rankKey, scores);
    res.json({ success: true, rank: scores });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/game-rank — requer sessão válida; playerName vem do token, não do body
// Proteção contra burla: o servidor ignora qualquer playerName enviado pelo cliente.
// O score é validado contra limites razoáveis por jogo.
app.post("/api/game-rank", requireAuth, async (req, res) => {
  try {
    const { game, difficulty, score, skipRank } = req.body;
    const playerName = req.sessionName; // Sempre do token de sessão, nunca do body

    if (!game || score === undefined) {
      return res
        .status(400)
        .json({ error: "game e score são obrigatórios." });
    }

    // ─── Validação de score ────────────────────────────────────────────────────
    // Limites máximos físicos por jogo para bloquear scores impossíveis.
    const scoreNum = Number(score);
    if (!Number.isFinite(scoreNum) || scoreNum < 0) {
      return res.status(400).json({ error: "Score inválido." });
    }

    const SCORE_LIMITS = {
      snake: 99999,           // Snake: fisicamente impossível passar disso
      minesweeper: 9999,      // Minesweeper: score = 9999 - tempo(s), só enviado ao vencer
    };

    const maxScore = SCORE_LIMITS[game];
    if (maxScore !== undefined && scoreNum > maxScore) {
      return res.status(400).json({ error: "Score fora dos limites permitidos." });
    }

    // Valida difficulty para minesweeper
    const validDifficulties = ["beginner", "intermediate", "expert"];
    if (game === "minesweeper" && difficulty && !validDifficulties.includes(difficulty)) {
      return res.status(400).json({ error: "Dificuldade inválida." });
    }

    const rankKey = difficulty
      ? `gamerank:${game}:${difficulty}`
      : `gamerank:${game}`;
    const kv = getKV();
    let scores = (await kv.get(rankKey)) || [];

    if (!skipRank) {
      scores = scores.filter(
        (s) =>
          String(s.name).toLowerCase() !== String(playerName).toLowerCase(),
      );
      scores.push({ name: playerName, score: scoreNum, date: new Date().toISOString() });
      scores.sort((a, b) => b.score - a.score);
      scores = scores.slice(0, 10);
      await kv.set(rankKey, scores);
    }

    // ─── AWARD COINS BASED ON GAME PERFORMANCE ───
    let coinsEarned = 0;
    if (game === "snake") {
      coinsEarned = Math.floor(scoreNum / 100) * 5;
      if (scoreNum >= 250) coinsEarned += 10;
      if (scoreNum >= 500) coinsEarned += 10;
    } else if (game === "minesweeper") {
      // O score só é enviado quando o jogador vence a partida
      if (difficulty === "expert") coinsEarned = 25;
      else if (difficulty === "intermediate") coinsEarned = 10;
      else if (difficulty === "beginner") coinsEarned = 1;
    }

    if (coinsEarned > 0) {
      const coinsKey = `gamecoins:${userKey(playerName)}`;
      const existingCoins = Number(await kv.get(coinsKey));
      const totalCoins =
        (Number.isFinite(existingCoins) ? existingCoins : 0) + coinsEarned;
      await kv.set(coinsKey, String(totalCoins));
    }

    // ─── AWARD ACHIEVEMENTS ───
    const achUnlockedKey = `achievements:${userKey(playerName)}`;
    const achUnlocked = parseRedisArray(await kv.get(achUnlockedKey));
    let newAchievements = [];

    if (game === "snake" && scoreNum > 500 && !achUnlocked.includes("snake_500")) {
      achUnlocked.push("snake_500");
      newAchievements.push("snake_500");
    }
    if (game === "minesweeper") {
      const achId =
        difficulty === "beginner"
          ? "minesweeper_beginner"
          : difficulty === "intermediate"
            ? "minesweeper_intermediate"
            : difficulty === "expert"
              ? "minesweeper_expert"
              : null;
      if (achId && !achUnlocked.includes(achId)) {
        achUnlocked.push(achId);
        newAchievements.push(achId);
      }
    }
    if (newAchievements.length > 0) {
      await kv.set(achUnlockedKey, JSON.stringify(achUnlocked));
    }

    res.json({ success: true, rank: scores, coinsEarned, newAchievements });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Loja de Prêmios ─────────────────────────────────────────────────────────
const STORE_ITEMS = [
  { id: "palinha", price: 10, src: "/photos/palinha.gif", title: "Luiz dando uma palinha" },
  { id: "baixista", price: 10, src: "/photos/baixista.gif", title: "Luiz Fernando baixista" },
  { id: "confusp", price: 25, src: "/photos/confuso.gif", title: "Luiz confuso" },
  { id: "color_esmeralda", price: 100, type: "namecolor", color: "#00c853", title: "Esmeralda" },
  { id: "color_rubi", price: 250, type: "namecolor", color: "#e53935", title: "Rubi" },
  { id: "color_dourado", price: 1000, type: "namecolor", color: "#ffd600", title: "Dourada" },
  { id: "color_diamante", price: 10000, type: "namecolor", color: "#b3e5fc", title: "Diamante" },
];

// ─── Emoji de ranking (compra livre, não é um item fixo da loja) ────────────
const EMOJI_PRICE = 500;
const EMOJI_MAX_OWNED = 3;
// Aceita um único emoji (incluindo sequências com ZWJ/seletor de variação/modificador de tom de pele) ou uma bandeira (par de Regional Indicator).
const ZWJ = "‍";
const VS16 = "️";
const EMOJI_REGEX = new RegExp(
  "^(?:\\p{Regional_Indicator}{2}|\\p{Extended_Pictographic}" + VS16 + "?\\p{Emoji_Modifier}?(?:" + ZWJ + "\\p{Extended_Pictographic}" + VS16 + "?\\p{Emoji_Modifier}?)*)$",
  "u"
);

async function calcBalance(kv, user, users) {
  const hcmNames = new Set(
    users.filter((u) => u.isHCM).map((u) => userKey(u.name)),
  );
  const isUserHCM = hcmNames.has(userKey(user.name));

  let index = (await kv.get("days_index")) || [];
  let earnedCoins = 0;

  for (const dateKey of index) {
    if (!isWeekday(dateKey)) continue;
    const day = await getDayData(kv, dateKey);
    if (!day.arrival || !day.rankings) continue;
    const userRank = day.rankings.find(
      (r) => userKey(r.name) === userKey(user.name),
    );
    if (userRank) {
      if (userRank.position === 1) earnedCoins += 25;
      else if (userRank.position === 2) earnedCoins += 10;
      else if (userRank.position === 3) earnedCoins += 5;
      earnedCoins += 1;
    }
    if (isUserHCM) {
      const hcmRanks = day.rankings.filter((r) =>
        hcmNames.has(userKey(r.name)),
      );
      if (hcmRanks.length > 0) {
        const topHcmPos = hcmRanks[0].position;
        const isTopHcm = hcmRanks.some(
          (r) =>
            r.position === topHcmPos &&
            userKey(r.name) === userKey(user.name),
        );
        if (isTopHcm && userRank) earnedCoins += 5;
      }
    }
  }

  const gameCoinsKey = `gamecoins:${userKey(user.name)}`;
  const gameCoins = parseRedisNumber(await kv.get(gameCoinsKey));
  earnedCoins += gameCoins;

  const purchasesKey = `purchases:${userKey(user.name)}`;
  const purchases = parseRedisArray(await kv.get(purchasesKey));
  let spentCoins = 0;
  purchases.forEach((id) => {
    const item = STORE_ITEMS.find((i) => i.id === id);
    if (item) spentCoins += item.price;
  });

  const emojiOwnedKey = `emoji_owned:${userKey(user.name)}`;
  const emojiOwned = parseRedisArray(await kv.get(emojiOwnedKey));
  spentCoins += emojiOwned.length * EMOJI_PRICE;

  return { earnedCoins, spentCoins, purchases, gameCoins, emojiOwned };
}

// GET /api/store — requer sessão válida
app.get("/api/store", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const { earnedCoins, spentCoins, purchases, gameCoins } = await calcBalance(kv, user, users);

    const responseItems = STORE_ITEMS.map((item) => {
      const isUnlocked = purchases.includes(item.id);
      const base = { id: item.id, title: item.title, price: item.price, type: item.type || "media" };
      if (item.type === "namecolor") {
        return { ...base, color: item.color, description: item.description };
      }
      return { ...base, src: isUnlocked ? item.src : null };
    });

    const activeColorId = (await kv.get(`color_active:${userKey(user.name)}`)) || null;

    res.json({
      balance: Math.max(0, earnedCoins - spentCoins),
      coinsFromGames: gameCoins,
      spentCoins,
      purchases,
      items: responseItems,
      activeColorId,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/store/buy — requer sessão válida
app.post("/api/store/buy", requireAuth, async (req, res) => {
  try {
    const { itemId } = req.body;
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const item = STORE_ITEMS.find((i) => i.id === itemId);
    if (!item) return res.status(404).json({ error: "Item não encontrado." });

    const { earnedCoins, spentCoins, purchases } = await calcBalance(kv, user, users);

    if (purchases.includes(itemId))
      return res.status(400).json({ error: "Você já possui este item." });

    const balance = earnedCoins - spentCoins;
    if (balance < item.price)
      return res.status(400).json({ error: "LuizCoins™ insuficientes." });

    purchases.push(itemId);
    await kv.set(`purchases:${userKey(user.name)}`, JSON.stringify(purchases));
    await invalidateCache(kv, "cache:profiles");

    res.json({ success: true, newBalance: balance - item.price });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/color — define qual cor de nome (já comprada) é exibida no ranking
app.post("/api/profile/color", requireAuth, async (req, res) => {
  try {
    const { colorId } = req.body;
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const activeKey = `color_active:${userKey(user.name)}`;
    if (!colorId) {
      await kv.del(activeKey);
    } else {
      const purchasesKey = `purchases:${userKey(user.name)}`;
      const purchases = parseRedisArray(await kv.get(purchasesKey));
      const item = STORE_ITEMS.find((i) => i.id === colorId && i.type === "namecolor");
      if (!item || !purchases.includes(colorId))
        return res.status(400).json({ error: "Você não possui essa cor." });
      await kv.set(activeKey, colorId);
    }
    await invalidateCache(kv, "cache:profiles");

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Emoji de ranking ────────────────────────────────────────────────────────
// GET /api/profile/emoji — emojis comprados, emoji ativo, preço e limite
app.get("/api/profile/emoji", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const uk = userKey(req.sessionName);
    const owned = parseRedisArray(await kv.get(`emoji_owned:${uk}`));
    const active = (await kv.get(`emoji_active:${uk}`)) || null;
    res.json({ owned, active, price: EMOJI_PRICE, max: EMOJI_MAX_OWNED });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/emoji/buy — compra um emoji novo (qualquer emoji válido) por 500 LuizCoins
app.post("/api/profile/emoji/buy", requireAuth, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji || typeof emoji !== "string" || !EMOJI_REGEX.test(emoji)) {
      return res.status(400).json({ error: "Emoji inválido." });
    }

    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const uk = userKey(user.name);
    const ownedKey = `emoji_owned:${uk}`;
    const { earnedCoins, spentCoins, emojiOwned } = await calcBalance(kv, user, users);

    if (emojiOwned.includes(emoji))
      return res.status(400).json({ error: "Você já possui este emoji." });
    if (emojiOwned.length >= EMOJI_MAX_OWNED)
      return res.status(400).json({ error: `Você já possui ${EMOJI_MAX_OWNED} emojis. Remova um antes de comprar outro.` });

    const balance = earnedCoins - spentCoins;
    if (balance < EMOJI_PRICE)
      return res.status(400).json({ error: "LuizCoins™ insuficientes." });

    const newOwned = [...emojiOwned, emoji];
    await kv.set(ownedKey, JSON.stringify(newOwned));
    if (newOwned.length === 1) {
      await kv.set(`emoji_active:${uk}`, emoji);
    }
    await invalidateCache(kv, "cache:profiles");

    res.json({ success: true, owned: newOwned, newBalance: balance - EMOJI_PRICE });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/emoji/remove — remove um emoji possuído (sem reembolso), liberando vaga para comprar outro
app.post("/api/profile/emoji/remove", requireAuth, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ error: "emoji é obrigatório." });

    const kv = getKV();
    const uk = userKey(req.sessionName);
    const ownedKey = `emoji_owned:${uk}`;
    const owned = parseRedisArray(await kv.get(ownedKey));
    const newOwned = owned.filter((e) => e !== emoji);
    if (newOwned.length === owned.length)
      return res.status(404).json({ error: "Emoji não encontrado." });

    await kv.set(ownedKey, JSON.stringify(newOwned));

    const activeKey = `emoji_active:${uk}`;
    const active = await kv.get(activeKey);
    if (active === emoji) await kv.del(activeKey);
    await invalidateCache(kv, "cache:profiles");

    res.json({ success: true, owned: newOwned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/emoji/set-active — define qual emoji possuído é exibido no ranking
app.post("/api/profile/emoji/set-active", requireAuth, async (req, res) => {
  try {
    const { emoji } = req.body;
    const kv = getKV();
    const uk = userKey(req.sessionName);
    const activeKey = `emoji_active:${uk}`;

    if (!emoji) {
      await kv.del(activeKey);
    } else {
      const owned = parseRedisArray(await kv.get(`emoji_owned:${uk}`));
      if (!owned.includes(emoji))
        return res.status(400).json({ error: "Você não possui esse emoji." });
      await kv.set(activeKey, emoji);
    }
    await invalidateCache(kv, "cache:profiles");

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Conquistas (Achievements) ───────────────────────────────────────────────
const ACHIEVEMENT_DEFS = [
  { id: "snake_500", title: "Serpente veloz", description: "Faça mais de 500 pontos no Snake", icon: "🐍" },
  { id: "minesweeper_beginner", title: "Detonador iniciante", description: "Complete uma partida de Campo Minado no modo Iniciante", icon: "💣" },
  { id: "minesweeper_intermediate", title: "Detonador intermediário", description: "Complete uma partida de Campo Minado no modo Intermediário", icon: "🧨" },
  { id: "minesweeper_expert", title: "Detonador especialista", description: "Complete uma partida de Campo Minado no modo Especialista", icon: "🏆" },
  { id: "bet_winner", title: "Profeta do Luiz", description: "Seja o vencedor (1º lugar) em uma aposta do dia", icon: "🔮" },
];

// GET /api/achievements — requer sessão válida
app.get("/api/achievements", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const unlockedKey = `achievements:${userKey(user.name)}`;
    const activeKey = `achievement_active:${userKey(user.name)}`;
    const unlocked = parseRedisArray(await kv.get(unlockedKey));
    let active = null;
    try { active = await kv.get(activeKey); } catch { active = null; }

    res.json({ definitions: ACHIEVEMENT_DEFS, unlocked, active: active || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/achievements/set-active — requer sessão válida
app.post("/api/achievements/set-active", requireAuth, async (req, res) => {
  try {
    const { achievementId } = req.body;
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const activeKey = `achievement_active:${userKey(user.name)}`;
    if (!achievementId) {
      await kv.del(activeKey);
    } else {
      const unlockedKey = `achievements:${userKey(user.name)}`;
      const unlocked = parseRedisArray(await kv.get(unlockedKey));
      if (!unlocked.includes(achievementId))
        return res.status(400).json({ error: "Conquista não desbloqueada." });
      await kv.set(activeKey, achievementId);
    }
    await invalidateCache(kv, "cache:profiles");

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/profiles — público
app.get("/api/profiles", async (req, res) => {
  try {
    const kv = getKV();
    const profiles = await getCachedOrCompute(kv, "cache:profiles", async () => {
      const users = await getUsers(kv);
      const computed = {};

      for (const u of users) {
        const uk = userKey(u.name);
        const purchasesKey = `purchases:${uk}`;
        const purchases = parseRedisArray(await kv.get(purchasesKey));

        let activeColor = null;
        const chosenColorId = await kv.get(`color_active:${uk}`);
        if (chosenColorId && purchases.includes(chosenColorId)) {
          const item = STORE_ITEMS.find((i) => i.id === chosenColorId && i.type === "namecolor");
          if (item) activeColor = { id: chosenColorId, color: item.color, title: item.title };
        }
        if (!activeColor) {
          // Sem escolha explícita: usa a cor de maior prestígio que o jogador possui.
          const colorPriority = ["color_diamante", "color_dourado", "color_rubi", "color_esmeralda"];
          for (const cid of colorPriority) {
            if (purchases.includes(cid)) {
              const item = STORE_ITEMS.find((i) => i.id === cid);
              if (item) {
                activeColor = { id: cid, color: item.color, title: item.title };
                break;
              }
            }
          }
        }

        let activeAchievement = null;
        try {
          const activeAchId = await kv.get(`achievement_active:${uk}`);
          if (activeAchId) {
            const def = ACHIEVEMENT_DEFS.find((a) => a.id === activeAchId);
            if (def) activeAchievement = { id: def.id, icon: def.icon, title: def.title };
          }
        } catch {}

        const activeEmoji = (await kv.get(`emoji_active:${uk}`)) || null;

        computed[u.name] = { nameColor: activeColor, achievement: activeAchievement, emoji: activeEmoji };
      }

      return computed;
    });

    res.json(profiles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Export para Vercel ───────────────────────────────────────────────────────
module.exports = app;