// ─── LuizFarm 95 ─────────────────────────────────────────────────────────────

(function () {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes farm-ready-pulse {
      0%, 100% { box-shadow: inset -1px -1px #000, inset 1px 1px #fff, inset -2px -2px #808080, inset 2px 2px #dfdfdf; }
      50%       { box-shadow: 0 0 0 2px #ffff00; }
    }
    @keyframes farm-loading-pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.45; }
    }
    .farm-plot-ready   { animation: farm-ready-pulse 1s ease-in-out infinite; }
    .farm-plot-loading { animation: farm-loading-pulse 0.7s ease-in-out infinite !important; cursor: wait !important; pointer-events: none; }
    .farm-seed-selected { background: #99ff99 !important; border-color: #808080 #fff #fff #808080 !important; }
  `;
  document.head.appendChild(style);
})();

const FARM_SEEDS_CLIENT = {
  corn:       { name: "Milho",    icon: "🌽", cost: 8,   growthMs: 2  * 3600000, reward: 14  },
  tomato:     { name: "Tomate",   icon: "🍅", cost: 20,  growthMs: 6  * 3600000, reward: 38  },
  pumpkin:    { name: "Abóbora",  icon: "🎃", cost: 45,  growthMs: 24 * 3600000, reward: 125 },
  grape:      { name: "Uva",      icon: "🍇", cost: 90,  growthMs: 48 * 3600000, reward: 270 },
  strawberry: { name: "Morango",  icon: "🍓", cost: 12,  growthMs: 1  * 3600000, reward: 22,  premium: true },
  orange:     { name: "Laranja",  icon: "🍊", cost: 30,  growthMs: 12 * 3600000, reward: 90,  premium: true },
  pineapple:  { name: "Abacaxi",  icon: "🍍", cost: 100, growthMs: 72 * 3600000, reward: 424, premium: true },
};

let farmPlots = null;
let farmBalance = 0;
let farmOwnedSeeds = [];
let farmPremiumUsedToday = 0;
let farmPremiumDailyLimit = 0;
let farmTimerInterval = null;
let farmSelectedSeed = null;
let farmBusy = false;
let farmLoadingPlots = new Set();

function openFarmWindow() {
  openWindow("win-farm");
  initFarm();
}

async function initFarm() {
  farmBusy = false;
  farmSelectedSeed = null;

  if (!sessionToken) {
    const root = document.getElementById("farm-root");
    if (root) root.innerHTML = `
      <div style="padding:16px;font-size:12px;color:#444;text-align:center">
        <div style="font-size:28px;margin-bottom:8px">🔒</div>
        Faça login para acessar a fazenda.<br>
        <button onclick="openWindow('win-login')" style="margin-top:8px;padding:2px 12px;background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;cursor:pointer;font-size:11px">
          Fazer Login
        </button>
      </div>`;
    return;
  }

  await loadFarm();
  if (farmTimerInterval) clearInterval(farmTimerInterval);
  farmTimerInterval = setInterval(tickFarmTimers, 1000);
}

function stopFarm() {
  if (farmTimerInterval) clearInterval(farmTimerInterval);
  farmTimerInterval = null;
}

async function loadFarm() {
  const root = document.getElementById("farm-root");
  if (root) root.innerHTML = `<div style="padding:12px;font-size:11px;color:#444">Carregando fazenda...</div>`;

  try {
    const resp = await fetch("/api/farm", { headers: authHeaders(sessionToken) });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Erro ao carregar fazenda.");
    farmPlots = data.plots;
    farmBalance = data.balance;
    farmOwnedSeeds = data.ownedSeeds || [];
    farmPremiumUsedToday = data.premiumUsedToday || 0;
    farmPremiumDailyLimit = data.premiumDailyLimit || 0;
    renderFarm();
  } catch (e) {
    const root = document.getElementById("farm-root");
    if (root) root.innerHTML = `<div style="padding:12px;color:red;font-size:11px">${e.message}</div>`;
  }
}

function getPlotState(plot) {
  if (!plot) return { type: "empty" };
  if (plot.locked) return { type: "locked", cost: plot.cost };
  if (!plot.seedType) return { type: "empty" };
  const seed = FARM_SEEDS_CLIENT[plot.seedType];
  if (!seed) return { type: "empty" };
  const elapsed = Date.now() - plot.plantedAt;
  if (elapsed >= seed.growthMs * 3) return { type: "withered",  seed, plot };
  if (elapsed >= seed.growthMs * 2) return { type: "degraded",  seed, plot };
  if (elapsed >= seed.growthMs)     return { type: "ready",     seed, plot };
  const pct = elapsed / seed.growthMs;
  if (pct >= 0.3) return { type: "growing",  seed, plot, pct };
  return              { type: "seedling", seed, plot, pct };
}

function formatTimeRemaining(ms) {
  if (ms <= 0) return "Pronto!";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatGrowthTime(ms) {
  const h = ms / 3600000;
  if (h >= 24) return `${h / 24}d`;
  return `${h}h`;
}

function renderFarm() {
  const root = document.getElementById("farm-root");
  if (!root || !farmPlots) return;

  const mobile = typeof isMobile === "function" && isMobile();
  const plotSize = mobile ? 62 : 80;
  const outerFlex = mobile
    ? "display:flex;flex-direction:column;gap:8px;padding:8px"
    : "display:flex;gap:8px;padding:8px;align-items:flex-start";

  const plotsHTML = farmPlots.map((p, i) => renderPlotHTML(p, i, plotSize)).join("");
  const seedShopHTML = renderSeedShop();

  const premiumStatusHTML = farmPremiumDailyLimit > 0
    ? `<span title="Plantios de sementes premium hoje (limite = parcelas desbloqueadas)">✨ Premium hoje: <strong>${farmPremiumUsedToday}/${farmPremiumDailyLimit}</strong></span>`
    : "";

  root.innerHTML = `
    <div style="background:#000080;color:#fff;padding:4px 8px;font-size:11px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span>🪙 LuizCoins: <strong id="farm-balance-display">${farmBalance}</strong></span>
      ${premiumStatusHTML}
      <span id="farm-seed-hint" style="font-size:10px;color:#adf">
        ${farmSelectedSeed
          ? `✔ ${FARM_SEEDS_CLIENT[farmSelectedSeed].name} selecionada — clique numa parcela vazia`
          : "Selecione uma semente e clique numa parcela"}
      </span>
    </div>
    <div style="${outerFlex}">
      <div>
        <div style="font-size:11px;font-weight:bold;color:#000;margin-bottom:4px">🌾 Sua fazenda</div>
        <div style="background:#006400;border:2px solid;border-color:#808080 #fff #fff #808080;padding:6px;display:inline-block">
          <div id="farm-plots" style="display:grid;grid-template-columns:repeat(3,${plotSize}px);gap:5px">
            ${plotsHTML}
          </div>
        </div>
        <div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:3px">
          <span style="background:#8B6914;color:#fff;padding:1px 5px;font-size:9px">Vazio</span>
          <span style="background:#5C4A1E;color:#fff;padding:1px 5px;font-size:9px">Broto</span>
          <span style="background:#3d6b1f;color:#fff;padding:1px 5px;font-size:9px">Crescendo</span>
          <span style="background:#2d8a1f;color:#fff;padding:1px 5px;font-size:9px">Pronto</span>
          <span style="background:#8B5E0A;color:#fff;padding:1px 5px;font-size:9px">Murchando</span>
          <span style="background:#888;color:#fff;padding:1px 5px;font-size:9px">Bloqueado</span>
        </div>
        <div style="margin-top:6px;display:flex;gap:4px">
          <button onclick="farmPlantAll()"
                  ${farmSelectedSeed ? "" : "disabled"}
                  style="flex:1;padding:3px 6px;font-size:10px;cursor:${farmSelectedSeed ? "pointer" : "not-allowed"};
                         background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;
                         opacity:${farmSelectedSeed ? 1 : 0.5}">
            🌱 Plantar em Todos
          </button>
          <button onclick="farmHarvestAll()"
                  style="flex:1;padding:3px 6px;font-size:10px;cursor:pointer;
                         background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff">
            🧺 Colher em Todos
          </button>
        </div>
      </div>
      <div style="flex:1;min-width:160px">
        <div style="font-size:11px;font-weight:bold;color:#000;margin-bottom:4px">🌱 Sementes</div>
        <div id="farm-seed-shop" style="border:2px solid;border-color:#808080 #fff #fff #808080;background:#c0c0c0;padding:4px">
          ${seedShopHTML}
        </div>
        <div style="font-size:11px;font-weight:bold;color:#000;margin:8px 0 3px">📋 Como jogar</div>
        <div style="border:2px solid;border-color:#808080 #fff #fff #808080;background:#c0c0c0;padding:6px;font-size:10px;color:#333;line-height:1.6">
          1. Selecione uma semente<br>
          2. Clique numa parcela vazia<br>
          3. Volte quando estiver pronta<br>
          4. Clique na parcela para colher<br>
          <span style="color:#994400">⚠ 2× o tempo: valor cai 25%</span><br>
          <span style="color:#800000">⚠ 3× o tempo: murcha!</span><br>
          <span style="color:#004a80">✨ Sementes premium: limite diário = parcelas desbloqueadas</span>
        </div>
      </div>
    </div>
  `;
}

function renderPlotHTML(plot, i, plotSize = 80) {
  const st = getPlotState(plot);
  let bg, icon, label, timerText, cursor, extraClass = "", badgeHTML = "";

  switch (st.type) {
    case "empty":
      bg = farmSelectedSeed ? "#3d7a1a" : "#8B6914";
      icon = farmSelectedSeed ? FARM_SEEDS_CLIENT[farmSelectedSeed].icon : "＋";
      label = farmSelectedSeed ? "Plantar" : "Vazio";
      timerText = "";
      cursor = "pointer";
      break;
    case "locked":
      bg = "#777";
      icon = "🔒";
      label = `${st.cost}🪙`;
      timerText = "Desbloquear";
      cursor = "pointer";
      break;
    case "seedling":
      bg = "#5C4A1E";
      icon = "🌱";
      label = st.seed.name;
      timerText = formatTimeRemaining(st.seed.growthMs * (1 - st.pct));
      cursor = "default";
      break;
    case "growing":
      bg = "#3d6b1f";
      icon = "🌿";
      label = st.seed.name;
      timerText = formatTimeRemaining(st.seed.growthMs * (1 - st.pct));
      cursor = "default";
      break;
    case "ready":
      bg = "#2d8a1f";
      icon = st.seed.icon;
      label = "Colher!";
      timerText = "✔ Pronto";
      cursor = "pointer";
      extraClass = "farm-plot-ready";
      badgeHTML = `<div style="position:absolute;top:-5px;right:-5px;background:#ff0;border:1px solid #000;font-size:8px;padding:1px 3px;color:#000;font-weight:bold">✔</div>`;
      break;
    case "degraded":
      bg = "#8B5E0A";
      icon = st.seed.icon;
      label = "Murchando!";
      timerText = "murcha: " + formatTimeRemaining(Math.max(0, st.seed.growthMs * 3 - (Date.now() - st.plot.plantedAt)));
      cursor = "pointer";
      extraClass = "farm-plot-ready";
      badgeHTML = `<div style="position:absolute;top:-5px;right:-5px;background:#ff8c00;border:1px solid #000;font-size:8px;padding:1px 3px;color:#fff;font-weight:bold">75%</div>`;
      break;
    case "withered":
      bg = "#5a4020";
      icon = "🍂";
      label = "Murchou";
      timerText = "Limpar";
      cursor = "pointer";
      break;
  }

  const plantedAt = (plot && plot.plantedAt) ? plot.plantedAt : 0;
  const growthMs  = (plot && plot.seedType && FARM_SEEDS_CLIENT[plot.seedType])
    ? FARM_SEEDS_CLIENT[plot.seedType].growthMs : 0;

  return `
    <div onclick="farmPlotClick(${i})"
         data-plot-id="${i}"
         data-state="${st.type}"
         data-planted-at="${plantedAt}"
         data-growth-ms="${growthMs}"
         class="${extraClass}"
         style="width:${plotSize}px;height:${plotSize}px;background:${bg};
                border:2px solid;border-color:#808080 #fff #fff #808080;
                display:flex;flex-direction:column;align-items:center;justify-content:center;
                cursor:${cursor};text-align:center;position:relative;box-sizing:border-box">
      <div style="font-size:${plotSize >= 75 ? 26 : 20}px;line-height:1">${icon}</div>
      <div style="color:#fff;font-size:10px;text-shadow:1px 1px 0 #000;margin-top:2px">${label}</div>
      <div class="farm-timer" style="color:#ffdd00;font-size:9px;text-shadow:1px 1px 0 #000">${timerText}</div>
      ${badgeHTML}
    </div>`;
}

function renderSeedShop() {
  return Object.entries(FARM_SEEDS_CLIENT).map(([key, seed]) => {
    const isLocked = seed.premium && !farmOwnedSeeds.includes(key);
    if (isLocked) {
      return `
        <div style="border:2px solid;border-color:#fff #808080 #808080 #fff;background:#c0c0c0;
                    padding:4px 6px;margin-bottom:3px;opacity:0.65;
                    display:flex;align-items:center;gap:6px">
          <span style="font-size:20px">🔒</span>
          <div style="flex:1">
            <div style="font-size:11px;font-weight:bold;color:#000">${seed.name}</div>
            <div style="font-size:9px;color:#444">${formatGrowthTime(seed.growthMs)} · +${seed.reward - seed.cost}🪙</div>
          </div>
          <div style="font-size:9px;color:#888;white-space:nowrap;text-align:right">Compre<br>na loja</div>
        </div>`;
    }
    const premiumLimitReached = seed.premium && farmPremiumUsedToday >= farmPremiumDailyLimit;
    const canAfford = farmBalance >= seed.cost && !premiumLimitReached;
    const isSelected = farmSelectedSeed === key;
    const borderStyle = isSelected
      ? "border:2px solid;border-color:#808080 #fff #fff #808080;background:#99ff99"
      : "border:2px solid;border-color:#fff #808080 #808080 #fff;background:#c0c0c0";
    const premiumBadge = seed.premium
      ? `<div style="font-size:9px;color:${premiumLimitReached ? "#8b0000" : "#666"}">✨ ${farmPremiumUsedToday}/${farmPremiumDailyLimit} hoje</div>`
      : "";
    return `
      <div onclick="farmSelectSeed('${key}')"
           style="${borderStyle};padding:4px 6px;margin-bottom:3px;cursor:pointer;
                  display:flex;align-items:center;gap:6px;opacity:${canAfford ? 1 : 0.55}">
        <span style="font-size:20px">${seed.icon}</span>
        <div style="flex:1">
          <div style="font-size:11px;font-weight:bold;color:#000">${seed.name}</div>
          <div style="font-size:9px;color:#444">${formatGrowthTime(seed.growthMs)} · +${seed.reward - seed.cost}🪙</div>
          ${premiumBadge}
        </div>
        <div style="font-size:11px;color:${canAfford ? "#000" : "#888"};white-space:nowrap">${seed.cost}🪙</div>
      </div>`;
  }).join("");
}

async function farmSelectSeed(seedType) {
  if (farmSelectedSeed === seedType) {
    farmSelectedSeed = null;
    renderFarm();
    return;
  }
  const seed = FARM_SEEDS_CLIENT[seedType];
  if (!seed) return;
  if (seed.premium && !farmOwnedSeeds.includes(seedType)) {
    await w95alert(`${seed.name} está bloqueada. Compre-a na loja para desbloquear!`);
    return;
  }
  if (seed.premium && farmPremiumUsedToday >= farmPremiumDailyLimit) {
    await w95alert(`Limite diário de sementes premium atingido (${farmPremiumUsedToday}/${farmPremiumDailyLimit}). Desbloqueie mais parcelas para aumentar o limite.`);
    return;
  }
  if (farmBalance < seed.cost) {
    await w95alert(`LuizCoins™ insuficientes para ${seed.name} (${seed.cost}🪙).`);
    return;
  }
  farmSelectedSeed = seedType;
  renderFarm();
}

async function farmPlotClick(plotId) {
  if (farmBusy || !farmPlots) return;

  const plot = farmPlots[plotId];
  const st = getPlotState(plot);

  if (st.type === "empty") {
    if (!sessionToken) { await w95alert("Faça login para plantar."); return; }
    if (!farmSelectedSeed) { await w95alert("Selecione uma semente primeiro (painel à direita)."); return; }
    await doFarmPlant(plotId, farmSelectedSeed);
  } else if (st.type === "locked") {
    if (!sessionToken) { await w95alert("Faça login para desbloquear."); return; }
    if (!await w95confirm(`Desbloquear esta parcela por ${st.cost} LuizCoins™?`)) return;
    await doFarmUnlock(plotId);
  } else if (st.type === "ready" || st.type === "degraded" || st.type === "withered") {
    if (!sessionToken) { await w95alert("Faça login para colher."); return; }
    await doFarmHarvest(plotId);
  }
}

async function doFarmPlant(plotId, seedType) {
  const seed = FARM_SEEDS_CLIENT[seedType];
  if (!seed) return;

  // Optimistic update
  const prevPlots = farmPlots.map((p) => (p ? { ...p } : p));
  const prevBalance = farmBalance;
  const prevSelected = farmSelectedSeed;

  farmPlots[plotId] = { seedType, plantedAt: Date.now() };
  farmBalance -= seed.cost;
  farmSelectedSeed = null;
  renderFarm();

  try {
    const resp = await fetch("/api/farm/plant", {
      method: "POST",
      headers: { ...authHeaders(sessionToken), "Content-Type": "application/json" },
      body: JSON.stringify({ plotId, seedType }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      farmPlots = prevPlots;
      farmBalance = prevBalance;
      farmSelectedSeed = prevSelected;
      renderFarm();
      showPlotError(plotId, data.error || "Erro ao plantar.");
      return;
    }
    farmPlots = data.plots;
    farmBalance = data.newBalance;
    if (data.premiumUsedToday !== undefined) farmPremiumUsedToday = data.premiumUsedToday;
    if (data.premiumDailyLimit !== undefined) farmPremiumDailyLimit = data.premiumDailyLimit;
    renderFarm();
  } catch (e) {
    farmPlots = prevPlots;
    farmBalance = prevBalance;
    farmSelectedSeed = prevSelected;
    renderFarm();
    showPlotError(plotId, "Erro de conexão.");
  }
}

function showPlotError(plotId, msg) {
  const el = document.querySelector(`#farm-plots [data-plot-id="${plotId}"]`);
  if (!el) return;
  el.style.background = "#8b0000";
  el.style.animation = "none";
  el.innerHTML = `
    <div style="font-size:18px;line-height:1">❌</div>
    <div style="color:#fff;font-size:9px;text-align:center;padding:2px;text-shadow:1px 1px 0 #000;word-break:break-word">${msg.slice(0, 50)}</div>`;
  setTimeout(() => { renderFarm(); }, 3000);
}

async function doFarmHarvest(plotId) {
  farmBusy = true;
  setPlotLoading(plotId, true);
  try {
    const resp = await fetch("/api/farm/harvest", {
      method: "POST",
      headers: { ...authHeaders(sessionToken), "Content-Type": "application/json" },
      body: JSON.stringify({ plotId }),
    });
    const data = await resp.json();
    if (!resp.ok) { await w95alert(data.error || "Erro ao colher."); return; }
    farmPlots = data.plots;
    farmBalance = data.newBalance;
    if (data.withered) {
      await w95alert("A planta murchou! 🍂\nNenhuma moeda desta vez — plante de novo.");
    } else if (data.degraded) {
      showGameCoinsToast(data.coinsEarned);
      await w95alert(`A planta estava murchando! 🟡\nVocê recebeu 75% do valor: ${data.coinsEarned}🪙.`);
    } else if (data.coinsEarned > 0) {
      showGameCoinsToast(data.coinsEarned);
    }
  } catch (e) {
    await w95alert("Erro ao colher: " + e.message);
  } finally {
    setPlotLoading(plotId, false);
    farmBusy = false;
    renderFarm();
  }
}

async function doFarmUnlock(plotId) {
  farmBusy = true;
  setPlotLoading(plotId, true);
  try {
    const resp = await fetch("/api/farm/unlock", {
      method: "POST",
      headers: { ...authHeaders(sessionToken), "Content-Type": "application/json" },
      body: JSON.stringify({ plotId }),
    });
    const data = await resp.json();
    if (!resp.ok) { await w95alert(data.error || "Erro ao desbloquear."); return; }
    farmPlots = data.plots;
    farmBalance = data.newBalance;
  } catch (e) {
    await w95alert("Erro ao desbloquear: " + e.message);
  } finally {
    setPlotLoading(plotId, false);
    farmBusy = false;
    renderFarm();
  }
}

function setPlotLoading(plotId, isLoading) {
  const el = document.querySelector(`#farm-plots [data-plot-id="${plotId}"]`);
  if (!el) return;
  if (isLoading) {
    farmLoadingPlots.add(plotId);
    el.classList.add("farm-plot-loading");
    el.innerHTML = `
      <div style="font-size:22px;line-height:1">⏳</div>
      <div style="color:#fff;font-size:10px;text-shadow:1px 1px 0 #000;margin-top:4px">Aguarde...</div>
      <div class="farm-timer"></div>`;
  } else {
    farmLoadingPlots.delete(plotId);
  }
}

async function farmPlantAll() {
  if (farmBusy || !farmPlots || !farmSelectedSeed) return;
  const seed = FARM_SEEDS_CLIENT[farmSelectedSeed];
  if (!seed) return;

  const emptyCount = farmPlots.filter((p) => getPlotState(p).type === "empty").length;
  if (emptyCount === 0) {
    await w95alert("Nenhuma parcela vazia disponível para plantar.");
    return;
  }

  let canPlant = Math.min(emptyCount, Math.floor(farmBalance / seed.cost));
  if (seed.premium) {
    const premiumRemaining = Math.max(0, farmPremiumDailyLimit - farmPremiumUsedToday);
    if (premiumRemaining === 0) {
      await w95alert(`Limite diário de sementes premium atingido (${farmPremiumUsedToday}/${farmPremiumDailyLimit}). Desbloqueie mais parcelas para aumentar o limite.`);
      return;
    }
    canPlant = Math.min(canPlant, premiumRemaining);
  }
  if (canPlant === 0) {
    await w95alert(`LuizCoins™ insuficientes para ${seed.name} (${seed.cost}🪙 necessários).`);
    return;
  }
  if (canPlant < emptyCount) {
    const ok = await w95confirm(
      `Saldo insuficiente para todas as parcelas.\nPlantar em ${canPlant} de ${emptyCount} parcelas (${canPlant * seed.cost}🪙)?`
    );
    if (!ok) return;
  }

  farmBusy = true;
  const emptyIds = farmPlots
    .map((p, i) => ({ i, type: getPlotState(p).type }))
    .filter(({ type }) => type === "empty")
    .slice(0, canPlant)
    .map(({ i }) => i);
  renderFarm();
  emptyIds.forEach((id) => setPlotLoading(id, true));
  try {
    const resp = await fetch("/api/farm/plant-all", {
      method: "POST",
      headers: { ...authHeaders(sessionToken), "Content-Type": "application/json" },
      body: JSON.stringify({ seedType: farmSelectedSeed }),
    });
    const data = await resp.json();
    if (!resp.ok) { await w95alert(data.error || "Erro ao plantar."); return; }
    farmPlots = data.plots;
    farmBalance = data.newBalance;
    farmSelectedSeed = null;
    if (data.premiumUsedToday !== undefined) farmPremiumUsedToday = data.premiumUsedToday;
    if (data.premiumDailyLimit !== undefined) farmPremiumDailyLimit = data.premiumDailyLimit;
    if (data.planted > 0) showGameCoinsToast(-seed.cost * data.planted);
  } catch (e) {
    await w95alert("Erro ao plantar: " + e.message);
  } finally {
    farmBusy = false;
    renderFarm();
  }
}

async function farmHarvestAll() {
  if (farmBusy || !farmPlots) return;

  const hasHarvestable = farmPlots.some((p) => {
    const t = getPlotState(p).type;
    return t === "ready" || t === "degraded" || t === "withered";
  });
  if (!hasHarvestable) {
    await w95alert("Nenhuma parcela pronta para colher.");
    return;
  }

  farmBusy = true;
  const harvestableIds = farmPlots
    .map((p, i) => ({ i, type: getPlotState(p).type }))
    .filter(({ type }) => ["ready", "degraded", "withered"].includes(type))
    .map(({ i }) => i);
  renderFarm();
  harvestableIds.forEach((id) => setPlotLoading(id, true));
  try {
    const resp = await fetch("/api/farm/harvest-all", {
      method: "POST",
      headers: { ...authHeaders(sessionToken), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await resp.json();
    if (!resp.ok) { await w95alert(data.error || "Erro ao colher."); return; }
    farmPlots = data.plots;
    farmBalance = data.newBalance;

    if (data.witheredCount > 0 && data.totalEarned === 0) {
      await w95alert(`Todas as plantas murcharam! 🍂\nNenhuma moeda desta vez.`);
    } else {
      if (data.witheredCount > 0) await w95alert(`${data.witheredCount} planta(s) murchou e não rendeu moedas. 🍂`);
      if (data.totalEarned > 0) showGameCoinsToast(data.totalEarned);
    }
  } catch (e) {
    await w95alert("Erro ao colher: " + e.message);
  } finally {
    farmBusy = false;
    renderFarm();
  }
}

function tickFarmTimers() {
  const plots = document.querySelectorAll("#farm-plots [data-plot-id]");
  let needsFullRender = false;

  plots.forEach((el) => {
    const state = el.dataset.state;
    const plantedAt = parseInt(el.dataset.plantedAt, 10);
    const growthMs  = parseInt(el.dataset.growthMs, 10);
    if (!plantedAt || !growthMs) return;

    const elapsed = Date.now() - plantedAt;

    if (state === "seedling" || state === "growing") {
      const remaining = Math.max(0, growthMs - elapsed);
      const timerEl = el.querySelector(".farm-timer");
      if (timerEl) timerEl.textContent = formatTimeRemaining(remaining);
      if (remaining === 0) needsFullRender = true;
      return;
    }

    if (state === "ready" || state === "degraded") {
      const newState = elapsed >= growthMs * 3 ? "withered"
                     : elapsed >= growthMs * 2 ? "degraded"
                     : "ready";
      if (newState !== state) { needsFullRender = true; return; }
      if (state === "degraded") {
        const timerEl = el.querySelector(".farm-timer");
        if (timerEl) timerEl.textContent = "murcha: " + formatTimeRemaining(Math.max(0, growthMs * 3 - elapsed));
      }
    }
  });

  if (needsFullRender) renderFarm();
}
