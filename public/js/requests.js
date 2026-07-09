function openRequestsWindow() {
  openWindow("win-requests");
  updateRequestsFormVisibility();
  loadRequests();
}

function updateRequestsFormVisibility() {
  const loggedIn = !!currentUser;
  document.getElementById("requests-login-hint").style.display = loggedIn ? "none" : "block";
  document.getElementById("requests-submit-form").style.display = loggedIn ? "block" : "none";
}

async function loadRequests() {
  const list = document.getElementById("requests-list");
  list.innerHTML = '<div class="no-data">⏳ Carregando...</div>';
  try {
    const res = await fetch(`${API}/requests`);
    const data = await res.json();
    if (!res.ok) {
      list.innerHTML = `<div class="no-data">❌ ${data.error}</div>`;
      return;
    }
    if (data.length === 0) {
      list.innerHTML = '<div class="no-data">Nenhum pedido ainda. Seja o primeiro!</div>';
      return;
    }
    list.innerHTML = data.map(renderRequestCard).join("");
  } catch {
    list.innerHTML = '<div class="no-data">Erro de conexão.</div>';
  }
}

function renderRequestCard(r) {
  const typeLabel = r.type === "bug" ? "🐛 Bug" : "💡 Sugestão";
  const statusMap = {
    pending:  { label: "⏳ Pendente",      color: "#666" },
    approved: { label: "✅ Aprovado",      color: "#006400" },
    rejected: { label: "❌ Recusado",      color: "#8b0000" },
    done:     { label: "🚀 Implementado",  color: "#000080" },
  };
  const st = statusMap[r.status] || { label: r.status, color: "#000" };
  const date = new Date(r.createdAt).toLocaleDateString("pt-BR");
  const adminNoteHtml = r.adminNote
    ? `<div style="margin-top:6px;padding:5px 8px;background:#f0f0f0;border-left:3px solid #808080;font-size:11px"><strong>Admin:</strong> ${escapeHtml(r.adminNote)}</div>`
    : "";
  return `
    <div style="border:1px solid #c0c0c0;padding:8px 10px;margin-bottom:8px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:11px;font-weight:bold">${escapeHtml(r.author)}</span>
        <span style="font-size:10px;color:#666">${date}</span>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <span style="font-size:10px;background:#e0e0e0;padding:1px 6px">${typeLabel}</span>
        <span style="font-size:10px;color:${st.color};font-weight:bold">${st.label}</span>
      </div>
      <div style="font-size:12px;line-height:1.4;word-break:break-word">${escapeHtml(r.text)}</div>
      ${adminNoteHtml}
    </div>`;
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function submitRequest() {
  const type = document.getElementById("requests-type").value;
  const text = document.getElementById("requests-text").value;
  const msg = document.getElementById("requests-submit-msg");
  try {
    const res = await fetch(`${API}/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sessionToken}` },
      body: JSON.stringify({ type, text }),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, "✅ Enviado com sucesso!", "ok");
      document.getElementById("requests-text").value = "";
      document.getElementById("requests-char-count").textContent = "0/500";
      loadRequests();
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  }
}

// ── Admin ────────────────────────────────────────────────────────────────────

async function loadAdminRequests() {
  const msg = document.getElementById("admin-requests-msg");
  const result = document.getElementById("admin-requests-result");
  result.innerHTML = '<div class="no-data">⏳ Carregando...</div>';
  try {
    const res = await fetch(`${API}/requests`);
    const data = await res.json();
    if (!res.ok) {
      showMsg(msg, `❌ ${data.error}`, "err");
      result.innerHTML = "";
      return;
    }
    if (data.length === 0) {
      result.innerHTML = '<div class="no-data">Nenhum pedido registrado.</div>';
      return;
    }
    result.innerHTML = data.map(renderAdminRequestCard).join("");
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
    result.innerHTML = "";
  }
}

function renderAdminRequestCard(r) {
  const typeLabel = r.type === "bug" ? "🐛 Bug" : "💡 Sugestão";
  const date = new Date(r.createdAt).toLocaleDateString("pt-BR");
  return `
    <div style="border:1px solid #c0c0c0;padding:8px 10px;margin-bottom:10px;background:#fff" id="admin-req-${r.id}">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:11px;font-weight:bold">${escapeHtml(r.author)} <span style="font-size:10px;background:#e0e0e0;padding:1px 5px">${typeLabel}</span></span>
        <span style="font-size:10px;color:#666">${date}</span>
      </div>
      <div style="font-size:12px;line-height:1.4;margin-bottom:8px;word-break:break-word">${escapeHtml(r.text)}</div>
      <div class="field-group" style="margin-bottom:4px">
        <label style="font-size:11px">Status:</label>
        <select id="admin-req-status-${r.id}" style="font-size:11px">
          <option value="pending"  ${r.status==="pending"  ? "selected":""}>⏳ Pendente</option>
          <option value="approved" ${r.status==="approved" ? "selected":""}>✅ Aprovado</option>
          <option value="rejected" ${r.status==="rejected" ? "selected":""}>❌ Recusado</option>
          <option value="done"     ${r.status==="done"     ? "selected":""}>🚀 Implementado</option>
        </select>
      </div>
      <div class="field-group" style="margin-bottom:6px">
        <label style="font-size:11px">Nota (opcional):</label>
        <input type="text" id="admin-req-note-${r.id}" value="${escapeHtml(r.adminNote || "")}"
          placeholder="Resposta visível a todos..." style="font-size:11px;width:100%;box-sizing:border-box" />
      </div>
      <div class="btn-row">
        <button class="win95-action-btn" style="font-size:11px" onclick="saveAdminRequest('${r.id}')">💾 Salvar</button>
      </div>
      <div class="win95-msg" id="admin-req-msg-${r.id}"></div>
    </div>`;
}

async function saveAdminRequest(id) {
  const status = document.getElementById(`admin-req-status-${id}`).value;
  const adminNote = document.getElementById(`admin-req-note-${id}`).value;
  const msg = document.getElementById(`admin-req-msg-${id}`);
  try {
    const res = await fetch(`${API}/admin/requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: JSON.stringify({ status, adminNote }),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, "✅ Salvo!", "ok");
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
      handleAdminAuthError(res.status);
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  }
}
