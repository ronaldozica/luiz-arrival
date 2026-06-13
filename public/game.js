// ==========================================
// SNAKE 95 - Vanilla JS  (v2)
// ==========================================

let snakeCanvas, snakeCtx;
let snakeGameInterval;
let snake = [];
let food  = {};
let score = 0;
let snakeLevel = 1;
let dx = 20;
let dy = 0;
let changingDirection = false;
let isPlaying = false;

// Config
const TILE_SIZE  = 20;
const CANVAS_SIZE = 380;
const BASE_SPEED  = 180;  // ms — starting slow
const MIN_SPEED   = 60;   // ms — fastest possible
const SPEED_STEP  = 10;   // ms reduced per level-up
const POINTS_PER_LEVEL = 50; // points to advance a level

const colorSnakeHead = "#00FF00";
const colorSnakeBody = "#008000";
const colorFood      = "#FF0000";

function initSnakeGame() {
  snakeCanvas = document.getElementById("snake-canvas");
  if (!snakeCanvas) return;
  snakeCtx = snakeCanvas.getContext("2d");

  document.removeEventListener("keydown", snakeKeyHandler);
  document.addEventListener("keydown", snakeKeyHandler);

  updateSnakeDisplays();
  clearCanvas();
  drawTextCenter("Pronto para jogar?", "white");
  drawTextCenter("Pressione ESPAÇO para iniciar", "gray", 30);
}

function snakeKeyHandler(event) {
  // Spacebar starts/restarts
  if (event.code === "Space") {
    if (!isPlaying) startSnakeGame();
    event.preventDefault();
    return;
  }
  changeDirection(event);
}

function startSnakeGame() {
  if (isPlaying) {
    // Restart
    isPlaying = false;
    if (snakeGameInterval) clearTimeout(snakeGameInterval);
  }

  snake = [
    { x: 160, y: 200 },
    { x: 140, y: 200 },
    { x: 120, y: 200 },
  ];
  score = 0;
  snakeLevel = 1;
  dx = TILE_SIZE;
  dy = 0;
  changingDirection = false;
  isPlaying = true;

  updateSnakeDisplays();

  const startBtn = document.getElementById("snake-start-btn");
  if (startBtn) startBtn.innerText = "⏹ Reiniciar";

  spawnFood();

  if (snakeGameInterval) clearTimeout(snakeGameInterval);
  gameLoop();
}

function stopSnakeGame() {
  isPlaying = false;
  if (snakeGameInterval) clearTimeout(snakeGameInterval);
  const startBtn = document.getElementById("snake-start-btn");
  if (startBtn) startBtn.innerText = "▶ Iniciar Novo Jogo";
}

function currentSnakeSpeed() {
  const speed = BASE_SPEED - (snakeLevel - 1) * SPEED_STEP;
  return Math.max(MIN_SPEED, speed);
}

function gameLoop() {
  if (!isPlaying) return;

  if (hasGameEnded()) {
    isPlaying = false;
    const startBtn = document.getElementById("snake-start-btn");
    if (startBtn) startBtn.innerText = "▶ Tentar Novamente";
    drawTextCenter("GAME OVER", "red");
    drawTextCenter(`Pontos: ${score}`, "white", 30);
    // Submit score
    submitGameScore("snake", null, score);
    return;
  }

  changingDirection = false;

  snakeGameInterval = setTimeout(() => {
    clearCanvas();
    drawFood();
    moveSnake();
    drawSnake();
    gameLoop();
  }, currentSnakeSpeed());
}

// ─── RENDERING ─────────────────────────────

function clearCanvas() {
  snakeCtx.fillStyle = "#000000";
  snakeCtx.fillRect(0, 0, snakeCanvas.width, snakeCanvas.height);
}

function drawSnake() {
  snake.forEach((part, index) => {
    snakeCtx.fillStyle = index === 0 ? colorSnakeHead : colorSnakeBody;
    snakeCtx.strokeStyle = "#000000";
    snakeCtx.fillRect(part.x, part.y, TILE_SIZE, TILE_SIZE);
    snakeCtx.strokeRect(part.x, part.y, TILE_SIZE, TILE_SIZE);
  });
}

function drawFood() {
  snakeCtx.fillStyle = colorFood;
  snakeCtx.strokeStyle = "#ffffff";
  snakeCtx.fillRect(food.x, food.y, TILE_SIZE, TILE_SIZE);
  snakeCtx.strokeRect(food.x, food.y, TILE_SIZE, TILE_SIZE);
}

function drawTextCenter(text, color, yOffset) {
  snakeCtx.fillStyle = color;
  snakeCtx.font = "20px 'Courier New', monospace";
  snakeCtx.textAlign = "center";
  snakeCtx.textBaseline = "middle";
  const y = CANVAS_SIZE / 2 + (yOffset || 0);
  snakeCtx.fillText(text, CANVAS_SIZE / 2, y);
}

function updateSnakeDisplays() {
  const scoreEl = document.getElementById("snake-score");
  const levelEl = document.getElementById("snake-level");
  const bestEl  = document.getElementById("snake-best");
  if (scoreEl) scoreEl.innerText = score;
  if (levelEl) levelEl.innerText = snakeLevel;
  if (bestEl)  bestEl.innerText  = Math.max(score, getPersonalBest("snake", null));
}

// ─── MOVEMENT & COLLISION ──────────────────

function moveSnake() {
  const tiles = CANVAS_SIZE / TILE_SIZE;

  // Wrap-around: cobra sai de um lado e entra pelo outro
  let newX = (snake[0].x + dx + CANVAS_SIZE) % CANVAS_SIZE;
  let newY = (snake[0].y + dy + CANVAS_SIZE) % CANVAS_SIZE;

  const head = { x: newX, y: newY };
  snake.unshift(head);

  if (head.x === food.x && head.y === food.y) {
    score += 10;

    // Level up every POINTS_PER_LEVEL
    const newLevel = Math.floor(score / POINTS_PER_LEVEL) + 1;
    if (newLevel > snakeLevel) snakeLevel = newLevel;

    updateSnakeDisplays();
    spawnFood();
  } else {
    snake.pop();
  }
}

function changeDirection(event) {
  if (changingDirection) return;

  const keyPressed = event.keyCode;
  const LEFT  = 37, RIGHT = 39, UP = 38, DOWN = 40;
  const W = 87, A = 65, S = 83, D = 68;

  const goingUp    = dy === -TILE_SIZE;
  const goingDown  = dy ===  TILE_SIZE;
  const goingRight = dx ===  TILE_SIZE;
  const goingLeft  = dx === -TILE_SIZE;

  // Prevent page scroll during game
  if ([LEFT, RIGHT, UP, DOWN].includes(keyPressed) && isPlaying) {
    event.preventDefault();
  }

  if ((keyPressed === LEFT || keyPressed === A) && !goingRight) { dx = -TILE_SIZE; dy = 0; changingDirection = true; }
  if ((keyPressed === UP   || keyPressed === W) && !goingDown)  { dx = 0; dy = -TILE_SIZE; changingDirection = true; }
  if ((keyPressed === RIGHT || keyPressed === D) && !goingLeft) { dx =  TILE_SIZE; dy = 0; changingDirection = true; }
  if ((keyPressed === DOWN  || keyPressed === S) && !goingUp)   { dx = 0; dy =  TILE_SIZE; changingDirection = true; }
}

function spawnFood() {
  const tiles = CANVAS_SIZE / TILE_SIZE;
  food.x = Math.floor(Math.random() * tiles) * TILE_SIZE;
  food.y = Math.floor(Math.random() * tiles) * TILE_SIZE;

  // Avoid placing on snake body
  const collision = snake.some((p) => p.x === food.x && p.y === food.y);
  if (collision) spawnFood();
}

function hasGameEnded() {
  // With wrap-around, only self-collision ends the game
  for (let i = 4; i < snake.length; i++) {
    if (snake[i].x === snake[0].x && snake[i].y === snake[0].y) return true;
  }
  return false;
}
