// ==========================================
// PAINT 95 (simplificado) - Vanilla JS
// Apenas caneta/pincel e borracha, sem camadas, formas ou desfazer.
// ==========================================

let paintCanvas, paintCtx;
let paintDrawing = false;
let paintTool = "pen"; // "pen" | "brush" | "eraser"
let paintColor = "#000000";

const PAINT_SIZES = { pen: 2, brush: 8, eraser: 16 };

function openPaintWindow() {
  openWindow("win-paint");
  initPaint();
}

function initPaint() {
  paintCanvas = document.getElementById("paint-canvas");
  if (!paintCanvas) return;
  paintCtx = paintCanvas.getContext("2d");

  if (!paintCanvas.dataset.loaded) {
    paintCtx.fillStyle = "#ffffff";
    paintCtx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);

    paintCanvas.addEventListener("mousedown", paintStart);
    paintCanvas.addEventListener("mousemove", paintMove);
    window.addEventListener("mouseup", paintEnd);
    paintCanvas.addEventListener("touchstart", paintStart, { passive: false });
    paintCanvas.addEventListener("touchmove", paintMove, { passive: false });
    window.addEventListener("touchend", paintEnd);

    paintCanvas.dataset.loaded = "true";
  }

  setPaintTool("pen");
}

function setPaintTool(tool) {
  paintTool = tool;
  document.querySelectorAll(".paint-tool-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tool === tool);
  });
}

function setPaintColor(color) {
  paintColor = color;
}

function getPaintPos(e) {
  const rect = paintCanvas.getBoundingClientRect();
  const point = e.touches ? e.touches[0] : e;
  return {
    x: point.clientX - rect.left,
    y: point.clientY - rect.top,
  };
}

function paintStart(e) {
  e.preventDefault();
  paintDrawing = true;
  const { x, y } = getPaintPos(e);
  paintCtx.beginPath();
  paintCtx.moveTo(x, y);
  paintDot(x, y);
}

function paintMove(e) {
  if (!paintDrawing) return;
  e.preventDefault();
  const { x, y } = getPaintPos(e);
  paintCtx.lineTo(x, y);
  paintStroke();
  paintCtx.beginPath();
  paintCtx.moveTo(x, y);
}

function paintEnd() {
  paintDrawing = false;
}

function paintStroke() {
  paintCtx.lineCap = "round";
  paintCtx.lineJoin = "round";
  paintCtx.lineWidth = PAINT_SIZES[paintTool];
  paintCtx.strokeStyle = paintTool === "eraser" ? "#ffffff" : paintColor;
  paintCtx.stroke();
}

function paintDot(x, y) {
  paintCtx.fillStyle = paintTool === "eraser" ? "#ffffff" : paintColor;
  const r = PAINT_SIZES[paintTool] / 2;
  paintCtx.beginPath();
  paintCtx.arc(x, y, r, 0, Math.PI * 2);
  paintCtx.fill();
}

function clearPaintCanvas() {
  if (!paintCtx) return;
  paintCtx.fillStyle = "#ffffff";
  paintCtx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
}

function savePaintImage() {
  if (!paintCanvas) return;
  const a = document.createElement("a");
  a.href = paintCanvas.toDataURL("image/png");
  a.download = "desenho.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
