const { getKV } = require("./redis");
const { getBearerToken, resolveUserSession, resolveAdminSession } = require("./session");

// ─── Middleware de autenticação ───────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  const kv = getKV();
  const name = await resolveUserSession(kv, token);

  if (!name) return res.status(401).json({ error: "Sessão inválida ou expirada. Faça login novamente." });
  req.sessionName = name;
  next();
}

async function requireAdminAuth(req, res, next) {
  const token = getBearerToken(req);
  const kv = getKV();
  const valid = await resolveAdminSession(kv, token);
  if (!valid) {
    return res.status(401).json({ error: "Acesso de admin negado." });
  }
  next();
}

module.exports = { requireAuth, requireAdminAuth };
