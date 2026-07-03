const express = require("express");
const router = express.Router();
const crypto = require("crypto");

const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { invalidatesCache } = require("../lib/cache");
const { userKey, parseRedisArray, parseRedisNumber } = require("../lib/utils");
const { todayKey } = require("../lib/datetime");
const { GAMES, minPlausibleSeconds } = require("../lib/games");

// TTL generoso pra dar tempo de partidas longas (Sudoku/Spider difícil).
const ROUND_TOKEN_TTL_SECONDS = 2 * 60 * 60;
// Margem pra latência de rede/clock drift entre cliente e servidor.
const ROUND_TOKEN_TOLERANCE_SECONDS = 2;

const DIFFICULTIES_BY_GAME = Object.fromEntries(
  Object.entries(GAMES)
    .filter(([, cfg]) => cfg.difficulties)
    .map(([game, cfg]) => [game, cfg.difficulties]),
);

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

// POST /api/game-rank/start — requer sessão válida; emite um token de rodada
// que precisa ser enviado de volta em POST /api/game-rank junto com o score
// final. Guarda o horário real de início no servidor, pra depois calcular se
// o score enviado é fisicamente plausível pro tempo decorrido (anti-trapaça:
// impede tanto forjar a requisição sem jogar quanto editar a variável de
// score no console e enviar na hora).
router.post("/game-rank/start", requireAuth, async (req, res) => {
  try {
    const { game, difficulty } = req.body;
    const playerName = req.sessionName;

    if (!game || !GAMES[game]) {
      return res.status(400).json({ error: "game inválido." });
    }
    const validDifficulties = DIFFICULTIES_BY_GAME[game];
    if (validDifficulties && difficulty && !validDifficulties.includes(difficulty)) {
      return res.status(400).json({ error: "Dificuldade inválida." });
    }

    const kv = getKV();
    const roundToken = crypto.randomBytes(24).toString("hex");
    await kv.set(
      `roundtoken:${roundToken}`,
      JSON.stringify({ name: playerName, game, difficulty: difficulty || null, startedAt: Date.now() }),
      { ex: ROUND_TOKEN_TTL_SECONDS },
    );

    res.json({ roundToken });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/game-rank — requer sessão válida; playerName vem do token, não do body
// Proteção contra burla: o servidor ignora qualquer playerName enviado pelo cliente.
// O score é validado contra limites razoáveis por jogo, e contra o tempo real
// decorrido desde POST /api/game-rank/start (ver roundToken abaixo).
router.post("/game-rank", requireAuth, invalidatesCache("cache:top1_all_games"), async (req, res) => {
  try {
    const { game, difficulty, score, hintsUsed, undoUsed, roundToken } = req.body;
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
      aimtrainer: 25000,      // Aim Trainer: cap de sanidade pra 30s de partida no modo difícil
      spider: 9999,           // Spider: score = 9999 - tempo(s), só enviado ao vencer
    };

    const maxScore = SCORE_LIMITS[game];
    if (maxScore !== undefined && scoreNum > maxScore) {
      return res.status(400).json({ error: "Score fora dos limites permitidos." });
    }

    // Valida difficulty por jogo
    const validDifficulties = DIFFICULTIES_BY_GAME[game];
    if (validDifficulties && difficulty && !validDifficulties.includes(difficulty)) {
      return res.status(400).json({ error: "Dificuldade inválida." });
    }

    // ─── Token de rodada (anti-trapaça) ────────────────────────────────────────
    // Obrigatório: sem token válido não há como saber se a partida de fato
    // ocorreu, então a submissão é rejeitada.
    const kv = getKV();
    if (!roundToken) {
      return res.status(400).json({ error: "Token de rodada ausente. Inicie a partida novamente." });
    }
    const tokenKey = `roundtoken:${roundToken}`;
    const tokenRaw = await kv.get(tokenKey);
    await kv.del(tokenKey); // uso único, consumido na primeira tentativa (válida ou não)
    if (!tokenRaw) {
      return res.status(400).json({ error: "Token de rodada inválido ou expirado. Inicie a partida novamente." });
    }
    const tokenData = typeof tokenRaw === "string" ? JSON.parse(tokenRaw) : tokenRaw;
    if (
      userKey(tokenData.name) !== userKey(playerName) ||
      tokenData.game !== game ||
      (tokenData.difficulty || null) !== (difficulty || null)
    ) {
      return res.status(400).json({ error: "Token de rodada não corresponde à partida enviada." });
    }
    const elapsedSeconds = (Date.now() - tokenData.startedAt) / 1000;
    const minPlausible = minPlausibleSeconds(game, difficulty, scoreNum);
    if (elapsedSeconds < minPlausible - ROUND_TOKEN_TOLERANCE_SECONDS) {
      return res.status(400).json({ error: "Tempo de partida incompatível com a pontuação enviada." });
    }

    const rankKey = difficulty
      ? `gamerank:${game}:${difficulty}`
      : `gamerank:${game}`;
    let scores = (await kv.get(rankKey)) || [];

    const existingEntry = scores.find(
      (s) => String(s.name).toLowerCase() === String(playerName).toLowerCase(),
    );
    const isNewBest = !existingEntry || scoreNum > existingEntry.score;

    if (isNewBest) {
      scores = scores.filter(
        (s) => String(s.name).toLowerCase() !== String(playerName).toLowerCase(),
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
    } else if (game === "aimtrainer") {
      // Proporcional ao score, com taxa maior em dificuldades mais difíceis
      // (alvos menores/mais rápidos rendem menos pontos por partida).
      const rate = { easy: 0.5, normal: 1, hard: 2 }[difficulty] || 1;
      coinsEarned = Math.floor((scoreNum / 100) * rate);
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
    if (game === "aimtrainer") {
      if (scoreNum >= 5000 && !achUnlocked.includes("aimtrainer_sharp")) {
        achUnlocked.push("aimtrainer_sharp");
        newAchievements.push("aimtrainer_sharp");
      }
      if (
        difficulty === "hard" &&
        scoreNum >= 10000 &&
        !achUnlocked.includes("aimtrainer_legend")
      ) {
        achUnlocked.push("aimtrainer_legend");
        newAchievements.push("aimtrainer_legend");
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
