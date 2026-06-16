require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env.local"),
});

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

// HCM preset users (used for the HCM tab in rankings)
const PRESET_USERS = [
  { name: "Ronaldo", password: "rolando", isHCM: true },
  { name: "Jorge", password: "jog", isHCM: true },
  { name: "Alexandre", password: "rock", isHCM: true },
  { name: "João Paulo", password: "joaoPedro", isHCM: true },
  { name: "Julio", password: "julho", isHCM: true },
  { name: "Pedro", password: "pedrao", isHCM: true },
];

const HCM_NAMES = new Set(
  PRESET_USERS.map((u) =>
    String(u.name || "")
      .trim()
      .toLowerCase(),
  ),
);

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
  return Array.isArray(users)
    ? users.filter(
        (u) =>
          u && typeof u.name === "string" && typeof u.password === "string",
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

async function getUsers(kv) {
  let extra = [];
  if (kv) {
    try {
      extra = normalizeUsers(await kv.get("users"));
    } catch {
      extra = [];
    }
  }
  const allNames = new Set(PRESET_USERS.map((u) => userKey(u.name)));
  const filtered = extra.filter((u) => !allNames.has(userKey(u.name)));
  return [...PRESET_USERS, ...filtered];
}

async function saveExtraUsers(kv, users) {
  const presetNames = new Set(PRESET_USERS.map((u) => userKey(u.name)));
  const extra = normalizeUsers(users).filter(
    (u) => !presetNames.has(userKey(u.name)),
  );
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

// Função auxiliar para calcular a data em string do próximo dia útil (pula finais de semana)
function getNextWeekdayStr() {
  const d = getBrasiliaDate();
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6); // 0 = Domingo, 6 = Sábado
  
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/users
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

// POST /api/login
app.post("/api/login", async (req, res) => {
  try {
    const { name, password } = req.body;
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find(
      (u) => userKey(u.name) === userKey(name) && u.password === password,
    );
    if (!user)
      return res.status(401).json({ error: "Nome ou senha incorretos." });
    res.json({
      name: user.name,
      isHCM: !!user.isHCM,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
    const newUser = { name: name.trim(), password, isHCM: false };
    const presetNames = new Set(PRESET_USERS.map((u) => userKey(u.name)));
    const extra = users.filter((u) => !presetNames.has(userKey(u.name)));
    extra.push(newUser);
    await saveExtraUsers(kv, extra);
    res.json({ name: newUser.name, isHCM: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ROTA GET /api/today COMPLETAMENTE ATUALIZADA
app.get("/api/today", async (req, res) => {
  try {
    const kv = getKV();
    const key = todayKey(); // Data de hoje real (ex: "2026-06-16")
    const todayDay = await getDayData(kv, key);
    const nowMins = currentTimeMinutes();
    const cutoffMins = timeStrToMinutes("10:00");

    // 1. Determina se as apostas já rolaram para o próximo dia útil
    let activeBetDate = key;
    if (!isWeekday(key) || todayDay.arrival || nowMins >= cutoffMins) {
      activeBetDate = getNextWeekdayStr();
    }

    // Se hoje já fechou ou é fim de semana, o foco de exibição passa a ser o próximo dia útil
    const isNextDay = activeBetDate !== key;
    const targetDate = activeBetDate; // Dia cujos palpites serão exibidos na tabela
    const targetDayData = isNextDay ? await getDayData(kv, targetDate) : todayDay;

    // 2. Valida credenciais do usuário visualizador se enviadas por parâmetro na query
    let viewerName = null;
    const { viewer, password } = req.query;
    if (viewer && password) {
      const users = await getUsers(kv);
      const user = users.find(
        (u) => userKey(u.name) === userKey(viewer) && u.password === password
      );
      if (user) viewerName = user.name;
    }

    // 3. Verifica palpites do usuário no dia alvo que está sendo exibido
    const targetViewerGuess = targetDayData.guesses.find(
      (g) => viewerName && userKey(g.name) === userKey(viewerName)
    );

    // 4. Lógica de visibilidade dos palpites para o dia exibido (targetDate)
    let exposedGuesses = [];
    let hiddenCount = 0;

    if (isNextDay) {
      // Se estamos exibindo o próximo dia útil, as apostas para ele estão abertas por definição.
      // Logo, aplica-se a regra de sigilo: o usuário só vê o próprio palpite; os outros ficam ocultos.
      hiddenCount = targetDayData.guesses.filter(
        (g) => !viewerName || userKey(g.name) !== userKey(viewerName)
      ).length;
      exposedGuesses = targetViewerGuess ? [targetViewerGuess] : [];
    } else {
      // Lógica original para quando hoje ainda está aberto ou acabou de fechar com a chegada do Luiz hoje
      const bettingOpenForToday = !todayDay.arrival && nowMins < cutoffMins && isWeekday(key);
      if (todayDay.arrival) {
        exposedGuesses = todayDay.guesses;
      } else if (bettingOpenForToday) {
        hiddenCount = todayDay.guesses.filter(
          (g) => !viewerName || userKey(g.name) !== userKey(viewerName)
        ).length;
        exposedGuesses = targetViewerGuess ? [targetViewerGuess] : [];
      } else {
        if (targetViewerGuess) {
          exposedGuesses = todayDay.guesses;
        } else {
          hiddenCount = todayDay.guesses.length;
          exposedGuesses = [];
        }
      }
    }

    res.json({
      date: key,               // Mantém a data de hoje real para o banner identificar o "isNextDay"
      displayDate: targetDate, // NOVO: Data correspondente aos palpites que estão sendo retornados
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

// ROTA POST /api/guess COMPLETAMENTE INTEGRADA
app.post("/api/guess", async (req, res) => {
  try {
    const { name, password, time } = req.body;
    if (!name || !password || !time) {
      return res.status(400).json({ error: "Faltam campos obrigatórios (name, password, time)." });
    }

    if (!/^\d{2}:\d{2}$/.test(time)) {
      return res.status(400).json({ error: "Formato de hora inválido. Use HH:MM." });
    }

    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find(
      (u) => userKey(u.name) === userKey(name) && u.password === password
    );
    if (!user) {
      return res.status(401).json({ error: "Usuário ou senha inválidos." });
    }

    let activeBetDate = todayKey();
    const todayDay = await getDayData(kv, activeBetDate);
    const nowMins = currentTimeMinutes();

    // Roteamento automático: se passou das 10h, o Luiz já chegou ou é fim de semana, aposta vai para o próximo dia útil
    if (!isWeekday(activeBetDate) || todayDay.arrival || nowMins >= timeStrToMinutes("10:00")) {
      activeBetDate = getNextWeekdayStr();
    }

    const day = await getDayData(kv, activeBetDate);

    if (day.arrival) {
      return res.status(400).json({ error: "Apostas já foram encerradas para este dia." });
    }

    // Trava rígida das 10h aplicada apenas se a aposta ainda for destinada ao dia atual
    if (activeBetDate === todayKey() && nowMins >= timeStrToMinutes("10:00")) {
      return res.status(400).json({ error: "Apostas encerradas após 10h." });
    }

    const existing = day.guesses.findIndex(g => userKey(g.name) === userKey(name));
    if (existing >= 0) {
      return res.status(409).json({
        error: "Você já apostou! Só é permitido um palpite por dia.",
      });
    }

    // Insere o palpite no dia ativo determinado
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

// POST /api/admin/login
app.post("/api/admin/login", async (req, res) => {
  try {
    const { password } = req.body;
    if (!password)
      return res.status(400).json({ error: "Senha é obrigatória." });
    if (password !== ADMIN_PASSWORD)
      return res.status(401).json({ error: "Senha incorreta." });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/arrival
app.post("/api/admin/arrival", async (req, res) => {
  try {
    const { password, time, date } = req.body;
    if (password !== ADMIN_PASSWORD)
      return res.status(401).json({ error: "Senha incorreta." });
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/overall-rank
// Returns all players. Each entry has isHCM flag for frontend filtering.
app.get("/api/overall-rank", async (req, res) => {
  try {
    const kv = getKV();
    let index = (await kv.get("days_index")) || [];
    const scores = {};
    // Build a lookup of HCM names from current user list
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
    const ranked = Object.values(scores)
      .map((s) => ({
        ...s,
        avgDiffMins: s.days > 0 ? Math.round(s.totalDiff / s.days) : 0,
      }))
      .sort((a, b) => b.points - a.points || a.avgDiffMins - b.avgDiffMins);
    res.json(ranked);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/game-rank?game=snake|minesweeper[&difficulty=beginner|intermediate|expert]
// Returns top 10 for the given game/difficulty from Redis
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

// POST /api/game-rank
// Body: { game, difficulty?, playerName, score, skipRank? }
// Stores one score per player, keeps top 10 overall
// Also awards coins based on game performance
app.post("/api/game-rank", async (req, res) => {
  try {
    const { game, difficulty, playerName, score, skipRank } = req.body;
    if (!game || !playerName || score === undefined) {
      return res
        .status(400)
        .json({ error: "game, playerName e score são obrigatórios." });
    }
    const rankKey = difficulty
      ? `gamerank:${game}:${difficulty}`
      : `gamerank:${game}`;
    const kv = getKV();
    let scores = (await kv.get(rankKey)) || [];

    if (!skipRank) {
      // Remove existing entry for this player and update ranking
      scores = scores.filter(
        (s) =>
          String(s.name).toLowerCase() !== String(playerName).toLowerCase(),
      );
      scores.push({ name: playerName, score, date: new Date().toISOString() });
      scores.sort((a, b) => b.score - a.score);
      scores = scores.slice(0, 10);
      await kv.set(rankKey, scores);
    }

    // ─── AWARD COINS BASED ON GAME PERFORMANCE ───
    let coinsEarned = 0;
    if (game === "snake") {
      if (score > 1000) coinsEarned = 3;
      else if (score > 500) coinsEarned = 2;
      else if (score > 250) coinsEarned = 1;
    } else if (game === "minesweeper") {
      if (difficulty === "expert") coinsEarned = 25;
      else if (difficulty === "intermediate") coinsEarned = 5;
      else if (difficulty === "beginner") coinsEarned = 1;
    }

    // Store earned coins
    if (coinsEarned > 0) {
      const coinsKey = `gamecoins:${userKey(playerName)}`;
      const existingCoins = Number(await kv.get(coinsKey));
      const totalCoins =
        (Number.isFinite(existingCoins) ? existingCoins : 0) +
        Number(coinsEarned);
      await kv.set(coinsKey, String(totalCoins));
    }

    // ─── AWARD ACHIEVEMENTS ───
    const achUnlockedKey = `achievements:${userKey(playerName)}`;
    const achUnlocked = parseRedisArray(await kv.get(achUnlockedKey));
    let newAchievements = [];

    if (game === "snake" && score > 500 && !achUnlocked.includes("snake_500")) {
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

// ─── Loja de Prêmios (Configuração) ──────────────────────────────────────────
const STORE_ITEMS = [
  // Cadastre seus GIFs e imagens aqui. Eles devem estar na pasta public (ex: /store/...)
  {
    id: "palinha",
    price: 10,
    src: "/photos/palinha.gif",
    title: "Luiz dando uma palinha",
  },
  {
    id: "baixista",
    price: 10,
    src: "/photos/baixista.gif",
    title: "Luiz Fernando baixista",
  },
  {
    id: "confusp",
    price: 25,
    src: "/photos/confuso.gif",
    title: "Luiz confuso",
  },
  // ─── Cores de nome (minerais) ────────────────────────────────────────────────
  {
    id: "color_esmeralda",
    price: 100,
    type: "namecolor",
    color: "#00c853",
    title: "Cor Esmeralda",
    description: "Nome verde esmeralda brilhante no ranking",
  },
  {
    id: "color_rubi",
    price: 250,
    type: "namecolor",
    color: "#e53935",
    title: "Cor Rubi",
    description: "Nome vermelho rubi ardente no ranking",
  },
  {
    id: "color_dourado",
    price: 1000,
    type: "namecolor",
    color: "#ffd600",
    title: "Cor Dourada",
    description: "Nome dourado reluzente no ranking",
  },
  {
    id: "color_diamante",
    price: 10000,
    type: "namecolor",
    color: "#b3e5fc",
    title: "Cor Diamante",
    description: "Nome com brilho de diamante no ranking",
  },
];

// ─── Rotas da Loja ───────────────────────────────────────────────────────────

// GET /api/store
app.get("/api/store", async (req, res) => {
  try {
    const { viewer, password } = req.query;
    if (!viewer || !password)
      return res.status(401).json({ error: "Faça login para acessar a loja." });

    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find(
      (u) => userKey(u.name) === userKey(viewer) && u.password === password,
    );
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const hcmNames = new Set(
      users.filter((u) => u.isHCM).map((u) => userKey(u.name)),
    );
    const isUserHCM = hcmNames.has(userKey(user.name));

    let index = (await kv.get("days_index")) || [];
    let earnedCoins = 0;

    // 1. Calcular moedas ganhas com base no histórico
    for (const dateKey of index) {
      if (!isWeekday(dateKey)) continue;
      const day = await getDayData(kv, dateKey);
      if (!day.arrival || !day.rankings) continue;

      const userRank = day.rankings.find(
        (r) => userKey(r.name) === userKey(user.name),
      );
      if (userRank) {
        if (userRank.position === 1) earnedCoins += 10;
        else if (userRank.position === 2) earnedCoins += 5;
        else if (userRank.position === 3) earnedCoins += 3;
      }

      // Regra HCM: 1 moeda extra se for o 1º lugar entre o pessoal do HCM
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

    // 2. Adicionar moedas ganhas em jogos
    const gameCoinsKey = `gamecoins:${userKey(user.name)}`;
    const gameCoins = parseRedisNumber(await kv.get(gameCoinsKey));
    earnedCoins += gameCoins;

    // 3. Subtrair moedas gastas
    const purchasesKey = `purchases:${userKey(user.name)}`;
    const purchases = parseRedisArray(await kv.get(purchasesKey));
    let spentCoins = 0;

    purchases.forEach((id) => {
      const item = STORE_ITEMS.find((i) => i.id === id);
      if (item) spentCoins += item.price;
    });

    // 4. Ocultar o SRC da mídia para quem não comprou
    const responseItems = STORE_ITEMS.map((item) => {
      const isUnlocked = purchases.includes(item.id);
      const base = {
        id: item.id,
        title: item.title,
        price: item.price,
        type: item.type || "media",
      };
      if (item.type === "namecolor") {
        return { ...base, color: item.color, description: item.description };
      }
      return { ...base, src: isUnlocked ? item.src : null }; // Mantém bloqueado na rede
    });

    res.json({
      balance: Math.max(0, earnedCoins - spentCoins),
      coinsFromGames: parseRedisNumber(await kv.get(gameCoinsKey)),
      spentCoins,
      purchases,
      items: responseItems,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/store/buy
app.post("/api/store/buy", async (req, res) => {
  try {
    const { name, password, itemId } = req.body;
    const kv = getKV();

    // Validar usuário
    const users = await getUsers(kv);
    const user = users.find(
      (u) => userKey(u.name) === userKey(name) && u.password === password,
    );
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const item = STORE_ITEMS.find((i) => i.id === itemId);
    if (!item) return res.status(404).json({ error: "Item não encontrado." });

    // Recalcular saldo para evitar bypass
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
        if (userRank.position === 1) earnedCoins += 10;
        else if (userRank.position === 2) earnedCoins += 5;
        else if (userRank.position === 3) earnedCoins += 3;
      }
      if (isUserHCM) {
        const hcmRanks = day.rankings.filter((r) =>
          hcmNames.has(userKey(r.name)),
        );
        if (
          hcmRanks.length > 0 &&
          hcmRanks.some(
            (r) =>
              r.position === hcmRanks[0].position &&
              userKey(r.name) === userKey(user.name),
          )
        ) {
          earnedCoins += 1;
        }
      }
    }

    // Adicionar moedas ganhas em jogos
    const gameCoinsKey = `gamecoins:${userKey(user.name)}`;
    const gameCoins = parseRedisNumber(await kv.get(gameCoinsKey));
    earnedCoins += gameCoins;

    const purchasesKey = `purchases:${userKey(user.name)}`;
    const purchases = parseRedisArray(await kv.get(purchasesKey));

    if (purchases.includes(itemId))
      return res.status(400).json({ error: "Você já possui este item." });

    let spentCoins = 0;
    purchases.forEach((id) => {
      const pItem = STORE_ITEMS.find((i) => i.id === id);
      if (pItem) spentCoins += pItem.price;
    });

    const balance = earnedCoins - spentCoins;
    if (balance < item.price)
      return res.status(400).json({ error: "LuizCoins™ insuficientes." });

    // Efetuar compra
    purchases.push(itemId);
    await kv.set(purchasesKey, JSON.stringify(purchases));

    res.json({ success: true, newBalance: balance - item.price });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Conquistas (Achievements) ───────────────────────────────────────────────

// Definição estática das conquistas disponíveis
const ACHIEVEMENT_DEFS = [
  {
    id: "snake_500",
    title: "Serpente Veloz",
    description: "Faça mais de 500 pontos no Snake",
    icon: "🪙",
  },
  {
    id: "minesweeper_beginner",
    title: "Detonador Iniciante",
    description: "Complete uma partida de Campo Minado no modo Iniciante",
    icon: "🪙",
  },
  {
    id: "minesweeper_intermediate",
    title: "Detonador Intermediário",
    description: "Complete uma partida de Campo Minado no modo Intermediário",
    icon: "🪙",
  },
  {
    id: "minesweeper_expert",
    title: "Detonador Especialista",
    description: "Complete uma partida de Campo Minado no modo Especialista",
    icon: "🪙",
  },
  {
    id: "bet_winner",
    title: "Profeta do Luiz",
    description: "Seja o vencedor (1º lugar) em uma aposta do dia",
    icon: "🪙",
  },
];

// GET /api/achievements?viewer=...&password=...
// Retorna as conquistas do usuário (quais desbloqueou) e a conquista ativa (exibida no rank)
app.get("/api/achievements", async (req, res) => {
  try {
    const { viewer, password } = req.query;
    if (!viewer || !password)
      return res.status(401).json({ error: "Faça login para ver conquistas." });

    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find(
      (u) => userKey(u.name) === userKey(viewer) && u.password === password,
    );
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const unlockedKey = `achievements:${userKey(user.name)}`;
    const activeKey = `achievement_active:${userKey(user.name)}`;
    const unlocked = parseRedisArray(await kv.get(unlockedKey));
    let active = null;
    try {
      active = await kv.get(activeKey);
    } catch {
      active = null;
    }

    res.json({
      definitions: ACHIEVEMENT_DEFS,
      unlocked,
      active: active || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/achievements/unlock
// Body: { name, password, achievementId }
app.post("/api/achievements/unlock", async (req, res) => {
  try {
    const { name, password, achievementId } = req.body;
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find(
      (u) => userKey(u.name) === userKey(name) && u.password === password,
    );
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const def = ACHIEVEMENT_DEFS.find((a) => a.id === achievementId);
    if (!def)
      return res.status(404).json({ error: "Conquista não encontrada." });

    const unlockedKey = `achievements:${userKey(user.name)}`;
    const unlocked = parseRedisArray(await kv.get(unlockedKey));
    if (!unlocked.includes(achievementId)) {
      unlocked.push(achievementId);
      await kv.set(unlockedKey, JSON.stringify(unlocked));
    }

    res.json({ success: true, unlocked });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/achievements/set-active
// Body: { name, password, achievementId }  (null achievementId to clear)
app.post("/api/achievements/set-active", async (req, res) => {
  try {
    const { name, password, achievementId } = req.body;
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find(
      (u) => userKey(u.name) === userKey(name) && u.password === password,
    );
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const activeKey = `achievement_active:${userKey(user.name)}`;
    if (!achievementId) {
      await kv.del(activeKey);
    } else {
      // Must be unlocked
      const unlockedKey = `achievements:${userKey(user.name)}`;
      const unlocked = parseRedisArray(await kv.get(unlockedKey));
      if (!unlocked.includes(achievementId))
        return res.status(400).json({ error: "Conquista não desbloqueada." });
      await kv.set(activeKey, achievementId);
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/profiles
// Returns public profile data for all users: active name color & achievement
app.get("/api/profiles", async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    const profiles = {};

    for (const u of users) {
      const uk = userKey(u.name);
      const purchasesKey = `purchases:${uk}`;
      const purchases = parseRedisArray(await kv.get(purchasesKey));

      // Find highest-tier purchased color (priority: diamante > dourado > rubi > esmeralda)
      const colorPriority = [
        "color_diamante",
        "color_dourado",
        "color_rubi",
        "color_esmeralda",
      ];
      let activeColor = null;
      for (const cid of colorPriority) {
        if (purchases.includes(cid)) {
          const item = STORE_ITEMS.find((i) => i.id === cid);
          if (item) {
            activeColor = { id: cid, color: item.color, title: item.title };
            break;
          }
        }
      }

      let activeAchievement = null;
      try {
        const activeAchId = await kv.get(`achievement_active:${uk}`);
        if (activeAchId) {
          const def = ACHIEVEMENT_DEFS.find((a) => a.id === activeAchId);
          if (def)
            activeAchievement = {
              id: def.id,
              icon: def.icon,
              title: def.title,
            };
        }
      } catch {}

      profiles[u.name] = {
        nameColor: activeColor,
        achievement: activeAchievement,
      };
    }

    res.json(profiles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Also award bet winner achievement in admin/arrival
// (patch: re-export existing route to also call achievements unlock)

// ─── Export for Vercel ────────────────────────────────────────────────────────
module.exports = app;
