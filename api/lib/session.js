const crypto = require("crypto");

// ─── Session tokens ──────────────────────────────────────────────────────────
// Tokens de sessão persistidos no Redis para suportar execução serverless.
// Sessões são permanentes: só são removidas no logout explícito.
const SESSION_PREFIX = "session:";
const ADMIN_SESSION_KEY = "admin_session";
const ADMIN_SESSION_EXPIRY_KEY = "admin_session_expiry";

// Extrai o token do header Authorization: Bearer <token>
function getBearerToken(req) {
  const auth = req.headers["authorization"] || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

async function createUserSession(kv, name) {
  const token = crypto.randomBytes(32).toString("hex");
  const session = { name };
  await kv.set(`${SESSION_PREFIX}${token}`, JSON.stringify(session));
  return token;
}

async function resolveUserSession(kv, token) {
  if (!token) return null;
  const raw = await kv.get(`${SESSION_PREFIX}${token}`);
  if (!raw) return null;
  let session;
  try {
    session = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!session) return null;
  return session.name;
}

async function setAdminSession(kv, token, expiresAt) {
  await kv.set(ADMIN_SESSION_KEY, token);
  await kv.set(ADMIN_SESSION_EXPIRY_KEY, String(expiresAt));
}

async function resolveAdminSession(kv, token) {
  if (!token) return false;
  const storedToken = await kv.get(ADMIN_SESSION_KEY);
  const expiry = Number(await kv.get(ADMIN_SESSION_EXPIRY_KEY));
  return token === storedToken && Number.isFinite(expiry) && Date.now() <= expiry;
}

module.exports = {
  SESSION_PREFIX,
  ADMIN_SESSION_KEY,
  ADMIN_SESSION_EXPIRY_KEY,
  getBearerToken,
  createUserSession,
  resolveUserSession,
  setAdminSession,
  resolveAdminSession,
};
