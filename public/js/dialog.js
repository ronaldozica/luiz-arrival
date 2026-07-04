// ─── Diálogos Win95 ──────────────────────────────────────────────────────────
// Substitutos estilizados para alert() e confirm() do navegador.
// Uso: await w95alert("mensagem")
//      const ok = await w95confirm("pergunta")

function _w95dialog(message, type) {
  return new Promise((resolve) => {
    const overlay   = document.getElementById("w95-dialog-overlay");
    const iconEl    = document.getElementById("w95-dialog-icon");
    const msgEl     = document.getElementById("w95-dialog-msg");
    const okBtn     = document.getElementById("w95-dialog-ok");
    const cancelBtn = document.getElementById("w95-dialog-cancel");
    if (!overlay) { resolve(type === "confirm" ? window.confirm(message) : window.alert(message)); return; }

    if (type === "confirm") {
      iconEl.textContent = "❓";
      cancelBtn.style.display = "";
      okBtn.textContent = "OK";
    } else if (/^❌|^Erro/i.test(message)) {
      iconEl.textContent = "❌";
      cancelBtn.style.display = "none";
      okBtn.textContent = "OK";
    } else if (/^⚠|murcho|insuficiente/i.test(message)) {
      iconEl.textContent = "⚠️";
      cancelBtn.style.display = "none";
      okBtn.textContent = "OK";
    } else {
      iconEl.textContent = "ℹ️";
      cancelBtn.style.display = "none";
      okBtn.textContent = "OK";
    }

    msgEl.textContent = message;
    overlay.style.display = "flex";
    setTimeout(() => okBtn.focus(), 50);

    function cleanup() {
      overlay.style.display = "none";
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey);
    }
    function onOk()     { cleanup(); resolve(true);  }
    function onCancel() { cleanup(); resolve(false); }
    function onKey(e) {
      if (e.key === "Enter")  { e.preventDefault(); onOk(); }
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKey);
  });
}

function w95alert(message)   { return _w95dialog(message, "alert");   }
function w95confirm(message) { return _w95dialog(message, "confirm"); }
