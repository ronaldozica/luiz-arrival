// ==========================================
// CALCULADORA - Vanilla JS
// ==========================================

// Cada token guarda o texto exibido no visor (disp) e o texto realmente
// avaliado (val) — eles divergem para funções/constantes (ex: botão "sin"
// mostra "sin(" mas avalia "sinDeg("), por isso o backspace remove tokens
// inteiros em vez de caracteres soltos.
let calcTokens = [];
let calcJustEvaluated = false;
let calcSciVisible = false;

function sinDeg(x) { return Math.sin((x * Math.PI) / 180); }
function cosDeg(x) { return Math.cos((x * Math.PI) / 180); }
function tanDeg(x) { return Math.tan((x * Math.PI) / 180); }

function openCalculatorWindow() {
  openWindow("win-calculator");
  updateCalcDisplay();
}

function toggleCalcScientific() {
  calcSciVisible = !calcSciVisible;
  const grid = document.getElementById("calc-sci-grid");
  if (grid) grid.style.display = calcSciVisible ? "grid" : "none";
}

function calcPush(val, disp) {
  if (calcJustEvaluated && /^[0-9.]$/.test(val)) {
    calcTokens = [];
  }
  calcJustEvaluated = false;
  calcTokens.push({ val, disp: disp !== undefined ? disp : val });
  updateCalcDisplay();
}

function calcNegate() {
  // Envolve a expressão atual em um menos unário — não é um toggle real de
  // sinal do último número, mas cobre o caso comum de negar o resultado
  // (ou o início de uma conta) sem precisar de um parser de expressões.
  if (!calcTokens.length) {
    calcPush("-", "-");
    return;
  }
  const exprVal = calcTokens.map((t) => t.val).join("");
  const exprDisp = calcTokens.map((t) => t.disp).join("");
  calcTokens = [{ val: `-(${exprVal})`, disp: `-(${exprDisp})` }];
  calcJustEvaluated = false;
  updateCalcDisplay();
}

function calcClear() {
  calcTokens = [];
  calcJustEvaluated = false;
  updateCalcDisplay();
}

function calcBackspace() {
  calcTokens.pop();
  calcJustEvaluated = false;
  updateCalcDisplay();
}

// Garante que a expressão só contém os tokens que nós mesmos inserimos pelos
// botões (visor é readonly, sem entrada livre de texto) antes de avaliar.
function isSafeCalcExpr(expr) {
  const safeTokens = [
    "Math.sqrt(", "Math.PI", "Math.E", "Math.log10(", "Math.log(",
    "sinDeg(", "cosDeg(", "tanDeg(", "**",
  ];
  let stripped = expr;
  for (const t of safeTokens) stripped = stripped.split(t).join("");
  return /^[0-9+\-*/.%() ]*$/.test(stripped);
}

function calcEquals() {
  if (!calcTokens.length) return;
  const exprStr = calcTokens.map((t) => t.val).join("");
  try {
    if (!isSafeCalcExpr(exprStr)) throw new Error("invalid");
    const result = Function(
      "Math", "sinDeg", "cosDeg", "tanDeg",
      `"use strict"; return (${exprStr})`
    )(Math, sinDeg, cosDeg, tanDeg);
    if (!Number.isFinite(result)) throw new Error("invalid");
    const resultStr = String(Math.round(result * 1e10) / 1e10);
    calcTokens = [{ val: resultStr, disp: resultStr }];
    calcJustEvaluated = true;
  } catch {
    calcTokens = [{ val: "0", disp: "Erro" }];
    calcJustEvaluated = true;
  }
  updateCalcDisplay();
}

function updateCalcDisplay() {
  const display = document.getElementById("calc-display");
  if (!display) return;
  const text = calcTokens.map((t) => t.disp).join("");
  display.value = text || "0";
}
