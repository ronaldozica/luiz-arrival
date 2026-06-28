// ==========================================
// PACIÊNCIA SPIDER - Vanilla JS
// ==========================================

const SP_DIFFICULTIES = {
  easy: { suits: 1 }, // só Espadas
  medium: { suits: 2 }, // Espadas + Copas
  hard: { suits: 4 }, // todos os naipes
};

const SP_SUITS = ["♠", "♥", "♦", "♣"];
const SP_SUIT_COLOR = { "♠": "black", "♣": "black", "♥": "red", "♦": "red" };
const SP_RANK_LABELS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

// Dimensões/layout do tabuleiro — usadas tanto pelo CSS (.sp-card/.sp-column)
// quanto pelo cálculo de posição feito aqui, então mantenha em sincronia com
// as larguras fixas declaradas em style.css.
const SP_CARD_W = 40;
const SP_CARD_H = 56;
const SP_COL_GAP = 6;
const SP_BASE_TOP = 6;
const SP_FACEUP_OFFSET = 20;
const SP_FACEDOWN_OFFSET = 7;
// Altura mínima do tabuleiro só pra não ficar com cara de vazio quando há
// poucas cartas — não tenta "adivinhar" um tamanho grande o bastante pro
// jogo inteiro, porque isso pode ficar maior que a janela disponível e
// empurrar o resto da UI pra fora da área visível. Em vez disso, o zoom é
// recalculado em toda renderização (ver chamada de refreshGameZoom no fim
// de renderSpBoard), então ele nunca fica desatualizado conforme o
// tabuleiro cresce/encolhe de verdade durante a partida.
const SP_TABLEAU_MIN_HEIGHT = 300;

let currentSpDifficulty = "easy";
let spTableau = []; // array[10] de arrays de {id, rank, suit, faceUp}
let spStock = []; // cartas restantes a distribuir
let spSelected = null; // { col, index } início da sequência selecionada
let spCompletedCount = 0; // 0..8
let spTimer = 0;
let spInterval = null;
let spGameOver = false;
let spCardEls = {}; // id da carta -> elemento DOM persistente (permite animações de transição)

let spHintsUsed = 0; // sem limite máximo — só conta pra decidir a conquista no final
let spUndoUsed = false; // true assim que o desfazer for usado pelo menos 1x na partida
let spUndoSnapshot = null; // estado anterior à última ação (só 1 nível de desfazer)
let spRoundTokenPromise = null;

/**
 * Abre a janela do Spider, inicializa o tabuleiro e valida a sessão.
 */
function openSpiderWindow() {
  openWindow("win-spider");
  initSpider();
  checkSpSessionValidity();
  const w = document.getElementById("win-spider");
  if (w) {
    centerWindow(w);
    clampWindowToViewport(w);
  }
}

/**
 * Testa se a sessão atual consegue salvar o rank ao final da partida.
 */
async function checkSpSessionValidity() {
  const warningEl = document.getElementById("sp-session-warning");
  if (!warningEl) return;

  if (!currentUser || !sessionToken) {
    warningEl.style.display = "block";
    return;
  }

  try {
    const res = await fetch(`${API}/session-check`, {
      headers: authHeaders(sessionToken),
    });
    warningEl.style.display = res.ok ? "none" : "block";
  } catch (e) {
    warningEl.style.display = "block";
  }
}

// ─── DIFFICULTY SWITCHING ──────────────────

function setSpDifficulty(diff) {
  currentSpDifficulty = diff;
  document.querySelectorAll(".sp-diff-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.diff === diff);
  });
  initSpider();
}

// ─── GAME SETUP ─────────────────────────────

function spShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Monta um baralho de 104 cartas (2 baralhos completos), usando apenas os
 * primeiros `suitCount` naipes (repetidos o quanto for preciso) para reduzir
 * a dificuldade nos modos fácil/médio.
 */
function buildSpDeck(suitCount) {
  const suits = SP_SUITS.slice(0, suitCount);
  const deck = [];
  let i = 0;
  while (deck.length < 104) {
    const suit = suits[i % suits.length];
    const rank = (Math.floor(i / suits.length) % 13) + 1;
    deck.push({ id: i, rank, suit, faceUp: false });
    i++;
  }
  return deck;
}

function initSpider() {
  stopSpider();

  const config = SP_DIFFICULTIES[currentSpDifficulty] || SP_DIFFICULTIES.easy;
  const deck = spShuffle(buildSpDeck(config.suits));

  spTableau = Array.from({ length: 10 }, () => []);
  let idx = 0;
  for (let col = 0; col < 10; col++) {
    const count = col < 4 ? 6 : 5;
    for (let i = 0; i < count; i++) {
      const card = deck[idx++];
      card.faceUp = i === count - 1;
      spTableau[col].push(card);
    }
  }
  spStock = deck.slice(idx);

  spSelected = null;
  spCompletedCount = 0;
  spGameOver = false;
  spTimer = 0;
  spHintsUsed = 0;
  spUndoUsed = false;
  spUndoSnapshot = null;
  spCardEls = {};
  const tableau = document.getElementById("sp-tableau");
  if (tableau) tableau.innerHTML = "";

  document.getElementById("sp-face").innerText = "🙂";
  updateSpCounters();
  updateSpHintButton();
  updateSpUndoButton();
  renderSpBoard();
  startSpTimer();
  spRoundTokenPromise = startGameRound("spider", currentSpDifficulty);
  refreshGameZoom("win-spider");
}

// ─── RENDERING ───────────────────────────────

function spCardInnerHTML(card) {
  const label = SP_RANK_LABELS[card.rank - 1];
  return `
    <div class="sp-card-center">${card.suit}</div>
    <div class="sp-card-corner">${label}<br>${card.suit}</div>
    <div class="sp-card-pip">${label}<br>${card.suit}</div>
  `;
}

function ensureSpColumnPlaceholders(tableau) {
  if (tableau.querySelectorAll(".sp-column").length === 10) return;
  tableau.querySelectorAll(".sp-column").forEach((el) => el.remove());
  for (let col = 0; col < 10; col++) {
    const ph = document.createElement("div");
    ph.className = "sp-column";
    ph.style.left = `${col * (SP_CARD_W + SP_COL_GAP)}px`;
    ph.addEventListener("click", () => handleSpColumnClick(col));
    tableau.appendChild(ph);
  }
}

/**
 * Renderiza o tabuleiro reaproveitando os mesmos elementos DOM das cartas
 * entre chamadas (mapeados por id). Isso permite que mudanças de posição
 * (left/top) sejam animadas automaticamente pela transição CSS de .sp-card,
 * em vez de recriar tudo do zero a cada render.
 */
function renderSpBoard() {
  const tableau = document.getElementById("sp-tableau");
  ensureSpColumnPlaceholders(tableau);

  let maxBottom = SP_BASE_TOP + SP_CARD_H;
  const seenIds = new Set();

  spTableau.forEach((column, col) => {
    let top = SP_BASE_TOP;
    const left = col * (SP_CARD_W + SP_COL_GAP);

    column.forEach((card, index) => {
      seenIds.add(card.id);
      let el = spCardEls[card.id];
      const isNew = !el;

      if (isNew) {
        el = document.createElement("div");
        el.className = "sp-card";
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          handleSpCardClick(Number(el.dataset.col), Number(el.dataset.index));
        });
        spCardEls[card.id] = el;
        tableau.appendChild(el);
        el.style.transition = "none";
      }

      el.dataset.col = col;
      el.dataset.index = index;
      el.classList.toggle(
        "selected",
        !!(spSelected && spSelected.col === col && index >= spSelected.index),
      );

      if (card.faceUp) {
        el.classList.remove("face-down");
        el.classList.remove("red", "black");
        el.classList.add(SP_SUIT_COLOR[card.suit]);
        el.innerHTML = spCardInnerHTML(card);
      } else {
        el.classList.add("face-down");
        el.classList.remove("red", "black");
        el.innerHTML = "";
      }

      el.style.zIndex = String(100 + index);

      // Cartas recém-distribuídas aparecem primeiro "acima" do tabuleiro
      // (sem transição) e só depois recebem a posição final já com a
      // transição ativa — ver dealSpStock(), que dispara o 2º render.
      const target = card.dealFrom ? card.dealFrom : { left, top };
      el.style.left = `${target.left}px`;
      el.style.top = `${target.top}px`;

      if (isNew) {
        el.getBoundingClientRect(); // força o reflow antes de reativar a transição
        el.style.transition = "";
      }
      delete card.dealFrom;

      top += card.faceUp ? SP_FACEUP_OFFSET : SP_FACEDOWN_OFFSET;
    });

    maxBottom = Math.max(maxBottom, top + SP_CARD_H);
  });

  // Remove (com fade) os elementos de cartas que saíram do tabuleiro
  // (sequência completa removida).
  Object.keys(spCardEls).forEach((id) => {
    if (seenIds.has(Number(id))) return;
    const el = spCardEls[id];
    el.classList.add("removing");
    setTimeout(() => el.remove(), 220);
    delete spCardEls[id];
  });

  tableau.style.width = `${10 * SP_CARD_W + 9 * SP_COL_GAP}px`;
  tableau.style.height = `${Math.max(maxBottom, SP_TABLEAU_MIN_HEIGHT)}px`;

  const stockEl = document.getElementById("sp-stock");
  const batches = Math.ceil(spStock.length / 10);
  stockEl.dataset.count = spStock.length > 0 ? String(batches) : "";
  stockEl.classList.toggle("empty", spStock.length === 0);

  // O tabuleiro muda de altura a cada jogada/distribuição (cartas saem/
  // entram nas colunas) — recalcula o zoom aqui pra nunca ficar desatualizado.
  refreshGameZoom("win-spider");
}

function updateSpCounters() {
  document.getElementById("sp-sequences").innerText = `${spCompletedCount}/8`;
  document.getElementById("sp-timer").innerText = spTimer.toString().padStart(3, "0");
}

// ─── MOVE VALIDATION ─────────────────────────

/**
 * Retorna a sequência móvel a partir de `index` na coluna `col`, ou null se
 * a carta estiver "enterrada" (a cadeia naipe-igual/rank-1 não chega até a
 * carta mais à frente da coluna) ou virada para baixo.
 */
function getMovableRun(col, index) {
  const column = spTableau[col];
  const card = column[index];
  if (!card || !card.faceUp) return null;

  for (let i = index; i < column.length - 1; i++) {
    const cur = column[i];
    const next = column[i + 1];
    if (!next.faceUp || next.suit !== cur.suit || next.rank !== cur.rank - 1) {
      return null;
    }
  }
  return column.slice(index);
}

function isValidSpDestination(destCol, run) {
  const dest = spTableau[destCol];
  if (dest.length === 0) return true;
  const topCard = dest[dest.length - 1];
  return topCard.rank === run[0].rank + 1;
}

function trySpMove(selected, destCol) {
  if (selected.col === destCol) return false;
  const run = getMovableRun(selected.col, selected.index);
  if (!run) return false;
  if (!isValidSpDestination(destCol, run)) return false;

  spTableau[selected.col].splice(selected.index, run.length);
  spTableau[destCol].push(...run);

  const source = spTableau[selected.col];
  if (source.length > 0 && !source[source.length - 1].faceUp) {
    source[source.length - 1].faceUp = true;
  }

  return true;
}

/**
 * Depois de um move, verifica se as 13 cartas no fundo da coluna formam um
 * K→A completo do mesmo naipe; se sim, remove e conta como sequência feita.
 */
function checkSpSequence(col) {
  const column = spTableau[col];
  if (column.length < 13) return;

  const tail = column.slice(column.length - 13);
  const isComplete = tail.every((card, i) => {
    if (!card.faceUp) return false;
    const expectedRank = 13 - i;
    return card.rank === expectedRank && card.suit === tail[0].suit;
  });

  if (isComplete) {
    column.splice(column.length - 13, 13);
    spCompletedCount++;
    if (column.length > 0 && !column[column.length - 1].faceUp) {
      column[column.length - 1].faceUp = true;
    }
  }
}

// ─── HINTS ────────────────────────────────────

function updateSpHintButton() {
  const btn = document.getElementById("sp-hint-btn");
  if (!btn) return;
  btn.disabled = spGameOver;
  btn.innerText = `💡 Dica (${spHintsUsed} usada${spHintsUsed === 1 ? "" : "s"})`;
}

/**
 * Procura um movimento válido para sugerir: a sequência mais longa possível
 * de alguma coluna, e um destino válido para ela. Se nenhuma coluna tiver um
 * movimento, mas o monte ainda tiver cartas, sugere distribuir.
 */
function findSpHint() {
  for (let col = 0; col < 10; col++) {
    const column = spTableau[col];
    if (column.length === 0) continue;

    let index = column.length - 1;
    while (index > 0) {
      const cur = column[index - 1];
      const next = column[index];
      if (cur.faceUp && next.faceUp && next.suit === cur.suit && next.rank === cur.rank - 1) {
        index--;
      } else {
        break;
      }
    }

    const run = column.slice(index);
    for (let destCol = 0; destCol < 10; destCol++) {
      if (destCol === col) continue;
      if (isValidSpDestination(destCol, run)) {
        return { col, index, destCol };
      }
    }
  }
  return spStock.length > 0 ? { deal: true } : null;
}

function flashSpHintElement(el) {
  if (!el) return;
  el.classList.add("hint-target");
  setTimeout(() => el.classList.remove("hint-target"), 1400);
}

function useSpHint() {
  if (spGameOver) return;

  const hint = findSpHint();
  if (!hint) return;

  spHintsUsed++;
  updateSpHintButton();

  if (hint.deal) {
    flashSpHintElement(document.getElementById("sp-stock"));
    return;
  }

  spSelected = { col: hint.col, index: hint.index };
  renderSpBoard();
  const placeholders = document.querySelectorAll("#sp-tableau .sp-column");
  flashSpHintElement(placeholders[hint.destCol]);
}

// ─── DESFAZER (1 nível) ───────────────────────

/**
 * Clona o estado do tabuleiro para permitir desfazer a próxima ação. Cópia
 * profunda das cartas (não só do array) porque elas são mutadas in-place
 * (faceUp) — sem isso, o "snapshot" mudaria junto com o estado atual.
 */
function cloneSpState() {
  return {
    tableau: spTableau.map((column) => column.map((card) => ({ ...card }))),
    stock: spStock.map((card) => ({ ...card })),
    completedCount: spCompletedCount,
  };
}

function updateSpUndoButton() {
  const btn = document.getElementById("sp-undo-btn");
  if (!btn) return;
  btn.disabled = spGameOver || !spUndoSnapshot;
}

function undoSpMove() {
  if (spGameOver || !spUndoSnapshot) return;

  spTableau = spUndoSnapshot.tableau;
  spStock = spUndoSnapshot.stock;
  spCompletedCount = spUndoSnapshot.completedCount;
  spUndoSnapshot = null; // só 1 nível — não dá pra desfazer o desfazer
  spUndoUsed = true;
  spSelected = null;

  updateSpCounters();
  updateSpUndoButton();
  renderSpBoard();
}

// ─── INPUT HANDLING ──────────────────────────

function handleSpCardClick(col, index) {
  if (spGameOver) return;

  if (spSelected && spSelected.col === col && spSelected.index === index) {
    spSelected = null;
    renderSpBoard();
    return;
  }

  if (spSelected && spSelected.col !== col) {
    const snapshot = cloneSpState();
    if (trySpMove(spSelected, col)) {
      spUndoSnapshot = snapshot;
      updateSpUndoButton();
      spSelected = null;
      checkSpSequence(col);
      updateSpCounters();
      renderSpBoard();
      checkSpWin();
      checkSpStuck();
      return;
    }
  }

  // Não havia seleção, ou o clique não resultou em um move válido: tenta
  // selecionar a sequência a partir da carta clicada (reseleção tolerante).
  const run = getMovableRun(col, index);
  spSelected = run ? { col, index } : null;
  renderSpBoard();
}

function handleSpColumnClick(col) {
  if (spGameOver || !spSelected) return;
  const snapshot = cloneSpState();
  if (trySpMove(spSelected, col)) {
    spUndoSnapshot = snapshot;
    updateSpUndoButton();
    spSelected = null;
    checkSpSequence(col);
    updateSpCounters();
    renderSpBoard();
    checkSpWin();
    checkSpStuck();
  }
}

function dealSpStock() {
  if (spGameOver) return;
  if (spStock.length === 0) return;
  if (spTableau.some((column) => column.length === 0)) return;

  spUndoSnapshot = cloneSpState();
  updateSpUndoButton();

  for (let col = 0; col < 10; col++) {
    const card = spStock.pop();
    card.faceUp = true;
    // Posição inicial "fora" do tabuleiro (acima), de onde a carta vai
    // deslizar para o lugar — ver o comentário em renderSpBoard().
    card.dealFrom = { left: col * (SP_CARD_W + SP_COL_GAP), top: -(SP_CARD_H + 10) };
    spTableau[col].push(card);
  }

  // 1º render: cria as cartas já na posição "acima do tabuleiro", sem
  // transição. Espera o navegador pintar esse frame antes de disparar a
  // posição final no 2º render, que aí sim anima (efeito de distribuir).
  renderSpBoard();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (let col = 0; col < 10; col++) checkSpSequence(col);
      updateSpCounters();
      renderSpBoard();
      checkSpWin();
      checkSpStuck();
    });
  });
}

// ─── GAME OVER ────────────────────────────────

function checkSpWin() {
  if (spCompletedCount >= 8) triggerSpGameOver(true);
}

/**
 * Verifica se existe algum movimento possível: distribuir do monte, ou
 * mover a carta do topo de alguma coluna para outra. A carta do topo de
 * qualquer coluna não-vazia é sempre virada para cima (invariante mantida
 * pelo flip automático em trySpMove/checkSpSequence), então essa checagem
 * não depende de adivinhar cartas viradas para baixo — se não há nenhum
 * movimento agora, nenhuma carta nova será exposta, e o jogo está
 * definitivamente travado.
 */
function hasAnySpMove() {
  if (spStock.length > 0) return true;
  for (let a = 0; a < 10; a++) {
    const colA = spTableau[a];
    if (colA.length === 0) continue;
    const topCard = colA[colA.length - 1];
    for (let b = 0; b < 10; b++) {
      if (b === a) continue;
      if (isValidSpDestination(b, [topCard])) return true;
    }
  }
  return false;
}

function checkSpStuck() {
  if (spGameOver) return;
  if (!hasAnySpMove()) triggerSpGameOver(false);
}

function triggerSpGameOver(won) {
  spGameOver = true;
  stopSpTimer();
  updateSpHintButton();
  updateSpUndoButton();
  const faceBtn = document.getElementById("sp-face");
  if (won) {
    faceBtn.innerText = "😎";
    const winScore = Math.max(1, 9999 - spTimer);
    spRoundTokenPromise.then((roundToken) => {
      submitGameScore(
        "spider",
        currentSpDifficulty,
        winScore,
        function (coinsEarned) {
          if (coinsEarned > 0) showGameCoinsToast(coinsEarned);
        },
        undefined,
        { roundToken, hintsUsed: spHintsUsed > 0, undoUsed: spUndoUsed },
      );
    });
  } else {
    faceBtn.innerText = "😵";
  }
}

// ─── TIMER ────────────────────────────────────

function startSpTimer() {
  if (spInterval) clearInterval(spInterval);
  spInterval = setInterval(() => {
    if (spTimer < 9999) spTimer++;
    updateSpCounters();
  }, 1000);
}

function stopSpTimer() {
  if (spInterval) clearInterval(spInterval);
}

function stopSpider() {
  stopSpTimer();
}
