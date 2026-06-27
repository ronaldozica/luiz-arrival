const bcrypt = require("bcryptjs");
const { invalidateCache } = require("./cache");
const { userKey } = require("./utils");

// ─── Gestão de usuários (sem PRESET_USERS hardcoded) ─────────────────────────
// Os usuários HCM agora são definidos pelo campo isHCM=true no banco (Redis),
// gerenciado pelo admin via /api/admin/users. Não há mais usuários hardcoded.

function normalizeUsers(value) {
  if (!value) return [];
  let users = value;
  if (typeof users === "string") {
    try {
      users = JSON.parse(users);
    } catch {
      return [];
    }
  }
  // A partir de agora, os usuários têm passwordHash em vez de password
  return Array.isArray(users)
    ? users.filter(
        (u) =>
          u && typeof u.name === "string" && (typeof u.passwordHash === "string" || typeof u.password === "string"),
      )
    : [];
}

async function getUsers(kv) {
  try {
    const value = await kv.get("users");
    return normalizeUsers(value);
  } catch {
    return [];
  }
}

async function saveUsers(kv, users) {
  // Nunca salva a senha em texto plano — apenas passwordHash
  const sanitized = users.map(({ password, ...rest }) => rest);
  await kv.set("users", sanitized);
  await invalidateCache(kv, "cache:overall_rank", "cache:profiles");
}

// Verifica a senha de um usuário comparando com o hash armazenado.
// Suporta migração: se o usuário ainda tem 'password' em texto plano (legado),
// verifica em texto plano, depois migra para hash automaticamente.
async function verifyUserPassword(kv, user, plainPassword) {
  if (user.passwordHash) {
    return bcrypt.compare(plainPassword, user.passwordHash);
  }
  // Migração legada: usuário tem password em texto plano
  if (user.password && user.password === plainPassword) {
    // Migra para hash automaticamente
    const hash = await bcrypt.hash(plainPassword, 12);
    const allUsers = await getUsers(kv);
    const idx = allUsers.findIndex((u) => userKey(u.name) === userKey(user.name));
    if (idx >= 0) {
      allUsers[idx].passwordHash = hash;
      delete allUsers[idx].password;
      await saveUsers(kv, allUsers);
    }
    return true;
  }
  return false;
}

module.exports = { normalizeUsers, getUsers, saveUsers, verifyUserPassword };
