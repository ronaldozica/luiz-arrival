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
const { todayKey, timeStrToMinutes } = require("../lib/datetime");
const { userKey, absDiff, parseRedisNumber, parseRedisArray } = require("../lib/utils");

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
