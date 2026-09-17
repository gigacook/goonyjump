"use strict";
/* =====================================================================
   JUMPY GOONERS — icy-tower-style co-op LAN jumper, goon edition
   Everything is canvas + WebAudio. No assets, no dependencies.
   ===================================================================== */

// ---------------------------------------------------------------- consts
const TOWER_W  = 560;      // inner tower width (world units)
const WALL_T   = 46;       // wall draw thickness
const FLOOR_H  = 85;       // vertical distance between floors
const PLAT_T   = 16;       // platform thickness
const VIEW_H   = 780;      // world height shown on screen
const GRAV     = 2600;
// ---- admin sliders (local to this browser, live, not synced over LAN) ----
const admin = { time: 1, grav: 1 };
const grav = () => GRAV * admin.grav;   // use this everywhere instead of GRAV
const RUN_ACC  = 2400;
const AIR_ACC  = 1500;
const MAX_VX   = 950;
const JUMP_BASE= 640;
const JUMP_VXK = 0.78;     // extra jump power per unit of |vx|
const P_W = 40, P_H = 54;  // player size (physics)
const BODY_W = 34, BODY_H = 46; // native sprite dimensions (scaled up to P_W/P_H)
const MEGA_EVERY = 100;    // every Nth floor glows and mega-launches you
const MEGA_VY = 3000;      // must still dwarf a full-🔥 jump (~2100)
const SEND_MS  = 50;       // net send rate
const GHOST_TIME = 3.5;    // seconds as ghost before respawn

// goon jet ability
const GOON_CHARGE = 6;     // meter per second (passive)
const GOON_DRAIN  = 40;    // meter per second while jetting — ramps up the longer you hold
const GOON_RAMP   = 60;    // extra drain per second held: a full tank = ~1.3s of blast
const JET_LOCK    = 0.8;   // dry spell after a blast before passive charge resumes
const JET_THRUST  = 4400;  // must comfortably out-accelerate gravity
const JET_MAX_VY  = 1150;
const SLOW_FACTOR = 0.55;  // how hard other goons get slowed
const SLOW_TIME   = 1.0;

const ZONES = [
  { at:   0, name: "THE GOON CAVE",             top: "#2c3e6b", bot: "#16213f" },
  { at:  25, name: "EDGING ALTITUDE",           top: "#2d5f8a", bot: "#1b2f55" },
  { at:  50, name: "THE MOIST STRATOSPHERE 💦", top: "#5b2d7a", bot: "#28104a" },
  { at:  75, name: "AUBERGINE FIELDS 🍆",       top: "#6b2d7a", bot: "#38104a" },
  { at: 100, name: "SPACE (STILL GOONING)",     top: "#0d0d24", bot: "#05050f" },
  { at: 125, name: "THE SOCK DIMENSION",        top: "#7a3d5e", bot: "#33142a" },
  { at: 150, name: "TREN VALLEY 💉",            top: "#6e5230", bot: "#33250f" },
  { at: 175, name: "POST-NUT CLARITY",          top: "#e8e4f4", bot: "#8f86b8" },
  { at: 200, name: "OK SERIOUSLY STOP",         top: "#123a3a", bot: "#061616" },
];
const TAUNTS = [
  "im literally gooning", "EDGING THE TOWER", "one more floor then i stop",
  "💦💦💦", "😩😩😩", "certified gooner moment", "goon jet ENGAGED",
  "🍆", "WITNESS ME", "AAAAAAAA", "do a flip!!", "tren made me do it",
  "MOM DONT COME IN", "post-nut clarity at floor 100", "goonmaxxing rn",
  "my knees!!", "who turned on gravity??",
];
const COMBO_CREDIT_MAX = 8;  // most combo one landing can add (keeps combo² from exploding)
const COMBO_BONUS_CAP  = 25; // combo² pays in full up to here, then tapers to linear
const COMBO_WORDS = ["", "", "MOIST!", "GREAT!", "SLOPPY!", "WOW!!", "DRIPPING!!", "UNREAL!!!", "GOONERLICIOUS!!!"];
const RANDOM_NAMES = ["Goonther","Edgelord","Sir Goons-a-lot","Moist Kevin","Tren Gerald",
  "Lil Edger","GoonMaster64","Aubergine Dave","Big Steve","Wiggly","Nugget","Susan"];
const SKIN_PRESETS = ["#f2b370","#8d5a2b","#ffd9b3","#7ee08a","#7ab8ff","#c98cff","#ff8ca8","#ffe066","#9aa4e8","#66e0d5"];
// [id, label, unlockScore]
const HATS = [
  ["cap","Cap",0],["tophat","Top hat",0],["propeller","Propeller",0],["cone","Traffic cone",0],
  ["sombrero","Sombrero",0],["viking","Viking",0],["chef","Chef",0],["wizard","Wizard",0],["none","Bald & proud",0],
  ["tren","TREN Syringe 💉",1500],["lambo","Lamborghini 🏎️",4000],["aubergine","The Aubergine 🍆",8000],
];

// ---------------------------------------------------------------- utils
function mulberry32(a) {
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
function hexLerp(c1, c2, t) {
  const p = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const a = p(c1), b = p(c2);
  return `rgb(${a.map((v,i)=>Math.round(lerp(v,b[i],t))).join(",")})`;
}
function shade(hex, f) { // f: -1 darken .. +1 lighten
  const v = i => clamp(Math.round(parseInt(hex.slice(i,i+2),16) * (1+f) + (f>0? f*40:0)), 0, 255);
  return `rgb(${v(1)},${v(3)},${v(5)})`;
}

// deterministic platform for floor n, given seed
function platformFor(n, seed) {
  if (n <= 0) return { x: 0, w: TOWER_W, n: 0 };
  if (n % 50 === 0) return { x: 0, w: TOWER_W, n };
  const rng = mulberry32((seed ^ Math.imul(n, 0x9E3779B9)) >>> 0);
  let w = clamp(250 - n * 0.85, 95, 250);
  if (n % 10 === 0) w = Math.min(w + 70, TOWER_W * 0.7);
  const x = rng() * (TOWER_W - w);
  const drip = n > 5 && rng() < 0.15; // dripping = jump off it for an instant tank refill
  return { x, w, n, drip };
}

// neon wall segments: bounce off one to stack a goon multiplier (x2..x4)
const SEG_H = 260, NEON_H = 90;
function neonWallAt(side, k, seed) {
  if (k < 1) return false;
  const rng = mulberry32((seed ^ Math.imul(k * 2 + (side > 0 ? 1 : 0), 0x27d4eb2f) ^ 0x9e37) >>> 0);
  return rng() < 0.25;
}
let usedNeon = new Set();
function tryWallBoost(side) {
  const k = Math.floor(me.y / SEG_H);
  const key = side + ":" + k;
  if (me.y >= k * SEG_H && me.y <= k * SEG_H + NEON_H && neonWallAt(side, k, seed) && !usedNeon.has(key)) {
    usedNeon.add(key);
    me.boost = Math.min(4, me.boost + 1);
    me.slowVelT = 0;
    fireGain(0.05);
    sfx.boost();
    shake = 8;
    floaters.push({ x: me.x, y: me.y + 100, txt: `🔥 GOON x${me.boost}!!`, t: 1.4, c: "#39ff14", big: true });
    for (let i = 0; i < 14; i++)
      particles.push({ x: me.x, y: me.y + 20, vx: -side * (100 + Math.random() * 300), vy: (Math.random() - 0.5) * 300,
        t: 0.7, c: "#39ff14", r: 3, grav: 0.3 });
  }
}

// deterministic floating condom for floor n (or null)
function condomFor(n, seed) {
  if (n < 3) return null;
  const rng = mulberry32((seed ^ Math.imul(n, 0x85EBCA6B) ^ 0x5bd1e99) >>> 0);
  // luck widens the odds — deterministic per seed, so each gooner sees their own spread
  if (rng() > 0.12 + Math.min(stats.luck * 0.0006, 0.10)) return null; // rare = special
  return { x: 50 + rng() * (TOWER_W - 100), y: n * FLOOR_H + FLOOR_H * (0.4 + rng() * 0.45), n };
}

// ---------------------------------------------------------------- audio
let AC = null;
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){} }
  if (AC && AC.state === "suspended") AC.resume();
  return AC;
}
function beep(f0, f1, dur, type = "square", vol = 0.12, delay = 0) {
  const ac = audio(); if (!ac) return;
  const t0 = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(ac.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
const sfx = {
  jump:   () => beep(180, 520, 0.14, "square", 0.10),
  bigJump:() => { beep(160, 700, 0.2, "square", 0.11); beep(320, 900, 0.2, "triangle", 0.07, 0.03); },
  land:   () => beep(130, 55, 0.09, "sine", 0.14),
  wall:   () => beep(280, 560, 0.1, "triangle", 0.12),
  combo:  n  => beep(500 + n * 70, 700 + n * 90, 0.13, "sine", 0.13),
  comboEnd:() => { for (let i = 0; i < 4; i++) beep(400+i*130, 500+i*130, 0.12, "triangle", 0.10, i*0.07); },
  ghost:  () => beep(500, 60, 0.7, "sawtooth", 0.10),
  respawn:() => { beep(300, 900, 0.25, "sine", 0.10); beep(450, 1200, 0.25, "sine", 0.07, 0.08); },
  taunt:  () => { const b = 200 + Math.random()*250;
                  for (let i = 0; i < 3; i++) beep(b*(1+i*0.3), b*(1+i*0.3)*1.2, 0.09, "sawtooth", 0.08, i*0.09); },
  zone:   () => { [523,659,784,1047].forEach((f,i)=>beep(f,f,0.16,"triangle",0.10,i*0.1)); },
  over:   () => { [400,320,240,120].forEach((f,i)=>beep(f,f*0.8,0.25,"square",0.10,i*0.18)); },
  condom: () => { beep(900, 1500, 0.09, "sine", 0.13); beep(1200, 1800, 0.09, "sine", 0.09, 0.06); },
  jet:    () => { for (let i = 0; i < 5; i++) beep(90 + Math.random()*60, 60, 0.12, "sawtooth", 0.09, i*0.06); },
  unlock: () => { [523,659,784,1047,1319].forEach((f,i)=>beep(f,f*1.02,0.2,"triangle",0.11,i*0.09)); },
  boost:  () => { [440,554,659,880].forEach((f,i)=>beep(f,f*1.3,0.12,"square",0.11,i*0.05)); },
  mega:   () => { beep(100, 1400, 0.5, "sawtooth", 0.13); [660,880,1320].forEach((f,i)=>beep(f,f*1.5,0.2,"square",0.09,0.1+i*0.08)); },
};

// ---------------------------------------------------------------- persistence
// 🏁 SEASON 2 — bump this number to wipe every gooner's progress and start over.
// The wipe runs once per device, the first time it loads a new season.
const SEASON = 2;
(() => {
  try {
    if (+(localStorage.getItem("gooner_season") || 1) !== SEASON) {
      localStorage.removeItem("gooner_best");  // score / floor / lifetime total
      localStorage.removeItem("gooner_stats"); // spent stat points
      localStorage.setItem("gooner_season", SEASON);
    }
  } catch (e) {}
})();
const bestSave = (() => {
  try { return { score: 0, floor: 0, total: 0, ...JSON.parse(localStorage.getItem("gooner_best") || "{}") }; }
  catch (e) { return { score: 0, floor: 0, total: 0 }; }
})();
function saveBest() { try { localStorage.setItem("gooner_best", JSON.stringify(bestSave)); } catch (e) {} }
function hatUnlocked(id) {
  const h = HATS.find(h => h[0] === id);
  return !h || bestSave.score >= h[2];
}

// gooner levels: gated behind TOTAL lifetime score, worn on the chest
function xpFor(lvl) { return 400 * (lvl - 1) * lvl; } // lv2=800, lv5=8k, lv10=36k…
function levelFromTotal(total) {
  let l = 1;
  while (l < 1337 && total >= xpFor(l + 1)) l++;
  return l;
}
let myLvl = levelFromTotal(bestSave.total);
let runCounted = 0; // how much of this run's score is already in the lifetime total

// ---- level perks (auto-unlock at milestone levels) ----
const PERKS = [
  [30,  "Golden Boots",     "+5% jump power, always"],
  [40,  "Sticky Hands",     "2x condom grab radius"],
  [50,  "BIG TANK",         "goon tank 150"],
  [60,  "Rapid Recharge",   "tank charges 50% faster"],
  [70,  "Efficient Gooning","jet drains 20% less"],
  [80,  "Edging Master",    "combo window +50%"],
  [90,  "Speedy Seance",    "ghost respawns 1s faster"],
  [100, "MEGA TANK",        "goon tank 200"],
  [125, "Pre-Gamed",        "start every run with a full tank"],
  [150, "Sponsored Gooner", "+10% floor & combo points"],
  [175, "Loud Mouth",       "taunting charges the tank +5"],
  [200, "Rainbow Trail",    "leave a fabulous trail at speed"],
  [255, "GOON GOD",         "crown on your name 👑"],
  [300, "Triple Tank",      "goon tank 300"],
  [500, "Overflow",         "tank charges 2x"],
  [1000,"Gravity Is Cringe","+10% jump power, always"],
  [1337,"L33T GOONER",      "👾 g0d-t13r name"],
];
const hasPerk = l => myLvl >= l;
const tankMax = () => 100 + (hasPerk(50) ? 50 : 0) + (hasPerk(100) ? 50 : 0) + (hasPerk(300) ? 100 : 0);
const ghostTime = () => Math.max(1, (GHOST_TIME - (hasPerk(90) ? 1 : 0)) * (1 - Math.min(stats.luck * 0.01, 0.6)));
const comboWindow = () => (hasPerk(80) ? 3.6 : 2.4) * (1 + stats.rizz * 0.015);

// ---- 🔥 FIRE: builds only while your inputs stay good, and lifts the run/jump
// ceiling to 2x. Slow to build, quick to lose — that's the whole point.
const FIRE_UP   = 40;  // seconds of *flawless* input for a full bar (good play ≈ 50-60s)
const FIRE_DOWN = 7;   // seconds to bleed a full bar once you go fully sloppy
const FIRE_GATE = 0.5; // movement quality below this drains instead of builds
const maxVX = () => MAX_VX * (1 + me.fire);
function fireGain(amt) { me.fire = Math.min(1, me.fire + amt); }

// ---- allocatable stats: 1 point per level ----
const STAT_KEYS = ["agi", "bnc", "msl", "rizz", "gains", "luck"];
const stats = (() => {
  const base = { agi: 0, bnc: 0, msl: 0, rizz: 0, gains: 0, luck: 0 };
  try { return { ...base, ...JSON.parse(localStorage.getItem("gooner_stats") || "{}") }; }
  catch (e) { return base; }
})();
function saveStats() { try { localStorage.setItem("gooner_stats", JSON.stringify(stats)); } catch (e) {} }
const statSum = () => STAT_KEYS.reduce((a, k) => a + (stats[k] | 0), 0);
function clampStats() {
  for (const k of STAT_KEYS) stats[k] = clamp(stats[k] | 0, 0, 254);
  while (statSum() > myLvl - 1) {
    const k = STAT_KEYS.slice().reverse().find(k => stats[k] > 0);
    if (!k) break;
    stats[k]--;
  }
}
clampStats();
function statPoints() { return Math.max(0, myLvl - 1 - statSum()); }

// ---- character bodies, unlocked by level ----
const CHARS = [
  ["goober",    "Goober",         1],
  ["gymbro",    "Gymbro",         3],
  ["dumbbell",  "Dumbbell Guy",   8],
  ["shaker",    "Protein Shaker", 12],
  ["sock",      "The Sock",       18],
  ["drop",      "Goon Droplet",   25],
  ["trenbot",   "Tren-Bot 9000",  35],
  ["girthzilla","Girthzilla",     45],
  ["orb",       "Ascended Orb",   60],
];
// difficulty: crank the goon juice for a score multiplier
const DIFFS = [
  ["chill",  "😌 Chill",     1,   1],
  ["sweaty", "🥵 Sweaty",    1.6, 1.5],
  ["gooned", "😩 GOONED",    2.2, 2],
  ["leet",   "👹 1337 MODE", 3,   3],
];
let myDiff = (() => { try { return localStorage.getItem("gooner_diff") || "chill"; } catch (e) { return "chill"; } })();
const DIFF = () => DIFFS.find(d => d[0] === myDiff) || DIFFS[0];

const charUnlocked = id => { const c = CHARS.find(c => c[0] === id); return !c || myLvl >= c[2]; };
const CSCALE = { girthzilla: 1.35, orb: 1.2, trenbot: 1.1, gymbro: 1.08 };

function noteScore(score, floor) {
  const prevBest = bestSave.score;
  if (score > runCounted) {
    bestSave.total += score - runCounted;
    runCounted = score;
  }
  if (score > bestSave.score) bestSave.score = score;
  if (floor > bestSave.floor) bestSave.floor = floor;
  saveBest();
  const nl = levelFromTotal(bestSave.total);
  if (nl > myLvl) {
    const myLvlPrev = myLvl;
    myLvl = nl;
    toast(`⬆️ LEVEL UP!! you are now LV${nl} (+${nl - myLvlPrev} stat point${nl - myLvlPrev > 1 ? "s" : ""})`);
    for (const [pl, pname, pdesc] of PERKS)
      if (myLvlPrev < pl && nl >= pl) toast(`🎁 LV${pl} PERK: ${pname} — ${pdesc}`);
    floaters.push({ x: me.x, y: me.y + 150, txt: `LV${nl}!!`, t: 2, c: "#7ee08a", big: true });
    sfx.unlock();
    confetti();
  }
  for (const [id, label, need] of HATS) {
    if (need > 0 && prevBest < need && bestSave.score >= need) {
      toast(`🔓 HAT UNLOCKED: ${label} !!`);
      floaters.push({ x: me.x, y: me.y + 150, txt: `NEW HAT: ${label}`, t: 2.5, c: "#ffe066", big: true });
      sfx.unlock();
      confetti();
    }
  }
}

// ---------------------------------------------------------------- DOM / lobby
const cv = document.getElementById("game");
const ctx = cv.getContext("2d");
const lobby = document.getElementById("lobby");
const nameInput = document.getElementById("nameInput");
const skinRow = document.getElementById("skinRow");
const skinPick = document.getElementById("skinPick");
const hatRow = document.getElementById("hatRow");
const hatPick = document.getElementById("hatPick");
const prevCv = document.getElementById("preview");
const prevCtx = prevCv.getContext("2d");
const errEl = document.getElementById("err");
const bestLine = document.getElementById("bestLine");

const IS_TOUCH = (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches)
  || "ontouchstart" in window;

const saved = JSON.parse(localStorage.getItem("gooner") || "{}");
let myProfile = {
  name: saved.name || RANDOM_NAMES[(Math.random() * RANDOM_NAMES.length) | 0],
  skin: saved.skin || SKIN_PRESETS[(Math.random() * SKIN_PRESETS.length) | 0],
  hat: saved.hat || "cap",
  hatColor: saved.hatColor || "#e94f4f",
  char: saved.char || "goober",
};
if (!hatUnlocked(myProfile.hat)) myProfile.hat = "cap";
if (!charUnlocked(myProfile.char)) myProfile.char = "goober";
nameInput.value = myProfile.name;
skinPick.value = myProfile.skin.length === 7 ? myProfile.skin : "#f2b370";
hatPick.value = myProfile.hatColor;

SKIN_PRESETS.forEach(c => {
  const d = document.createElement("div");
  d.className = "swatch"; d.style.background = c;
  d.onclick = () => { myProfile.skin = c; refreshLobby(); };
  d.dataset.c = c;
  skinRow.insertBefore(d, skinPick);
});
DIFFS.forEach(([id, label, goo, mul]) => {
  const b = document.createElement("button");
  b.className = "hatbtn"; b.dataset.df = id;
  b.textContent = `${label} (goo ×${goo}, pts ×${mul})`;
  b.onclick = () => { myDiff = id; try { localStorage.setItem("gooner_diff", id); } catch (e) {} refreshLobby(); };
  const dr = document.getElementById("diffRow");
  if (dr) dr.appendChild(b);
});
CHARS.forEach(([id, label, need]) => {
  const b = document.createElement("button");
  b.className = "hatbtn"; b.dataset.ch = id; b.dataset.need = need;
  b.onclick = () => {
    if (!charUnlocked(id)) { errEl.textContent = `🔒 reach LV${need} to unlock ${label}`; return; }
    errEl.textContent = "";
    myProfile.char = id; refreshLobby();
  };
  const cr = document.getElementById("charRow");
  if (cr) cr.appendChild(b);
});
HATS.forEach(([id, label, need]) => {
  const b = document.createElement("button");
  b.className = "hatbtn"; b.dataset.h = id; b.dataset.need = need;
  b.onclick = () => {
    if (!hatUnlocked(id)) { errEl.textContent = `🔒 reach ${need} score to unlock ${label}`; return; }
    errEl.textContent = "";
    myProfile.hat = id; refreshLobby();
  };
  hatRow.appendChild(b);
});
skinPick.oninput = () => { myProfile.skin = skinPick.value; refreshLobby(); };
hatPick.oninput = () => { myProfile.hatColor = hatPick.value; refreshLobby(); };
nameInput.oninput = () => { myProfile.name = nameInput.value; };

function refreshLobby() {
  [...skinRow.querySelectorAll(".swatch")].forEach(s => s.classList.toggle("sel", s.dataset.c === myProfile.skin));
  [...hatRow.children].forEach(b => {
    const [id, label, need] = HATS.find(h => h[0] === b.dataset.h);
    const locked = !hatUnlocked(id);
    b.textContent = locked ? `🔒 ${label} (${need}+)` : label;
    b.classList.toggle("locked", locked);
    b.classList.toggle("sel", id === myProfile.hat);
  });
  if (bestLine) bestLine.textContent =
    `LV${levelFromTotal(bestSave.total)} gooner · best ${bestSave.score} pts · floor ${bestSave.floor} · lifetime ${bestSave.total} (saved on this device)`;
}
const STAT_DEFS = [
  ["agi", "\ud83c\udfc3 Agility",  "accel + snappier turns \u2014 builds \ud83d\udd25 faster (+2%/pt)"],
  ["bnc", "\ud83e\udd98 Bounce",   "higher jumps (+1.5%/pt)"],
  ["msl", "\ud83d\udcaa Muscles",  "goon jet power only \u2014 jet earns no combo (+1.2%/pt)"],
  ["rizz", "\ud83d\ude0f Rizz",     "combo window lasts longer (+1.5%/pt)"],
  ["gains", "\ud83d\udcc8 Gains",   "all score gains (+1%/pt)"],
  ["luck", "\ud83c\udf40 Luck",     "faster respawn + more condoms spawn for you (-1%/pt)"],
];
// spend (or refund) n points on one stat, never past the level budget or the 254 cap
function bump(k, n) {
  const room = n > 0 ? Math.min(n, statPoints()) : n;
  stats[k] = clamp(stats[k] + room, 0, 254);
  saveStats(); refreshLobby();
}
function resetStats() {
  for (const k of STAT_KEYS) stats[k] = 0;
  saveStats(); refreshLobby();
}
const QUICKSET = [-100, -10, -1, 1, 10, 100];
function buildStatsUI() {
  const row = document.getElementById("statRow");
  if (!row) return;
  row.innerHTML = "";
  for (const [k, label, desc] of STAT_DEFS) {
    const d = document.createElement("div");
    d.style.cssText = "display:flex;align-items:center;gap:4px;margin:4px 0;font-size:14px";
    const val = document.createElement("b"); val.style.cssText = "min-width:30px;text-align:center;color:#ffe066";
    const lab = document.createElement("span"); lab.innerHTML = `${label} <span style="color:#8a93d6;font-size:11px">${desc}</span>`;
    const btns = QUICKSET.map(n => {
      const b = document.createElement("button");
      b.textContent = n > 0 ? `+${n}` : `\u2212${-n}`;
      b.className = "hatbtn";
      b.style.cssText = "padding:2px 6px;font-size:12px";
      b.dataset.n = n;
      b.onclick = () => bump(k, n);
      return b;
    });
    const max = document.createElement("button");
    max.textContent = "MAX"; max.className = "hatbtn";
    max.style.cssText = "padding:2px 6px;font-size:12px";
    max.dataset.n = 999;
    max.onclick = () => bump(k, statPoints());
    d.append(...btns.slice(0, 3), val, ...btns.slice(3), max, lab);
    d.dataset.k = k;
    row.appendChild(d);
  }
  const rst = document.getElementById("statReset");
  if (rst) rst.onclick = resetStats;
}
buildStatsUI();
function refreshStatsUI() {
  const row = document.getElementById("statRow");
  if (!row) return;
  const left = statPoints();
  for (const d of row.children) {
    const k = d.dataset.k;
    d.querySelector("b").textContent = stats[k];
    for (const b of d.querySelectorAll("button")) {
      const n = +b.dataset.n;
      b.disabled = n > 0 ? left === 0 || stats[k] >= 254 : stats[k] === 0;
      b.style.opacity = b.disabled ? ".35" : "1";
    }
  }
  const cr = document.getElementById("charRow");
  if (cr) for (const b of cr.children) {
    const [id, label, need] = CHARS.find(c => c[0] === b.dataset.ch);
    const locked = !charUnlocked(id);
    b.textContent = locked ? `🔒 ${label} (LV${need})` : label;
    b.classList.toggle("locked", locked);
    b.classList.toggle("sel", id === myProfile.char);
  }
  const dr = document.getElementById("diffRow");
  if (dr) for (const b of dr.children) b.classList.toggle("sel", b.dataset.df === myDiff);
  const sp = document.getElementById("statPts");
  if (sp) sp.textContent = `(${statPoints()} points left \u2014 1 per level)`;
  const pk = document.getElementById("perkList");
  if (pk) pk.innerHTML = PERKS.map(([l, n, ds]) =>
    `<div style="${myLvl >= l ? "color:#7ee08a" : "opacity:.45"}">${myLvl >= l ? "\u2705" : "\ud83d\udd12"} LV${l} \u2014 <b>${n}</b>: ${ds}</div>`).join("");
}
const _refreshLobby = refreshLobby;
refreshLobby = function () { _refreshLobby(); refreshStatsUI(); };
refreshLobby();

function pollInfo() {
  fetch("/info").then(r => r.json()).then(j => {
    const urls = (j.ips || [j.ip]).map(ip => `<b>http://${ip}:${j.port}</b>`).join("<br>");
    document.getElementById("joinInfo").innerHTML =
      `friends on your wifi join at:<br>${urls}<br>` +
      `📱 phones: same wifi, type it with the http:// !<br>` +
      `<span style="color:#8a93d6">not connecting? System Settings → Privacy & Security → Local Network → allow Terminal, then restart the server</span>`;
    const a = document.getElementById("activeGame");
    if (a) a.innerHTML = (j.players && j.players.length)
      ? `🟢 <b>LIVE TOWER:</b> ${j.players.map(p => `LV${p.lvl} ${p.name}`).join(" · ")} — join em!!`
      : `⚪ tower is empty — be the first gooner in`;
    buildPodium(j.seen);
  }).catch(() => { document.getElementById("joinInfo").textContent = "…"; });
}
function drawPodiumChar(cvp, u, pose) {
  const g = cvp.getContext("2d");
  g.clearRect(0, 0, cvp.width, cvp.height);
  g.save(); g.translate(cvp.width / 2, cvp.height - 6); g.scale(1.05, 1.05);
  drawGoober(g, 0, 0, { skin: u.skin || "#f2b370", hat: u.hat || "cap", hatColor: u.hatColor || "#e94f4f",
    char: u.char || "goober", lvl: u.lvl || 1, facing: pose === "lookup" ? -1 : 1, vx: 0,
    airborne: false, rot: 0, ghost: false, t: 1.2, pose });
  g.restore();
}
function inspectUser(u) {
  const el = document.getElementById("inspect");
  if (!el) return;
  const st = u.stats || {};
  const charL = (CHARS.find(c => c[0] === u.char) || CHARS[0])[1];
  const hatL = (HATS.find(h => h[0] === u.hat) || HATS[0])[1];
  el.innerHTML = `<b style="color:#ffe066">🔎 LV${u.lvl || 1} ${u.name}</b> — ${charL}, wearing ${hatL}<br>` +
    STAT_DEFS.map(([k, l]) => `${l.split(" ")[0]} ${st[k] | 0}`).join(" · ");
  el.style.display = "block";
}
function buildPodium(seen) {
  const pd = document.getElementById("podium");
  if (!pd || !seen || !seen.length) return;
  pd.innerHTML = "";
  const sorted = seen.slice().sort((a, b) => (b.lvl || 1) - (a.lvl || 1));
  const top = sorted.slice(0, 3), rest = sorted.slice(3);
  const order = [top[1], top[0], top[2]]; // F1 style: 2 | 1 | 3
  const hts = [40, 62, 26], medals = ["🥈", "🥇", "🥉"], poses = ["spit", "flex", "lookup"], nums = ["2", "1", "3"];
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:flex-end;justify-content:center;gap:8px";
  order.forEach((u, i) => {
    if (!u) return;
    const col = document.createElement("div");
    col.style.cssText = "text-align:center;cursor:pointer";
    const cvp = document.createElement("canvas");
    cvp.width = 86; cvp.height = 104;
    drawPodiumChar(cvp, u, poses[i]);
    const cap = document.createElement("div");
    cap.style.cssText = "font-size:11px;color:#ffe066";
    cap.textContent = `${medals[i]} LV${u.lvl || 1} ${u.name}`;
    const block = document.createElement("div");
    block.style.cssText = `height:${hts[i]}px;background:linear-gradient(#ffd24d,#b8741b);border:3px outset #ffe066;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:20px;color:#5b2d00`;
    block.textContent = nums[i];
    col.append(cvp, cap, block);
    col.onclick = () => inspectUser(u);
    row.appendChild(col);
  });
  pd.appendChild(row);
  const pr = document.createElement("div");
  pr.style.cssText = "margin-top:6px;text-align:center;font-size:11px;color:#8a93d6";
  pr.textContent = "🪣 PEASANT TIER: ";
  if (rest.length) rest.forEach(u => {
    const sp = document.createElement("span");
    sp.style.cssText = "cursor:pointer;text-decoration:underline;margin:0 4px;color:#cfd6ff";
    sp.textContent = `LV${u.lvl || 1} ${u.name}`;
    sp.onclick = () => inspectUser(u);
    pr.appendChild(sp);
  });
  else pr.textContent += "(mercifully empty)";
  pd.appendChild(pr);
}
pollInfo();
if (typeof setInterval !== "undefined") setInterval(() => { if (!started) pollInfo(); }, 3000);

// animated lobby preview
let prevT = 0;
function drawPreview(ts) {
  prevT = ts / 1000;
  prevCtx.clearRect(0, 0, 140, 130);
  prevCtx.save();
  prevCtx.translate(70, 118);
  prevCtx.scale(1.6, 1.6);
  const bob = Math.sin(prevT * 3) * 3;
  drawGoober(prevCtx, 0, bob, {
    skin: myProfile.skin, hat: myProfile.hat, hatColor: myProfile.hatColor,
    facing: Math.sin(prevT * 0.7) > 0 ? 1 : -1, vx: Math.sin(prevT * 3) * 300,
    airborne: false, rot: 0, ghost: false, lvl: myLvl, char: myProfile.char, t: prevT,
  });
  prevCtx.restore();
  if (!started) requestAnimationFrame(drawPreview);
}
requestAnimationFrame(drawPreview);

// ---------------------------------------------------------------- net
let ws = null, myId = -1, seed = 1, started = false, disconnected = false;
const remotes = new Map(); // id -> remote player

let leaving = false; // true while intentionally returning to lobby

function connect() {
  leaving = false;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: "join", ...myProfile, lvl: myLvl, stats, key: adminKey }));
  };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    handleNet(m);
  };
  ws.onclose = () => {
    if (leaving) return;
    if (started) disconnected = true; else errEl.textContent = "couldn't reach server :(";
  };
  ws.onerror = () => {};
}

function newRemote(id, p) {
  return {
    id, name: p.name, skin: p.skin, hat: p.hat, hatColor: p.hatColor, lvl: p.lvl || 1, char: p.char || "goober",
    x: TOWER_W / 2, y: 0, tx: TOWER_W / 2, ty: 0, vx: 0,
    facing: 1, ghost: false, jet: false, fire: 0, floor: 0, score: 0, rot: 0, trot: 0,
    bubble: null, bubbleT: 0, seen: performance.now(),
  };
}

function handleNet(m) {
  switch (m.t) {
    case "welcome":
      myId = m.id; seed = m.seed;
      adminUI.show(m.host);            // ⚙ appears only on the host's machine
      if (m.admin) adminUI.set(m.admin); // inherit whatever the tower is set to

      for (const [idStr, p] of Object.entries(m.players)) {
        const id = +idStr;
        remotes.set(id, newRemote(id, p));
      }
      startGame(remotes.size > 0); // late joiner starts as ghost
      break;
    case "admin":   // host retuned the tower — everyone's physics follow
      adminUI.set(m);
      toast(`⚙ admin: time ${m.time.toFixed(2)}× · gravity ${m.grav.toFixed(2)}×`);
      break;
    case "join": {
      remotes.set(m.id, newRemote(m.id, m.p));
      toast(`${m.p.name} joined the goon session!!`);
      sfx.respawn();
      break;
    }
    case "leave": {
      const r = remotes.get(m.id);
      if (r) toast(`${r.name} finished (left) 😩`);
      remotes.delete(m.id);
      break;
    }
    case "s": {
      const r = remotes.get(m.id);
      if (!r) break;
      r.tx = m.x; r.ty = m.y; r.vx = m.vx; r.facing = m.f;
      r.ghost = !!m.g; r.jet = !!m.j; r.floor = m.fl; r.score = m.sc; r.trot = m.r || 0;
      r.fire = m.fi || 0;
      if (m.lv) r.lvl = m.lv;
      r.seen = performance.now();
      break;
    }
    case "taunt": {
      const r = remotes.get(m.id);
      if (r) { r.bubble = m.txt; r.bubbleT = 2.4; sfx.taunt(); }
      break;
    }
    case "slow": break; // legacy
    case "lasso": {
      const r = remotes.get(m.id);
      if (m.ph === "s") {
        me.pullT = 2; me.pullId = m.id;
        toast(`🤠 ${r ? r.name : "someone"} threw the GOON LASSO — hold on!!`);
        sfx.boost();
      } else {
        me.pullT = 0;
        if (!me.ghost && me.y < m.y - 40) { // ricochet the stragglers above the caster
          me.vy = Math.min(Math.sqrt(2 * grav() * (m.y - me.y + 400)), 2800);
          me.grounded = false;
          shake = 12; sfx.mega();
          floaters.push({ x: me.x, y: me.y + 100, txt: "LASSO RICOCHET!!!", t: 1.5, c: "#ffd24d", big: true });
        }
      }
      break;
    }
    case "restart":
      seed = m.seed;
      resetRun();
      toast("NEW TOWER! goon responsibly");
      break;
  }
}

// ---------------------------------------------------------------- input
const keys = {};
let tiltInput = 0, gotTilt = false;
let touchJet = false, touchLeft = false, touchRight = false;

addEventListener("keydown", e => {
  if (!started) return;
  if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," "].includes(e.key)) e.preventDefault();
  const k = e.key.toLowerCase();
  if (!keys[k]) {
    if ((k === " " || k === "arrowup" || k === "w") && !e.repeat) me.jumpBuf = 0.12;
    if (k === "t" && !e.repeat) doTaunt();
    if (k === "capslock" && !e.repeat) tryLasso();
    if (k === "r" && gameOver && !e.repeat) ws && ws.send(JSON.stringify({ t: "restart" }));
    if ((k === "escape" || (k === "l" && gameOver)) && !e.repeat) backToLobby();
  }
  keys[k] = true;
  audio();
});
addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });

// Admin key for a deployed server: open  https://your-app/?admin=THEKEY  once and
// it sticks on this device. Locally there's no key and the server just checks that
// you're on its own machine. Server decides either way — this is only the claim.
const adminKey = (() => {
  try {
    const q = new URLSearchParams(location.search).get("admin");
    if (q) { localStorage.setItem("gooner_adminkey", q);
             history.replaceState(null, "", location.pathname); } // keep it out of the URL bar
    return localStorage.getItem("gooner_adminkey") || "";
  } catch (e) { return ""; }
})();

// ---- admin sliders -----------------------------------------------------
// Server-authoritative: the values live in server.py, apply to EVERY player,
// and only the host's browser (this machine) can see or move them. The server
// enforces that too — a phone sending {t:"admin"} is refused.
const adminUI = (() => {
  const panel = document.getElementById("admin");
  const toggle = document.getElementById("admToggle");
  if (!panel || !toggle) return { show() {}, set() {} };
  const f = v => v.toFixed(2) + "×";
  const bind = (key, id) => {
    const slider = document.getElementById(id), out = document.getElementById(id + "V");
    if (!slider) return null;
    const show = () => { if (out) out.textContent = f(admin[key]); };
    // move the bar -> tell the server -> it broadcasts back to everyone (us included)
    slider.addEventListener("input", () => {
      admin[key] = +slider.value; show();
      ws && ws.readyState === 1 && ws.send(JSON.stringify({ t: "admin", [key]: admin[key] }));
    });
    return { key, slider, show };
  };
  const ctl = [bind("time", "admTime"), bind("grav", "admGrav")].filter(Boolean);
  const reset = document.getElementById("admReset");
  if (reset) reset.onclick = () => {
    for (const c of ctl) { admin[c.key] = 1; c.slider.value = 1; c.show(); }
    ws && ws.readyState === 1 && ws.send(JSON.stringify({ t: "admin", time: 1, grav: 1 }));
  };
  toggle.onclick = () => panel.classList.toggle("on");
  // backtick toggles too — its own listener, so the lobby's `started` guard
  // on the main keydown handler can't swallow it
  addEventListener("keydown", e => {
    if (e.key === "`" && !e.repeat && toggle.classList.contains("on")) panel.classList.toggle("on");
  });
  return {
    show(isHost) { toggle.classList.toggle("on", !!isHost); },  // host only
    set(vals) {   // adopt the server's values (broadcast, or on join)
      for (const c of ctl) {
        if (typeof vals[c.key] === "number") { admin[c.key] = vals[c.key]; c.slider.value = vals[c.key]; }
        c.show();
      }
    },
  };
})();

// phone leaning sensor -> left/right
function onTilt(e) {
  if (e.gamma == null && e.beta == null) return;
  gotTilt = true;
  let ang = 0;
  if (typeof screen !== "undefined" && screen.orientation) ang = screen.orientation.angle || 0;
  else if (typeof window.orientation === "number") ang = window.orientation;
  let v;
  if (ang === 0) v = e.gamma;
  else if (ang === 90) v = e.beta;
  else if (ang === -90 || ang === 270) v = -e.beta;
  else v = -e.gamma;
  tiltInput = clamp((v || 0) / 22, -1, 1);
}
addEventListener("deviceorientation", onTilt);

function bindTouch(id, down, up) {
  const el = document.getElementById(id);
  if (!el) return;
  const d = e => { e.preventDefault(); audio(); down(); };
  const u = e => { e.preventDefault(); up && up(); };
  el.addEventListener("touchstart", d, { passive: false });
  el.addEventListener("touchend", u, { passive: false });
  el.addEventListener("touchcancel", u, { passive: false });
  el.addEventListener("mousedown", d);
  el.addEventListener("mouseup", u);
}
bindTouch("btnJump", () => { me.jumpBuf = 0.12; });
bindTouch("btnJet", () => { if (gameOver) backToLobby(); else touchJet = true; }, () => { touchJet = false; });
bindTouch("btnTaunt", () => doTaunt());
bindTouch("btnLeft", () => { touchLeft = true; }, () => { touchLeft = false; });
bindTouch("btnRight", () => { touchRight = true; }, () => { touchRight = false; });
document.addEventListener("touchmove", e => { if (started) e.preventDefault(); }, { passive: false });

function tryLasso() {
  if (!started || me.ghost || me.lassoT > 0 || me.goon < tankMax() - 1) return;
  me.lassoT = 2;
  sfx.boost();
  toast("🤠 GOON LASSO!! everyone hold on!!");
  ws && ws.readyState === 1 && ws.send(JSON.stringify({ t: "lasso", ph: "s" }));
}

function doTaunt() {
  if (hasPerk(175)) me.goon = Math.min(tankMax(), me.goon + 5);
  const txt = TAUNTS[(Math.random() * TAUNTS.length) | 0];
  me.bubble = txt; me.bubbleT = 2.4;
  sfx.taunt();
  ws && ws.readyState === 1 && ws.send(JSON.stringify({ t: "taunt", txt }));
}

// ---------------------------------------------------------------- game state
const me = {
  x: TOWER_W / 2, y: 0, vx: 0, vy: 0, facing: 1,
  grounded: true, coyote: 0, jumpBuf: 0,
  ghost: false, ghostT: 0,
  floor: 0, bestFloor: 0, score: 0,
  combo: 0, comboT: 0, lastLandFloor: 0,
  rot: 0, rotV: 0, airT: 0, legPhase: 0, squash: 0,
  bubble: null, bubbleT: 0,
  goon: 30, jet: false, slowT: 0,   // goon jet ability
  jetHeld: 0, jetLock: 0, jetFloor: null, // volatile jet: ramping drain + no free refunds
  fire: 0,                          // 🔥 skill meter: lifts the speed/jump ceiling to 2x
  boost: 1, slowVelT: 0, comboMax: 2.4, // neon wall multiplier
  lassoT: 0, pullT: 0, pullId: 0,       // goon lasso
};
let camY = 0;                 // world y at bottom of view
let doomY = -600, doomOn = false;
let gameOver = false, gameOverT = 0;
let elapsed = 0;
let particles = [];
let floaters = [];            // floating texts {x,y,txt,t,c,big}
let toasts = [];              // top-of-screen messages
let zoneFlash = null, zoneFlashT = 0;
let lastZoneIdx = 0;
let shake = 0;
let lastSend = 0, lastSlowSend = 0;
let collectedCondoms = new Set();

function toast(txt) { toasts.push({ txt, t: 4 }); if (toasts.length > 4) toasts.shift(); }

function zoneAt(floor) {
  let z = ZONES[0];
  for (const zn of ZONES) if (floor >= zn.at) z = zn;
  return z;
}

function resetRun() {
  me.x = TOWER_W / 2 + (Math.random() - 0.5) * 200;
  me.y = 0; me.vx = 0; me.vy = 0;
  me.grounded = true; me.ghost = false; me.ghostT = 0;
  me.floor = 0; me.bestFloor = 0; me.score = 0;
  me.combo = 0; me.comboT = 0; me.lastLandFloor = 0;
  me.rot = 0; me.rotV = 0; me.airT = 0;
  me.goon = hasPerk(125) ? tankMax() : 30; me.jet = false; me.slowT = 0;
  me.jetHeld = 0; me.jetLock = 0; me.jetFloor = null; me.fire = 0;
  me.boost = 1; me.slowVelT = 0; usedNeon = new Set();
  me.lassoT = 0; me.pullT = 0;
  runCounted = 0;
  camY = 0; doomY = -600; doomOn = false;
  gameOver = false; gameOverT = 0; elapsed = 0;
  particles = []; floaters = []; lastZoneIdx = 0;
  collectedCondoms = new Set();
}

function startGame(asGhost) {
  myProfile.name = (myProfile.name.trim() || "Gooner").slice(0, 14);
  localStorage.setItem("gooner", JSON.stringify(myProfile));
  lobby.style.display = "none";
  started = true;
  resetRun();
  if (asGhost) { becomeGhost(true); me.ghostT = ghostTime() - 0.5; }
  if (IS_TOUCH) {
    const ui = document.getElementById("touchUI");
    if (ui) ui.style.display = "block";
    if (typeof setTimeout !== "undefined") setTimeout(() => {
      if (!gotTilt) { // no gyro? show arrow buttons
        for (const id of ["btnLeft", "btnRight"]) {
          const el = document.getElementById(id);
          if (el) el.style.display = "flex";
        }
        toast("no tilt sensor — use the arrows!");
      } else toast("lean your phone to move!!");
    }, 2500);
  }
  last = performance.now();
  requestAnimationFrame(frame);
}

function backToLobby() {
  if (!started) return;
  leaving = true;
  try { if (ws) ws.close(); } catch (e) {}
  ws = null;
  remotes.clear();
  started = false; disconnected = false; gameOver = false;
  lobby.style.display = "flex";
  const ui = document.getElementById("touchUI");
  if (ui) ui.style.display = "none";
  refreshLobby(); // shows freshly saved progress + any new unlocks
  requestAnimationFrame(drawPreview);
}

document.getElementById("playBtn").onclick = () => {
  audio();
  // iOS needs a user-gesture permission grab for the leaning sensor
  if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }
  errEl.textContent = "";
  connect();
};

// ---------------------------------------------------------------- physics
function becomeGhost(quiet) {
  if (me.ghost) return;
  me.ghost = true; me.ghostT = 0; me.vy = 0; me.combo = 0; me.jet = false; me.boost = 1;
  me.jetHeld = 0; me.jetFloor = null; me.fire = 0;
  if (!quiet) {
    sfx.ghost();
    burst(me.x, me.y + P_H / 2, 18, "#bfe8ff");
    floaters.push({ x: me.x, y: me.y + 70, txt: "oh no", t: 1.5, c: "#bfe8ff", big: false });
  }
}

function highestAlive() {
  let best = null;
  if (!me.ghost) best = { y: me.y, floor: me.bestFloor, x: me.x };
  for (const r of remotes.values())
    if (!r.ghost && (!best || r.y > best.y)) best = { y: r.y, floor: r.floor, x: r.x };
  return best;
}

function updateMe(dt) {
  me.slowT -= dt;
  me.jetLock -= dt;
  if (me.ghost) {
    // float toward highest living buddy
    me.ghostT += dt;
    const target = highestAlive();
    if (target) {
      me.x += clamp(target.x - me.x, -220 * dt, 220 * dt);
      me.y += clamp(target.y + 60 - me.y, -60 * dt, 320 * dt);
      if (me.ghostT > ghostTime()) { // respawn on a platform near buddy
        const fl = Math.max(0, Math.round(target.y / FLOOR_H));
        const p = platformFor(fl, seed);
        me.x = p.x + p.w / 2; me.y = fl * FLOOR_H;
        me.vx = 0; me.vy = 0; me.ghost = false; me.grounded = true;
        me.lastLandFloor = fl;
        sfx.respawn();
        burst(me.x, me.y + P_H / 2, 24, "#ffe066");
      }
    } else {
      me.y += 120 * dt; // everyone dead-ish; drift up sadly
    }
    return;
  }

  const slowMul = 1;
  const left = keys["arrowleft"] || keys["a"];
  const right = keys["arrowright"] || keys["d"];
  let move = 0;
  if (left && !right) move = -1;
  else if (right && !left) move = 1;
  else if (touchLeft) move = -1;
  else if (touchRight) move = 1;
  else if (Math.abs(tiltInput) > 0.12) move = tiltInput;

  let acc = (me.grounded ? RUN_ACC : AIR_ACC) * slowMul * (1 + stats.agi * 0.02);
  if (move && move * me.vx < 0) acc *= 1.3 + stats.agi * 0.01; // agility = snappier turns
  if (move) { me.vx += acc * move * dt; if (Math.abs(move) > 0.3) me.facing = move > 0 ? 1 : -1; }
  else if (me.grounded) me.vx -= me.vx * Math.min(1, 9 * dt);
  me.vx = clamp(me.vx, -maxVX() * slowMul, maxVX() * slowMul);

  // jump (buffer + coyote)
  me.jumpBuf -= dt; me.coyote -= dt;
  if (me.jumpBuf > 0 && (me.grounded || me.coyote > 0)) {
    if (me.grounded && platformFor(Math.round(me.y / FLOOR_H), seed).drip) {
      me.goon = tankMax();
      sfx.condom();
      floaters.push({ x: me.x, y: me.y + 80, txt: "DRIP REFILL!! 💦", t: 1.2, c: "#7ab8ff", big: true });
    }
    me.jumpBuf = 0; me.coyote = 0;
    const power = (JUMP_BASE + Math.abs(me.vx) * JUMP_VXK) * 1
      * (1 + stats.bnc * 0.015) * (hasPerk(30) ? 1.05 : 1) * (hasPerk(1000) ? 1.1 : 1);
    me.vy = power;
    me.grounded = false;
    me.squash = -0.35;
    if (Math.abs(me.vx) > 620 * (1 + me.fire * 0.5)) { // fast enough = do a flip
      me.rotV = me.facing * (Math.PI * 2) / (2 * power / grav());
      sfx.bigJump();
      floaters.push({ x: me.x, y: me.y + 80, txt: "FLIP!", t: 0.8, c: "#ffe066", big: false });
    } else sfx.jump();
    burst(me.x, me.y, 6, "#ffffff");
  }

  // GOON JET: hold to blast upward, spraying goon-like substance
  const wantJet = keys["shift"] || keys["e"] || touchJet;
  // once you run dry you have to build a real sip back — no dribbling on fumes
  if (wantJet && me.goon > (me.jet ? 1 : tankMax() * 0.15)) {
    if (!me.jet) {
      me.jet = true;
      me.jetHeld = 0;
      me.jetFloor = Math.round(me.y / FLOOR_H); // altitude above this was BOUGHT, not earned
      sfx.jet();
      floaters.push({ x: me.x, y: me.y + 90, txt: "GOON JET!! 😩", t: 1.0, c: "#bfe8ff", big: false });
    }
    me.jetHeld += dt;
    // the longer you hold, the thirstier it gets: 40/s -> ~120/s
    const drain = (GOON_DRAIN + me.jetHeld * GOON_RAMP) * (hasPerk(70) ? 0.8 : 1);
    me.goon = Math.max(0, me.goon - drain * dt);
    me.fire = Math.max(0, me.fire - dt / FIRE_DOWN); // jetting is lazy — it bleeds 🔥
    me.vy = Math.min(me.vy + JET_THRUST * (1 + stats.msl * 0.012) * dt, JET_MAX_VY + stats.msl * 2); // muscles = goon harder
    me.grounded = false;
    me.rotV = 0; me.rot -= me.rot * Math.min(1, 8 * dt);
    if (Math.random() < dt * 45) { // spray the substance
      particles.push({ x: me.x + (Math.random()-0.5)*16, y: me.y + 4,
        vx: (Math.random()-0.5)*160, vy: -250 - Math.random()*200,
        t: 0.5 + Math.random()*0.4, c: "#bfe8ff", r: 3, grav: 0.3, e: "💦" });
    }
  } else {
    if (me.jet) { me.jetHeld = 0; me.jetLock = JET_LOCK; } // brief dry spell after every blast
    me.jet = false;
    if (me.jetLock <= 0)
      me.goon = Math.min(tankMax(), me.goon + GOON_CHARGE * (hasPerk(500) ? 2 : hasPerk(60) ? 1.5 : 1) * me.boost * dt);
  }

  // GOON LASSO: full-tank super — rockets you up, drags the squad along,
  // and the finale ricochets everyone below you up HARD (anti-useless tech)
  if (me.lassoT > 0) {
    me.lassoT -= dt;
    if (me.jetFloor == null) me.jetFloor = Math.round(me.y / FLOOR_H); // lasso altitude is bought too
    me.goon = Math.max(0, me.goon - (tankMax() / 2) * dt);
    me.vy = Math.min(me.vy + JET_THRUST * 1.1 * dt, JET_MAX_VY + 120);
    me.grounded = false;
    me.jet = true;
    if (Math.random() < dt * 20)
      particles.push({ x: me.x, y: me.y + 20, vx: (Math.random()-0.5)*200, vy: -200, t: 0.5, c: "#ffd24d", r: 3, grav: 0.2, e: "💫" });
    if (me.lassoT <= 0) {
      ws && ws.readyState === 1 && ws.send(JSON.stringify({ t: "lasso", ph: "e", y: Math.round(me.y) }));
      floaters.push({ x: me.x, y: me.y + 100, txt: "YEEHAW!!", t: 1.2, c: "#ffd24d", big: true });
    }
  }
  // being lassoed: pulled up toward the caster
  if (me.pullT > 0) {
    me.pullT -= dt;
    const c = remotes.get(me.pullId);
    if (c && !me.ghost && me.y < c.y) {
      me.vy = Math.min(me.vy + 2800 * dt, 1000);
      me.x += clamp(c.x - me.x, -160 * dt, 160 * dt);
      me.grounded = false;
      if (Math.random() < dt * 15)
        particles.push({ x: me.x, y: me.y + 30, vx: 0, vy: -120, t: 0.4, c: "#ffd24d", r: 2, grav: 0 });
    }
  }

  // ride a buddy's goon draft — chasing their jet lifts you too!
  for (const r of remotes.values()) {
    if (r.jet && !r.stale) {
      const ddx = me.x - r.x, ddy = me.y - r.y;
      if (ddx * ddx + ddy * ddy < 150 * 150) {
        me.vy = Math.min(me.vy + JET_THRUST * 0.8 * dt, JET_MAX_VY);
        me.grounded = false;
        if (Math.random() < dt * 22)
          particles.push({ x: me.x, y: me.y, vx: 0, vy: -160, t: 0.4, c: "#bfe8ff", r: 2, grav: 0.2, e: "💦" });
      }
    }
  }

  const prevFeet = me.y;
  if (!me.grounded) {
    me.vy -= grav() * dt;
    me.airT += dt;
    me.rot += me.rotV * dt;
  } else {
    me.airT = 0; me.rotV = 0;
    me.rot -= me.rot * Math.min(1, 14 * dt);
  }
  me.x += me.vx * dt;
  me.y += me.vy * dt;

  // walls: icy-tower bounce (works on the ground too — build momentum side to side!)
  const half = P_W / 2;
  if (me.x < half) {
    me.x = half;
    if (me.vx < -220) {
      me.vx = -me.vx * 0.96;
      if (!me.grounded) me.vy += 60;
      me.facing = 1;
      sfx.wall(); burst(me.x - 10, me.y + 20, 8, "#cfd6ff"); shake = 4;
      fireGain(0.008); // clean wall work feeds the 🔥 (small — you bounce a LOT at speed)
      tryWallBoost(-1);
    } else me.vx = Math.max(me.vx, 0);
  }
  if (me.x > TOWER_W - half) {
    me.x = TOWER_W - half;
    if (me.vx > 220) {
      me.vx = -me.vx * 0.96;
      if (!me.grounded) me.vy += 60;
      me.facing = -1;
      sfx.wall(); burst(me.x + 10, me.y + 20, 8, "#cfd6ff"); shake = 4;
      fireGain(0.008); // clean wall work feeds the 🔥 (small — you bounce a LOT at speed)
      tryWallBoost(1);
    } else me.vx = Math.min(me.vx, 0);
  }

  // platform landing (one-way, only while falling)
  if (me.vy <= 0 && !me.grounded) {
    const from = Math.floor(prevFeet / FLOOR_H);
    const to = Math.max(0, Math.floor(me.y / FLOOR_H));
    for (let n = Math.min(from, 400000); n >= to; n--) {
      if (n < 0) break;
      const top = n * FLOOR_H;
      if (prevFeet >= top && me.y <= top) {
        const p = platformFor(n, seed);
        if (me.x + half > p.x + 4 && me.x - half < p.x + p.w - 4) {
          land(n, top);
          break;
        }
      }
    }
  } else if (me.grounded) {
    // walked off an edge?
    const n = Math.round(me.y / FLOOR_H);
    const p = platformFor(n, seed);
    if (me.x + half <= p.x + 4 || me.x - half >= p.x + p.w - 4) {
      me.grounded = false; me.coyote = 0.09;
    }
  }

  // floating condoms: grab for lil goon combo points
  const myFloor = Math.floor(me.y / FLOOR_H);
  const cy = me.y + P_H / 2;
  for (let n = myFloor - 1; n <= myFloor + 2; n++) {
    if (n < 3 || collectedCondoms.has(n)) continue;
    const c = condomFor(n, seed);
    if (!c) continue;
    const dx = me.x - c.x, dy = cy - c.y;
    const grabR = hasPerk(40) ? 80 : 40; // sticky hands
    if (dx * dx + dy * dy < grabR * grabR) {
      collectedCondoms.add(n);
      me.score += Math.round(100 * (1 + stats.gains * 0.01));
      me.goon = Math.min(tankMax(), me.goon + 25 * me.boost);
      me.vy = Math.max(me.vy, 650); // bouncy!
      me.grounded = false;
      shake = 8;
      noteScore(me.score, me.bestFloor);
      sfx.condom();
      floaters.push({ x: c.x, y: c.y + 40, txt: "GOON COMBO +100 💦", t: 1.5, c: "#ff9de2", big: true });
      for (let i = 0; i < 16; i++)
        particles.push({ x: c.x, y: c.y, vx: (Math.random()-0.5)*380, vy: Math.random()*380,
          t: 0.8, c: "#bfe8ff", r: 3 + Math.random()*2, grav: 0.4, e: "💦" });
    }
  }

  // goon juice check
  if (doomOn && me.y < doomY) becomeGhost();

  if (hasPerk(200) && Math.abs(me.vx) > 500 && Math.random() < dt * 25)
    particles.push({ x: me.x, y: me.y + 10, vx: -me.vx * 0.2, vy: 40,
      t: 0.6, c: `hsl(${(elapsed * 300) % 360}, 90%, 60%)`, r: 4, grav: 0 });
  // boost fades if you dawdle (burnout rules)
  if (me.boost > 1) {
    if (Math.abs(me.vx) < 350 && Math.abs(me.vy) < 200) me.slowVelT += dt;
    else me.slowVelT = Math.max(0, me.slowVelT - dt * 2);
    if (me.slowVelT > 1.6) {
      me.boost--; me.slowVelT = 0;
      floaters.push({ x: me.x, y: me.y + 80, txt: `boost fading… x${me.boost}`, t: 1.2, c: "#8fb8d8", big: false });
    }
  }
  // 🔥 FIRE: rated on how good your movement actually is right now — lateral speed
  // (weighted heaviest) plus real vertical motion. Above the bar it creeps up, below
  // it drains, both proportional to how far off you are. Slow to earn, quick to lose.
  if (!me.jet) {
    const q = clamp(Math.abs(me.vx) / MAX_VX * 0.65
                  + Math.min(Math.abs(me.vy) / 1400, 1) * 0.35, 0, 1);
    if (q > FIRE_GATE) fireGain(dt * (q - FIRE_GATE) / (1 - FIRE_GATE) / FIRE_UP);
    else me.fire = Math.max(0, me.fire - dt * (FIRE_GATE - q) / FIRE_GATE / FIRE_DOWN);
  }
  if (me.fire > 0.4 && Math.random() < dt * 30 * me.fire)
    particles.push({ x: me.x + (Math.random() - 0.5) * 20, y: me.y + 6,
      vx: -me.vx * 0.12, vy: -60 - Math.random() * 120,
      t: 0.4 + Math.random() * 0.3, c: "#ff9d3d", r: 3, grav: -0.2,
      e: me.fire > 0.85 ? "🔥" : null });

  me.legPhase += Math.abs(me.vx) * dt * 0.06;
  me.squash -= me.squash * Math.min(1, 10 * dt);
  me.floor = Math.max(0, Math.round(me.y / FLOOR_H));
}

function land(n, top) {
  me.y = top; me.vy = 0; me.grounded = true; me.coyote = 0;
  me.rot = Math.round(me.rot / (Math.PI * 2)) * Math.PI * 2; me.rotV = 0;
  me.squash = 0.35;
  sfx.land();
  burst(me.x, me.y, 5, "#ffffff");

  const gained = n - me.lastLandFloor;
  // floors above where the jet fired were BOUGHT with goon — they earn no combo
  // and no fuel back, otherwise a blast refunds more than it costs and you fly forever
  const earned = me.jetFloor == null ? gained
    : clamp(me.jetFloor - me.lastLandFloor, 0, gained);
  me.jetFloor = null;
  me.lastLandFloor = n;
  if (n > me.bestFloor) {
    me.score += Math.round((n - me.bestFloor) * 10 * (hasPerk(150) ? 1.1 : 1) * (1 + stats.gains * 0.01) * DIFF()[3]);
    me.bestFloor = n;
    checkZone();
  }
  // icy tower combos: chain jumps that skip 2+ floors
  if (earned >= 2) {
    // one monstrous 🔥 jump shouldn't pay like a 30-jump chain — combo² stays quadratic,
    // so cap what a single landing contributes. Floor points still count every floor.
    const credit = Math.min(earned, COMBO_CREDIT_MAX);
    me.combo += credit;
    me.comboT = me.comboMax = comboWindow() + Math.min(me.combo * 0.08, 2);
    me.goon = Math.min(tankMax(), me.goon + credit * 2 * me.boost);
    sfx.combo(Math.min(me.combo, 12));
    const w = COMBO_WORDS[Math.min(COMBO_WORDS.length - 1, Math.floor(me.combo / 3) + 2)];
    floaters.push({ x: me.x, y: me.y + 90, txt: `COMBO x${me.combo}`, t: 1.1, c: "#ff9de2", big: me.combo >= 8 });
    if (me.combo >= 6) floaters.push({ x: me.x, y: me.y + 130, txt: w, t: 1.1, c: "#ffe066", big: true });
  } else if (me.combo > 0) {
    endCombo();
  }
  noteScore(me.score, me.bestFloor);

  // MEGA floor: every 100th launches you into the stratosphere
  if (n > 0 && n % MEGA_EVERY === 0) {
    me.grounded = false;
    me.vy = MEGA_VY;
    me.rotV = me.facing * Math.PI * 3;
    shake = 14;
    sfx.mega();
    floaters.push({ x: me.x, y: me.y + 110, txt: "MEGA JUMP!!!", t: 1.6, c: "#ffe066", big: true });
    for (let i = 0; i < 30; i++)
      particles.push({ x: me.x + (Math.random()-0.5)*60, y: me.y,
        vx: (Math.random()-0.5)*500, vy: -Math.random()*400,
        t: 0.9, c: "#ffe066", r: 3 + Math.random()*3, grav: 0.3,
        e: Math.random() < 0.3 ? "⭐" : null });
  }
}

function endCombo() {
  if (me.combo >= 4) {
    // quadratic is the fun part, but an unbounded chain used to dwarf everything else —
    // pay combo² up to the cap, then linearly past it
    const c = Math.min(me.combo, COMBO_BONUS_CAP)
            + Math.max(0, me.combo - COMBO_BONUS_CAP) * 0.5;
    const pts = Math.round(c * Math.min(me.combo, COMBO_BONUS_CAP) * 10 * (hasPerk(150) ? 1.1 : 1) * (1 + stats.gains * 0.01) * DIFF()[3]);
    me.score += pts;
    fireGain(0.05);
    sfx.comboEnd();
    floaters.push({ x: me.x, y: me.y + 100, txt: `+${pts} COMBO BONUS`, t: 1.6, c: "#7ee08a", big: true });
    burst(me.x, me.y + 40, 26, "#ff9de2");
    shake = 6;
    noteScore(me.score, me.bestFloor);
  }
  me.combo = 0; me.comboT = 0;
}

function checkZone() {
  const idx = ZONES.findIndex((z, i) => me.bestFloor >= z.at && (i === ZONES.length - 1 || me.bestFloor < ZONES[i + 1].at));
  if (idx > lastZoneIdx) {
    lastZoneIdx = idx;
    zoneFlash = ZONES[idx].name; zoneFlashT = 3;
    sfx.zone();
    confetti();
  }
}

function updateWorld(dt) {
  elapsed += dt;
  if (me.comboT > 0) { me.comboT -= dt; if (me.comboT <= 0 && me.grounded) endCombo(); }
  me.bubbleT -= dt; if (me.bubbleT <= 0) me.bubble = null;

  // camera follows YOUR gooner (ghosts spectate the highest survivor)
  const top = highestAlive();
  const focusY = !me.ghost ? me.y : (top ? top.y : me.y);
  const targetCam = Math.max(0, focusY - 380);
  camY = lerp(camY, targetCam, Math.min(1, (3.2 + me.fire * 2.5) * dt)); // keep up with 🔥 launches

  // the goon juice
  const maxFloorAll = Math.max(me.bestFloor, ...[...remotes.values()].map(r => r.floor), 0);
  if (!doomOn && maxFloorAll >= 3) { doomOn = true; toast("THE GOON JUICE IS RISING. climb!! 💦"); }
  if (doomOn && !gameOver) {
    const speed = Math.min(40 + maxFloorAll * 0.6, 300) * DIFF()[2];
    doomY += speed * dt;
    if (top) { // catch up smoothly — no teleporting goo
      const want = top.y - 1000;
      if (want > doomY) doomY += Math.min(want - doomY, 520 * dt);
    }
  }

  // remotes: interpolate
  const now = performance.now();
  for (const r of remotes.values()) {
    const k = Math.min(1, 14 * dt);
    r.x += (r.tx - r.x) * k;
    r.y += (r.ty - r.y) * k;
    r.rot += (r.trot - r.rot) * k;
    r.bubbleT -= dt; if (r.bubbleT <= 0) r.bubble = null;
    r.stale = now - r.seen > 4000;
    if (r.jet && !r.stale && Math.random() < dt * 30)
      particles.push({ x: r.x + (Math.random()-0.5)*16, y: r.y + 4,
        vx: (Math.random()-0.5)*160, vy: -250 - Math.random()*200,
        t: 0.5, c: "#bfe8ff", r: 3, grav: 0.3, e: "💦" });
    if (r.fire > 0.4 && !r.stale && Math.random() < dt * 30 * r.fire)
      particles.push({ x: r.x + (Math.random()-0.5)*20, y: r.y + 6,
        vx: -r.vx * 0.12, vy: -60 - Math.random()*120,
        t: 0.5, c: "#ff9d3d", r: 3, grav: -0.2, e: r.fire > 0.85 ? "🔥" : null });
  }

  // team wipe?
  const anyAlive = !me.ghost || [...remotes.values()].some(r => !r.ghost);
  if (!anyAlive && !gameOver && started) {
    gameOver = true; gameOverT = 0;
    noteScore(me.score, me.bestFloor);
    sfx.over();
  }
  if (gameOver) gameOverT += dt;

  // particles & floaters
  for (const p of particles) {
    p.vy -= 1400 * dt * p.grav;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.t -= dt;
  }
  particles = particles.filter(p => p.t > 0);
  for (const f of floaters) { f.y += 60 * dt; f.t -= dt; }
  floaters = floaters.filter(f => f.t > 0);
  for (const t of toasts) t.t -= dt;
  toasts = toasts.filter(t => t.t > 0);
  zoneFlashT -= dt;
  shake -= shake * Math.min(1, 8 * dt);

  // network send
  if (ws && ws.readyState === 1 && now - lastSend > SEND_MS) {
    lastSend = now;
    ws.send(JSON.stringify({
      t: "s", x: Math.round(me.x), y: Math.round(me.y),
      vx: Math.round(me.vx), f: me.facing, g: me.ghost ? 1 : 0, j: me.jet ? 1 : 0,
      fi: +me.fire.toFixed(2),
      fl: me.bestFloor, sc: me.score, r: +me.rot.toFixed(2), lv: myLvl,
    }));
  }
}

function burst(x, y, count, color) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 260;
    particles.push({ x, y: y + 10, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 100,
      t: 0.4 + Math.random() * 0.5, c: color, r: 2 + Math.random() * 3, grav: 0.6 });
  }
}
function confetti() {
  const cols = ["#ff5c5c","#ffe066","#7ee08a","#7ab8ff","#c98cff","#ff9de2"];
  for (let i = 0; i < 80; i++) {
    particles.push({ x: Math.random() * TOWER_W, y: camY + VIEW_H + 40,
      vx: (Math.random() - 0.5) * 200, vy: -100 - Math.random() * 200,
      t: 1.5 + Math.random(), c: cols[i % cols.length], r: 3 + Math.random() * 3, grav: 0.25,
      e: Math.random() < 0.25 ? (Math.random() < 0.5 ? "💦" : "🍆") : null });
  }
}

// ---------------------------------------------------------------- drawing
let scale = 1, offX = 0, cvW = 0, cvH = 0;
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cvW = innerWidth; cvH = innerHeight;
  cv.width = cvW * dpr; cv.height = cvH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scale = cvH / VIEW_H;
  offX = (cvW - (TOWER_W + WALL_T * 2) * scale) / 2 + WALL_T * scale;
}
addEventListener("resize", resize);
resize();

const wx = x => offX + x * scale;                       // world->screen x
const wy = y => cvH - (y - camY) * scale;               // world->screen y (y up)

function drawGoober(g, sx, sy, o) {
  // sx,sy = screen coords of FEET. o: {skin,hat,hatColor,facing,vx,airborne,rot,ghost,jet,lvl,t,squash}
  const t = o.t || 0;
  g.save();
  g.translate(sx, sy);
  if (o.ghost) g.globalAlpha = 0.55;
  const sq = o.squash || 0;
  if (o.rot) { g.translate(0, -P_H / 2); g.rotate(-o.rot); g.translate(0, P_H / 2); }
  g.scale(1 - sq * 0.5, 1 + sq);
  g.scale(P_W / BODY_W, P_H / BODY_H); // physics size grew; sprite drawn in native units

  const skin = o.skin, dark = shade(skin, -0.3);
  const lvl = o.lvl || 1;
  const ch = o.char || "goober";
  const cs = CSCALE[ch] || 1;
  g.scale(cs, cs);

  // high-level aura, so everyone knows who's been grinding
  if (lvl >= 20 && !o.ghost) {
    g.save();
    g.globalAlpha = 0.22 + Math.sin(t * 5) * 0.08;
    g.fillStyle = `hsl(${(t * 140) % 360}, 90%, 60%)`;
    g.beginPath(); g.arc(0, -BODY_H / 2, BODY_W * 0.95, 0, 7); g.fill();
    g.restore();
  } else if (lvl >= 10 && !o.ghost) {
    g.save();
    g.globalAlpha = 0.18 + Math.sin(t * 4) * 0.06;
    g.fillStyle = "#ffd24d";
    g.beginPath(); g.arc(0, -BODY_H / 2, BODY_W * 0.85, 0, 7); g.fill();
    g.restore();
  }

  // legs (scissor run) — ghosts get a wavy tail instead; floaty chars hover
  if (!o.ghost && ch !== "drop" && ch !== "orb") {
    const ph = o.legPhase || t * 6;
    const spread = o.airborne ? 0.9 : Math.sin(ph) * clamp(Math.abs(o.vx) / 400, 0.15, 1);
    g.strokeStyle = dark; g.lineWidth = 5; g.lineCap = "round";
    g.beginPath(); g.moveTo(-6, -14); g.lineTo(-6 - spread * 9, 0); g.stroke();
    g.beginPath(); g.moveTo(6, -14); g.lineTo(6 + spread * 9, 0); g.stroke();
  } else {
    g.fillStyle = skin;
    g.beginPath();
    g.moveTo(-BODY_W / 2 + 4, -16);
    for (let i = 0; i <= 4; i++) {
      const px = -BODY_W / 2 + 4 + i * (BODY_W - 8) / 4;
      g.lineTo(px, -6 + Math.sin(t * 8 + i * 2) * 5 - (i % 2) * 8);
    }
    g.lineTo(BODY_W / 2 - 4, -16);
    g.fill();
  }

  // body (per character)
  const bw = BODY_W, bh = BODY_H - 8, by = -12; // body bottom y
  switch (ch) {
    case "gymbro": // shoulders wider than his future
      g.fillStyle = skin;
      g.beginPath(); g.moveTo(-24, by - bh); g.lineTo(24, by - bh); g.lineTo(13, by); g.lineTo(-13, by); g.closePath(); g.fill();
      g.strokeStyle = dark; g.lineWidth = 2.5; g.stroke();
      g.fillStyle = "#fff"; g.fillRect(-11, by - bh + 16, 22, 16); // tank top
      g.fillStyle = dark;
      g.beginPath(); g.arc(-8, by - bh + 24, 4, 0, 7); g.fill(); // pecs
      g.beginPath(); g.arc(8, by - bh + 24, 4, 0, 7); g.fill();
      break;
    case "dumbbell":
      g.fillStyle = "#999"; g.fillRect(-6, by - bh, 12, bh);
      g.fillStyle = "#444";
      g.fillRect(-19, by - bh - 4, 38, 9); g.fillRect(-19, by - 5, 38, 9);
      break;
    case "shaker":
      g.fillStyle = skin;
      g.beginPath(); g.roundRect(-16, by - bh + 7, 32, bh - 7, 6); g.fill();
      g.strokeStyle = dark; g.lineWidth = 2; g.stroke();
      g.fillStyle = "#333"; g.fillRect(-18, by - bh, 36, 8);
      g.beginPath(); g.arc(0, by - bh - 2, 5, 0, 7); g.fill();
      g.strokeStyle = "rgba(255,255,255,.5)";
      for (const ly of [10, 18, 26]) { g.beginPath(); g.moveTo(8, by - bh + ly); g.lineTo(14, by - bh + ly); g.stroke(); }
      break;
    case "sock":
      g.fillStyle = "#eee";
      g.beginPath(); g.roundRect(-13, by - bh, 26, bh - 6, 12); g.fill();
      g.beginPath(); g.arc(8, by - 8, 10, 0, 7); g.fill(); // toe
      g.strokeStyle = "#bbb"; g.lineWidth = 2; g.stroke();
      g.fillStyle = "rgba(190,170,120,.6)"; // crust
      g.beginPath(); g.arc(-4, by - 14, 4, 0, 7); g.fill();
      g.beginPath(); g.arc(6, by - 26, 3, 0, 7); g.fill();
      break;
    case "drop":
      g.fillStyle = "#6db8ff";
      g.beginPath(); g.moveTo(0, by - bh - 8);
      g.quadraticCurveTo(18, by - 18, 0, by);
      g.quadraticCurveTo(-18, by - 18, 0, by - bh - 8); g.fill();
      g.fillStyle = "rgba(255,255,255,.6)";
      g.beginPath(); g.arc(-6, by - 22, 4, 0, 7); g.fill();
      break;
    case "trenbot":
      g.fillStyle = "#9aabb8"; g.fillRect(-16, by - bh, 32, bh);
      g.strokeStyle = "#5a6b78"; g.lineWidth = 2; g.strokeRect(-16, by - bh, 32, bh);
      g.fillStyle = "#5a6b78";
      for (const [rx, ry] of [[-12, 4], [12, 4], [-12, bh - 6], [12, bh - 6]])
        { g.beginPath(); g.arc(rx, by - bh + ry, 1.5, 0, 7); g.fill(); }
      g.strokeStyle = "#ff8c42"; g.lineWidth = 2;
      g.beginPath(); g.arc(0, by - 12, 5, 0, 7); g.stroke(); // gauge
      g.beginPath(); g.moveTo(0, by - bh); g.lineTo(0, by - bh - 7); g.stroke();
      g.fillStyle = "#ff8c42"; g.beginPath(); g.arc(0, by - bh - 8, 2.5, 0, 7); g.fill();
      break;
    case "girthzilla":
      g.fillStyle = skin;
      g.beginPath(); g.roundRect(-bw / 2 - 3, by - bh, bw + 6, bh, 14); g.fill();
      g.strokeStyle = dark; g.lineWidth = 2.5; g.stroke();
      g.fillStyle = dark; // back spikes
      for (const sy3 of [8, 18, 28])
        { g.beginPath(); g.moveTo(-bw / 2 - 3, by - bh + sy3); g.lineTo(-bw / 2 - 12, by - bh + sy3 + 4); g.lineTo(-bw / 2 - 3, by - bh + sy3 + 8); g.fill(); }
      break;
    case "orb":
      g.fillStyle = skin;
      g.beginPath(); g.arc(0, by - bh / 2 - 4, 21, 0, 7); g.fill();
      g.strokeStyle = dark; g.lineWidth = 2.5; g.stroke();
      g.fillStyle = "#fff"; // extra eyes of the ascended
      for (const [ex2, ey2] of [[-10, by - 10], [10, by - 10], [0, by - 4]])
        { g.beginPath(); g.arc(ex2, ey2, 3.5, 0, 7); g.fill();
          g.fillStyle = "#222"; g.beginPath(); g.arc(ex2, ey2, 1.4, 0, 7); g.fill(); g.fillStyle = "#fff"; }
      break;
    default:
      g.fillStyle = skin;
      g.beginPath();
      g.roundRect(-bw / 2, by - bh, bw, bh, 14);
      g.fill();
      g.strokeStyle = dark; g.lineWidth = 2.5; g.stroke();
  }

  // level worn on the chest, like a jersey
  g.fillStyle = lvl >= 20 ? `hsl(${(t * 140) % 360}, 85%, 45%)` : lvl >= 10 ? "#8a6d1b" : "rgba(0,0,0,.4)";
  g.font = "bold 10px 'Chalkboard SE', 'Comic Sans MS', sans-serif";
  g.textAlign = "center";
  g.fillText(`LV${lvl}`, 0, by - 2); // belly tattoo placement

  // arms: flail when airborne, or podium pose
  g.strokeStyle = dark; g.lineWidth = 5; g.lineCap = "round";
  if (o.pose === "flex") { // double front bicep, obviously
    g.lineWidth = 6;
    for (const sd of [-1, 1]) {
      g.beginPath();
      g.moveTo(sd * (bw / 2 - 2), by - bh + 22);
      g.lineTo(sd * (bw / 2 + 10), by - bh + 14);
      g.lineTo(sd * (bw / 2 + 5), by - bh - 4);
      g.stroke();
      g.fillStyle = dark;
      g.beginPath(); g.arc(sd * (bw / 2 + 8), by - bh + 9, 5, 0, 7); g.fill(); // the bicep
    }
  } else {
    const armA = o.airborne ? Math.sin(t * 20) * 1.1 - 1.6 : Math.sin((o.legPhase || 0)) * 0.5 + 0.5;
    g.beginPath(); g.moveTo(-bw / 2 + 2, by - bh + 22);
    g.lineTo(-bw / 2 + 2 - Math.cos(armA) * 12, by - bh + 22 + Math.sin(armA) * 12); g.stroke();
    g.beginPath(); g.moveTo(bw / 2 - 2, by - bh + 22);
    g.lineTo(bw / 2 - 2 + Math.cos(armA) * 12, by - bh + 22 + Math.sin(armA) * 12); g.stroke();
  }

  // eyes: googly normally, scrunched shut while goon-jetting
  const headY = by - bh + 13;
  const look = clamp((o.vx || 0) / 500, -1, 1) * 2.5;
  const jig = Math.sin(t * 13) * 0.8;
  if (o.jet) {
    g.strokeStyle = "#333"; g.lineWidth = 2;
    for (const ex of [-7, 7]) {
      g.beginPath(); g.arc(ex + o.facing * 2, headY + 2, 4, Math.PI + 0.4, -0.4); g.stroke();
    }
  } else {
    for (const ex of [-7, 7]) {
      g.fillStyle = "#fff";
      g.beginPath(); g.arc(ex + o.facing * 2, headY, 6, 0, 7); g.fill();
      g.strokeStyle = "#333"; g.lineWidth = 1; g.stroke();
      g.fillStyle = "#222";
      const lookUp = o.pose === "lookup" ? -3.5 : (o.airborne ? -1.5 : 1);
      g.beginPath(); g.arc(ex + o.facing * 2 + look + jig * 0.5, headY + lookUp, 2.6, 0, 7); g.fill();
    }
  }
  // mouth
  g.strokeStyle = "#5b2d00"; g.lineWidth = 2; g.fillStyle = "#5b2d00";
  if (o.jet) { // the 😩 mouth
    g.beginPath(); g.ellipse(o.facing * 3, headY + 11, 3.5, 5.5, 0, 0, 7); g.fill();
  } else if (o.airborne || o.ghost) { // screaming O
    g.beginPath(); g.arc(o.facing * 3, headY + 11, 4.5, 0, 7); g.fill();
  } else {
    g.beginPath(); g.arc(o.facing * 3, headY + 8, 5, 0.2, Math.PI - 0.2); g.stroke();
  }

  if (o.pose === "spit") { // spitting down on the peasant tier
    g.font = "9px sans-serif"; g.textAlign = "center";
    g.fillText("💦", o.facing * 15, headY + 20);
    g.fillText("💦", o.facing * 22, headY + 32);
  }

  // halo for ghosts
  if (o.ghost) {
    g.strokeStyle = "#ffe066"; g.lineWidth = 3;
    g.beginPath(); g.ellipse(0, by - bh - 14, 12, 4, 0, 0, 7); g.stroke();
  }

  // hat (wobbles)
  drawHat(g, o.hat, o.hatColor, by - bh, Math.sin(t * 3.3) * 0.07 + clamp((o.vx || 0) * 0.0002, -0.15, 0.15), t);
  g.restore();
}

function drawHat(g, hat, c, topY, wob, t) {
  if (hat === "none") { // shiny bald spot
    g.fillStyle = "rgba(255,255,255,.35)";
    g.beginPath(); g.arc(4, topY + 5, 4, 0, 7); g.fill();
    return;
  }
  g.save();
  g.translate(0, topY + 2);
  g.rotate(wob);
  const dk = shade(c, -0.35);
  switch (hat) {
    case "cap":
      g.fillStyle = c;
      g.beginPath(); g.arc(0, 0, 15, Math.PI, 0); g.fill();
      g.fillRect(-15, -3, 30, 4);
      g.fillStyle = dk; g.fillRect(8, -4, 18, 5); // brim
      break;
    case "tophat":
      g.fillStyle = c;
      g.fillRect(-11, -30, 22, 28);
      g.fillRect(-17, -4, 34, 5);
      g.fillStyle = dk; g.fillRect(-11, -10, 22, 5); // band
      break;
    case "propeller":
      g.fillStyle = c;
      g.beginPath(); g.arc(0, 0, 14, Math.PI, 0); g.fill();
      g.strokeStyle = "#666"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -14); g.lineTo(0, -21); g.stroke();
      g.fillStyle = dk;
      const s = Math.sin(t * 22) * 20;
      g.beginPath(); g.ellipse(0, -22, Math.abs(s) + 3, 3.5, 0, 0, 7); g.fill();
      break;
    case "cone":
      g.fillStyle = c;
      g.beginPath(); g.moveTo(0, -32); g.lineTo(13, 0); g.lineTo(-13, 0); g.fill();
      g.fillStyle = "#fff";
      g.beginPath(); g.moveTo(-7, -15); g.lineTo(7, -15); g.lineTo(9, -9); g.lineTo(-9, -9); g.fill();
      g.fillStyle = dk; g.fillRect(-17, -2, 34, 4);
      break;
    case "sombrero":
      g.fillStyle = c;
      g.beginPath(); g.ellipse(0, 0, 30, 8, 0, 0, 7); g.fill();
      g.beginPath(); g.arc(0, -3, 12, Math.PI, 0); g.fill();
      g.strokeStyle = dk; g.lineWidth = 2;
      g.beginPath(); g.ellipse(0, 0, 30, 8, 0, Math.PI, 0, true); g.stroke();
      break;
    case "viking":
      g.fillStyle = c;
      g.beginPath(); g.arc(0, 0, 15, Math.PI, 0); g.fill();
      g.fillStyle = "#eee";
      g.beginPath(); g.moveTo(-14, -4); g.quadraticCurveTo(-26, -12, -22, -26);
      g.quadraticCurveTo(-16, -14, -10, -8); g.fill();
      g.beginPath(); g.moveTo(14, -4); g.quadraticCurveTo(26, -12, 22, -26);
      g.quadraticCurveTo(16, -14, 10, -8); g.fill();
      break;
    case "chef":
      g.fillStyle = "#f6f6f6";
      g.fillRect(-11, -14, 22, 14);
      for (const bx of [-9, 0, 9]) { g.beginPath(); g.arc(bx, -16, 9, 0, 7); g.fill(); }
      g.strokeStyle = "#ccc"; g.strokeRect(-11, -14, 22, 14);
      break;
    case "wizard":
      g.fillStyle = c;
      g.beginPath(); g.moveTo(2, -36); g.lineTo(15, 0); g.lineTo(-15, 0); g.fill();
      g.fillStyle = "#ffe066";
      for (const [sx2, sy2] of [[-4, -10], [5, -18], [-1, -26]]) {
        g.save(); g.translate(sx2, sy2); g.rotate(t);
        g.fillRect(-2.5, -0.8, 5, 1.6); g.fillRect(-0.8, -2.5, 1.6, 5);
        g.restore();
      }
      break;
    case "tren": { // gigabig syringe straight through the skull
      g.rotate(-0.12);
      // needle poking out the left side of the head
      g.strokeStyle = "#c8c8d0"; g.lineWidth = 2.5; g.lineCap = "round";
      g.beginPath(); g.moveTo(-46, 8); g.lineTo(-20, 8); g.stroke();
      // barrel (through the head)
      g.fillStyle = "rgba(225,238,255,.94)";
      g.fillRect(-20, 0, 46, 16);
      g.strokeStyle = "#8899bb"; g.lineWidth = 1.5;
      g.strokeRect(-20, 0, 46, 16);
      // juice inside
      g.fillStyle = "rgba(255,190,70,.85)";
      g.fillRect(-18, 2, 28, 12);
      // graduations
      g.strokeStyle = "#8899bb"; g.lineWidth = 1;
      for (const gx of [-12, -4, 4, 12]) { g.beginPath(); g.moveTo(gx, 0); g.lineTo(gx, 5); g.stroke(); }
      // plunger
      g.fillStyle = "#ff8c42";
      g.fillRect(26, 2, 12, 12);
      g.fillRect(38, -2, 4, 20);
      // flanges
      g.fillStyle = "#c8c8d0";
      g.fillRect(24, -4, 3, 24);
      // label
      g.fillStyle = "#334";
      g.font = "bold 9px 'Chalkboard SE', 'Comic Sans MS', sans-serif";
      g.textAlign = "center";
      g.fillText("tren", -4, 12);
      break;
    }
    case "lambo": { // it's just a lamborghini
      g.translate(0, -2);
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(-27, 0); g.lineTo(-24, -7); g.lineTo(-8, -12); g.lineTo(6, -12);
      g.lineTo(17, -6); g.lineTo(27, -3); g.lineTo(27, 0);
      g.closePath(); g.fill();
      g.strokeStyle = dk; g.lineWidth = 1.5; g.stroke();
      // window
      g.fillStyle = "#1c2340";
      g.beginPath(); g.moveTo(-7, -11); g.lineTo(4, -11); g.lineTo(10, -6); g.lineTo(-10, -6); g.closePath(); g.fill();
      // spoiler
      g.fillStyle = dk;
      g.fillRect(-30, -11, 8, 2.5);
      g.fillRect(-25, -9, 2.5, 6);
      // wheels
      for (const wx2 of [-15, 16]) {
        g.fillStyle = "#222";
        g.beginPath(); g.arc(wx2, 0, 5, 0, 7); g.fill();
        g.fillStyle = "#999";
        g.beginPath(); g.arc(wx2, 0, 2, 0, 7); g.fill();
      }
      break;
    }
    case "aubergine": // 🍆
      g.font = "30px sans-serif";
      g.textAlign = "center";
      g.save(); g.rotate(-0.5);
      g.fillText("🍆", 4, -4);
      g.restore();
      break;
  }
  g.restore();
}

function drawCondom(sx, sy, t, n) {
  ctx.save();
  ctx.translate(sx, sy + Math.sin(t * 2 + n) * 7 * scale);
  ctx.scale(scale, scale);
  ctx.rotate(Math.sin(t * 1.3 + n * 2) * 0.15);
  ctx.globalAlpha = 0.95;
  // rolled ring
  ctx.strokeStyle = "rgba(238,232,255,.95)";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); ctx.stroke();
  // reservoir nub
  ctx.fillStyle = "rgba(238,232,255,.95)";
  ctx.beginPath(); ctx.ellipse(0, -3, 3.5, 5, 0, 0, 7); ctx.fill();
  // shine
  ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 11, Math.PI * 1.1, Math.PI * 1.45); ctx.stroke();
  // label
  ctx.fillStyle = "#cfd6ff";
  ctx.font = "bold 8px 'Chalkboard SE', 'Comic Sans MS', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("XL", 0, 24);
  ctx.restore();
}

function drawWorld(t) {
  const zi = clamp(Math.floor(camY / FLOOR_H / 25), 0, ZONES.length - 1);
  const znext = ZONES[Math.min(zi + 1, ZONES.length - 1)];
  const zcur = ZONES[zi];
  const zt = clamp(((camY / FLOOR_H) - zcur.at) / Math.max(1, (znext.at - zcur.at)), 0, 1);

  // bg: posterized y2k bands
  const hx2 = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const mixA = (a, b, tt) => a.map((v, i) => Math.round(v + (b[i] - v) * tt));
  const tc = mixA(hx2(zcur.top), hx2(znext.top), zt), bc = mixA(hx2(zcur.bot), hx2(znext.bot), zt);
  const BANDS = 14, bandH = cvH / BANDS;
  for (let i = 0; i < BANDS; i++) {
    ctx.fillStyle = `rgb(${mixA(tc, bc, i / (BANDS - 1))})`;
    ctx.fillRect(0, i * bandH, cvW, bandH + 1);
  }

  // parallax blobs (clouds/stars/floating regrets, who's to say)
  ctx.save();
  ctx.fillStyle = "#ffffff";
  const rngBg = mulberry32(1234);
  for (let i = 0; i < 44; i++) { // twinkly diamond stars
    const bx = rngBg() * cvW, spd = 0.2 + rngBg() * 0.4, r = 3 + rngBg() * 9;
    const byy = ((rngBg() * 3000 - camY * spd) % (cvH + 200) + cvH + 200) % (cvH + 200) - 100;
    ctx.globalAlpha = 0.15 + 0.15 * Math.sin(t * 2 + i * 3);
    ctx.beginPath();
    ctx.moveTo(bx, byy - r); ctx.lineTo(bx + r * 0.35, byy); ctx.lineTo(bx, byy + r); ctx.lineTo(bx - r * 0.35, byy);
    ctx.fill();
  }
  ctx.restore();

  const shx = (Math.random() - 0.5) * shake, shy = (Math.random() - 0.5) * shake;
  ctx.save();
  ctx.translate(shx, shy);

  // walls
  const wallGrad = hexLerp(zcur.top, znext.top, zt);
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? wx(0) - WALL_T * scale : wx(TOWER_W);
    ctx.fillStyle = shade("#3a4478", -0.1);
    ctx.fillRect(x0, 0, WALL_T * scale, cvH);
    // bricks
    ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 2;
    const bh = 34 * scale;
    const start = Math.floor(camY / 34) * 34;
    for (let yy = start; yy < camY + VIEW_H + 34; yy += 34) {
      const sy = wy(yy);
      ctx.beginPath(); ctx.moveTo(x0, sy); ctx.lineTo(x0 + WALL_T * scale, sy); ctx.stroke();
      const off = (Math.floor(yy / 34) % 2) * (WALL_T / 2) * scale;
      ctx.beginPath(); ctx.moveTo(x0 + off + WALL_T * 0.25 * scale, sy); ctx.lineTo(x0 + off + WALL_T * 0.25 * scale, sy - bh); ctx.stroke();
    }
    ctx.fillStyle = wallGrad;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x0, 0, WALL_T * scale, cvH);
    ctx.globalAlpha = 1;
    // neon goon-boost strips
    const kFrom = Math.max(1, Math.floor(camY / SEG_H)), kTo = Math.floor((camY + VIEW_H) / SEG_H) + 1;
    for (let k = kFrom; k <= kTo; k++) {
      if (!neonWallAt(side, k, seed) || usedNeon.has(side + ":" + k)) continue;
      const xx = side < 0 ? x0 + (WALL_T - 7) * scale : x0;
      ctx.save();
      ctx.shadowColor = "#39ff14";
      ctx.shadowBlur = (14 + Math.sin(t * 6 + k) * 7) * scale;
      ctx.fillStyle = "#39ff14";
      ctx.fillRect(xx, wy(k * SEG_H + NEON_H), 7 * scale, NEON_H * scale);
      ctx.restore();
    }
  }

  // platforms + condoms in view
  const nFrom = Math.max(0, Math.floor(camY / FLOOR_H) - 1);
  const nTo = Math.ceil((camY + VIEW_H) / FLOOR_H) + 1;
  for (let n = nFrom; n <= nTo; n++) {
    const p = platformFor(n, seed);
    const px = wx(p.x), py = wy(n * FLOOR_H), pw = p.w * scale, ph = PLAT_T * scale;
    const milestone = n > 0 && n % 50 === 0;
    const mega = n > 0 && n % MEGA_EVERY === 0;
    if (mega) { // pulsing rainbow glow — hit it for a MEGA JUMP
      ctx.save();
      ctx.shadowColor = `hsl(${(t * 160) % 360}, 95%, 60%)`;
      ctx.shadowBlur = (22 + Math.sin(t * 6) * 10) * scale;
      ctx.fillStyle = `hsl(${(t * 160) % 360}, 95%, 72%)`;
      ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 6 * scale); ctx.fill();
      ctx.restore();
      ctx.font = `bold ${13 * scale}px "Chalkboard SE", "Comic Sans MS", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillText(`⭐ MEGA ${n} ⭐`, px + pw / 2, py + ph * 0.8);
      if (!collectedCondoms.has(n)) {
        const c = condomFor(n, seed);
        if (c) drawCondom(wx(c.x), wy(c.y), t, n);
      }
      continue;
    }
    ctx.fillStyle = milestone ? "#ffd24d" : "#e8f2ff";
    ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 6 * scale); ctx.fill();
    ctx.fillStyle = milestone ? "#b8741b" : "#9db4d6";
    ctx.beginPath(); ctx.roundRect(px, py + ph * 0.55, pw, ph * 0.45, 5 * scale); ctx.fill();
    if (p.drip) { // dripping wet platform
      ctx.fillStyle = "rgba(110,185,255,.5)";
      ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 6 * scale); ctx.fill();
      ctx.fillStyle = "#7ab8ff";
      for (const [fx, off] of [[0.25, 0], [0.6, 0.4], [0.85, 0.7]]) {
        const dp = (t * 0.8 + n * 0.31 + off) % 1;
        ctx.beginPath(); ctx.ellipse(px + pw * fx, py + ph + dp * 44 * scale, 3 * scale, 5 * scale, 0, 0, 7); ctx.fill();
      }
    }
    if (n > 0 && n % 10 === 0) {
      ctx.fillStyle = milestone ? "#5b2d00" : "#5a6f95";
      ctx.font = `bold ${12 * scale}px "Chalkboard SE", "Comic Sans MS", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(String(n), px + pw / 2, py + ph * 0.75);
    }
    if (!collectedCondoms.has(n)) {
      const c = condomFor(n, seed);
      if (c) drawCondom(wx(c.x), wy(c.y), t, n);
    }
  }

  // particles
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.t * 2, 0, 1);
    if (p.e) {
      ctx.font = `${Math.round(p.r * 5 * scale)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(p.e, wx(p.x), wy(p.y));
    } else {
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(wx(p.x), wy(p.y), p.r * scale, 0, 7); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // players — remotes first, me on top
  for (const r of remotes.values()) {
    if (r.stale) continue;
    drawPlayerFull(r, t, false);
  }
  drawPlayerFull(me, t, true);

  // THE GOON JUICE
  if (doomOn) {
    const gy = wy(doomY);
    if (gy > -50) {
      const goo = ctx.createLinearGradient(0, gy, 0, cvH);
      goo.addColorStop(0, "rgba(247,244,255,.96)"); goo.addColorStop(1, "rgba(196,180,228,.98)");
      ctx.fillStyle = goo;
      ctx.beginPath();
      ctx.moveTo(0, cvH); ctx.lineTo(0, gy);
      for (let x = 0; x <= cvW; x += 24) {
        ctx.lineTo(x, gy + Math.sin(x * 0.03 + t * 3) * 7 * scale + Math.sin(x * 0.011 - t * 1.7) * 5 * scale);
      }
      ctx.lineTo(cvW, cvH);
      ctx.fill();
      // bubbles
      ctx.fillStyle = "rgba(255,255,255,.5)";
      const rngG = mulberry32(77);
      for (let i = 0; i < 12; i++) {
        const bx = rngG() * cvW;
        const bt = (t * (0.3 + rngG() * 0.5) + rngG()) % 1;
        ctx.beginPath(); ctx.arc(bx, gy + 20 + bt * 120, (3 + rngG() * 6) * scale, 0, 7); ctx.fill();
      }
      ctx.fillStyle = "#8a6db8";
      ctx.font = `bold ${16 * scale}px "Chalkboard SE", "Comic Sans MS", sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("~ 💦 the goon juice 💦 ~", cvW / 2, Math.min(gy + 40 * scale, cvH - 14));
    }
  }

  // floating texts
  for (const f of floaters) {
    ctx.globalAlpha = clamp(f.t * 1.4, 0, 1);
    ctx.fillStyle = f.c;
    ctx.font = `bold ${(f.big ? 30 : 18) * scale}px "Chalkboard SE", "Comic Sans MS", sans-serif`;
    ctx.textAlign = "center";
    ctx.save();
    ctx.translate(wx(f.x), wy(f.y));
    ctx.rotate(Math.sin(f.t * 10) * 0.06);
    ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 4; ctx.strokeText(f.txt, 0, 0);
    ctx.fillText(f.txt, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.restore(); // shake
}

function drawPlayerFull(p, t, isMe) {
  const sx = wx(p.x), sy = wy(p.y);
  if (sy < -80 || sy > cvH + 80) {
    // off-screen buddy indicator
    if (!isMe && !p.stale) {
      const iy = clamp(sy, 26, cvH - 26);
      ctx.fillStyle = p.skin;
      ctx.beginPath();
      ctx.moveTo(sx, iy + (sy < 0 ? -14 : 14));
      ctx.lineTo(sx - 10, iy); ctx.lineTo(sx + 10, iy);
      ctx.fill();
      ctx.font = `bold ${12 * scale}px "Chalkboard SE", "Comic Sans MS", sans-serif`;
      ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      ctx.fillText(p.name, sx, iy + (sy < 0 ? 16 : -8));
    }
    return;
  }
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(scale, scale);
  const lvl = isMe ? myLvl : (p.lvl || 1);
  drawGoober(ctx, 0, 0, {
    skin: isMe ? myProfile.skin : p.skin, hat: isMe ? myProfile.hat : p.hat, hatColor: isMe ? myProfile.hatColor : p.hatColor,
    facing: p.facing, vx: p.vx, airborne: isMe ? !p.grounded : Math.abs(p.ty - p.y) > 4,
    rot: p.rot, ghost: p.ghost, jet: p.jet, lvl, char: isMe ? myProfile.char : p.char,
    t: t + (p.id || 0), legPhase: p.legPhase, squash: p.squash,
  });
  ctx.restore();

  // name tag (gold at LV10+, rainbow at LV20+)
  const nm = (lvl >= 1337 ? "\ud83d\udc7e\ud83d\udc51 " : lvl >= 255 ? "\ud83d\udc51 " : "") + (isMe ? myProfile.name : p.name);
  ctx.font = `bold ${13 * scale}px "Chalkboard SE", "Comic Sans MS", sans-serif`;
  ctx.textAlign = "center";
  ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 3;
  ctx.strokeText(nm, sx, sy - (P_H + 16) * scale);
  ctx.fillStyle = p.ghost ? "#bfe8ff" : lvl >= 20 ? `hsl(${(t * 140) % 360}, 90%, 70%)` : lvl >= 10 ? "#ffd24d" : "#fff";
  ctx.fillText(nm, sx, sy - (P_H + 16) * scale);

  // speech bubble
  if (p.bubble) {
    ctx.font = `bold ${14 * scale}px "Chalkboard SE", "Comic Sans MS", sans-serif`;
    const tw = ctx.measureText(p.bubble).width + 18 * scale;
    const bx = clamp(sx, tw / 2 + 6, cvW - tw / 2 - 6), by2 = sy - (P_H + 44) * scale;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.roundRect(bx - tw / 2, by2 - 13 * scale, tw, 24 * scale, 9 * scale);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx - 5 * scale, by2 + 10 * scale); ctx.lineTo(sx, sy - (P_H + 26) * scale); ctx.lineTo(bx + 7 * scale, by2 + 10 * scale);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.fillText(p.bubble, bx, by2 + 5 * scale);
  }
}

function drawHUD(t) {
  const fh = `"Chalkboard SE", "Comic Sans MS", sans-serif`;
  // team score
  let teamScore = me.score, roster = [{ name: myProfile.name, floor: me.bestFloor, score: me.score, ghost: me.ghost, skin: myProfile.skin, lvl: myLvl, isMe: true }];
  for (const r of remotes.values()) {
    teamScore += r.score;
    roster.push({ name: r.name, floor: r.floor, score: r.score, ghost: r.ghost, skin: r.skin, lvl: r.lvl || 1 });
  }
  roster.sort((a, b) => b.score - a.score);

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath(); ctx.roundRect(12, 12, 240, 62 + roster.length * 24, 12); ctx.fill();
  ctx.fillStyle = "#ffe066";
  ctx.font = `bold 22px ${fh}`;
  ctx.fillText(`TEAM  ${teamScore}`, 24, 42);
  ctx.fillStyle = "#9aa4e8";
  ctx.font = `bold 12px ${fh}`;
  ctx.fillText(`best: ${bestSave.score} · total goon: ${bestSave.total} · next LV @ ${xpFor(myLvl + 1)}`, 24, 60);
  ctx.font = `bold 14px ${fh}`;
  roster.forEach((r, i) => {
    const y = 84 + i * 24;
    ctx.fillStyle = r.skin;
    ctx.beginPath(); ctx.arc(30, y - 5, 7, 0, 7); ctx.fill();
    ctx.fillStyle = r.ghost ? "#8fb8d8" : "#fff";
    ctx.fillText(`LV${r.lvl} ${r.name}${r.isMe ? " (you)" : ""}${r.ghost ? " 👻" : ""}`, 44, y);
    ctx.textAlign = "right";
    ctx.fillText(`fl ${r.floor} · ${r.score}`, 244, y);
    ctx.textAlign = "left";
  });

  // zone name top right
  const z = zoneAt(Math.max(0, Math.round(camY / FLOOR_H)) + 4);
  ctx.textAlign = "right";
  ctx.font = `bold 15px ${fh}`;
  ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 4;
  ctx.strokeText(z.name, cvW - 16, 32);
  ctx.fillStyle = "#cfd6ff";
  ctx.fillText(z.name, cvW - 16, 32);
  ctx.font = `bold 13px ${fh}`;
  ctx.strokeText(`floor ${me.floor}`, cvW - 16, 52);
  ctx.fillStyle = "#9aa4e8";
  ctx.fillText(`floor ${me.floor}`, cvW - 16, 52);
  if (DIFF()[3] > 1) {
    ctx.strokeText(`${DIFF()[1]} ×${DIFF()[3]} pts`, cvW - 16, 72);
    ctx.fillStyle = "#ff9de2";
    ctx.fillText(`${DIFF()[1]} ×${DIFF()[3]} pts`, cvW - 16, 72);
  }

  // 🔥 FIRE meter — sits right above the goon meter
  {
    const mw = 190, mx = 16, my2 = cvH - 78;
    const hot = me.fire > 0.95;
    ctx.fillStyle = "rgba(0,0,0,.4)";
    ctx.beginPath(); ctx.roundRect(mx - 4, my2 - 22, mw + 8, 44, 10); ctx.fill();
    ctx.textAlign = "left";
    ctx.font = `bold 12px ${fh}`;
    ctx.fillStyle = hot && (t % 0.5 < 0.3) ? "#fff3c4" : me.fire > 0.05 ? "#ffb066" : "#8a93d6";
    ctx.fillText(hot ? "🔥 MAX FIRE — DOUBLE SPEED!!" : `🔥 FIRE ×${(1 + me.fire).toFixed(2)} speed`, mx, my2 - 6);
    ctx.fillStyle = "rgba(255,255,255,.15)";
    ctx.beginPath(); ctx.roundRect(mx, my2 + 2, mw, 12, 6); ctx.fill();
    const fg = ctx.createLinearGradient(mx, 0, mx + mw, 0);
    fg.addColorStop(0, "#ff5c2b"); fg.addColorStop(0.6, "#ffb066"); fg.addColorStop(1, "#fff3c4");
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.roundRect(mx, my2 + 2, mw * clamp(me.fire, 0, 1), 12, 6); ctx.fill();
  }

  // goon jet meter (bottom left)
  {
    const mw = 190, mx = 16, my2 = cvH - 34;
    const full = me.goon >= tankMax() - 0.5;
    ctx.fillStyle = "rgba(0,0,0,.4)";
    ctx.beginPath(); ctx.roundRect(mx - 4, my2 - 22, mw + 8, 44, 10); ctx.fill();
    ctx.textAlign = "left";
    ctx.font = `bold 12px ${fh}`;
    ctx.fillStyle = me.jetLock > 0 ? "#8a93d6" : full && (t % 0.6 < 0.35) ? "#ffe066" : "#cfd6ff";
    ctx.fillText(me.jetLock > 0 ? "💦 …catching your breath…"
      : full ? "💦 GOON JET READY!! 😩"
      : `💦 GOON JET ${IS_TOUCH ? "" : "(hold SHIFT)"}`, mx, my2 - 6);
    ctx.fillStyle = "rgba(255,255,255,.15)";
    ctx.beginPath(); ctx.roundRect(mx, my2 + 2, mw, 12, 6); ctx.fill();
    const gg = ctx.createLinearGradient(mx, 0, mx + mw, 0);
    gg.addColorStop(0, "#7ab8ff"); gg.addColorStop(1, "#ff9de2");
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.roundRect(mx, my2 + 2, mw * clamp(me.goon / tankMax(), 0, 1), 12, 6); ctx.fill();
    if (me.boost > 1) {
      ctx.font = `bold 19px ${fh}`;
      ctx.fillStyle = `hsl(${105 + Math.sin(t * 9) * 15}, 100%, ${55 + Math.sin(t * 9) * 10}%)`;
      ctx.fillText(`🔥 GOON x${me.boost}`, mx + mw + 16, my2 + 12);
    }
  }

  // goo distance indicator
  if (doomOn && !gameOver && wy(doomY) > cvH + 10) {
    const distM = Math.max(0, Math.round((me.y - doomY) / 10));
    const close = distM < 40;
    ctx.textAlign = "center";
    ctx.font = `bold 15px ${fh}`;
    ctx.fillStyle = close && t % 0.5 < 0.3 ? "#ff5c5c" : "#b39ddb";
    ctx.fillText(`⬇️ goon juice ${distM}m below${close ? " !!" : ""}`, cvW / 2, cvH - 12);
  }

  // active combo meter
  if (me.combo > 0 && me.comboT > 0) {
    ctx.textAlign = "center";
    const pulse = 1 + Math.sin(t * 12) * 0.06;
    ctx.save();
    ctx.translate(cvW / 2, 60);
    ctx.scale(pulse, pulse);
    ctx.rotate(Math.sin(t * 5) * 0.04);
    ctx.font = `bold 34px ${fh}`;
    ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 6;
    ctx.strokeText(`COMBO x${me.combo}`, 0, 0);
    ctx.fillStyle = `hsl(${(t * 200) % 360}, 90%, 65%)`;
    ctx.fillText(`COMBO x${me.combo}`, 0, 0);
    ctx.restore();
    // timer bar
    ctx.fillStyle = "rgba(0,0,0,.4)";
    ctx.fillRect(cvW / 2 - 60, 72, 120, 8);
    ctx.fillStyle = "#ff9de2";
    ctx.fillRect(cvW / 2 - 60, 72, 120 * clamp(me.comboT / (me.comboMax || 1), 0, 1), 8);
  }


  // zone flash banner
  if (zoneFlashT > 0 && zoneFlash) {
    ctx.textAlign = "center";
    ctx.globalAlpha = clamp(zoneFlashT, 0, 1);
    ctx.save();
    ctx.translate(cvW / 2, cvH * 0.3);
    ctx.rotate(Math.sin(t * 3) * 0.02);
    ctx.font = `bold 40px ${fh}`;
    ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 8;
    ctx.strokeText("NOW ENTERING", 0, -44);
    ctx.strokeText(zoneFlash, 0, 0);
    ctx.fillStyle = "#ffe066";
    ctx.font = `bold 22px ${fh}`;
    ctx.fillText("NOW ENTERING", 0, -44);
    ctx.font = `bold 40px ${fh}`;
    ctx.fillText(zoneFlash, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ghost overlay hint
  if (me.ghost && !gameOver) {
    ctx.textAlign = "center";
    ctx.font = `bold 22px ${fh}`;
    ctx.fillStyle = "#bfe8ff";
    const rem = Math.max(0, ghostTime() - me.ghostT);
    ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 5;
    const msg = highestAlive() ? `you are a ghost!! respawning in ${rem.toFixed(1)}…` : "you are a ghost!!";
    ctx.strokeText(msg, cvW / 2, cvH - 40);
    ctx.fillText(msg, cvW / 2, cvH - 40);
  }

  // toasts
  ctx.textAlign = "center";
  ctx.font = `bold 16px ${fh}`;
  toasts.forEach((tt, i) => {
    ctx.globalAlpha = clamp(tt.t, 0, 1);
    ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 4;
    ctx.strokeText(tt.txt, cvW / 2, 130 + i * 24);
    ctx.fillStyle = "#7ee08a";
    ctx.fillText(tt.txt, cvW / 2, 130 + i * 24);
  });
  ctx.globalAlpha = 1;

  // game over
  if (gameOver) {
    ctx.fillStyle = `rgba(10,8,30,${clamp(gameOverT, 0, 0.75)})`;
    ctx.fillRect(0, 0, cvW, cvH);
    ctx.textAlign = "center";
    ctx.save();
    ctx.translate(cvW / 2, cvH * 0.32);
    ctx.rotate(Math.sin(t * 2) * 0.02);
    ctx.font = `bold 46px ${fh}`;
    ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 10;
    ctx.strokeText("EVERYONE DROWNED IN GOON JUICE", 0, 0);
    ctx.fillStyle = "#ff7a7a";
    ctx.fillText("EVERYONE DROWNED IN GOON JUICE", 0, 0);
    ctx.font = `bold 20px ${fh}`;
    ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 6;
    ctx.strokeText("💦 post-nut clarity achieved 💦", 0, 36);
    ctx.fillStyle = "#cfc4e8";
    ctx.fillText("💦 post-nut clarity achieved 💦", 0, 36);
    ctx.restore();
    ctx.font = `bold 26px ${fh}`;
    ctx.fillStyle = "#ffe066";
    ctx.fillText(`team score: ${teamScore}`, cvW / 2, cvH * 0.32 + 84);
    ctx.font = `bold 18px ${fh}`;
    ctx.fillStyle = "#cfd6ff";
    roster.forEach((r, i) => {
      ctx.fillText(`${r.name} — floor ${r.floor}, ${r.score} pts`, cvW / 2, cvH * 0.32 + 122 + i * 28);
    });
    if (gameOverT % 1.2 < 0.8) {
      ctx.font = `bold 24px ${fh}`;
      ctx.fillStyle = "#7ee08a";
      ctx.fillText(IS_TOUCH ? "tap JUMP to goon again · GOON JET for lobby" : "R  = goon again  ·  L = back to lobby",
        cvW / 2, cvH * 0.32 + 142 + roster.length * 28 + 20);
      ctx.font = `bold 15px ${fh}`;
      ctx.fillStyle = "#9aa4e8";
      ctx.fillText("(progress + unlocks are already saved on this device)",
        cvW / 2, cvH * 0.32 + 142 + roster.length * 28 + 48);
    }
  }

  if (disconnected) {
    ctx.fillStyle = "rgba(10,8,30,.8)";
    ctx.fillRect(0, 0, cvW, cvH);
    ctx.textAlign = "center";
    ctx.font = `bold 34px ${fh}`;
    ctx.fillStyle = "#ff7a7a";
    ctx.fillText("lost the server!! refresh the page", cvW / 2, cvH / 2);
    ctx.font = `bold 18px ${fh}`;
    ctx.fillStyle = "#9aa4e8";
    ctx.fillText("(or press ESC for the lobby — your progress is saved)", cvW / 2, cvH / 2 + 34);
  }

  // y2k scanlines
  ctx.fillStyle = "rgba(0,0,0,.055)";
  for (let y = 0; y < cvH; y += 4) ctx.fillRect(0, y, cvW, 1);
}

// mobile restart: tap jump on game-over screen
(function () {
  const el = document.getElementById("btnJump");
  if (!el) return;
  el.addEventListener("touchstart", () => {
    if (gameOver && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: "restart" }));
  }, { passive: true });
})();

// ---------------------------------------------------------------- main loop
let last = 0;
function frame(now) {
  if (!started) return; // back in the lobby — stop the loop
  const t = now / 1000;
  let dt = Math.min((now - last) / 1000, 0.033) * admin.time;
  last = now;

  // sped-up time must never integrate a fat frame in one go, or you tunnel
  // through platforms — split it into <=33ms substeps instead.
  const steps = Math.max(1, Math.ceil(dt / 0.033));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    if (!gameOver && !disconnected) updateMe(sdt);
    updateWorld(sdt);
  }
  drawWorld(t);
  drawHUD(t);

  requestAnimationFrame(frame);
}
