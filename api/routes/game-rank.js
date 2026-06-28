const express = require("express");
const router = express.Router();

const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { userKey, parseRedisArray, parseRedisNumber } = require("../lib/utils");
const { todayKey } = require("../lib/datetime");

// Minigames não têm cooldown entre partidas (dá pra jogar e ganhar quantas
// vezes quiser), diferente da aposta (1x por dia útil). Sem um teto, alguém
// disposto a repetir partidas rapidamente (ex: Campo Minado Iniciante em
// ~20s) acumularia moedas muito mais rápido que jogando "normalmente" — o
// que tornaria o preço dos itens da loja sem sentido. Este teto mantém o
// ganho diário via minigames na mesma ordem de grandeza de uma boa aposta.
const GAME_COINS_DAILY_CAP = 20;

const RANK_SIZE = 50;

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
    const { game, difficulty, score, skipRank, hintsUsed, undoUsed } = req.body;
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
      sudoku: 9999,           // Sudoku: score = 9999 - tempo(s), só enviado ao vencer
      spider: 9999,           // Spider: score = 9999 - tempo(s), só enviado ao vencer
    };

    const maxScore = SCORE_LIMITS[game];
    if (maxScore !== undefined && scoreNum > maxScore) {
      return res.status(400).json({ error: "Score fora dos limites permitidos." });
    }

    // Valida difficulty por jogo
    const DIFFICULTIES_BY_GAME = {
      minesweeper: ["beginner", "intermediate", "expert"],
      sudoku: ["easy", "medium", "hard"],
      spider: ["easy", "medium", "hard"],
    };
    const validDifficulties = DIFFICULTIES_BY_GAME[game];
    if (validDifficulties && difficulty && !validDifficulties.includes(difficulty)) {
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
      scores = scores.slice(0, RANK_SIZE);
      await kv.set(rankKey, scores);
    }

    // ─── AWARD COINS BASED ON GAME PERFORMANCE ───
    let coinsEarned = 0;
    if (game === "snake") {
      // Comida = 10 pontos e o jogo não acelera muito (1 nível a cada 50
      // pontos), então 200-300 pontos são fáceis de alcançar. A curva é
      // achatada nesses scores fáceis e reserva a recompensa cheia (= teto
      // diário de minigames) só pra quem chega nos 500 pontos da conquista.
      coinsEarned = Math.floor(scoreNum / 100) * 2;
      if (scoreNum >= 250) coinsEarned += 5;
      if (scoreNum >= 500) coinsEarned += 5;
    } else if (game === "minesweeper") {
      // O score só é enviado quando o jogador vence a partida
      if (difficulty === "expert") coinsEarned = 25;
      else if (difficulty === "intermediate") coinsEarned = 10;
      else if (difficulty === "beginner") coinsEarned = 1;
    } else if (game === "sudoku") {
      // O score só é enviado quando o jogador completa o tabuleiro corretamente
      if (difficulty === "hard") coinsEarned = 20;
      else if (difficulty === "medium") coinsEarned = 8;
      else if (difficulty === "easy") coinsEarned = 2;
    } else if (game === "spider") {
      // O score só é enviado quando as 8 sequências são completadas
      if (difficulty === "hard") coinsEarned = 25;
      else if (difficulty === "medium") coinsEarned = 15;
      else if (difficulty === "easy") coinsEarned = 5;
    }

    if (coinsEarned > 0) {
      const dailyKey = `gamecoins_daily:${userKey(playerName)}:${todayKey()}`;
      const dailySoFar = parseRedisNumber(await kv.get(dailyKey));
      const allowedCoins = Math.max(0, Math.min(coinsEarned, GAME_COINS_DAILY_CAP - dailySoFar));

      if (allowedCoins > 0) {
        const coinsKey = `gamecoins:${userKey(playerName)}`;
        const existingCoins = parseRedisNumber(await kv.get(coinsKey));
        await kv.set(coinsKey, String(existingCoins + allowedCoins));
        // TTL curto: só precisa sobreviver até a virada do dia, não acumular pra sempre.
        await kv.set(dailyKey, String(dailySoFar + allowedCoins), { ex: 2 * 24 * 60 * 60 });
      }
      coinsEarned = allowedCoins;
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
    if (game === "sudoku") {
      const achId =
        difficulty === "easy"
          ? "sudoku_easy"
          : difficulty === "medium"
            ? "sudoku_medium"
            : difficulty === "hard"
              ? "sudoku_hard"
              : null;
      if (achId && !achUnlocked.includes(achId)) {
        achUnlocked.push(achId);
        newAchievements.push(achId);
      }
    }
    if (game === "spider") {
      const achId =
        difficulty === "easy"
          ? "spider_easy"
          : difficulty === "medium"
            ? "spider_medium"
            : difficulty === "hard"
              ? "spider_hard"
              : null;
      if (achId && !achUnlocked.includes(achId)) {
        achUnlocked.push(achId);
        newAchievements.push(achId);
      }

      // Conquistas independentes da dificuldade, sobre o uso de dicas nesta vitória.
      const hintsAchId = hintsUsed ? "spider_with_hints" : "spider_no_hints";
      if (!achUnlocked.includes(hintsAchId)) {
        achUnlocked.push(hintsAchId);
        newAchievements.push(hintsAchId);
      }

      // Vitória sem dicas e sem desfazer nenhuma jogada.
      if (!hintsUsed && !undoUsed && !achUnlocked.includes("spider_flawless")) {
        achUnlocked.push("spider_flawless");
        newAchievements.push("spider_flawless");
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
