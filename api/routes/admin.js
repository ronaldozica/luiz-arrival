const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const router = express.Router();

const { getKV } = require("../lib/redis");
const { ADMIN_PASSWORD_HASH } = require("../lib/config");
const { setAdminSession } = require("../lib/session");
const { requireAdminAuth } = require("../lib/auth-middleware");
const { getUsers, saveUsers } = require("../lib/users");
const { getDayData, setDayData } = require("../lib/days");
const { todayKey, timeStrToMinutes, brasiliaWallTimeToInstant, getWeekKey } = require("../lib/datetime");
const { userKey, absDiff, parseRedisNumber } = require("../lib/utils");
const { unlockAchievement } = require("../lib/achievement-defs");
const { countPlayedDaysBefore, computeWeekRanking, MIN_DAYS_FOR_OVERALL_RANK } = require("../lib/rankings");
const { calcBalance } = require("../lib/store-items");

// Apostas feitas a menos de 30min do horário real de chegada são suspeitas de
// "sniping" (jogador viu o Luiz chegar e apostou antes do admin registrar).
// Penalização é suave: a aposta continua valendo para fins de participação
// (1 LuizCoin), mas não concorre a precisão nem ao pódio do dia.
const SNIPING_WINDOW_MS = 30 * 60 * 1000;

// POST /api/admin/login — autentica com bcrypt e retorna token de admin
router.post("/admin/login", async (req, res) => {
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
router.post("/admin/arrival", requireAdminAuth, async (req, res) => {
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
      const arrivalInstant = brasiliaWallTimeToInstant(key, time);

      // Quem apostou nos 30min antes da chegada real entra como "invalidated"
      // (suspeita de sniping) — ainda aparece na lista, mas não concorre a
      // precisão/pódio. Empates de diferença são desempatados por quem
      // apostou primeiro (createdAt mais antigo vence), então não há mais
      // posições compartilhadas.
      const withDiff = day.guesses.map((g) => {
        const createdAtMs = Date.parse(g.createdAt) || 0;
        const sinceArrivalMs = arrivalInstant - createdAtMs;
        return {
          ...g,
          diff: absDiff(timeStrToMinutes(g.time), arrivalMins),
          invalidated: sinceArrivalMs >= 0 && sinceArrivalMs <= SNIPING_WINDOW_MS,
        };
      });

      const valid = withDiff
        .filter((g) => !g.invalidated)
        .sort((a, b) => a.diff - b.diff || Date.parse(a.createdAt) - Date.parse(b.createdAt));
      valid.forEach((g, i) => { g.position = i + 1; });

      const invalidated = withDiff.filter((g) => g.invalidated);
      invalidated.forEach((g) => { g.position = null; });

      day.rankings = [...valid, ...invalidated];
    } else {
      day.rankings = [];
    }

    await setDayData(kv, key, day);

    // Conquistas ligadas ao resultado do dia
    if (day.rankings && day.rankings.length > 0) {
      const top3 = day.rankings.filter((r) => r.position && r.position <= 3);
      for (const entry of top3) {
        if (entry.position === 1) await unlockAchievement(kv, entry.name, "bet_winner");

        const playedBefore = await countPlayedDaysBefore(kv, entry.name, key);
        if (playedBefore < MIN_DAYS_FOR_OVERALL_RANK) {
          await unlockAchievement(kv, entry.name, "novato_em_ascensao");
        }
      }
    }

    // Conquistas semanais: avaliadas quando o dia resolvido é uma sexta-feira,
    // tratada como "fim de semana de apostas" (não há cron job no projeto —
    // se uma sexta não tiver chegada registrada, a conquista daquela semana
    // simplesmente não dispara).
    const [y, m, d] = key.split("-").map(Number);
    const isFriday = new Date(y, m - 1, d).getDay() === 5;
    if (isFriday) {
      const users = await getUsers(kv);
      const weekKey = getWeekKey(key);
      const { ranking } = await computeWeekRanking(kv, users, weekKey);
      for (let i = 0; i < Math.min(3, ranking.length); i++) {
        if (i === 0) await unlockAchievement(kv, ranking[i].name, "weekly_champion");
        await unlockAchievement(kv, ranking[i].name, "weekly_top3");
      }
    }

    res.json({ success: true, arrival: time, rankings: day.rankings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/users — lista todos os usuários (admin only, sem hashes)
router.get("/admin/users", requireAdminAuth, async (req, res) => {
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
router.post("/admin/users", requireAdminAuth, async (req, res) => {
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

// GET /api/admin/coins/all — saldo de LuizCoins de todos os jogadores de uma vez (admin only)
router.get("/admin/coins/all", requireAdminAuth, async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    const balances = [];
    for (const user of users) {
      const { earnedCoins, spentCoins, gameCoins } = await calcBalance(kv, user, users);
      balances.push({
        name: user.name,
        balance: Math.max(0, earnedCoins - spentCoins),
        earnedCoins,
        spentCoins,
        gameCoins,
      });
    }
    balances.sort((a, b) => b.balance - a.balance);
    res.json(balances);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/coins/adjust — adiciona ou remove luizCoins de um jogador (admin only)
// Body: { name, amount } — amount pode ser negativo para remover moedas.
router.post("/admin/coins/adjust", requireAdminAuth, async (req, res) => {
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
router.delete("/admin/users/:name", requireAdminAuth, async (req, res) => {
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

// POST /api/admin/game-rank/delete — remove o recorde de um jogador (anti-trapaça)
// Funciona para qualquer jogo (game[:difficulty]) presente ou futuro.
router.post("/admin/game-rank/delete", requireAdminAuth, async (req, res) => {
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

module.exports = router;
