// ==========================================
// POKÉMON FIRERED (PT-BR) - GBA via mGBA Wasm
// ==========================================

let pokemonRunning = false;
let pokemonMessageListenerInstalled = false;
let pokemonGamepadBound = false;
let pokemonToastTimer = null;

function installPokemonMessageListener() {
  if (pokemonMessageListenerInstalled) return;
  pokemonMessageListenerInstalled = true;

  window.addEventListener("message", (e) => {
    const data = e && e.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "pokemon-status") {
      const statusEl = document.getElementById("pokemon-status");
      if (!statusEl) return;
      if (data.ready || !data.text) {
        statusEl.style.display = "none";
        statusEl.textContent = "";
      } else {
        statusEl.style.display = "block";
        statusEl.textContent = data.text;
      }
    } else if (data.type === "pokemon-focus") {
      const win = document.getElementById("win-pokemon");
      if (win && typeof bringToFront === "function") {
        bringToFront(win);
      }
    } else if (data.type === "pokemon-saved") {
      const badge = document.getElementById("pokemon-save-indicator");
      if (badge) {
        badge.textContent = data.timeStr
          ? `💾 Salvo (${data.timeStr})`
          : "💾 Salvo no navegador";
      }
      if (data.source === "ingame") {
        showPokemonToast("💾 Jogo salvo automaticamente no localStorage!");
      }
    } else if (data.type === "pokemon-toast") {
      if (data.text) showPokemonToast(data.text);
    } else if (data.type === "pokemon-speed-changed") {
      const btn = document.getElementById("pokemon-speed-btn");
      if (btn) {
        btn.textContent = `⏩ ${data.speed || 1}x`;
      }
    } else if (data.type === "pokemon-mute-changed") {
      const btn = document.getElementById("pokemon-mute-btn");
      if (btn) {
        btn.textContent = data.muted ? "🔇 Mudo" : "🔊 Som";
      }
    }
  });
}

function showPokemonToast(text) {
  const statusEl = document.getElementById("pokemon-status");
  if (!statusEl) return;
  if (pokemonToastTimer) clearTimeout(pokemonToastTimer);
  statusEl.style.display = "block";
  statusEl.textContent = text;
  pokemonToastTimer = setTimeout(() => {
    statusEl.style.display = "none";
    statusEl.textContent = "";
  }, 2600);
}

function postToPokemonIframe(payload) {
  const iframe = document.getElementById("pokemon-iframe");
  if (!iframe || !iframe.contentWindow) return;
  try {
    iframe.contentWindow.postMessage(payload, "*");
  } catch {}
}

function focusPokemonIframe() {
  const iframe = document.getElementById("pokemon-iframe");
  if (!iframe) return;
  try {
    iframe.focus();
    if (iframe.contentWindow) {
      iframe.contentWindow.focus();
      const canvas =
        iframe.contentDocument && iframe.contentDocument.getElementById("canvas");
      if (canvas) canvas.focus();
    }
  } catch {}
}

function bindPokemonTouchGamepad() {
  if (pokemonGamepadBound) return;
  const pad = document.getElementById("pokemon-touch-controls");
  if (!pad) return;
  pokemonGamepadBound = true;

  const buttons = pad.querySelectorAll("[data-gba-btn]");
  buttons.forEach((btnEl) => {
    const btnName = btnEl.getAttribute("data-gba-btn");
    if (!btnName) return;

    const press = (ev) => {
      if (ev && ev.cancelable) ev.preventDefault();
      btnEl.classList.add("pressed");
      if (navigator.vibrate) {
        try {
          navigator.vibrate(10);
        } catch {}
      }
      postToPokemonIframe({ type: "pokemon-btn", button: btnName, pressed: true });
    };

    const release = (ev) => {
      if (ev && ev.cancelable) ev.preventDefault();
      if (!btnEl.classList.contains("pressed")) return;
      btnEl.classList.remove("pressed");
      postToPokemonIframe({ type: "pokemon-btn", button: btnName, pressed: false });
      focusPokemonIframe();
    };

    btnEl.addEventListener("pointerdown", press);
    btnEl.addEventListener("pointerup", release);
    btnEl.addEventListener("pointercancel", release);
    btnEl.addEventListener("pointerleave", release);
    btnEl.addEventListener("contextmenu", (e) => e.preventDefault());
  });
}

function pokemonSaveState() {
  postToPokemonIframe({ type: "pokemon-save-state" });
  focusPokemonIframe();
}

function pokemonLoadState() {
  postToPokemonIframe({ type: "pokemon-load-state" });
  focusPokemonIframe();
}

function pokemonToggleSpeed() {
  postToPokemonIframe({ type: "pokemon-toggle-speed" });
  focusPokemonIframe();
}

function pokemonToggleMute() {
  postToPokemonIframe({ type: "pokemon-toggle-mute" });
  focusPokemonIframe();
}

function openPokemonWindow() {
  openWindow("win-pokemon");
  initPokemonGame();
}

function initPokemonGame() {
  installPokemonMessageListener();
  bindPokemonTouchGamepad();

  const wrap = document.getElementById("pokemon-container");
  const statusEl = document.getElementById("pokemon-status");
  if (!wrap) return;

  try {
    const metaRaw = localStorage.getItem("luizos_pokemon_firered_meta_v1");
    const badge = document.getElementById("pokemon-save-indicator");
    if (badge && metaRaw) {
      const meta = JSON.parse(metaRaw);
      if (meta && meta.timeStr) {
        badge.textContent = `💾 Salvo (${meta.timeStr})`;
      }
    }
  } catch {}

  if (pokemonRunning && document.getElementById("pokemon-iframe")) {
    setTimeout(focusPokemonIframe, 50);
    return;
  }

  pokemonRunning = true;
  const speedBtn = document.getElementById("pokemon-speed-btn");
  if (speedBtn) speedBtn.textContent = "⏩ 1x";
  const muteBtn = document.getElementById("pokemon-mute-btn");
  if (muteBtn) muteBtn.textContent = "🔊 Som";

  if (statusEl) {
    statusEl.style.display = "block";
    statusEl.textContent = "⏳ Carregando Pokémon FireRed (PT-BR)...";
  }

  wrap.innerHTML =
    '<iframe id="pokemon-iframe" class="pokemon-iframe" src="/assets/pokemon/embed.html" width="480" height="320" frameborder="0" scrolling="no" allow="autoplay"></iframe>';

  const iframe = document.getElementById("pokemon-iframe");
  if (iframe) {
    iframe.addEventListener("load", () => {
      setTimeout(focusPokemonIframe, 60);
    });
  }
}

function stopPokemonGame() {
  pokemonRunning = false;
  if (pokemonToastTimer) {
    clearTimeout(pokemonToastTimer);
    pokemonToastTimer = null;
  }
  const iframe = document.getElementById("pokemon-iframe");
  if (iframe) {
    try {
      postToPokemonIframe({ type: "pokemon-flush-save" });
    } catch {}
    try {
      iframe.src = "about:blank";
    } catch {}
  }
  const wrap = document.getElementById("pokemon-container");
  if (wrap) {
    wrap.innerHTML = "";
  }
  const statusEl = document.getElementById("pokemon-status");
  if (statusEl) {
    statusEl.style.display = "none";
    statusEl.textContent = "";
  }
}
