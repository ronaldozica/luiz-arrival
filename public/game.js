// ==========================================
// SNAKE 95 - Vanilla JS
// ==========================================

let snakeCanvas, snakeCtx;
let snakeGameInterval;
let snake = [];
let food = {};
let score = 0;
let dx = 20; // Velocidade/Direção X
let dy = 0;  // Velocidade/Direção Y
let changingDirection = false;
let isPlaying = false;

// Configurações do Grid
const TILE_SIZE = 20;
const CANVAS_SIZE = 380;
const SPEED_MS = 100; // Milissegundos por frame (menor = mais rápido)

const colorSnakeHead = "#00FF00";
const colorSnakeBody = "#008000";
const colorFood = "#FF0000";

/**
 * Inicializa os ouvintes e desenha a tela estática
 * Chamado quando a janela é aberta
 */
function initSnakeGame() {
  snakeCanvas = document.getElementById('snake-canvas');
  if (!snakeCanvas) return;
  
  snakeCtx = snakeCanvas.getContext('2d');
  
  // Limpa ouvintes antigos para evitar múltiplos gatilhos se abrir/fechar a janela
  document.removeEventListener("keydown", changeDirection);
  document.addEventListener("keydown", changeDirection);
  
  clearCanvas();
  drawTextCenter("Pronto para jogar?", "Branco");
}

/**
 * Reseta o estado e inicia o loop do jogo
 */
function startSnakeGame() {
  if (isPlaying) return;
  
  // Estado inicial
  snake = [
    { x: 160, y: 200 },
    { x: 140, y: 200 },
    { x: 120, y: 200 }
  ];
  score = 0;
  dx = TILE_SIZE;
  dy = 0;
  changingDirection = false;
  isPlaying = true;
  
  document.getElementById('snake-score').innerText = score;
  document.getElementById('snake-start-btn').innerText = "⏹ Reiniciar";
  
  spawnFood();
  
  if (snakeGameInterval) clearTimeout(snakeGameInterval);
  gameLoop();
}

/**
 * Para a execução (útil ao fechar a janela)
 */
function stopSnakeGame() {
  isPlaying = false;
  if (snakeGameInterval) clearTimeout(snakeGameInterval);
  document.getElementById('snake-start-btn').innerText = "▶ Iniciar Novo Jogo";
}

/**
 * Loop principal do jogo
 */
function gameLoop() {
  if (!isPlaying) return;
  
  if (hasGameEnded()) {
    isPlaying = false;
    document.getElementById('snake-start-btn').innerText = "▶ Tentar Novamente";
    drawTextCenter("GAME OVER", "Red");
    return;
  }

  changingDirection = false;
  
  snakeGameInterval = setTimeout(() => {
    clearCanvas();
    drawFood();
    moveSnake();
    drawSnake();
    gameLoop();
  }, SPEED_MS);
}

// ─── FUNÇÕES DE RENDERIZAÇÃO ───────────────────────

function clearCanvas() {
  snakeCtx.fillStyle = 'var(--win-black)';
  snakeCtx.fillRect(0, 0, snakeCanvas.width, snakeCanvas.height);
}

function drawSnake() {
  snake.forEach((part, index) => {
    snakeCtx.fillStyle = index === 0 ? colorSnakeHead : colorSnakeBody;
    snakeCtx.strokeStyle = 'var(--win-black)';
    snakeCtx.fillRect(part.x, part.y, TILE_SIZE, TILE_SIZE);
    snakeCtx.strokeRect(part.x, part.y, TILE_SIZE, TILE_SIZE);
  });
}

function drawFood() {
  snakeCtx.fillStyle = colorFood;
  snakeCtx.strokeStyle = 'var(--win-white)';
  snakeCtx.fillRect(food.x, food.y, TILE_SIZE, TILE_SIZE);
  snakeCtx.strokeRect(food.x, food.y, TILE_SIZE, TILE_SIZE);
}

function drawTextCenter(text, color) {
  snakeCtx.fillStyle = color;
  snakeCtx.font = "20px 'Courier New', monospace";
  snakeCtx.textAlign = "center";
  snakeCtx.textBaseline = "middle";
  snakeCtx.fillText(text, CANVAS_SIZE / 2, CANVAS_SIZE / 2);
}

// ─── LÓGICA DE MOVIMENTO E COLISÃO ─────────────────

function moveSnake() {
  const head = { x: snake[0].x + dx, y: snake[0].y + dy };
  snake.unshift(head); // Adiciona nova cabeça

  // Comeu a comida?
  if (head.x === food.x && head.y === food.y) {
    score += 10;
    document.getElementById('snake-score').innerText = score;
    spawnFood();
  } else {
    snake.pop(); // Remove cauda se não comeu
  }
}

function changeDirection(event) {
  // Evita reverter a direção e previne múltiplas mudanças no mesmo tick
  if (changingDirection) return;
  
  const keyPressed = event.keyCode;
  const LEFT_KEY = 37;
  const RIGHT_KEY = 39;
  const UP_KEY = 38;
  const DOWN_KEY = 40;

  const goingUp = dy === -TILE_SIZE;
  const goingDown = dy === TILE_SIZE;
  const goingRight = dx === TILE_SIZE;
  const goingLeft = dx === -TILE_SIZE;

  // Previne a rolagem da página quando usa as setinhas dentro do jogo
  if ([LEFT_KEY, RIGHT_KEY, UP_KEY, DOWN_KEY].includes(keyPressed) && isPlaying) {
    event.preventDefault();
  }

  if (keyPressed === LEFT_KEY && !goingRight) { dx = -TILE_SIZE; dy = 0; changingDirection = true; }
  if (keyPressed === UP_KEY && !goingDown)    { dx = 0; dy = -TILE_SIZE; changingDirection = true; }
  if (keyPressed === RIGHT_KEY && !goingLeft) { dx = TILE_SIZE; dy = 0; changingDirection = true; }
  if (keyPressed === DOWN_KEY && !goingUp)    { dx = 0; dy = TILE_SIZE; changingDirection = true; }
}

function spawnFood() {
  food.x = Math.floor(Math.random() * (CANVAS_SIZE / TILE_SIZE)) * TILE_SIZE;
  food.y = Math.floor(Math.random() * (CANVAS_SIZE / TILE_SIZE)) * TILE_SIZE;
  
  // Verifica se a comida não caiu no corpo da cobra
  snake.forEach((part) => {
    if (part.x === food.x && part.y === food.y) spawnFood();
  });
}

function hasGameEnded() {
  // Colisão consigo mesmo
  for (let i = 4; i < snake.length; i++) {
    if (snake[i].x === snake[0].x && snake[i].y === snake[0].y) return true;
  }
  // Colisão com as paredes
  const hitLeftWall = snake[0].x < 0;
  const hitRightWall = snake[0].x >= CANVAS_SIZE;
  const hitTopWall = snake[0].y < 0;
  const hitBottomWall = snake[0].y >= CANVAS_SIZE;

  return hitLeftWall || hitRightWall || hitTopWall || hitBottomWall;
}