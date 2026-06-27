const express = require("express");
const router = express.Router();

const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { userKey, parseRedisArray } = require("../lib/utils");

// GET /api/game-rank
router.get("/game-rank", async (req, res) => {
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

// POST /api/game-rank — requer sessão válida; playerName vem do token, não do body
// Proteção contra burla: o servidor ignora qualquer playerName enviado pelo cliente.
// O score é validado contra limites razoáveis por jogo.
router.post("/game-rank", requireAuth, async (req, res) => {
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

module.exports = router;
