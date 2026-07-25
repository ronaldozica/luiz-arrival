const express = require("express");
const router = express.Router();
const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { getUsers } = require("../lib/users");
const { userKey, parseRedisNumber } = require("../lib/utils");
const { todayKey } = require("../lib/datetime");
const { WORD_LENGTH, MAX_ATTEMPTS, pickDailyWord, evaluateGuess, isValidGuessFormat } = require("../lib/termo-daily");

const RANK_SIZE = 50;

// A palavra do dia nunca é enviada ao cliente antes do jogo terminar — só
// guardada aqui no servidor. NX evita duas requisições concorrentes gerarem
// palavras diferentes pro mesmo dia (mesma técnica do sudoku-daily.js).
async function getOrCreateDailyWord(kv, dateKey) {
  const key = `termo_daily_word:${dateKey}`;
  let word = await kv.get(key);
  if (!word) {
    const generated = pickDailyWord(dateKey);
    await kv.set(key, generated, { nx: true });
    word = (await kv.get(key)) || generated;
  }
  return word;
}

function defaultState() {
  return { guesses: [], won: false, done: false };
}

async function getState(kv, uKey, date) {
  const raw = await kv.get(`termo_daily_state:${uKey}:${date}`);
  if (!raw) return defaultState();
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function saveState(kv, uKey, date, state) {
  // Retido por ~60 dias, igual ao sudoku diário — só pra revisitar o
  // resultado de dias recentes, não é histórico permanente.
  await kv.set(`termo_daily_state:${uKey}:${date}`, state, { ex: 60 * 24 * 60 * 60 });
}

async function getAllTimeWins(kv) {
  const users = await getUsers(kv);
  const entries = [];
  for (const user of users) {
    const count = parseRedisNumber(await kv.get(`termo_daily_wins:${userKey(user.name)}`));
    if (count <= 0) continue;
    entries.push({ name: user.name, count });
  }
  entries.sort((a, b) => b.count - a.count);
  return entries.slice(0, RANK_SIZE);
}

// ─── GET /api/termo-daily/status ────────────────────────────────────────────
router.get("/termo-daily/status", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const date = todayKey();
    const uKey = userKey(req.sessionName);

    const state = await getState(kv, uKey, date);
    const todayRank = ((await kv.get(`termo_daily_rank:${date}`)) || []).slice(0, RANK_SIZE);
    const allTimeWins = await getAllTimeWins(kv);

    let word = null;
    if (state.done) word = await getOrCreateDailyWord(kv, date);

    res.json({
      date,
      wordLength: WORD_LENGTH,
      maxAttempts: MAX_ATTEMPTS,
      guesses: state.guesses,
      won: state.won,
      done: state.done,
      word,
      todayRank,
      allTimeWins,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/termo-daily/guess ────────────────────────────────────────────
// Sem roundToken/tempo mínimo: diferente dos outros jogos, aqui não há score
// pra forjar — o servidor é a única fonte da palavra e da contagem de
// tentativas, então um cliente não tem como "resolver instantaneamente" sem
// realmente adivinhar. O limite de MAX_ATTEMPTS já é a proteção natural
// contra força bruta (no máximo 6 palpites por jogador por dia).
router.post("/termo-daily/guess", requireAuth, async (req, res) => {
  try {
    const { word: rawWord } = req.body;
    if (!isValidGuessFormat(rawWord))
      return res.status(400).json({ error: `Palpite precisa ter ${WORD_LENGTH} letras.` });
    const guess = rawWord.toUpperCase();

    const kv = getKV();
    const date = todayKey();
    const uKey = userKey(req.sessionName);

    const state = await getState(kv, uKey, date);
    if (state.done) return res.status(400).json({ error: "Você já jogou o Termo de hoje." });
    if (state.guesses.length >= MAX_ATTEMPTS) return res.status(400).json({ error: "Sem tentativas restantes." });

    const answer = await getOrCreateDailyWord(kv, date);
    const statuses = evaluateGuess(guess, answer);
    const won = guess === answer;

    state.guesses.push({ word: guess, statuses });
    state.won = won;
    state.done = won || state.guesses.length >= MAX_ATTEMPTS;
    await saveState(kv, uKey, date, state);

    let todayRank = null;
    if (state.done && won) {
      const winsKey = `termo_daily_wins:${uKey}`;
      await kv.set(winsKey, parseRedisNumber(await kv.get(winsKey)) + 1);

      todayRank = (await kv.get(`termo_daily_rank:${date}`)) || [];
      todayRank.push({ name: req.sessionName, attempts: state.guesses.length, date: new Date().toISOString() });
      todayRank.sort((a, b) => a.attempts - b.attempts);
      if (todayRank.length > RANK_SIZE) todayRank.length = RANK_SIZE;
      await kv.set(`termo_daily_rank:${date}`, todayRank);
    }

    res.json({
      statuses,
      won,
      done: state.done,
      attemptsUsed: state.guesses.length,
      word: state.done ? answer : null,
      todayRank,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
