// ─── Portão de moeda do fliperama ──────────────────────────────────────────
// Cada partida custa uma ficha (10 LuizCoins™ — ver ARCADE_ENTRY_FEE no
// backend) pra jogar; o troco depende do desempenho (ver computeArcadePayout
// em api/routes/game-rank.js). Este componente injeta um overlay "🪙 Inserir
// Moeda" dentro de um container do jogo (position:relative) e só chama
// startGameRound (que cobra a ficha de verdade no servidor) quando o
// jogador confirma.
const ARCADE_ENTRY_FEE_DISPLAY = 10; // só pra exibir antes de checar o saldo real; o backend é a fonte de verdade

async function arcadeFetchBalance() {
  try {
    const res = await fetch(`${API}/balance`, { headers: authHeaders(sessionToken) });
    if (!res.ok) return 0;
    const data = await res.json();
    return Number(data.balance) || 0;
  } catch (e) {
    console.error("arcadeFetchBalance", e);
    return 0;
  }
}

// Mostra o portão de moeda dentro de containerEl e resolve quando o jogador
// insere a ficha (ou cancela/fecha). containerEl precisa existir na tela
// (a função cuida de position:relative pra posicionar o overlay por cima).
function arcadeInsertCoin(containerEl, game, difficulty) {
  return new Promise((resolve) => {
    if (!containerEl) return resolve({ started: false });

    const prevPosition = containerEl.style.position;
    if (!prevPosition) containerEl.style.position = "relative";

    const gate = document.createElement("div");
    gate.className = "arcade-coin-gate";
    gate.innerHTML = `
      <div class="arcade-coin-slot">
        <div class="arcade-coin">🪙</div>
        <button type="button" class="win95-action-btn arcade-insert-btn" disabled>Inserir Moeda</button>
        <div class="arcade-coin-balance">Consultando saldo…</div>
      </div>
    `;
    containerEl.appendChild(gate);

    const btn = gate.querySelector(".arcade-insert-btn");
    const balEl = gate.querySelector(".arcade-coin-balance");
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      gate.remove();
      containerEl.style.position = prevPosition;
      resolve(result);
    }

    arcadeFetchBalance().then((balance) => {
      if (settled) return;
      btn.disabled = false;
      btn.textContent = `Inserir Moeda (${ARCADE_ENTRY_FEE_DISPLAY} 🪙)`;
      balEl.textContent = `Seu saldo: ${balance} 🪙`;
      if (balance < ARCADE_ENTRY_FEE_DISPLAY) {
        btn.disabled = true;
        btn.textContent = "LuizCoins™ insuficientes";
      }
    });

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Inserindo…";
      gate.classList.add("inserting");

      const result = await startGameRound(game, difficulty);
      if (!result.ok) {
        gate.classList.remove("inserting");
        btn.disabled = false;
        btn.textContent = `Inserir Moeda (${ARCADE_ENTRY_FEE_DISPLAY} 🪙)`;
        balEl.textContent = result.error || "Erro ao iniciar.";
        return;
      }

      setTimeout(() => finish({ started: true, roundToken: result.roundToken, balance: result.balance }), 350);
    });
  });
}
