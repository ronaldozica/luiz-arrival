// A senha de admin deve ser forte e definida via variável de ambiente.
// Exemplo: ADMIN_PASSWORD=xK#9mP!vQ2rL@nZ
// Nunca use "admin123" ou qualquer senha fraca em produção.
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
if (!ADMIN_PASSWORD_HASH) {
  console.warn(
    "[AVISO] ADMIN_PASSWORD_HASH não definida no .env.local. " +
    "Gere com: node -e \"const b=require('bcryptjs'); console.log(b.hashSync(process.env.ADMIN_PW, 12))\" ADMIN_PW=suaSenhaForte"
  );
}

module.exports = { ADMIN_PASSWORD_HASH };
