// ---------- Firebase ----------

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getDatabase, ref, set, get, update, push, child, remove,
  onValue, onChildAdded, onDisconnect, off, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA0sSQZ94xHTngATQqRSYO2OKyQehRpf_g",
  authDomain: "roulette-multijeux.firebaseapp.com",
  databaseURL: "https://roulette-multijeux-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "roulette-multijeux",
  storageBucket: "roulette-multijeux.firebasestorage.app",
  messagingSenderId: "1012713605405",
  appId: "1:1012713605405:web:c82d0dd9a41cc9f57df9f4",
};

let firebaseApp = null;
let db = null;
let auth = null;
let authReadyPromise = null;

async function initFirebase() {
  if (authReadyPromise) return authReadyPromise;
  if (FIREBASE_CONFIG.apiKey === "REMPLACE-MOI") {
    alert("Firebase n'est pas configuré. Édite script.js → objet FIREBASE_CONFIG en haut du fichier.");
    return null;
  }
  try {
    firebaseApp = initializeApp(FIREBASE_CONFIG);
    db = getDatabase(firebaseApp);
    auth = getAuth(firebaseApp);

    authReadyPromise = new Promise((resolve, reject) => {
      const unsub = onAuthStateChanged(auth, (user) => {
        if (user) { unsub(); resolve(user); }
      }, reject);
      signInAnonymously(auth).catch((err) => {
        unsub();
        reject(err);
      });
    });

    return await authReadyPromise;
  } catch (err) {
    console.error("Firebase init failed:", err);
    alert("Erreur Firebase : " + err.message);
    authReadyPromise = null;
    return null;
  }
}

// ---------- Games registry ----------

const GAMES = {
  minecraft: {
    name: "Minecraft", icon: "⛏️", color: "#5acb7a", available: true,
    dataPath: "entities.json", entityLabel: "Entités",
  },
  pokemon: {
    name: "Pokémon", icon: "⚡", color: "#ffcb05", available: false,
    csDescription: "Bientôt : la roulette des 1025 Pokémon avec leurs cris, sprites et types.",
  },
  zelda: {
    name: "Zelda", icon: "🗡️", color: "#3a8a6a", available: false,
    csDescription: "Bientôt : la roulette des créatures, ennemis et boss de Hyrule.",
  },
};

const GAME_KEY = "roulette-active-game";
const MODE_KEY = "roulette-mode";
const PSEUDO_KEY = "roulette-pseudo";
const wonKey = (gameId) => `roulette-won-${gameId}`;

// ---------- DOM refs ----------

const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");
const spinBtn = document.getElementById("spin-btn");

const panel = document.getElementById("entity-panel");
const panelEmpty = document.getElementById("panel-empty");
const panelContent = document.getElementById("panel-content");
const panelImage = document.getElementById("panel-image");
const panelName = document.getElementById("panel-name");
const panelSounds = document.getElementById("panel-sounds");

const trackerList = document.getElementById("tracker-list");
const trackerCount = document.getElementById("tracker-count");
const trackerReset = document.getElementById("tracker-reset");

const filterInputs = document.querySelectorAll('#filters input[type="checkbox"]');
const filtersEl = document.getElementById("filters");

const gameNav = document.getElementById("game-nav");
const gameContent = document.getElementById("game-content");
const comingSoon = document.getElementById("coming-soon");
const csIcon = document.getElementById("cs-icon");
const csTitle = document.getElementById("cs-title");
const csDesc = document.getElementById("cs-desc");
const csBack = document.getElementById("cs-back");

const landing = document.getElementById("landing");
const multiSetup = document.getElementById("multi-setup");
const multiPseudoInput = document.getElementById("multi-pseudo");
const multiCreateBtn = document.getElementById("multi-create");
const multiCreateResult = document.getElementById("multi-create-result");
const multiLinkInput = document.getElementById("multi-link");
const multiCopyBtn = document.getElementById("multi-copy");
const multiJoinInput = document.getElementById("multi-join-input");
const multiJoinBtn = document.getElementById("multi-join");
const multiBackBtn = document.getElementById("multi-back");

const revealTop = document.getElementById("reveal-top");
const revealTopImage = document.getElementById("reveal-top-image");
const revealTopName = document.getElementById("reveal-top-name");
const revealTopSounds = document.getElementById("reveal-top-sounds");

const scoreboard = document.getElementById("scoreboard");
const scoreboardList = document.getElementById("scoreboard-list");

const buzzBar = document.getElementById("buzz-bar");
const buzzStatus = document.getElementById("buzz-status");
const guessForm = document.getElementById("guess-form");
const guessInput = document.getElementById("guess-input");
const guessSubmit = document.getElementById("guess-submit");

const roomInfo = document.getElementById("room-info");
const playerCountEl = document.getElementById("player-count");
const roomLeaveBtn = document.getElementById("room-leave");
const roomShareBtn = document.getElementById("room-share");
const brandLink = document.getElementById("brand-link");

// ---------- State ----------

let currentGameId = null;
let allEntities = [];
let entities = [];
let currentRotation = 0;
let isSpinning = false;
let audio = null;
let won = new Set();

const MULTI = {
  active: false,
  isHost: false,
  roomId: null,
  myPlayerId: "",
  myName: "",
  players: {},
  roundPhase: "idle",
  currentEntity: null,
  guessWinnerId: null,
  currentRound: 0,
};

let roomRef = null;
const roomListeners = [];

// ---------- Pseudo ----------

function loadPseudo() {
  try { return localStorage.getItem(PSEUDO_KEY) || ""; } catch { return ""; }
}
function savePseudo(p) {
  try { localStorage.setItem(PSEUDO_KEY, p); } catch {}
}
function readPseudo() {
  const v = multiPseudoInput.value.trim().slice(0, 20);
  if (!v) {
    multiPseudoInput.focus();
    multiPseudoInput.style.borderColor = "#ff6b6b";
    setTimeout(() => { multiPseudoInput.style.borderColor = ""; }, 1500);
    return null;
  }
  savePseudo(v);
  return v;
}

// ---------- Mode flow ----------

function showLanding() {
  landing.hidden = false;
  multiSetup.hidden = true;
  gameContent.hidden = true;
  comingSoon.hidden = true;
  roomInfo.hidden = true;
}

function chooseMode(mode) {
  landing.hidden = true;
  if (mode === "solo") startSolo();
  else showMultiSetup();
}

function startSolo() {
  MULTI.active = false;
  try { localStorage.setItem(MODE_KEY, "solo"); } catch {}
  filtersEl.hidden = false;
  roomInfo.hidden = true;
  let initial = "minecraft";
  try {
    const saved = localStorage.getItem(GAME_KEY);
    if (saved && GAMES[saved]) initial = saved;
  } catch {}
  switchGame(initial);
}

function showMultiSetup() {
  try { localStorage.setItem(MODE_KEY, "multi"); } catch {}
  multiSetup.hidden = false;
  gameContent.hidden = true;
  comingSoon.hidden = true;
  multiCreateBtn.disabled = false;
  multiCreateBtn.textContent = "Créer une room";
  multiCreateBtn.style.display = "";
  multiCreateResult.hidden = true;
  multiPseudoInput.value = loadPseudo();
}

document.querySelectorAll(".mode-card").forEach((card) => {
  card.addEventListener("click", () => chooseMode(card.dataset.mode));
});
multiBackBtn.addEventListener("click", () => { multiSetup.hidden = true; showLanding(); });
brandLink.addEventListener("click", (e) => {
  e.preventDefault();
  if (MULTI.active) {
    if (!confirm("Quitter la room en cours ?")) return;
    leaveRoom();
  } else {
    showLanding();
  }
});

// ---------- Game navigation ----------

function buildGameNav() {
  gameNav.innerHTML = "";
  Object.entries(GAMES).forEach(([id, game]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "game-btn";
    btn.dataset.game = id;
    btn.style.setProperty("--game-color", game.color);
    btn.innerHTML = `
      <span class="game-btn-icon">${game.icon}</span>
      <span>${game.name}</span>
      ${game.available ? "" : '<span class="game-badge">Bientôt</span>'}
    `;
    btn.addEventListener("click", () => {
      if (MULTI.active) { alert("Quitte la room pour changer de jeu."); return; }
      switchGame(id);
    });
    gameNav.appendChild(btn);
  });
}

async function switchGame(id) {
  const game = GAMES[id];
  if (!game) return;
  currentGameId = id;
  document.querySelectorAll(".game-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.game === id);
  });
  if (game.available) {
    comingSoon.hidden = true;
    gameContent.hidden = false;
    try { localStorage.setItem(GAME_KEY, id); } catch {}
    won = MULTI.active ? new Set() : loadWon(id);
    await loadEntities(game.dataPath);
  } else {
    gameContent.hidden = true;
    comingSoon.hidden = false;
    csIcon.textContent = game.icon;
    csTitle.textContent = `${game.name} — Bientôt`;
    csDesc.textContent = game.csDescription || "Cette roulette arrivera plus tard.";
    if (audio) { audio.pause(); audio.currentTime = 0; }
  }
}

csBack.addEventListener("click", () => switchGame("minecraft"));

// ---------- Won set ----------

function loadWon(gameId) {
  try {
    const raw = localStorage.getItem(wonKey(gameId));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}
function saveWon() {
  if (!currentGameId || MULTI.active) return;
  try { localStorage.setItem(wonKey(currentGameId), JSON.stringify([...won])); } catch {}
}

// ---------- Entities loading ----------

async function loadEntities(dataPath) {
  try {
    const response = await fetch(dataPath);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    allEntities = data.entities || [];
    if (allEntities.length === 0) throw new Error("Aucune entité");
    updateCounts();
    buildTracker();
    applyFilters();
    panelContent.hidden = true;
    panelContent.classList.remove("revealing");
    if (MULTI.active) {
      panelEmpty.hidden = true;
      scoreboard.hidden = false;
    } else {
      panelEmpty.hidden = false;
      scoreboard.hidden = true;
    }
  } catch (err) {
    console.error("Échec du chargement des entités :", err);
    panelName.textContent = "Erreur";
    spinBtn.disabled = true;
  }
}

// ---------- Filters ----------

function getActiveTypes() {
  return new Set(
    Array.from(filterInputs).filter((cb) => cb.checked).map((cb) => cb.value)
  );
}

function applyFilters() {
  let pool;
  if (MULTI.active) {
    pool = allEntities.filter((e) => !won.has(e.name));
  } else {
    const active = getActiveTypes();
    pool = allEntities.filter((e) => active.has(e.type) && !won.has(e.name));
  }
  entities = pool;
  currentRotation = 0;
  canvas.style.transition = "none";
  canvas.style.transform = "rotate(0deg)";
  requestAnimationFrame(() => { canvas.style.transition = ""; });

  if (entities.length === 0) {
    spinBtn.disabled = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const allFilteredZero = !MULTI.active && allEntities.filter((e) => getActiveTypes().has(e.type)).length === 0;
    const msg = allFilteredZero ? "Aucun type sélectionné" : "Toutes obtenues — reset ?";
    drawEmptyWheel(msg);
  } else {
    spinBtn.disabled = false;
    drawWheel();
  }
}

function updateCounts() {
  const counts = { hostile: 0, neutral: 0, passive: 0, boss: 0 };
  allEntities.forEach((e) => { if (counts[e.type] !== undefined) counts[e.type]++; });
  document.querySelectorAll(".filter-chip").forEach((chip) => {
    const type = chip.dataset.type;
    const span = chip.querySelector("[data-count]");
    if (span) span.textContent = counts[type] || 0;
  });
}

// ---------- Tracker ----------

function buildTracker() {
  trackerList.innerHTML = "";
  const order = ["boss", "hostile", "neutral", "passive"];
  const grouped = order.flatMap((t) => allEntities.filter((e) => e.type === t));
  grouped.forEach((entity) => {
    const li = document.createElement("li");
    li.className = "tracker-item";
    li.dataset.name = entity.name;
    li.style.setProperty("--item-color", entity.color);
    if (won.has(entity.name)) li.classList.add("won");
    li.innerHTML = `
      <span class="tracker-item-dot" aria-hidden="true"></span>
      <span class="tracker-item-name">${entity.name}</span>
      <span class="tracker-item-check" aria-hidden="true"></span>
    `;
    li.addEventListener("click", () => {
      if (MULTI.active) return;
      toggleWon(entity.name, li);
    });
    trackerList.appendChild(li);
  });
  updateTrackerCount();
}

function toggleWon(name, li) {
  if (won.has(name)) { won.delete(name); li.classList.remove("won"); }
  else { won.add(name); li.classList.add("won"); }
  saveWon();
  updateTrackerCount();
  if (!isSpinning) applyFilters();
}

function updateTrackerCount() {
  trackerCount.textContent = `${won.size} / ${allEntities.length}`;
}

function markWon(name) {
  won.add(name);
  saveWon();
  const li = trackerList.querySelector(`[data-name="${cssEscape(name)}"]`);
  if (li) {
    li.classList.add("won", "just-won");
    setTimeout(() => li.classList.remove("just-won"), 700);
    li.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  updateTrackerCount();
}

function cssEscape(s) { return s.replace(/["\\]/g, "\\$&"); }

async function resetWon() {
  if (won.size === 0) return;
  if (MULTI.active && roomRef) {
    const playersData = {};
    Object.entries(MULTI.players).forEach(([id, p]) => {
      playersData[id] = { ...p, points: 0 };
    });
    try {
      await update(roomRef, {
        players: playersData,
        state: { phase: "idle", round: Date.now() },
        guesses: null,
        won: null,
      });
    } catch (e) { console.warn("reset failed", e); }
  }
  doReset();
}

function doReset() {
  won.clear();
  saveWon();
  trackerList.querySelectorAll(".tracker-item").forEach((li) => li.classList.remove("won"));
  updateTrackerCount();
  applyFilters();
}

// ---------- Wheel drawing ----------

function drawEmptyWheel(message) {
  const size = canvas.width;
  const cx = size / 2, cy = size / 2;
  ctx.fillStyle = "#1d1d2e";
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 10, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#8a8aa0";
  ctx.font = "bold 20px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, cx, cy);
}

function drawWheel() {
  const size = canvas.width;
  const cx = size / 2, cy = size / 2;
  const radius = size / 2 - 10;
  const n = entities.length;
  const sliceAngle = (2 * Math.PI) / n;
  const fontSize = Math.max(9, Math.min(18, size / (n * 1.1)));

  ctx.clearRect(0, 0, size, size);

  entities.forEach((entity, i) => {
    const startAngle = i * sliceAngle - Math.PI / 2;
    const endAngle = startAngle + sliceAngle;
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
    const baseColor = entity.color || `hsl(${(i * 360) / n}, 65%, 50%)`;
    grad.addColorStop(0, lighten(baseColor, 0.15));
    grad.addColorStop(1, baseColor);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(startAngle + sliceAngle / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
    ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
    ctx.shadowBlur = 4;
    ctx.fillText(entity.name, radius - 14, fontSize / 3);
    ctx.restore();
  });

  ctx.beginPath();
  ctx.arc(cx, cy, 32, 0, 2 * Math.PI);
  const hubGrad = ctx.createRadialGradient(cx, cy - 8, 4, cx, cy, 32);
  hubGrad.addColorStop(0, "#2a2a3e");
  hubGrad.addColorStop(1, "#0a0a14");
  ctx.fillStyle = hubGrad;
  ctx.fill();
  ctx.strokeStyle = "#5acb7a";
  ctx.lineWidth = 3;
  ctx.stroke();
}

function lighten(hex, amount) {
  const h = hex.replace("#", "");
  const r = Math.min(255, parseInt(h.slice(0, 2), 16) + Math.round(255 * amount));
  const g = Math.min(255, parseInt(h.slice(2, 4), 16) + Math.round(255 * amount));
  const b = Math.min(255, parseInt(h.slice(4, 6), 16) + Math.round(255 * amount));
  return `rgb(${r},${g},${b})`;
}

// ---------- Spin (solo entry + multi host trigger) ----------

function spin() {
  if (isSpinning || entities.length === 0) return;
  if (MULTI.active && !MULTI.isHost) return;

  if (!MULTI.active) {
    soloSpin();
    return;
  }

  // Multi host: compute winner, write state to Firebase
  const winnerIdx = Math.floor(Math.random() * entities.length);
  const winner = entities[winnerIdx];
  const sliceAngle = 360 / entities.length;
  const targetAngle = 360 - (winnerIdx * sliceAngle + sliceAngle / 2);
  const fullTurns = 5 + Math.floor(Math.random() * 3);
  const finalRotation =
    currentRotation + fullTurns * 360 + (targetAngle - (currentRotation % 360));

  MULTI.currentEntity = winner.name; // host keeps this secret locally
  MULTI.guessWinnerId = null;

  const soundUrl = winner.sounds?.[0]?.path || "";
  const round = Date.now();

  update(child(roomRef, "state"), {
    phase: "spinning",
    finalRotation,
    soundUrl,
    round,
  }).catch((e) => console.warn("spin state update failed", e));

  // Host's own listener will pick up the state change and start the animation.
  // After 5s, host transitions to "guessing".
  setTimeout(() => {
    if (MULTI.guessWinnerId) return;
    update(child(roomRef, "state"), { phase: "guessing" })
      .catch((e) => console.warn("guess phase update failed", e));
  }, 5000);
}

function soloSpin() {
  isSpinning = true;
  spinBtn.disabled = true;
  if (audio) { audio.pause(); audio.currentTime = 0; }
  const winnerIdx = Math.floor(Math.random() * entities.length);
  const winner = entities[winnerIdx];
  const sliceAngle = 360 / entities.length;
  const targetAngle = 360 - (winnerIdx * sliceAngle + sliceAngle / 2);
  const fullTurns = 5 + Math.floor(Math.random() * 3);
  const finalRotation =
    currentRotation + fullTurns * 360 + (targetAngle - (currentRotation % 360));
  currentRotation = finalRotation;
  canvas.style.transform = `rotate(${finalRotation}deg)`;
  setTimeout(() => {
    reveal(winner);
    markWon(winner.name);
    isSpinning = false;
    setTimeout(() => applyFilters(), 50);
  }, 5000);
}

function reveal(entity) {
  panel.style.setProperty("--entity", entity.color || "#5acb7a");
  const imgSrc = entity.render || entity.texture || "";
  const isBruteTexture = !entity.render && entity.texture;
  panelImage.classList.toggle("pixelated", isBruteTexture);
  if (imgSrc) { panelImage.src = imgSrc; panelImage.alt = entity.name; }
  else { panelImage.removeAttribute("src"); panelImage.alt = ""; }
  panelName.textContent = entity.name;
  renderSoundChips(entity);
  panelEmpty.hidden = true;
  panelContent.hidden = false;
  panelContent.classList.remove("revealing");
  void panelContent.offsetWidth;
  panelContent.classList.add("revealing");
  if (entity.sounds && entity.sounds.length > 0) {
    playSoundChip(entity.sounds[0].path, 0);
  }
}

function revealAtTop(entity) {
  revealTop.style.setProperty("--accent", entity.color || "#5acb7a");
  const imgSrc = entity.render || entity.texture || "";
  const isBruteTexture = !entity.render && entity.texture;
  revealTopImage.classList.toggle("pixelated", isBruteTexture);
  if (imgSrc) { revealTopImage.src = imgSrc; revealTopImage.alt = entity.name; }
  else { revealTopImage.removeAttribute("src"); revealTopImage.alt = ""; }
  revealTopName.textContent = entity.name;
  renderSoundChipsInto(revealTopSounds, entity);
  revealTop.hidden = false;
  revealTop.classList.remove("revealing");
  void revealTop.offsetWidth;
  revealTop.classList.add("revealing");
}

function playClueSound(soundUrl) {
  if (!soundUrl) return;
  if (audio) { audio.pause(); audio.currentTime = 0; }
  audio = new Audio(soundUrl);
  audio.play().catch((err) => console.warn(`Son indisponible :`, err.message));
}

function renderSoundChips(entity) { renderSoundChipsInto(panelSounds, entity); }

function renderSoundChipsInto(container, entity) {
  container.innerHTML = "";
  if (!entity.sounds || entity.sounds.length === 0) {
    const empty = document.createElement("span");
    empty.className = "panel-sounds-empty";
    empty.textContent = "Aucun son disponible";
    container.appendChild(empty);
    return;
  }
  const groups = new Map();
  entity.sounds.forEach((s) => {
    if (!groups.has(s.action)) groups.set(s.action, []);
    groups.get(s.action).push(s);
  });
  let chipIndex = 0;
  groups.forEach((sounds, action) => {
    const group = document.createElement("div");
    group.className = "sound-group";
    const label = document.createElement("span");
    label.className = "sound-group-label";
    label.textContent = action;
    group.appendChild(label);
    sounds.forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sound-chip";
      btn.textContent = s.n || "♪";
      btn.title = s.label;
      const idx = chipIndex++;
      btn.addEventListener("click", () => playSoundChipInto(container, s.path, idx, btn));
      group.appendChild(btn);
    });
    container.appendChild(group);
  });
}

function playSoundChip(src, idx, btnEl) { playSoundChipInto(panelSounds, src, idx, btnEl); }

function playSoundChipInto(container, src, idx, btnEl) {
  if (audio) { audio.pause(); audio.currentTime = 0; }
  container.querySelectorAll(".sound-chip.playing").forEach((b) => b.classList.remove("playing"));
  const target = btnEl || container.querySelectorAll(".sound-chip")[idx];
  if (target) {
    target.classList.add("playing");
    setTimeout(() => target.classList.remove("playing"), 1500);
  }
  audio = new Audio(src);
  audio.addEventListener("ended", () => { if (target) target.classList.remove("playing"); });
  audio.play().catch((err) => console.warn(`Son indisponible "${src}" :`, err.message));
}

// ---------- Scoreboard ----------

function renderScoreboard(highlightId = null) {
  scoreboardList.innerHTML = "";
  const arr = Object.entries(MULTI.players).map(([id, p]) => ({ id, ...p }));
  if (arr.length === 0) {
    const li = document.createElement("li");
    li.className = "scoreboard-empty";
    li.textContent = "Aucun joueur";
    scoreboardList.appendChild(li);
    return;
  }
  arr.sort((a, b) => (b.points || 0) - (a.points || 0));
  arr.forEach((p, i) => {
    const rank = i + 1;
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}`;
    const li = document.createElement("li");
    li.className = `score-item rank-${rank}`;
    if (p.id === MULTI.myPlayerId) li.classList.add("self");
    if (p.id === highlightId) li.classList.add("bumped");
    li.innerHTML = `
      <span class="score-rank">${medal}</span>
      <span class="score-name">${escapeHtml(p.name || "Joueur")}${p.id === MULTI.myPlayerId ? '<span class="score-name-tag">(toi)</span>' : ""}</span>
      <span class="score-points">${p.points || 0}</span>
    `;
    scoreboardList.appendChild(li);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Round / guess phase ----------

function setRoundPhase(phase, winnerName = null) {
  MULTI.roundPhase = phase;
  buzzBar.hidden = !MULTI.active;
  guessInput.classList.remove("wrong", "correct");
  buzzStatus.classList.remove("active", "won");
  if (phase === "idle") {
    guessInput.disabled = true;
    guessInput.value = "";
    guessSubmit.disabled = true;
    buzzStatus.textContent = MULTI.isHost
      ? "Lance la roulette pour démarrer un tour."
      : "En attente du tirage par l'hôte…";
  } else if (phase === "spinning") {
    guessInput.disabled = true;
    guessSubmit.disabled = true;
    guessInput.value = "";
    buzzStatus.textContent = "Roulette en cours… écoute bien le son.";
  } else if (phase === "guessing") {
    if (MULTI.guessWinnerId) return;
    guessInput.disabled = false;
    guessSubmit.disabled = false;
    guessInput.value = "";
    buzzStatus.textContent = "🎯 Devine quelle entité c'est ! (tape le nom)";
    buzzStatus.classList.add("active");
    setTimeout(() => guessInput.focus(), 30);
  } else if (phase === "resolved") {
    guessInput.disabled = true;
    guessSubmit.disabled = true;
    const winner = MULTI.players[MULTI.guessWinnerId];
    const who = winner ? winner.name : winnerName || "?";
    buzzStatus.textContent = `✓ ${who} a trouvé ! +1 pt`;
    buzzStatus.classList.add("won");
  }
}

function normalize(s) {
  return (s || "")
    .trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

function flashWrongInput() {
  guessInput.classList.remove("wrong");
  void guessInput.offsetWidth;
  guessInput.classList.add("wrong");
  guessInput.select();
  setTimeout(() => guessInput.classList.remove("wrong"), 600);
}

async function submitGuess(text) {
  if (!MULTI.active || MULTI.roundPhase !== "guessing") return;
  if (MULTI.guessWinnerId) return;
  if (!text || !text.trim()) return;
  if (!roomRef) return;

  if (MULTI.isHost) {
    // Host validates locally — has access to currentEntity
    handleHostLocalGuess(MULTI.myPlayerId, text);
    return;
  }

  // Client : push guess to Firebase, listen for verdict
  const guessesRef = child(roomRef, "guesses");
  const newGuessRef = push(guessesRef);
  const verdictListener = onValue(newGuessRef, (snap) => {
    const v = snap.val();
    if (!v || v.verdict == null) return;
    if (v.verdict === "wrong") flashWrongInput();
    else if (v.verdict === "correct" && MULTI.myPlayerId === v.playerId) {
      guessInput.classList.add("correct");
    }
    off(newGuessRef);
  });
  try {
    await set(newGuessRef, {
      playerId: MULTI.myPlayerId,
      text,
      timestamp: serverTimestamp(),
      verdict: null,
    });
  } catch (e) {
    console.warn("guess write failed", e);
    off(newGuessRef);
  }
}

function handleHostLocalGuess(playerId, text) {
  if (!MULTI.isHost) return;
  if (MULTI.guessWinnerId) return;
  if (MULTI.roundPhase !== "guessing") return;
  if (!MULTI.currentEntity) return;

  if (normalize(text) === normalize(MULTI.currentEntity)) {
    // Correct — broadcast resolution via Firebase
    const winnerName = MULTI.players[playerId]?.name || MULTI.myName;
    const newPoints = (MULTI.players[playerId]?.points || 0) + 1;
    MULTI.guessWinnerId = playerId;
    guessInput.classList.add("correct");

    Promise.all([
      set(child(roomRef, `players/${playerId}/points`), newPoints),
      set(child(roomRef, `won/${MULTI.currentEntity}`), true),
      update(child(roomRef, "state"), {
        phase: "resolved",
        winnerId: playerId,
        winnerName,
        entityName: MULTI.currentEntity,
      }),
    ]).catch((e) => console.warn("host resolve failed", e));
  } else {
    flashWrongInput();
  }
}

async function handleClientGuess(guessId, guess) {
  // Host validates a guess from a remote client
  if (!MULTI.isHost) return;
  if (MULTI.guessWinnerId) return;
  if (MULTI.roundPhase !== "guessing") return;
  if (!guess || !guess.text) return;
  if (!MULTI.currentEntity) return;
  if (!MULTI.players[guess.playerId]) return;

  if (normalize(guess.text) === normalize(MULTI.currentEntity)) {
    const winnerName = MULTI.players[guess.playerId].name;
    const newPoints = (MULTI.players[guess.playerId].points || 0) + 1;
    MULTI.guessWinnerId = guess.playerId;
    try {
      await update(child(roomRef, `guesses/${guessId}`), { verdict: "correct" });
      await Promise.all([
        set(child(roomRef, `players/${guess.playerId}/points`), newPoints),
        set(child(roomRef, `won/${MULTI.currentEntity}`), true),
        update(child(roomRef, "state"), {
          phase: "resolved",
          winnerId: guess.playerId,
          winnerName,
          entityName: MULTI.currentEntity,
        }),
      ]);
    } catch (e) { console.warn("host resolve failed", e); }
  } else {
    try { await update(child(roomRef, `guesses/${guessId}`), { verdict: "wrong" }); }
    catch (e) { console.warn("verdict write failed", e); }
  }
}

// ---------- Firebase multi : room lifecycle ----------

function genRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function createRoom() {
  const pseudo = readPseudo();
  if (!pseudo) return;
  MULTI.myName = pseudo;
  multiCreateBtn.disabled = true;
  multiCreateBtn.textContent = "Authentification…";

  const user = await initFirebase();
  if (!user) {
    multiCreateBtn.disabled = false;
    multiCreateBtn.textContent = "Créer une room";
    return;
  }
  multiCreateBtn.textContent = "Création…";

  let roomId = null;
  for (let i = 0; i < 6; i++) {
    const candidate = genRoomCode();
    const snap = await get(ref(db, `rooms/${candidate}`));
    if (!snap.exists()) { roomId = candidate; break; }
  }
  if (!roomId) {
    alert("Impossible de générer une room. Réessaie.");
    multiCreateBtn.disabled = false;
    multiCreateBtn.textContent = "Créer une room";
    return;
  }

  MULTI.myPlayerId = user.uid;
  MULTI.isHost = true;
  MULTI.roomId = roomId;
  MULTI.players = { [MULTI.myPlayerId]: { name: pseudo, points: 0 } };

  roomRef = ref(db, `rooms/${roomId}`);
  try {
    await set(roomRef, {
      host: MULTI.myPlayerId,
      createdAt: serverTimestamp(),
      state: { phase: "idle", round: 0 },
      players: {
        [MULTI.myPlayerId]: { name: pseudo, points: 0, joined: serverTimestamp() },
      },
    });
    onDisconnect(roomRef).remove();
  } catch (e) {
    alert("Erreur création room : " + e.message);
    multiCreateBtn.disabled = false;
    multiCreateBtn.textContent = "Créer une room";
    return;
  }

  MULTI.active = true;
  setupRoomListeners();

  const url = `${window.location.origin}${window.location.pathname}#room=${roomId}`;
  multiLinkInput.value = url;
  multiCreateResult.hidden = false;
  multiCreateBtn.style.display = "none";

  setTimeout(() => enterMultiGame(), 400);
}

async function joinRoom(rawInput) {
  const pseudo = readPseudo();
  if (!pseudo) return;
  MULTI.myName = pseudo;

  let roomId = (rawInput || "").trim();
  if (!roomId) return;
  const match = roomId.match(/[#?&]room=([^&]+)/);
  if (match) roomId = match[1];
  roomId = roomId.toUpperCase();

  multiJoinBtn.disabled = true;
  multiJoinBtn.textContent = "Authentification…";

  const user = await initFirebase();
  if (!user) {
    multiJoinBtn.disabled = false;
    multiJoinBtn.textContent = "Rejoindre";
    return;
  }
  multiJoinBtn.textContent = "Connexion…";

  const candidateRef = ref(db, `rooms/${roomId}`);
  try {
    const snap = await get(candidateRef);
    if (!snap.exists()) {
      alert("Room introuvable. Vérifie le code.");
      multiJoinBtn.disabled = false;
      multiJoinBtn.textContent = "Rejoindre";
      return;
    }
  } catch (e) {
    alert("Erreur Firebase : " + e.message);
    multiJoinBtn.disabled = false;
    multiJoinBtn.textContent = "Rejoindre";
    return;
  }

  MULTI.myPlayerId = user.uid;
  MULTI.isHost = false;
  MULTI.roomId = roomId;
  roomRef = candidateRef;

  const playerRef = child(roomRef, `players/${MULTI.myPlayerId}`);
  try {
    await set(playerRef, { name: pseudo, points: 0, joined: serverTimestamp() });
    onDisconnect(playerRef).remove();
  } catch (e) {
    alert("Erreur join : " + e.message);
    multiJoinBtn.disabled = false;
    multiJoinBtn.textContent = "Rejoindre";
    return;
  }

  MULTI.active = true;
  setupRoomListeners();
  enterMultiGame();
}

function setupRoomListeners() {
  if (!roomRef) return;

  const stateRef = child(roomRef, "state");
  onValue(stateRef, (snap) => {
    const s = snap.val();
    if (s) handleStateUpdate(s);
  });
  roomListeners.push(() => off(stateRef));

  const playersRef = child(roomRef, "players");
  onValue(playersRef, (snap) => {
    const p = snap.val() || {};
    MULTI.players = p;
    renderScoreboard();
    playerCountEl.textContent = Object.keys(p).length;
  });
  roomListeners.push(() => off(playersRef));

  const wonRef = child(roomRef, "won");
  onValue(wonRef, (snap) => {
    const wonData = snap.val() || {};
    const remoteSet = new Set(Object.keys(wonData));
    if (remoteSet.size === 0 && won.size > 0) {
      // Reset broadcast received
      doReset();
      return;
    }
    won.clear();
    remoteSet.forEach((n) => won.add(n));
    if (allEntities.length > 0) {
      buildTracker();
      applyFilters();
    }
  });
  roomListeners.push(() => off(wonRef));

  if (MULTI.isHost) {
    const guessesRef = child(roomRef, "guesses");
    onChildAdded(guessesRef, (snap) => {
      const g = snap.val();
      if (!g || g.verdict != null) return;
      handleClientGuess(snap.key, g);
    });
    roomListeners.push(() => off(guessesRef));
  }
}

function teardownRoomListeners() {
  roomListeners.forEach((unsub) => { try { unsub(); } catch {} });
  roomListeners.length = 0;
}

function handleStateUpdate(state) {
  if (!state) return;
  if (state.phase === "spinning") {
    if (state.round && state.round === MULTI.currentRound) return; // already handled
    MULTI.currentRound = state.round || Date.now();
    MULTI.guessWinnerId = null;
    revealTop.hidden = true;
    revealTop.classList.remove("revealing");
    if (typeof state.finalRotation === "number") {
      isSpinning = true;
      spinBtn.disabled = true;
      currentRotation = state.finalRotation;
      canvas.style.transform = `rotate(${state.finalRotation}deg)`;
    }
    setRoundPhase("spinning");
    if (state.soundUrl) {
      setTimeout(() => playClueSound(state.soundUrl), 5000);
    }
    setTimeout(() => { isSpinning = false; }, 5050);
  } else if (state.phase === "guessing") {
    isSpinning = false;
    setRoundPhase("guessing");
  } else if (state.phase === "resolved") {
    MULTI.guessWinnerId = state.winnerId;
    const ent = allEntities.find((e) => e.name === state.entityName);
    if (ent) {
      revealAtTop(ent);
      // local won set is also updated via /won listener
    }
    setRoundPhase("resolved", state.winnerName);
    if (state.winnerId === MULTI.myPlayerId) {
      guessInput.classList.add("correct");
    }
  } else if (state.phase === "idle") {
    revealTop.hidden = true;
    setRoundPhase("idle");
  }
}

function enterMultiGame() {
  multiSetup.hidden = true;
  filtersEl.hidden = true;
  roomInfo.hidden = false;
  panelEmpty.hidden = true;
  panelContent.hidden = true;
  scoreboard.hidden = false;
  buzzBar.hidden = false;
  revealTop.hidden = true;
  revealTop.classList.remove("revealing");
  setRoundPhase("idle");
  spinBtn.hidden = !MULTI.isHost;
  renderScoreboard();
  playerCountEl.textContent = Object.keys(MULTI.players).length;
  if (MULTI.roomId) {
    history.replaceState(null, "", `#room=${MULTI.roomId}`);
  }
  switchGame("minecraft");
}

async function leaveRoom() {
  teardownRoomListeners();
  if (roomRef && MULTI.myPlayerId) {
    try {
      if (MULTI.isHost) {
        await remove(roomRef);
      } else {
        await remove(child(roomRef, `players/${MULTI.myPlayerId}`));
      }
    } catch {}
  }
  MULTI.active = false;
  MULTI.isHost = false;
  MULTI.roomId = null;
  MULTI.myPlayerId = "";
  MULTI.players = {};
  MULTI.roundPhase = "idle";
  MULTI.currentEntity = null;
  MULTI.guessWinnerId = null;
  MULTI.currentRound = 0;
  roomRef = null;
  history.replaceState(null, "", window.location.pathname);
  filtersEl.hidden = false;
  roomInfo.hidden = true;
  scoreboard.hidden = true;
  buzzBar.hidden = true;
  revealTop.hidden = true;
  spinBtn.hidden = false;
  panelEmpty.hidden = false;
  showLanding();
}

// ---------- Wire up ----------

spinBtn.addEventListener("click", spin);
trackerReset.addEventListener("click", resetWon);
filterInputs.forEach((cb) =>
  cb.addEventListener("change", () => { if (!isSpinning) applyFilters(); })
);

multiCreateBtn.addEventListener("click", createRoom);
multiJoinBtn.addEventListener("click", () => joinRoom(multiJoinInput.value));
multiJoinInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(multiJoinInput.value); });
multiCopyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(multiLinkInput.value);
    multiCopyBtn.textContent = "Copié ✓";
    setTimeout(() => (multiCopyBtn.textContent = "Copier"), 1600);
  } catch { multiLinkInput.select(); }
});
roomLeaveBtn.addEventListener("click", leaveRoom);
roomShareBtn.addEventListener("click", async () => {
  if (!MULTI.roomId) return;
  const url = `${window.location.origin}${window.location.pathname}#room=${MULTI.roomId}`;
  try { await navigator.clipboard.writeText(url); }
  catch {
    const tmp = document.createElement("input");
    tmp.value = url; document.body.appendChild(tmp); tmp.select();
    try { document.execCommand("copy"); } catch {}
    document.body.removeChild(tmp);
  }
  roomShareBtn.classList.add("copied");
  const label = roomShareBtn.querySelector(".room-share-label");
  const original = label.textContent;
  label.textContent = "Copié ✓";
  setTimeout(() => { roomShareBtn.classList.remove("copied"); label.textContent = original; }, 1800);
});

guessForm.addEventListener("submit", (e) => {
  e.preventDefault();
  submitGuess(guessInput.value);
});

// ---------- Init ----------

buildGameNav();

(function init() {
  const hashMatch = window.location.hash.match(/room=([^&]+)/);
  if (hashMatch) {
    landing.hidden = true;
    multiSetup.hidden = false;
    multiCreateResult.hidden = true;
    multiCreateBtn.style.display = "none";
    multiJoinInput.value = hashMatch[1];
    multiPseudoInput.value = loadPseudo();
    multiPseudoInput.focus();
    return;
  }
  showLanding();
})();
