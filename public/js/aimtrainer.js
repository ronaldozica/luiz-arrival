// ==========================================
// AIM TRAINER - Vanilla JS
// Teste de mira e reação estilo osu! simplificado
// ==========================================

let atCanvas, atCtx, atCanvasWrap;
let atRafId = null;
let isAtPlaying = false;
let currentAtDifficulty = "normal";

let atScore = 0;
let atCombo = 0;
let atMaxCombo = 0;
let atHits = 0;
let atMisses = 0;
let atRoundEndTime = 0;
let activeTarget = null; // { x, y, radius, spawnTime, lifetime }
let atLastScreen = "idle"; // "idle" | "result" — usado para redesenhar depois de um resize
let atRoundTokenPromise = null;

// Config
const AT_ROUND_DURATION = 15000; // ms
const AT_MIN_CANVAS_SIZE = 280;

const AT_DIFFICULTY_CONFIG = {
  easy:   { radius: 30, lifetime: 1100 },
  normal: { radius: 24, lifetime: 800 },
  hard:   { radius: 18, lifetime: 650 },
};

function initAimTrainerGame() {
  atCanvas = document.getElementById("at-canvas");
  atCanvasWrap = document.getElementById("at-canvas-container");
  if (!atCanvas) return;
  atCtx = atCanvas.getContext("2d");

  atCanvas.removeEventListener("click", atClickHandler);
  atCanvas.addEventListener("click", atClickHandler);

  document.removeEventListener("keydown", atKeyHandler);
  document.addEventListener("keydown", atKeyHandler);

  window.removeEventListener("resize", atHandleResize);
  window.addEventListener("resize", atHandleResize);

  atResizeCanvas();
  updateAtDisplays();
  atDrawIdleScreen();
}

// Mede o espaço real disponível dentro da janela (sem sobrepor os elementos
// vizinhos, já que o container do canvas usa flex:1 para ocupar só o que
// resta depois da barra de dificuldade, cabeçalho, botão e texto de ajuda)
// e redimensiona o canvas (resolução interna + CSS) para preencher esse
// espaço por completo — retangular, não forçado a quadrado, pra não deixar
// "zona morta" cinza nas laterais quando a janela é mais larga que alta.
function atResizeCanvas() {
  if (!atCanvas || !atCanvasWrap) return;
  const rect = atCanvasWrap.getBoundingClientRect();
  const w = Math.max(AT_MIN_CANVAS_SIZE, Math.floor(rect.width));
  const h = Math.max(AT_MIN_CANVAS_SIZE, Math.floor(rect.height));
  if (atCanvas.width === w && atCanvas.height === h) return;

  atCanvas.width = w;
  atCanvas.height = h;
  atCanvas.style.width = w + "px";
  atCanvas.style.height = h + "px";
}

function atHandleResize() {
  if (isAtPlaying) return; // não redimensiona no meio de uma partida (mudaria a posição do alvo)
  atResizeCanvas();
  if (atLastScreen === "result") {
    atDrawResultScreen();
  } else {
    atDrawIdleScreen();
  }
}

function atKeyHandler(event) {
  if (event.code !== "Space") return;
  const win = document.getElementById("win-aimtrainer");
  if (!win || win.style.display === "none") return;
  if (!isAtPlaying) {
    event.preventDefault();
    startAimTrainerGame();
  }
}

function setAtDifficulty(diff) {
  if (isAtPlaying) return; // não troca dificuldade no meio de uma partida
  currentAtDifficulty = diff;
  document.querySelectorAll(".at-diff-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.diff === diff);
  });
  updateAtDisplays();
}

function startAimTrainerGame() {
  if (atRafId) cancelAnimationFrame(atRafId);

  atResizeCanvas();

  atScore = 0;
  atCombo = 0;
  atMaxCombo = 0;
  atHits = 0;
  atMisses = 0;
  isAtPlaying = true;
  atRoundEndTime = Date.now() + AT_ROUND_DURATION;
  atRoundTokenPromise = startGameRound("aimtrainer", currentAtDifficulty);

  const startBtn = document.getElementById("at-start-btn");
  if (startBtn) startBtn.innerText = "⏹ Reiniciar";

  updateAtDisplays();
  atSpawnTarget();
  atRafId = requestAnimationFrame(atGameLoop);
}

function stopAimTrainerGame() {
  isAtPlaying = false;
  if (atRafId) cancelAnimationFrame(atRafId);
  atRafId = null;
  const startBtn = document.getElementById("at-start-btn");
  if (startBtn) startBtn.innerText = "▶ Iniciar";
}

function atSpawnTarget() {
  const cfg = AT_DIFFICULTY_CONFIG[currentAtDifficulty];
  const margin = cfg.radius + 4;
  const x = margin + Math.random() * (atCanvas.width - margin * 2);
  const y = margin + Math.random() * (atCanvas.height - margin * 2);
  activeTarget = {
    x, y,
    radius: cfg.radius,
    spawnTime: Date.now(),
    lifetime: cfg.lifetime,
  };
}

function atGameLoop() {
  if (!isAtPlaying) return;

  if (Date.now() >= atRoundEndTime) {
    atEndRound();
    return;
  }

  if (activeTarget && Date.now() - activeTarget.spawnTime >= activeTarget.lifetime) {
    // Miss por timeout
    atCombo = 0;
    atMisses++;
    atSpawnTarget();
  }

  atDrawFrame();
  updateAtDisplays();

  atRafId = requestAnimationFrame(atGameLoop);
}

function atClickHandler(event) {
  if (!isAtPlaying || !activeTarget) return;

  const rect = atCanvas.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;

  const dx = clickX - activeTarget.x;
  const dy = clickY - activeTarget.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist <= activeTarget.radius) {
    // Hit
    const elapsed = Date.now() - activeTarget.spawnTime;
    const remainingFraction = Math.max(0, 1 - elapsed / activeTarget.lifetime);
    const speedBonus = Math.round(100 * remainingFraction);
    const comboBonus = Math.min(atCombo * 2, 40);

    atScore += 100 + speedBonus + comboBonus;
    atCombo++;
    atHits++;
    if (atCombo > atMaxCombo) atMaxCombo = atCombo;

    atSpawnTarget();
  } else {
    // Clique errado (fora do alvo)
    atCombo = 0;
    atMisses++;
  }

  updateAtDisplays();
}

// ─── RENDERING ─────────────────────────────

function atClearCanvas() {
  atCtx.fillStyle = "#000000";
  atCtx.fillRect(0, 0, atCanvas.width, atCanvas.height);
}

function atDrawFrame() {
  atClearCanvas();
  if (activeTarget) atDrawTarget(activeTarget);
}

function atDrawTarget(target) {
  const elapsed = Date.now() - target.spawnTime;
  const remainingFraction = Math.max(0, 1 - elapsed / target.lifetime);

  // Alvo
  atCtx.beginPath();
  atCtx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
  atCtx.fillStyle = "#FF3030";
  atCtx.fill();
  atCtx.strokeStyle = "#ffffff";
  atCtx.lineWidth = 2;
  atCtx.stroke();

  // Anel de contagem regressiva ("approach circle")
  const ringRadius = target.radius + 4 + remainingFraction * (target.radius * 1.4);
  atCtx.beginPath();
  atCtx.arc(target.x, target.y, ringRadius, 0, Math.PI * 2);
  atCtx.strokeStyle = remainingFraction > 0.3 ? "#00FFAA" : "#FFD700";
  atCtx.lineWidth = 2;
  atCtx.stroke();
}

function atDrawTextCenter(text, color, yOffset, fontSize) {
  atCtx.fillStyle = color;
  atCtx.font = `${fontSize || 18}px 'Courier New', monospace`;
  atCtx.textAlign = "center";
  atCtx.textBaseline = "middle";
  const y = atCanvas.height / 2 + (yOffset || 0);
  atCtx.fillText(text, atCanvas.width / 2, y);
}

function atDrawIdleScreen() {
  atLastScreen = "idle";
  atClearCanvas();
  atDrawTextCenter("Pronto para treinar a mira?", "white");
  atDrawTextCenter("Escolha a dificuldade e clique em Iniciar (ou Espaço)", "gray", 30, 13);
}

function updateAtDisplays() {
  const scoreEl = document.getElementById("at-score");
  const comboEl = document.getElementById("at-combo");
  const timeEl = document.getElementById("at-time");
  const bestEl = document.getElementById("at-best");

  if (scoreEl) scoreEl.innerText = atScore;
  if (comboEl) comboEl.innerText = atCombo;
  if (timeEl) {
    const remaining = isAtPlaying ? Math.max(0, Math.ceil((atRoundEndTime - Date.now()) / 1000)) : AT_ROUND_DURATION / 1000;
    timeEl.innerText = remaining;
  }
  if (bestEl) bestEl.innerText = Math.max(atScore, getPersonalBest("aimtrainer", currentAtDifficulty));
}

function atDrawResultScreen() {
  atLastScreen = "result";
  const accuracy = atHits + atMisses > 0 ? Math.round((atHits / (atHits + atMisses)) * 100) : 0;

  atClearCanvas();
  atCtx.fillStyle = "red";
  atCtx.font = "20px 'Courier New', monospace";
  atCtx.textAlign = "center";
  atCtx.textBaseline = "middle";
  atCtx.fillText("TEMPO ESGOTADO", atCanvas.width / 2, atCanvas.height / 2 - 60);
  atCtx.fillStyle = "white";
  atCtx.font = "16px 'Courier New', monospace";
  atCtx.fillText(`Pontos: ${atScore}`, atCanvas.width / 2, atCanvas.height / 2 - 25);
  atCtx.font = "13px 'Courier New', monospace";
  atCtx.fillText(`Acertos: ${atHits}  Erros: ${atMisses}  Precisão: ${accuracy}%`, atCanvas.width / 2, atCanvas.height / 2);
  atCtx.fillText(`Maior combo: ${atMaxCombo}`, atCanvas.width / 2, atCanvas.height / 2 + 25);
}

function atEndRound() {
  isAtPlaying = false;
  if (atRafId) cancelAnimationFrame(atRafId);
  atRafId = null;
  activeTarget = null;

  const startBtn = document.getElementById("at-start-btn");
  if (startBtn) startBtn.innerText = "▶ Tentar Novamente";

  atDrawResultScreen();

  atRoundTokenPromise.then((roundToken) => {
    submitGameScore("aimtrainer", currentAtDifficulty, atScore, function (coinsEarned) {
      if (coinsEarned > 0) {
        showGameCoinsToast(coinsEarned);
        setTimeout(() => {
          atCtx.fillStyle = "gold";
          atCtx.fillText(`🎉 +${coinsEarned} LuizCoins™`, atCanvas.width / 2, atCanvas.height / 2 + 60);
        }, 100);
      }
    }, undefined, { roundToken });
  });

  updateAtDisplays();
}
