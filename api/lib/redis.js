const { Redis } = require("@upstash/redis");

// ─── Redis Client (Upstash) ──────────────────────────────────────────────────
function getKV() {
  return new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
}

module.exports = { getKV };
