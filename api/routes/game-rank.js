const express = require("express");
const router = express.Router();
const crypto = require("crypto");

const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { invalidatesCache } = require("../lib/cache");
const { getUsers } = require("../lib/users");
const { userKey, parseRedisArray, parseRedisNumber } = require("../lib/utils");
const { calcBalance } = require("../lib/store-items");
const { GAMES, minPlausibleSeconds, ARCADE_ENTRY_FEE } = require("../lib/games");

// TTL generoso pra dar tempo de partidas longas (Sudoku/Spider difícil).
const ROUND_TOKEN_TTL_SECONDS = 2 * 60 * 60;
// Margem pra latência de rede/clock drift entre cliente e servidor.
const ROUND_TOKEN_TOLERANCE_SECONDS = 2;

const DIFFICULTIES_BY_GAME = Object.fromEntries(
  Object.entries(GAMES)
    .filter(([, cfg]) => cfg.difficulties)
    .map(([game, cfg]) => [game, cfg.difficulties]),
);

const RANK_SIZE = 50;

// Mutex atômico por usuário: impede que dois /start simultâneos cobrem a
// ficha duas vezes (TOCTOU race), mesmo padrão de acquireFarmLock/acquireBjLock.
async function acquireGameLock(kv, uKey) {
  const result = await kv.set(`gamelock:${uKey}`, "1", { nx: true, ex: 15 });
  return result !== null;
}
async function releaseGameLock(kv, uKey) {
  await kv.del(`gamelock:${uKey}`);
}

// GET /api/game-rank
router.get("/game-rank", async (req, res) => {
  try {
    const { game, difficulty, platform } = req.query;
    if (!game) return res.status(400).json({ error: "game é obrigatório." });
    const kv = getKV();
    let scores;
    if (game === "aimtrainer" && difficulty && platform) {
      const platformKey = `gamerank:aimtrainer:${difficulty}:${platform}`;
      const platformScores = await kv.get(platformKey);
      if (platformScores && Array.isArray(platformScores) && platformScores.length > 0) {
        scores = platformScores;
      } else if (platform === "mobile") {
        // Fallback: dados legados ainda não migrados vão para o mobile
        scores = (await kv.get(`gamerank:aimtrainer:${difficulty}`)) || [];
      } else {
        scores = [];
      }
    } else {
      const rankKey = difficulty ? `gamerank:${game}:${difficulty}` : `gamerank:${game}`;
      scores = (await kv.get(rankKey)) || [];
    }
    res.json(scores);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/game-rank/start — requer sessão válida; cobra a ficha de entrada
// (ARCADE_ENTRY_FEE) e emite um token de rodada que precisa ser enviado de
// volta em POST /api/game-rank (vitória) ou /api/game-rank/forfeit (derrota).
// Guarda o horário real de início no servidor, pra depois calcular se o score
// enviado é fisicamente plausível pro tempo decorrido (anti-trapaça: impede
// tanto forjar a requisição sem jogar quanto editar a variável de score no
// console e enviar na hora) — e agora também pra calcular o troco da ficha.
router.post("/game-rank/start", requireAuth, async (req, res) => {
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
  const uKey = userKey(playerName);
  if (!(await acquireGameLock(kv, uKey)))
    return res.status(429).json({ error: "Operação em andamento. Tente novamente." });

  try {
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === uKey);
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const { earnedCoins, spentCoins } = await calcBalance(kv, user, users);
    const balance = Math.max(0, earnedCoins - spentCoins);
    if (balance < ARCADE_ENTRY_FEE) {
      return res.status(400).json({ error: "LuizCoins™ insuficientes." });
    }

    const gameSpentKey = `gamespent:${uKey}`;
    const currentSpent = parseRedisNumber(await kv.get(gameSpentKey));
    await kv.set(gameSpentKey, currentSpent + ARCADE_ENTRY_FEE);

    const roundToken = crypto.randomBytes(24).toString("hex");
    await kv.set(
      `roundtoken:${roundToken}`,
      JSON.stringify({ name: playerName, game, difficulty: difficulty || null, startedAt: Date.now() }),
      { ex: ROUND_TOKEN_TTL_SECONDS },
    );

    res.json({ roundToken, balance: balance - ARCADE_ENTRY_FEE });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await releaseGameLock(kv, uKey);
  }
});

// POST /api/game-rank/forfeit — requer sessão válida; fecha uma rodada
// perdida (Campo Minado/Sudoku/Spider não vencidos). A ficha já foi debitada
// em /start — este endpoint só consome o roundToken (uso único, evita
// reaproveitar o mesmo token depois) e devolve o saldo atual pra UI.
router.post("/game-rank/forfeit", requireAuth, async (req, res) => {
  try {
    const { roundToken } = req.body;
    const playerName = req.sessionName;
    if (!roundToken) return res.status(400).json({ error: "Token de rodada ausente." });

    const kv = getKV();
    const tokenKey = `roundtoken:${roundToken}`;
    const tokenRaw = await kv.get(tokenKey);
    await kv.del(tokenKey);
    if (!tokenRaw) {
      return res.status(400).json({ error: "Token de rodada inválido ou expirado." });
    }
    const tokenData = typeof tokenRaw === "string" ? JSON.parse(tokenRaw) : tokenRaw;
    if (userKey(tokenData.name) !== userKey(playerName)) {
      return res.status(400).json({ error: "Token de rodada não corresponde ao jogador." });
    }

    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(playerName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });
    const { earnedCoins, spentCoins } = await calcBalance(kv, user, users);
    const balance = Math.max(0, earnedCoins - spentCoins);

    res.json({ success: true, balance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Troco da ficha de fliperama (ARCADE_ENTRY_FEE = 10 LC) ───────────────────
// Faixas calibradas a partir da distribuição real de scores em produção
// (gamerank:*): mediano ≈ recupera a ficha, faixas boas lucram, ruim = 0.
// Campo Minado/Sudoku/Spider só chegam aqui em vitória (derrota vai por
// /game-rank/forfeit, que não paga nada) — por isso usam elapsedSeconds
// (vindo do roundToken, não do cliente) em vez do score pra definir a faixa.
// Snake/Aim Trainer não têm conceito de vitória/derrota — o score baixo já
// cobre o caso "ruim" (paga 0) sem precisar de um caminho de derrota à parte.
// value >= min mais alto vence — pra métricas onde "maior é melhor" (score).
function tierByMin(value, thresholds) {
  for (const [min, payout] of thresholds) {
    if (value >= min) return payout;
  }
  return 0;
}

// value <= max mais baixo vence — pra métricas onde "menor é melhor" (tempo).
function tierByMax(value, thresholds) {
  for (const [max, payout] of thresholds) {
    if (value <= max) return payout;
  }
  return thresholds[thresholds.length - 1][1];
}

function computeArcadePayout(game, difficulty, { scoreNum, elapsedSeconds }) {
  if (game === "snake") {
    return tierByMin(scoreNum, [[600, 25], [450, 16], [300, 10], [120, 5]]);
  }
  if (game === "aimtrainer") {
    const bands = {
      easy:   [[5500, 25], [4200, 16], [2500, 10], [800, 5]],
      normal: [[4000, 25], [2700, 16], [1500, 10], [500, 5]],
      hard:   [[3200, 25], [2200, 16], [1200, 10], [400, 5]],
    };
    return tierByMin(scoreNum, bands[difficulty] || bands.normal);
  }
  if (game === "minesweeper") {
    if (difficulty === "beginner") return elapsedSeconds < 15 ? 14 : 10;
    if (difficulty === "intermediate") return tierByMax(elapsedSeconds, [[45, 22], [120, 15], [Infinity, 10]]);
    if (difficulty === "expert") return tierByMax(elapsedSeconds, [[150, 30], [300, 20], [Infinity, 12]]);
    return 10;
  }
  if (game === "sudoku") {
    if (difficulty === "easy") return elapsedSeconds < 120 ? 16 : 12;
    if (difficulty === "medium") return tierByMax(elapsedSeconds, [[420, 22], [720, 15], [Infinity, 10]]);
    if (difficulty === "hard") return tierByMax(elapsedSeconds, [[900, 32], [1500, 20], [Infinity, 12]]);
    return 10;
  }
  if (game === "spider") {
    if (difficulty === "easy") return elapsedSeconds < 300 ? 16 : 12;
    if (difficulty === "medium") return tierByMax(elapsedSeconds, [[600, 22], [1200, 15], [Infinity, 10]]);
    if (difficulty === "hard") return tierByMax(elapsedSeconds, [[900, 32], [1800, 20], [Infinity, 12]]);
    return 10;
  }
  if (game === "2048") {
    // Sem dados históricos (jogo novo) — calibrado pelos marcos clássicos do
    // jogo (score cresce com o valor das peças fundidas), mesmo espírito de
    // "número de partida" do rebalanceamento da fazenda: ajustável depois.
    return tierByMin(scoreNum, [[8000, 28], [3000, 18], [1000, 10], [300, 5]]);
  }
  return 0;
}

// POST /api/game-rank — requer sessão válida; playerName vem do token, não do body
// Proteção contra burla: o servidor ignora qualquer playerName enviado pelo cliente.
// O score é validado contra limites razoáveis por jogo, e contra o tempo real
// decorrido desde POST /api/game-rank/start (ver roundToken abaixo).
router.post("/game-rank", requireAuth, invalidatesCache("cache:top1_all_games"), async (req, res) => {
  try {
    const { game, difficulty, score, hintsUsed, undoUsed, roundToken, platform, maxTile } = req.body;
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
      "2048": 4000000,        // 2048: bem acima do máximo teórico de uma partida real
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

    let rankKey;
    if (game === "aimtrainer" && difficulty) {
      const atPlatform = platform === "desktop" ? "desktop" : "mobile";
      rankKey = `gamerank:aimtrainer:${difficulty}:${atPlatform}`;
    } else if (difficulty) {
      rankKey = `gamerank:${game}:${difficulty}`;
    } else {
      rankKey = `gamerank:${game}`;
    }
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

    // ─── TROCO DA FICHA (fliperama) ───
    // A ficha (ARCADE_ENTRY_FEE) já foi debitada em /game-rank/start; aqui só
    // calculamos o troco (pode ser menos, igual ou mais que a ficha).
    const coinsEarned = computeArcadePayout(game, difficulty, { scoreNum, elapsedSeconds });
    if (coinsEarned > 0) {
      const coinsKey = `gamecoins:${userKey(playerName)}`;
      const existingCoins = parseRedisNumber(await kv.get(coinsKey));
      await kv.set(coinsKey, existingCoins + coinsEarned);
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
      const atPlatform = platform === "desktop" ? "desktop" : "mobile";
      const sharpId = atPlatform === "desktop" ? "aimtrainer_sharp_desktop" : "aimtrainer_sharp";
      const legendId = atPlatform === "desktop" ? "aimtrainer_legend_desktop" : "aimtrainer_legend";
      if (scoreNum >= 5000 && !achUnlocked.includes(sharpId)) {
        achUnlocked.push(sharpId);
        newAchievements.push(sharpId);
      }
      if (difficulty === "hard" && scoreNum >= 3000 && !achUnlocked.includes(legendId)) {
        achUnlocked.push(legendId);
        newAchievements.push(legendId);
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

    if (game === "2048") {
      const maxTileNum = Number(maxTile) || 0;
      if (maxTileNum >= 2048 && !achUnlocked.includes("game2048_2048")) {
        achUnlocked.push("game2048_2048");
        newAchievements.push("game2048_2048");
      }
      if (maxTileNum >= 4096 && !achUnlocked.includes("game2048_4096")) {
        achUnlocked.push("game2048_4096");
        newAchievements.push("game2048_4096");
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
