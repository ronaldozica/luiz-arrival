const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const router = express.Router();

const { getKV } = require("../lib/redis");
const { getUsers, saveUsers, verifyUserPassword } = require("../lib/users");
const { createUserSession, getBearerToken, SESSION_PREFIX } = require("../lib/session");
const { userKey } = require("../lib/utils");
const { requireAuth } = require("../lib/auth-middleware");

// ─── Reset de senha (fluxo manual via admin) ─────────────────────────────────
// Não há e-mail/SMS neste app — "esqueci minha senha" gera uma senha
// temporária, marca a conta para troca obrigatória no próximo login, e deixa
// a senha em texto plano visível só para o admin (aba "Senhas temporárias"),
// que repassa particularmente para quem pediu. Ver POST /admin/password-resets
// em admin.js.
const PASSWORD_RESETS_KEY = "password_resets";

function genTempPassword() {
  return crypto.randomBytes(6).toString("base64url");
}

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
      mustChangePassword: !!user.mustChangePassword,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/forgot-password — gera uma senha temporária e força troca no
// próximo login. A senha em si NUNCA é devolvida nesta resposta — só fica
// visível para o admin (GET /admin/password-resets), que repassa
// particularmente para quem pediu o reset.
router.post("/forgot-password", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Nome é obrigatório." });

    const kv = getKV();
    const users = await getUsers(kv);
    const idx = users.findIndex((u) => userKey(u.name) === userKey(name));
    // Resposta genérica independente de o nome existir, para não revelar
    // quais nomes têm conta — mas só executa o reset se existir de fato.
    if (idx === -1) return res.json({ success: true });

    const tempPassword = genTempPassword();
    users[idx].passwordHash = await bcrypt.hash(tempPassword, 12);
    users[idx].mustChangePassword = true;
    await saveUsers(kv, users);

    const resets = (await kv.get(PASSWORD_RESETS_KEY)) || [];
    const filtered = resets.filter((r) => userKey(r.name) !== userKey(users[idx].name));
    filtered.push({ name: users[idx].name, password: tempPassword, createdAt: new Date().toISOString() });
    await kv.set(PASSWORD_RESETS_KEY, filtered);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/change-password — requer sessão válida; usado tanto pela troca
// obrigatória após um reset quanto por uma troca voluntária futura.
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: "Senha deve ter ao menos 4 caracteres." });
    }

    const kv = getKV();
    const users = await getUsers(kv);
    const idx = users.findIndex((u) => userKey(u.name) === userKey(req.sessionName));
    if (idx === -1) return res.status(404).json({ error: "Usuário não encontrado." });

    users[idx].passwordHash = await bcrypt.hash(newPassword, 12);
    delete users[idx].mustChangePassword;
    await saveUsers(kv, users);

    const resets = (await kv.get(PASSWORD_RESETS_KEY)) || [];
    const filtered = resets.filter((r) => userKey(r.name) !== userKey(req.sessionName));
    if (filtered.length !== resets.length) await kv.set(PASSWORD_RESETS_KEY, filtered);

    res.json({ success: true });
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
