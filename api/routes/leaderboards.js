const express = require("express");
const router = express.Router();

const { getKV } = require("../lib/redis");
const { getCachedOrCompute } = require("../lib/cache");
const { getUsers } = require("../lib/users");
const { userKey, parseRedisArray } = require("../lib/utils");
const { GAMES } = require("../lib/games");
const { ACHIEVEMENT_DEFS } = require("../lib/achievement-defs");

// GET /api/leaderboards/top1 — melhor jogador de cada jogo+dificuldade.
// Os dados já existem prontos nas chaves gamerank:<game>[:<difficulty>]
// (arrays ordenados por score); aqui só agregamos o 1º lugar de cada uma.
// Cacheado sob uma única chave e invalidado em POST /api/game-rank
// (ver invalidatesCache("cache:top1_all_games") em game-rank.js).
router.get("/leaderboards/top1", async (req, res) => {
  try {
    const kv = getKV();
    const data = await getCachedOrCompute(kv, "cache:top1_all_games", async () => {
      const entries = []; // [game, difficulty|null]
      for (const [game, cfg] of Object.entries(GAMES)) {
        if (cfg.difficulties) cfg.difficulties.forEach((d) => entries.push([game, d]));
        else entries.push([game, null]);
      }

      const results = await Promise.all(
        entries.map(([game, diff]) => {
          const key = diff ? `gamerank:${game}:${diff}` : `gamerank:${game}`;
          return kv.get(key);
        }),
      );

      const out = {};
      entries.forEach(([game, diff], i) => {
        const scores = results[i] || [];
        if (!out[game]) out[game] = {};
        out[game][diff || "default"] = scores[0] || null;
      });
      return out;
    });

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/leaderboards/achievements — top 10 jogadores com mais conquistas.
// Itera todos os usuários (1 leitura por usuário), por isso é cacheado sob
// uma única chave com TTL de segurança (sem invalidação explícita: as
// conquistas são desbloqueadas em vários pontos espalhados do código e o
// atraso de poucos minutos é uma troca aceitável pela simplicidade).
router.get("/leaderboards/achievements", async (req, res) => {
  try {
    const kv = getKV();
    const data = await getCachedOrCompute(kv, "cache:achievements_leaderboard", async () => {
      const users = await getUsers(kv);
      const results = await Promise.all(
        users.map(async (u) => {
          const unlocked = parseRedisArray(await kv.get(`achievements:${userKey(u.name)}`));
          return { name: u.name, achievements: unlocked, count: unlocked.length };
        }),
      );
      const top = results
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      return { definitions: ACHIEVEMENT_DEFS, top };
    });

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
