'use strict';

/* ===================== 常量 ===================== */
const TILE = 20;                 // 小格边长(px)
const COLS = 26, ROWS = 26;      // 26x26 小格
const FIELD = COLS * TILE;       // 战场 520px
const TANK = TILE * 2;           // 坦克占 2x2 小格

const T_EMPTY = 0, T_BRICK = 1, T_STEEL = 2, T_WATER = 3, T_TREE = 4, T_BASE = 5;
const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

const MAX_ENEMY_ON_FIELD = 4;
const ENEMY_TOTAL = 20;
const PLAYER_SPAWN = { x: 8 * TILE, y: 24 * TILE };
const ENEMY_SPAWNS = [[0, 0], [12 * TILE, 0], [24 * TILE, 0]];
const BASE_CELLS = [[24, 12], [24, 13], [25, 12], [25, 13]]; // [r,c]
const BASE_SHELL = [           // 基地周围的砖墙
  [23, 11], [23, 12], [23, 13], [23, 14],
  [24, 11], [24, 14],
  [25, 11], [25, 14],
];

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

/* ===================== 关卡地图 ===================== */
/* 13x13 宏观格，每格扩展为 2x2 小格
   '.'空  '#'砖墙  '@'钢墙  '~'水  '*'草丛           */
const LEVELS = [
  [ // STAGE 1
    '.............',
    '.............',
    '..#..#.#..#..',
    '..#..#.#..#..',
    '..#..###..#..',
    '..#.......#..',
    '..#..~.~..#..',
    '....#...#....',
    '.**..#.#..**.',
    '.**..###..**.',
    '......#......',
    '...#.....#...',
    '..#.........#',
  ],
  [ // STAGE 2
    '.............',
    '.............',
    '..#.#.@.#.#..',
    '..#.#.@.#.#..',
    '.##.#...#.##.',
    '.......#.....',
    '~~~..###..~~~',
    '.......#.....',
    '..*..#.#..*..',
    '.***.#.#.***.',
    '.......#.....',
    '..##.....##..',
    '..#.......#..',
  ],
  [ // STAGE 3
    '.............',
    '.............',
    '#..##.#.##..#',
    '#..#.....#..#',
    '#..#.@.@.#..#',
    '....#...#....',
    '.~~..#.#..~~.',
    '.~~.......~~.',
    '..*..###..*..',
    '..**.#.#.**..',
    '.....@.@.....',
    '..#.@...@.#..',
    '..#.......#..',
  ],
];

/* 每关敌人组成 [类型, 数量] */
const LEVEL_ENEMIES = [
  [['basic', 14], ['fast', 4], ['power', 2]],
  [['basic', 8], ['fast', 8], ['power', 4]],
  [['basic', 4], ['fast', 8], ['power', 8]],
];

const TANK_CONF = {
  player: { speed: 2,   bulletSpeed: 6,   hp: 1, color: '#e8c44a', score: 0 },
  basic:  { speed: 1,   bulletSpeed: 3,   hp: 1, color: '#9aa0a8', score: 100 },
  fast:   { speed: 2,   bulletSpeed: 3.5, hp: 1, color: '#7ec8e8', score: 200 },
  power:  { speed: 1.4, bulletSpeed: 5,   hp: 2, color: '#d96a55', score: 300 },
};

/* ===================== 全局状态 ===================== */
let state = 'title';   // title | stageIntro | playing | paused | stageClear | gameover | win
let grid = [];
let player = null;
let enemies = [];
let bullets = [];
let explosions = [];
let spawnFlashes = [];
let enemyQueue = [];
let spawnTimer = 0;
let respawnTimer = 0;
let stage = 1;
let score = 0;
let lives = 3;
let baseAlive = true;
let stateTimer = 0;
let frameCount = 0;

const dirStack = [];   // 方向键按压栈（后按优先）
let spaceHeld = false;

/* ===================== 音效 ===================== */
let actx = null;
function audio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
  }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function beep(f0, f1, dur, type, vol) {
  const a = audio(); if (!a) return;
  type = type || 'square'; vol = vol || 0.12;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g); g.connect(a.destination);
  o.start(); o.stop(a.currentTime + dur);
}
function noiseBurst(dur, vol) {
  const a = audio(); if (!a) return;
  dur = dur || 0.25; vol = vol || 0.18;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = a.createBufferSource(); s.buffer = buf;
  const g = a.createGain(); g.gain.value = vol;
  s.connect(g); g.connect(a.destination);
  s.start();
}
const sfxShoot  = () => beep(900, 200, 0.08, 'square', 0.08);
const sfxBrick  = () => noiseBurst(0.06, 0.10);
const sfxSteel  = () => beep(180, 120, 0.06, 'square', 0.06);
const sfxBoom   = () => { noiseBurst(0.3, 0.22); beep(160, 40, 0.3, 'sawtooth', 0.14); };
const sfxBigBoom= () => { noiseBurst(0.6, 0.3); beep(120, 30, 0.6, 'sawtooth', 0.2); };
const sfxStart  = () => { beep(440, 880, 0.15, 'square', 0.1); setTimeout(() => beep(660, 1320, 0.15, 'square', 0.1), 120); };

/* ===================== 地图 ===================== */
function expandMap(rows13) {
  const g = Array.from({ length: ROWS }, () => new Array(COLS).fill(T_EMPTY));
  const mapChar = { '#': T_BRICK, '@': T_STEEL, '~': T_WATER, '*': T_TREE };
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const t = mapChar[rows13[r][c]];
      if (t === undefined) continue;
      for (let dr = 0; dr < 2; dr++)
        for (let dc = 0; dc < 2; dc++)
          g[r * 2 + dr][c * 2 + dc] = t;
    }
  }
  return g;
}
function placeBase() {
  for (const [r, c] of BASE_CELLS) grid[r][c] = T_BASE;
  for (const [r, c] of BASE_SHELL) grid[r][c] = T_BRICK;
}
function destroyBase() {
  for (const [r, c] of BASE_CELLS) grid[r][c] = T_EMPTY;
  baseAlive = false;
  addExplosion(13 * TILE, 25 * TILE, true);
  sfxBigBoom();
}

/* ===================== 实体 ===================== */
function makeTank(x, y, dir, kind, isPlayer) {
  const conf = TANK_CONF[kind];
  return {
    x, y, dir, kind, isPlayer,
    speed: conf.speed, bulletSpeed: conf.bulletSpeed,
    hp: conf.hp, maxHp: conf.hp, color: conf.color, scoreValue: conf.score,
    alive: true, treadFrame: 0, moving: false,
    cooldown: 0, shield: isPlayer ? 180 : 0,
    aiTimer: 60 + ((Math.random() * 120) | 0),
    fireTimer: 90 + ((Math.random() * 150) | 0),
  };
}
function addExplosion(cx, cy, big) {
  explosions.push({ x: cx, y: cy, t: 0, max: big ? 36 : 18, big: !!big });
}

/* ===================== 碰撞 ===================== */
function cellAt(c, r) {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return T_STEEL;
  return grid[r][c];
}
function rectCells(x, y, w, h) {
  return {
    c0: Math.floor(x / TILE), c1: Math.floor((x + w - 1) / TILE),
    r0: Math.floor(y / TILE), r1: Math.floor((y + h - 1) / TILE),
  };
}
function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
function tankBlocked(nx, ny, self) {
  if (nx < 0 || ny < 0 || nx + TANK > FIELD || ny + TANK > FIELD) return true;
  const { c0, c1, r0, r1 } = rectCells(nx, ny, TANK, TANK);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = cellAt(c, r);
      if (t === T_BRICK || t === T_STEEL || t === T_WATER || t === T_BASE) return true;
    }
  }
  const all = (player && player.alive ? [player].concat(enemies) : enemies.slice());
  for (const o of all) {
    if (o === self || !o.alive) continue;
    if (overlap(nx, ny, TANK, TANK, o.x, o.y, TANK, TANK)) return true;
  }
  return false;
}

/* ===================== 移动 ===================== */
function moveTank(t) {
  const nx = t.x + DX[t.dir] * t.speed;
  const ny = t.y + DY[t.dir] * t.speed;
  if (!tankBlocked(nx, ny, t)) {
    t.x = nx; t.y = ny; t.moving = true;
    t.treadFrame = (t.treadFrame + 1) % 8;
    return true;
  }
  t.moving = false;
  return false;
}
/* 转向时把垂直轴坐标对齐到小格，保证能拐进巷子 */
function snapPerp(t, dir) {
  const horiz = (dir === UP || dir === DOWN);
  const pos = horiz ? t.x : t.y;
  const off = pos % TILE;
  if (off === 0) return;
  const snap = off <= TILE / 2 ? -off : TILE - off;
  const nx = horiz ? t.x + snap : t.x;
  const ny = horiz ? t.y + snap : t.y;
  if (!tankBlocked(nx, ny, t)) { t.x = nx; t.y = ny; }
}

/* ===================== 开火 ===================== */
function fire(t) {
  const b = {
    x: t.x + TANK / 2 - 4 + DX[t.dir] * (TANK / 2),
    y: t.y + TANK / 2 - 4 + DY[t.dir] * (TANK / 2),
    dir: t.dir, speed: t.bulletSpeed,
    fromPlayer: t.isPlayer, owner: t, alive: true,
  };
  bullets.push(b);
  if (t.isPlayer) sfxShoot();
}
function playerBulletCount() {
  let n = 0;
  for (const b of bullets) if (b.alive && b.fromPlayer) n++;
  return n;
}
function updateBullet(b) {
  b.x += DX[b.dir] * b.speed;
  b.y += DY[b.dir] * b.speed;

  // 出界
  if (b.x < 0 || b.y < 0 || b.x + 8 > FIELD || b.y + 8 > FIELD) {
    b.alive = false;
    return;
  }

  // 撞地形
  const { c0, c1, r0, r1 } = rectCells(b.x, b.y, 8, 8);
  let hitBrick = false, hitSteel = false, hitBase = false;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = cellAt(c, r);
      if (t === T_BRICK) { grid[r][c] = T_EMPTY; hitBrick = true; }
      else if (t === T_STEEL) hitSteel = true;
      else if (t === T_BASE) hitBase = true;
    }
  }
  if (hitBase && baseAlive) destroyBase();
  if (hitBrick || hitSteel || hitBase) {
    b.alive = false;
    if (hitBrick) sfxBrick(); else sfxSteel();
    addExplosion(b.x + 4, b.y + 4, false);
    return;
  }

  // 撞坦克
  if (b.fromPlayer) {
    for (const e of enemies) {
      if (!e.alive) continue;
      if (overlap(b.x, b.y, 8, 8, e.x, e.y, TANK, TANK)) {
        b.alive = false;
        e.hp--;
        if (e.hp <= 0) {
          e.alive = false;
          score += e.scoreValue;
          addExplosion(e.x + TANK / 2, e.y + TANK / 2, false);
          sfxBoom();
          updateHUD();
        } else {
          sfxSteel();
        }
        return;
      }
    }
  } else if (player && player.alive && player.shield <= 0) {
    if (overlap(b.x, b.y, 8, 8, player.x, player.y, TANK, TANK)) {
      b.alive = false;
      killPlayer();
      return;
    }
  }

  // 子弹对撞（敌我子弹相互抵消）
  for (const o of bullets) {
    if (o === b || !o.alive || o.fromPlayer === b.fromPlayer) continue;
    if (overlap(b.x, b.y, 8, 8, o.x, o.y, 8, 8)) {
      b.alive = false; o.alive = false;
      return;
    }
  }
}

/* ===================== 玩家 ===================== */
function killPlayer() {
  if (!player.alive) return;
  player.alive = false;
  addExplosion(player.x + TANK / 2, player.y + TANK / 2, true);
  sfxBigBoom();
  bullets = bullets.filter(b => !b.fromPlayer);
  lives--;
  updateHUD();
  respawnTimer = 90;
}
function tryRespawn() {
  if (player.alive || lives <= 0 || !baseAlive) return;
  respawnTimer--;
  if (respawnTimer > 0) return;
  if (tankBlocked(PLAYER_SPAWN.x, PLAYER_SPAWN.y, null)) return; // 出生点被堵，等待
  player = makeTank(PLAYER_SPAWN.x, PLAYER_SPAWN.y, UP, 'player', true);
}
function updatePlayer() {
  if (!player.alive) { tryRespawn(); return; }
  if (player.shield > 0) player.shield--;
  if (player.cooldown > 0) player.cooldown--;

  const dir = dirStack[dirStack.length - 1];
  if (dir !== undefined) {
    if (player.dir !== dir) {
      snapPerp(player, dir);
      player.dir = dir;
    }
    moveTank(player);
  } else {
    player.moving = false;
  }

  if (spaceHeld && player.cooldown <= 0 && playerBulletCount() < 2) {
    fire(player);
    player.cooldown = 15;
  }
}

/* ===================== 敌人 AI ===================== */
function chooseEnemyDir(e) {
  const r = Math.random();
  if (r < 0.4) return DOWN;                          // 倾向向下压向基地
  if (r < 0.6) return e.x < 12 * TILE ? RIGHT : LEFT; // 朝中路靠拢
  return (Math.random() * 4) | 0;
}
function updateEnemy(e) {
  if (!e.alive) return;
  e.aiTimer--;
  const moved = moveTank(e);
  if (!moved || e.aiTimer <= 0) {
    const nd = chooseEnemyDir(e);
    if (nd !== e.dir) { snapPerp(e, nd); e.dir = nd; }
    e.aiTimer = 40 + ((Math.random() * 120) | 0);
  }
  e.fireTimer--;
  if (e.fireTimer <= 0) {
    if (!bullets.some(b => b.alive && b.owner === e)) fire(e);
    e.fireTimer = 90 + ((Math.random() * 150) | 0);
  }
}
function enemiesAlive() {
  let n = 0;
  for (const e of enemies) if (e.alive) n++;
  return n;
}
function trySpawnEnemy() {
  if (enemyQueue.length === 0 || enemiesAlive() >= MAX_ENEMY_ON_FIELD) return;
  spawnTimer--;
  if (spawnTimer > 0) return;
  const free = ENEMY_SPAWNS.filter(([x, y]) => !tankBlocked(x, y, null));
  if (free.length === 0) { spawnTimer = 30; return; }
  const [x, y] = free[(Math.random() * free.length) | 0];
  spawnFlashes.push({ x, y, t: 40 });
  spawnTimer = 160;
}
function updateSpawnFlashes() {
  for (let i = spawnFlashes.length - 1; i >= 0; i--) {
    const f = spawnFlashes[i];
    f.t--;
    if (f.t <= 0) {
      spawnFlashes.splice(i, 1);
      const kind = enemyQueue.shift();
      if (kind && !tankBlocked(f.x, f.y, null)) {
        enemies.push(makeTank(f.x, f.y, DOWN, kind, false));
      }
      updateHUD();
    }
  }
}

/* ===================== 关卡 ===================== */
function buildQueue(n) {
  const q = [];
  for (const [kind, count] of LEVEL_ENEMIES[n - 1])
    for (let i = 0; i < count; i++) q.push(kind);
  // 洗牌
  for (let i = q.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [q[i], q[j]] = [q[j], q[i]];
  }
  return q;
}
function loadStage(n) {
  grid = expandMap(LEVELS[n - 1]);
  placeBase();
  baseAlive = true;
  enemies = []; bullets = []; explosions = []; spawnFlashes = [];
  enemyQueue = buildQueue(n);
  spawnTimer = 90;
  respawnTimer = 0;
  player = makeTank(PLAYER_SPAWN.x, PLAYER_SPAWN.y, UP, 'player', true);
  updateHUD();
}
function startGame() {
  score = 0; lives = 3; stage = 1;
  loadStage(stage);
  state = 'stageIntro';
  stateTimer = 90;
  sfxStart();
  updateHUD();
}
function enemiesRemaining() {
  return enemyQueue.length + enemiesAlive() + spawnFlashes.length;
}

/* ===================== 更新 ===================== */
function update() {
  frameCount++;

  if (state === 'stageIntro' || state === 'stageClear') {
    stateTimer--;
    if (stateTimer <= 0) {
      if (state === 'stageIntro') {
        state = 'playing';
      } else {
        if (stage >= LEVELS.length) {
          state = 'win';
        } else {
          stage++;
          loadStage(stage);
          state = 'stageIntro';
          stateTimer = 90;
        }
      }
    }
    return;
  }

  if (state !== 'playing') {
    // gameover / win 界面仍播放爆炸动画
    updateExplosions();
    return;
  }

  updatePlayer();
  for (const e of enemies) updateEnemy(e);
  enemies = enemies.filter(e => e.alive);
  trySpawnEnemy();
  updateSpawnFlashes();

  for (const b of bullets) if (b.alive) updateBullet(b);
  bullets = bullets.filter(b => b.alive);

  updateExplosions();

  // 判负：基地被毁 或 命用完且玩家已死
  if (!baseAlive || (lives <= 0 && !player.alive)) {
    state = 'gameover';
    return;
  }
  // 判胜：本关敌人清空
  if (enemiesRemaining() === 0) {
    state = 'stageClear';
    stateTimer = 120;
    score += 500; // 过关奖励
    updateHUD();
  }
}
function updateExplosions() {
  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].t++;
    if (explosions[i].t >= explosions[i].max) explosions.splice(i, 1);
  }
}

/* ===================== 绘制 ===================== */
function drawTerrain() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = grid[r][c];
      if (t === T_EMPTY || t === T_TREE || t === T_BASE) continue;
      const x = c * TILE, y = r * TILE;
      if (t === T_BRICK) drawBrick(x, y);
      else if (t === T_STEEL) drawSteel(x, y);
      else if (t === T_WATER) drawWater(x, y);
    }
  }
  drawBase();
}
function drawBrick(x, y) {
  ctx.fillStyle = '#8a3b1e';
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = '#c96f4a';
  ctx.fillRect(x, y, TILE, 3);
  ctx.fillRect(x, y + 10, TILE, 3);
  ctx.fillRect(x + 4, y + 3, 3, 7);
  ctx.fillRect(x + 13, y + 13, 3, 7);
}
function drawSteel(x, y) {
  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = '#e0e0e0';
  ctx.fillRect(x, y, TILE / 2, TILE / 2);
  ctx.fillRect(x + TILE / 2, y + TILE / 2, TILE / 2, TILE / 2);
  ctx.fillStyle = '#5a5a5a';
  ctx.fillRect(x + TILE / 2, y, TILE / 2, TILE / 2);
  ctx.fillRect(x, y + TILE / 2, TILE / 2, TILE / 2);
}
function drawWater(x, y) {
  ctx.fillStyle = '#123a8a';
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = '#2f6bd8';
  const phase = Math.floor(frameCount / 30) % 2;
  for (let i = 0; i < 2; i++) {
    const wy = y + 4 + i * 9;
    const off = phase ? 2 : 6;
    ctx.fillRect(x + off, wy, 6, 2);
    ctx.fillRect(x + off + 8, wy + 4, 6, 2);
  }
}
const EAGLE_BMP = [
  '..1..1..',
  '.111111.',
  '11122111',
  '11222211',
  '.122221.',
  '..1221..',
  '.112211.',
  '11111111',
];
function drawBase() {
  const x0 = 12 * TILE, y0 = 24 * TILE, s = 5; // 8x8 位图放大5倍=40px
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const ch = EAGLE_BMP[r][c];
      if (ch === '.') continue;
      if (!baseAlive) ctx.fillStyle = ch === '1' ? '#555' : '#333';
      else ctx.fillStyle = ch === '1' ? '#e8b830' : '#8a5f10';
      ctx.fillRect(x0 + c * s, y0 + r * s, s, s);
    }
  }
  if (!baseAlive) { // 残骸上画个X
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0 + 6, y0 + 6); ctx.lineTo(x0 + 34, y0 + 34);
    ctx.moveTo(x0 + 34, y0 + 6); ctx.lineTo(x0 + 6, y0 + 34);
    ctx.stroke();
  }
}
function drawTrees() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] !== T_TREE) continue;
      const x = c * TILE, y = r * TILE;
      ctx.fillStyle = '#0e4d1a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#1e7a30';
      ctx.fillRect(x + 3, y + 3, 5, 5);
      ctx.fillRect(x + 11, y + 8, 6, 6);
      ctx.fillRect(x + 4, y + 12, 5, 5);
    }
  }
}
function shade(hex, d) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + d));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + d));
  const b = Math.max(0, Math.min(255, (n & 255) + d));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}
function drawTank(t) {
  ctx.save();
  ctx.translate(t.x + TANK / 2, t.y + TANK / 2);
  ctx.rotate(t.dir * Math.PI / 2); // 朝上为基准，顺时针旋转

  const col = t.color;
  // 履带
  ctx.fillStyle = shade(col, -70);
  ctx.fillRect(-20, -18, 8, 36);
  ctx.fillRect(12, -18, 8, 36);
  ctx.fillStyle = shade(col, -110);
  const step = t.moving ? (t.treadFrame < 4 ? 0 : 3) : 0;
  for (let i = -18 + step; i < 18; i += 6) {
    ctx.fillRect(-20, i, 8, 2);
    ctx.fillRect(12, i, 8, 2);
  }
  // 车身
  ctx.fillStyle = col;
  ctx.fillRect(-12, -14, 24, 28);
  ctx.fillStyle = shade(col, 30);
  ctx.fillRect(-10, -12, 5, 24);
  // 炮塔
  ctx.fillStyle = shade(col, -30);
  ctx.beginPath();
  ctx.arc(0, 2, 8, 0, Math.PI * 2);
  ctx.fill();
  // 炮管
  ctx.fillStyle = shade(col, -80);
  ctx.fillRect(-2.5, -20, 5, 16);
  // power 型受伤裂纹
  if (t.kind === 'power' && t.hp < t.maxHp) {
    ctx.strokeStyle = '#301008';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-10, -8); ctx.lineTo(2, 4); ctx.lineTo(-4, 12);
    ctx.stroke();
  }
  ctx.restore();

  // 出生护盾
  if (t.shield > 0 && Math.floor(frameCount / 4) % 2 === 0) {
    ctx.strokeStyle = '#7fd4ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(t.x + 1, t.y + 1, TANK - 2, TANK - 2);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(t.x + 4, t.y + 4, TANK - 8, TANK - 8);
  }
}
function drawBullets() {
  for (const b of bullets) {
    ctx.fillStyle = b.fromPlayer ? '#ffe9a0' : '#ff9a7a';
    ctx.fillRect(b.x, b.y, 8, 8);
    ctx.fillStyle = '#fff';
    ctx.fillRect(b.x + 2, b.y + 2, 4, 4);
  }
}
function drawExplosions() {
  for (const e of explosions) {
    const k = e.t / e.max;
    const r = (e.big ? 34 : 18) * k + 4;
    const colors = ['#fff3a0', '#ffb340', '#e85a20'];
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = colors[i];
      ctx.beginPath();
      ctx.arc(e.x, e.y, Math.max(1, r - i * r / 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
function drawSpawnFlashes() {
  for (const f of spawnFlashes) {
    const k = Math.floor(f.t / 5) % 2;
    ctx.save();
    ctx.translate(f.x + TANK / 2, f.y + TANK / 2);
    ctx.rotate(f.t * 0.15);
    ctx.fillStyle = k ? '#ffe9a0' : '#7fd4ff';
    const s = 14 + (f.t % 10);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.moveTo(0, 0);
      ctx.lineTo(-4, -s);
      ctx.lineTo(4, -s);
    }
    ctx.fill();
    ctx.restore();
  }
}

/* ===================== 界面 ===================== */
function drawCenterText(lines) {
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, FIELD, FIELD);
  let y = FIELD / 2 - (lines.length - 1) * 24;
  for (const [text, size, color] of lines) {
    ctx.fillStyle = color;
    ctx.font = 'bold ' + size + 'px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, FIELD / 2, y);
    y += size + 18;
  }
}
function draw() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, FIELD, FIELD);

  if (state === 'title') {
    drawCenterText([
      ['坦克大战', 56, '#e8c44a'],
      ['BATTLE CITY', 20, '#888888'],
      ['', 8, '#000'],
      ['按 Enter 开始游戏', 20, '#ffffff'],
      ['方向键/WASD 移动 · 空格射击', 14, '#999999'],
    ]);
    return;
  }

  drawTerrain();
  if (player && player.alive) drawTank(player);
  for (const e of enemies) if (e.alive) drawTank(e);
  drawBullets();
  drawTrees();
  drawSpawnFlashes();
  drawExplosions();

  if (state === 'stageIntro') {
    drawCenterText([['STAGE ' + stage, 40, '#ffffff']]);
  } else if (state === 'stageClear') {
    drawCenterText([
      ['STAGE ' + stage + ' CLEAR!', 36, '#7fd4ff'],
      ['奖励 +500', 18, '#e8c44a'],
    ]);
  } else if (state === 'paused') {
    drawCenterText([['PAUSE', 40, '#ffffff'], ['按 P 继续', 16, '#999999']]);
  } else if (state === 'gameover') {
    drawCenterText([
      ['GAME OVER', 44, '#e03030'],
      ['得分 ' + score, 22, '#ffffff'],
      ['按 Enter 返回标题', 16, '#999999'],
    ]);
  } else if (state === 'win') {
    drawCenterText([
      ['YOU WIN!', 44, '#e8c44a'],
      ['全部关卡通过！', 20, '#7fd4ff'],
      ['得分 ' + score, 22, '#ffffff'],
      ['按 Enter 返回标题', 16, '#999999'],
    ]);
  }
}

/* ===================== HUD ===================== */
const elScore = document.getElementById('score');
const elStage = document.getElementById('stage');
const elLives = document.getElementById('lives');
const elDots = document.getElementById('dots');
for (let i = 0; i < ENEMY_TOTAL; i++) {
  const d = document.createElement('div');
  d.className = 'dot';
  elDots.appendChild(d);
}
function updateHUD() {
  elScore.textContent = score;
  elStage.textContent = stage;
  elLives.innerHTML = '';
  for (let i = 0; i < Math.max(0, lives); i++) {
    const s = document.createElement('span');
    s.className = 'life';
    s.textContent = '🛡️';
    elLives.appendChild(s);
  }
  const remain = state === 'title' ? 0 : enemiesRemaining();
  const dots = elDots.children;
  for (let i = 0; i < dots.length; i++) {
    dots[i].className = 'dot' + (i < remain ? ' on' : '');
  }
}

/* ===================== 输入 ===================== */
const KEYMAP = {
  ArrowUp: UP, KeyW: UP,
  ArrowRight: RIGHT, KeyD: RIGHT,
  ArrowDown: DOWN, KeyS: DOWN,
  ArrowLeft: LEFT, KeyA: LEFT,
};
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }
  audio(); // 首次按键解锁音频

  if (e.code === 'Enter') {
    if (state === 'title' || state === 'gameover' || state === 'win') startGame();
    return;
  }
  if (e.code === 'KeyP' && !e.repeat) {
    if (state === 'playing') state = 'paused';
    else if (state === 'paused') state = 'playing';
    return;
  }
  const dir = KEYMAP[e.code];
  if (dir !== undefined && !e.repeat) {
    const i = dirStack.indexOf(dir);
    if (i >= 0) dirStack.splice(i, 1);
    dirStack.push(dir);
  }
  if (e.code === 'Space') spaceHeld = true;
});
window.addEventListener('keyup', (e) => {
  const dir = KEYMAP[e.code];
  if (dir !== undefined) {
    const i = dirStack.indexOf(dir);
    if (i >= 0) dirStack.splice(i, 1);
  }
  if (e.code === 'Space') spaceHeld = false;
});
window.addEventListener('blur', () => {
  dirStack.length = 0;
  spaceHeld = false;
});

/* ===================== 主循环 ===================== */
let lastTime = 0, acc = 0;
const STEP = 1000 / 60;
function frame(t) {
  requestAnimationFrame(frame);
  if (!lastTime) lastTime = t;
  acc += Math.min(100, t - lastTime);
  lastTime = t;
  while (acc >= STEP) {
    if (state !== 'paused') update();
    acc -= STEP;
  }
  draw();
}
updateHUD();
requestAnimationFrame(frame);
