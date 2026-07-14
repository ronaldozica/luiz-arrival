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

// Apostas feitas a menos de 15 min do horário real de chegada são suspeitas de
// "sniping". Isso cobre dois casos: quem apostou logo antes de Luiz chegar
// (viu pelo corredor) e quem apostou logo depois (viu chegar mas o admin ainda
// não tinha registrado). Penalização suave: conta 1 LuizCoin de participação,
// mas não concorre a precisão nem ao pódio do dia.
const SNIPING_WINDOW_MS = 15 * 60 * 1000;

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
          invalidated: Math.abs(sinceArrivalMs) <= SNIPING_WINDOW_MS,
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
      const valid = day.rankings.filter((r) => r.position != null);
      const top3 = valid.filter((r) => r.position <= 3);
      for (const entry of top3) {
        if (entry.position === 1) await unlockAchievement(kv, entry.name, "bet_winner");

        const playedBefore = await countPlayedDaysBefore(kv, entry.name, key);
        if (playedBefore < MIN_DAYS_FOR_OVERALL_RANK) {
          await unlockAchievement(kv, entry.name, "novato_em_ascensao");
        }
      }

      // Pior aposta do dia: último da lista válida, só quando há 2+ apostadores
      // (evita dar a mesma pessoa que ganhou quando joga sozinha).
      if (valid.length >= 2) {
        const worst = valid[valid.length - 1];
        await unlockAchievement(kv, worst.name, "bet_loser");
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

// GET /api/admin/password-resets — lista as senhas temporárias pendentes
// (geradas via POST /forgot-password), para o admin copiar e repassar
// particularmente para quem pediu o reset.
router.get("/admin/password-resets", requireAdminAuth, async (req, res) => {
  try {
    const kv = getKV();
    const resets = (await kv.get("password_resets")) || [];
    res.json(resets);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/invalidate-bets — recalcula invalidações de um dia já resolvido,
// aplicando a janela de sniping atual. Útil quando apostas foram feitas após a
// chegada real mas antes do admin registrá-la (reaplicar a regra sem mudar o horário).
router.post("/admin/invalidate-bets", requireAdminAuth, async (req, res) => {
  try {
    const { date } = req.body;
    const kv = getKV();
    const key = date || todayKey();
    const day = await getDayData(kv, key);

    if (!day.arrival) {
      return res.status(400).json({ error: "Nenhuma chegada registrada para este dia." });
    }

    const time = day.arrival;
    const arrivalMins = timeStrToMinutes(time);
    const arrivalInstant = brasiliaWallTimeToInstant(key, time);

    const withDiff = day.guesses.map((g) => {
      const createdAtMs = Date.parse(g.createdAt) || 0;
      const sinceArrivalMs = arrivalInstant - createdAtMs;
      return {
        ...g,
        diff: absDiff(timeStrToMinutes(g.time), arrivalMins),
        invalidated: Math.abs(sinceArrivalMs) <= SNIPING_WINDOW_MS,
      };
    });

    const valid = withDiff
      .filter((g) => !g.invalidated)
      .sort((a, b) => a.diff - b.diff || Date.parse(a.createdAt) - Date.parse(b.createdAt));
    valid.forEach((g, i) => { g.position = i + 1; });

    const invalidated = withDiff.filter((g) => g.invalidated);
    invalidated.forEach((g) => { g.position = null; });

    day.rankings = [...valid, ...invalidated];
    await setDayData(kv, key, day);

    res.json({ success: true, arrival: time, rankings: day.rankings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/password-resets/dismiss — remove uma entrada da lista
// (ex: depois de já ter repassado a senha) sem afetar a senha do usuário.
router.post("/admin/password-resets/dismiss", requireAdminAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Nome é obrigatório." });
    const kv = getKV();
    const resets = (await kv.get("password_resets")) || [];
    const filtered = resets.filter((r) => userKey(r.name) !== userKey(name));
    await kv.set("password_resets", filtered);
    res.json({ success: true, resets: filtered });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/grant-aimtrainer-legend — concede retroativamente a conquista
// "Lenda da mira" a todos os jogadores com 3000+ pontos no aim trainer difícil.
router.post("/admin/grant-aimtrainer-legend", requireAdminAuth, async (req, res) => {
  try {
    const kv = getKV();
    const scores = (await kv.get("gamerank:aimtrainer:hard")) || [];
    const eligible = scores.filter((e) => e.score >= 3000);
    const granted = [];
    for (const entry of eligible) {
      const wasNew = await unlockAchievement(kv, entry.name, "aimtrainer_legend");
      if (wasNew) granted.push(entry.name);
    }
    res.json({ checked: eligible.length, granted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/migrate-aimtrainer-platform — copia scores legados
// (gamerank:aimtrainer:diff) para gamerank:aimtrainer:diff:mobile.
// Seguro de re-executar: pula se a chave mobile já tiver dados.
router.post("/admin/migrate-aimtrainer-platform", requireAdminAuth, async (req, res) => {
  try {
    const kv = getKV();
    const diffs = ["easy", "normal", "hard"];
    const report = [];
    for (const diff of diffs) {
      const oldKey = `gamerank:aimtrainer:${diff}`;
      const newKey = `gamerank:aimtrainer:${diff}:mobile`;
      const existing = await kv.get(newKey);
      if (existing && Array.isArray(existing) && existing.length > 0) {
        report.push({ diff, status: "skipped", reason: "chave mobile já tem dados" });
        continue;
      }
      const scores = await kv.get(oldKey);
      if (!scores || !Array.isArray(scores) || scores.length === 0) {
        report.push({ diff, status: "skipped", reason: "sem dados na chave legada" });
        continue;
      }
      await kv.set(newKey, scores);
      report.push({ diff, status: "migrated", count: scores.length });
    }
    res.json({ success: true, report });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/admin/requests/:id — atualiza status e nota do admin
router.patch("/admin/requests/:id", requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNote } = req.body;
    const validStatuses = ["pending", "approved", "rejected", "done"];
    if (status !== undefined && !validStatuses.includes(status))
      return res.status(400).json({ error: "Status inválido." });

    const kv = getKV();
    const { getRequests, saveRequests } = require("./requests");
    const requests = await getRequests(kv);
    const idx = requests.findIndex((r) => r.id === id);
    if (idx === -1)
      return res.status(404).json({ error: "Pedido não encontrado." });

    if (status !== undefined) requests[idx].status = status;
    if (adminNote !== undefined) requests[idx].adminNote = adminNote || null;
    await saveRequests(kv, requests);
    res.json({ success: true, request: requests[idx] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
