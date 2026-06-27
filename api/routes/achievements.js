const express = require("express");
const router = express.Router();

const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { invalidatesCache } = require("../lib/cache");
const { getUsers } = require("../lib/users");
const { userKey, parseRedisArray } = require("../lib/utils");
const { ACHIEVEMENT_DEFS } = require("../lib/achievement-defs");

// GET /api/achievements — requer sessão válida
router.get("/achievements", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const unlockedKey = `achievements:${userKey(user.name)}`;
    const activeKey = `achievement_active:${userKey(user.name)}`;
    const unlocked = parseRedisArray(await kv.get(unlockedKey));
    let active = null;
    try { active = await kv.get(activeKey); } catch { active = null; }

    res.json({ definitions: ACHIEVEMENT_DEFS, unlocked, active: active || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/achievements/set-active — requer sessão válida
router.post("/achievements/set-active", requireAuth, invalidatesCache("cache:profiles"), async (req, res) => {
  try {
    const { achievementId } = req.body;
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const activeKey = `achievement_active:${userKey(user.name)}`;
    if (!achievementId) {
      await kv.del(activeKey);
    } else {
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

module.exports = router;
