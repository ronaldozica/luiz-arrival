const express = require("express");
const router = express.Router();
const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");

async function getRequests(kv) {
  const raw = await kv.get("requests");
  if (!raw) return [];
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function saveRequests(kv, requests) {
  await kv.set("requests", JSON.stringify(requests));
}

// GET /api/requests — board público, sem autenticação
router.get("/requests", async (req, res) => {
  try {
    const kv = getKV();
    const requests = await getRequests(kv);
    res.json(requests.slice().reverse());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/requests — cria novo pedido (auth required)
router.post("/requests", requireAuth, async (req, res) => {
  try {
    const { type, text } = req.body;
    if (!["feature", "bug"].includes(type))
      return res.status(400).json({ error: "Tipo inválido." });
    if (!text || typeof text !== "string" || text.trim().length < 5)
      return res.status(400).json({ error: "Texto muito curto (mín. 5 caracteres)." });
    if (text.trim().length > 500)
      return res.status(400).json({ error: "Texto muito longo (máx. 500 caracteres)." });

    const kv = getKV();
    const requests = await getRequests(kv);
    const newRequest = {
      id: Date.now().toString(),
      type,
      text: text.trim(),
      author: req.sessionName,
      createdAt: new Date().toISOString(),
      status: "pending",
      adminNote: null,
    };
    requests.push(newRequest);
    await saveRequests(kv, requests);
    res.json({ success: true, request: newRequest });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, getRequests, saveRequests };
