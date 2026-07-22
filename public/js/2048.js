// ==========================================
// 2048 - Vanilla JS
// ==========================================

const G2048_SIZE = 4;
const G2048_TILE = 64;
const G2048_GAP = 8;

let g2048Grid = null; // [r][c] = {id, value} | null
let g2048Score = 0;
let g2048MaxTile = 0;
let g2048NextId = 1;
let g2048TileEls = {}; // id -> DOM element
let g2048Playing = false;
let g2048Busy = false; // true durante a animação de uma jogada (bloqueia input)
let g2048GameOverFlag = false;
let g2048RoundToken = null;

function g2048EmptyGrid() {
  return Array.from({ length: G2048_SIZE }, () => Array(G2048_SIZE).fill(null));
}

function g2048TilePos(r, c) {
  return {
    left: G2048_GAP + c * (G2048_TILE + G2048_GAP),
    top: G2048_GAP + r * (G2048_TILE + G2048_GAP),
  };
}

function g2048UpdateMaxTile(v) {
  if (v > g2048MaxTile) g2048MaxTile = v;
}

function g2048RandomEmptyCell() {
  const empties = [];
  for (let r = 0; r < G2048_SIZE; r++) {
    for (let c = 0; c < G2048_SIZE; c++) {
      if (!g2048Grid[r][c]) empties.push([r, c]);
    }
  }
  if (!empties.length) return null;
  return empties[Math.floor(Math.random() * empties.length)];
}

function g2048SpawnTile() {
  const cell = g2048RandomEmptyCell();
  if (!cell) return null;
  const [r, c] = cell;
  const value = Math.random() < 0.9 ? 2 : 4;
  const tile = { id: g2048NextId++, value };
  g2048Grid[r][c] = tile;
  g2048UpdateMaxTile(value);
  g2048RenderTile(tile, r, c);
  return tile;
}

function g2048RenderTile(tile, r, c, opts = {}) {
  const board = document.getElementById("g2048-board");
  if (!board) return;
  let el = g2048TileEls[tile.id];
  const isNewEl = !el;
  const pos = g2048TilePos(r, c);
  if (isNewEl) {
    el = document.createElement("div");
    el.className = "g2048-tile";
    board.appendChild(el);
    g2048TileEls[tile.id] = el;
    el.style.left = pos.left + "px";
    el.style.top = pos.top + "px";
  } else {
    el.style.left = pos.left + "px";
    el.style.top = pos.top + "px";
  }
  el.textContent = tile.value;
  el.dataset.value = tile.value >= 2048 ? "super" : String(tile.value);
  if (isNewEl) el.classList.add("new");
  if (opts.pop) {
    el.classList.remove("merging");
    void el.offsetWidth; // força reflow pra reiniciar a animação mesmo se a classe já tiver sido usada
    el.classList.add("merging");
  }
}

function g2048RemoveTile(id) {
  const el = g2048TileEls[id];
  if (!el) return;
  delete g2048TileEls[id];
  el.classList.add("removing");
  setTimeout(() => el.remove(), 180);
}

// Quadrados de fundo fixos (grade vazia clássica do 2048) — criados uma vez
// por abertura de janela; tiles são renderizados por cima como filhos
// seguintes do mesmo container, então a ordem de DOM já resolve o z-index.
function g2048EnsureBackgroundCells() {
  const board = document.getElementById("g2048-board");
  if (!board || board.querySelector(".g2048-cell-bg")) return;
  for (let r = 0; r < G2048_SIZE; r++) {
    for (let c = 0; c < G2048_SIZE; c++) {
      const bg = document.createElement("div");
      bg.className = "g2048-cell-bg";
      const pos = g2048TilePos(r, c);
      bg.style.left = pos.left + "px";
      bg.style.top = pos.top + "px";
      board.appendChild(bg);
    }
  }
}

function g2048ClearBoard() {
  Object.keys(g2048TileEls).forEach((id) => g2048TileEls[id].remove());
  g2048TileEls = {};
  g2048Grid = g2048EmptyGrid();
  g2048Score = 0;
  g2048MaxTile = 0;
  update2048Displays();
}

function update2048Displays() {
  const scoreEl = document.getElementById("g2048-score");
  const bestEl = document.getElementById("g2048-best");
  if (scoreEl) scoreEl.innerText = g2048Score;
  if (bestEl) bestEl.innerText = Math.max(g2048Score, getPersonalBest("2048", null));
}

// ─── Movimento/fusão ─────────────────────────
// coords: array (tamanho 4) de [r,c] ordenado do lado de destino pro lado oposto.
function g2048LinesForDirection(dir) {
  const lines = [];
  if (dir === "left") {
    for (let r = 0; r < G2048_SIZE; r++) lines.push(Array.from({ length: G2048_SIZE }, (_, c) => [r, c]));
  } else if (dir === "right") {
    for (let r = 0; r < G2048_SIZE; r++) lines.push(Array.from({ length: G2048_SIZE }, (_, c) => [r, G2048_SIZE - 1 - c]));
  } else if (dir === "up") {
    for (let c = 0; c < G2048_SIZE; c++) lines.push(Array.from({ length: G2048_SIZE }, (_, r) => [r, c]));
  } else if (dir === "down") {
    for (let c = 0; c < G2048_SIZE; c++) lines.push(Array.from({ length: G2048_SIZE }, (_, r) => [G2048_SIZE - 1 - r, c]));
  }
  return lines;
}

function g2048Move(dir) {
  if (!g2048Playing || g2048Busy) return;

  const lines = g2048LinesForDirection(dir);
  const newGrid = g2048EmptyGrid();
  const finalCoordOf = new Map(); // tile -> [r,c]
  const poppedIds = new Set();
  const absorbed = []; // { id, survivorTile }
  let scoreGained = 0;

  lines.forEach((coords) => {
    const tiles = coords.map(([r, c]) => g2048Grid[r][c]).filter(Boolean);
    const compacted = [];
    let i = 0;
    while (i < tiles.length) {
      const cur = tiles[i];
      const next = tiles[i + 1];
      if (next && next.value === cur.value) {
        cur.value *= 2;
        scoreGained += cur.value;
        g2048UpdateMaxTile(cur.value);
        poppedIds.add(cur.id);
        absorbed.push({ id: next.id, survivorTile: cur });
        compacted.push(cur);
        i += 2;
      } else {
        compacted.push(cur);
        i += 1;
      }
    }
    compacted.forEach((tile, idx) => {
      const [r, c] = coords[idx];
      newGrid[r][c] = tile;
      finalCoordOf.set(tile, [r, c]);
    });
  });

  // Nada mudou de lugar nem se fundiu: jogada inválida, ignora.
  let moved = absorbed.length > 0;
  if (!moved) {
    for (let r = 0; r < G2048_SIZE && !moved; r++) {
      for (let c = 0; c < G2048_SIZE; c++) {
        if (g2048Grid[r][c] !== newGrid[r][c]) { moved = true; break; }
      }
    }
  }
  if (!moved) return;

  g2048Busy = true;

  finalCoordOf.forEach((coord, tile) => {
    g2048RenderTile(tile, coord[0], coord[1], { pop: poppedIds.has(tile.id) });
  });
  absorbed.forEach(({ id, survivorTile }) => {
    const [r, c] = finalCoordOf.get(survivorTile);
    const el = g2048TileEls[id];
    if (!el) return;
    const pos = g2048TilePos(r, c);
    el.style.left = pos.left + "px";
    el.style.top = pos.top + "px";
  });

  g2048Grid = newGrid;
  g2048Score += scoreGained;
  update2048Displays();

  setTimeout(() => {
    absorbed.forEach(({ id }) => g2048RemoveTile(id));
    g2048SpawnTile();
    g2048Busy = false;
    if (!g2048HasMoves()) g2048TriggerGameOver();
  }, 160);
}

function g2048HasMoves() {
  for (let r = 0; r < G2048_SIZE; r++) {
    for (let c = 0; c < G2048_SIZE; c++) {
      const t = g2048Grid[r][c];
      if (!t) return true;
      if (c + 1 < G2048_SIZE && g2048Grid[r][c + 1] && g2048Grid[r][c + 1].value === t.value) return true;
      if (r + 1 < G2048_SIZE && g2048Grid[r + 1][c] && g2048Grid[r + 1][c].value === t.value) return true;
    }
  }
  return false;
}

// ─── Ciclo de vida do jogo ────────────────────
function init2048Game() {
  const board = document.getElementById("g2048-board");
  if (!board) return;

  board.removeEventListener("touchstart", g2048TouchStartHandler);
  board.addEventListener("touchstart", g2048TouchStartHandler, { passive: true });
  board.removeEventListener("touchend", g2048TouchEndHandler);
  board.addEventListener("touchend", g2048TouchEndHandler);

  g2048Playing = false;
  g2048GameOverFlag = false;
  g2048Busy = false;
  g2048EnsureBackgroundCells();
  g2048ClearBoard();

  const startBtn = document.getElementById("g2048-start-btn");
  if (startBtn) startBtn.innerText = "▶ Iniciar Novo Jogo";
  refreshGameZoom("win-2048");
}

function stop2048Game() {
  g2048Playing = false;
}

async function start2048Game() {
  if (g2048Busy) return;
  const board = document.getElementById("g2048-board");
  const result = await arcadeInsertCoin(board, "2048", null);
  if (!result.started) return;

  g2048RoundToken = result.roundToken;
  g2048ClearBoard();
  g2048GameOverFlag = false;
  g2048Playing = true;
  g2048Busy = false;
  g2048SpawnTile();
  g2048SpawnTile();

  const startBtn = document.getElementById("g2048-start-btn");
  if (startBtn) startBtn.innerText = "⏹ Reiniciar";
}

function g2048TriggerGameOver() {
  g2048GameOverFlag = true;
  g2048Playing = false;

  const startBtn = document.getElementById("g2048-start-btn");
  if (startBtn) startBtn.innerText = "▶ Tentar Novamente";

  submitGameScore("2048", null, g2048Score, function (coinsEarned) {
    showGameCoinsToast(coinsEarned - ARCADE_ENTRY_FEE_DISPLAY);
  }, undefined, { roundToken: g2048RoundToken, maxTile: g2048MaxTile });
}

// ─── Input: teclado ───────────────────────────
function g2048KeyHandler(e) {
  const win = document.getElementById("win-2048");
  if (!win || win.style.display === "none") return;
  if (!g2048Playing || g2048Busy) return;
  const map = {
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
    a: "left", d: "right", w: "up", s: "down",
    A: "left", D: "right", W: "up", S: "down",
  };
  const dir = map[e.key];
  if (!dir) return;
  e.preventDefault();
  g2048Move(dir);
}
document.addEventListener("keydown", g2048KeyHandler);

// ─── Input: swipe (mobile) ────────────────────
let g2048TouchStart = null;
const G2048_SWIPE_THRESHOLD = 24;

function g2048TouchStartHandler(e) {
  if (!g2048Playing) return;
  const t = e.touches[0];
  g2048TouchStart = { x: t.clientX, y: t.clientY };
}

function g2048TouchEndHandler(e) {
  if (!g2048Playing || !g2048TouchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - g2048TouchStart.x;
  const dy = t.clientY - g2048TouchStart.y;
  g2048TouchStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < G2048_SWIPE_THRESHOLD) return;
  if (Math.abs(dx) > Math.abs(dy)) g2048Move(dx > 0 ? "right" : "left");
  else g2048Move(dy > 0 ? "down" : "up");
}
