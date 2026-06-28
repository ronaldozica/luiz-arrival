// ==========================================
// BLOCO DE NOTAS - Vanilla JS
// ==========================================

const NOTEPAD_STORAGE_KEY = "luizos_notepad_text";

function openNotepadWindow() {
  openWindow("win-notepad");
  initNotepad();
}

function initNotepad() {
  const textarea = document.getElementById("notepad-text");
  if (!textarea || textarea.dataset.loaded) return;
  textarea.value = localStorage.getItem(NOTEPAD_STORAGE_KEY) || "";
  textarea.addEventListener("input", () => {
    localStorage.setItem(NOTEPAD_STORAGE_KEY, textarea.value);
  });
  textarea.dataset.loaded = "true";
}

function saveNotepadFile() {
  const textarea = document.getElementById("notepad-text");
  if (!textarea) return;
  const blob = new Blob([textarea.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bloco-de-notas.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
