const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();

const { getKV } = require("../lib/redis");
const { getUsers, saveUsers, verifyUserPassword } = require("../lib/users");
const { createUserSession, getBearerToken, SESSION_PREFIX } = require("../lib/session");
const { userKey } = require("../lib/utils");
const { requireAuth } = require("../lib/auth-middleware");

// GET /api/users — retorna apenas nome e isHCM (sem senha)
router.get("/users", async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    res.json(
      users.map((u) => ({
        name: u.name,
        isHCM: !!u.isHCM,
      })),
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/login — retorna um token de sessão em vez de repassar a senha
router.post("/login", async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password)
      return res.status(400).json({ error: "Nome e senha são obrigatórios." });

    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(name));
    if (!user) return res.status(401).json({ error: "Nome ou senha incorretos." });

    const valid = await verifyUserPassword(kv, user, password);
    if (!valid) return res.status(401).json({ error: "Nome ou senha incorretos." });

    const token = await createUserSession(kv, user.name);
    res.json({
      token,
      name: user.name,
      isHCM: !!user.isHCM,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/logout
router.post("/logout", async (req, res) => {
  const token = getBearerToken(req);
  if (token) {
    const kv = getKV();
    await kv.del(`${SESSION_PREFIX}${token}`);
  }
  res.json({ success: true });
});

// POST /api/register
router.post("/register", async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password)
      return res.status(400).json({ error: "Nome e senha são obrigatórios." });

    const kv = getKV();
    const users = await getUsers(kv);
    const exists = users.find((u) => userKey(u.name) === userKey(name));
    if (exists) return res.status(409).json({ error: "Usuário já existe." });

    const passwordHash = await bcrypt.hash(password, 12);
    const newUser = { name: name.trim(), passwordHash, isHCM: false };
    users.push(newUser);
    await saveUsers(kv, users);

    res.json({ success: true, name: newUser.name, isHCM: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/session-check — verifica se o token de sessão atual ainda é válido
router.get("/session-check", requireAuth, async (req, res) => {
  res.json({ valid: true });
});

module.exports = router;
