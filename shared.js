// Shared game data used by both the server and the browser client.
export const TILE = 2;           // metres per tile
export const W = 44, H = 40;     // grid size in tiles
export const WALL_H = 4.5;
export const EYE = 1.6;
export const PLAYER_R = 0.4;
export const PLAYER_H = 1.8;

export const ROUND = {
  buyTime: 15, liveTime: 105, bombTime: 40, endTime: 6, matchEndTime: 12,
  plantTime: 3.2, defuseTime: 7, defuseKitTime: 3.5, winRounds: 7, halftime: 6,
};

export const ECON = {
  start: 800, max: 16000, win: 3250, loss: 1900, lossBonus: 500, lossMax: 3400,
  plant: 300, defuse: 300,
};

// slot: 'secondary' | 'primary' | 'gear'
export const WEAPONS = {
  sidearm:  { name: 'P-9 Sidearm',   slot: 'secondary', price: 0,    dmg: 26,  head: 3.5, rpm: 380, auto: false, mag: 12, reserve: 36, reload: 2.0, spread: 0.010, moveSpread: 0.035, recoil: 0.012, range: 40, falloff: 0.55, speed: 6.2, reward: 300 },
  cannon:   { name: 'Hand Cannon',   slot: 'secondary', price: 700,  dmg: 54,  head: 3.6, rpm: 220, auto: false, mag: 7,  reserve: 35, reload: 2.2, spread: 0.008, moveSpread: 0.06,  recoil: 0.045, range: 60, falloff: 0.7, speed: 6.0, reward: 300 },
  vector:   { name: 'Vector SMG',    slot: 'primary',   price: 1250, dmg: 23,  head: 3.0, rpm: 820, auto: true,  mag: 30, reserve: 120, reload: 2.3, spread: 0.018, moveSpread: 0.028, recoil: 0.010, range: 30, falloff: 0.55, speed: 6.0, reward: 600 },
  raptor:   { name: 'Raptor Rifle',  slot: 'primary',   price: 2700, dmg: 34,  head: 4.0, rpm: 600, auto: true,  mag: 30, reserve: 90,  reload: 2.5, spread: 0.006, moveSpread: 0.07,  recoil: 0.016, range: 90, falloff: 0.85, speed: 5.5, reward: 300 },
  longbow:  { name: 'Longbow Sniper',slot: 'primary',   price: 4500, dmg: 115, head: 2.5, rpm: 42,  auto: false, mag: 5,  reserve: 25,  reload: 3.4, spread: 0.0015, moveSpread: 0.12, recoil: 0.06, range: 200, falloff: 1.0, speed: 5.0, reward: 100, scope: true },
};
export const GEAR = {
  armor:  { name: 'Kevlar + Helmet', price: 1000 },
  kit:    { name: 'Defuse Kit',      price: 400, team: 'D' },
};

// ---------- Map: carved from rectangles (tile coords, inclusive) ----------
const FLOOR = [
  [17, 1, 26, 6],   // defender spawn
  [2, 1, 12, 10],   // B site
  [31, 1, 41, 10],  // A site
  [12, 3, 17, 5],   // B <-> CT connector
  [26, 3, 31, 5],   // CT <-> A connector
  [20, 6, 23, 33],  // mid
  [9, 10, 11, 15],  // B window drop
  [11, 13, 20, 15], // mid -> B connector
  [23, 11, 33, 13], // A short (catwalk)
  [31, 10, 33, 13],
  [37, 10, 41, 34], // A long
  [2, 10, 5, 34],   // B tunnels
  [2, 31, 17, 34],  // T side left
  [26, 31, 41, 34], // T side right
  [17, 33, 26, 38], // attacker spawn
  [24, 20, 36, 22], // long-mid link
  [6, 22, 19, 24],  // tunnel-mid link
];
const CRATES = [
  [6, 4], [7, 4], [6, 5], [9, 7], [10, 7], [4, 8],          // B site
  [35, 4], [36, 4], [36, 5], [33, 7], [34, 7], [39, 8],     // A site
  [21, 17], [22, 26], [20, 10],                             // mid
  [39, 18], [38, 27], [3, 19], [4, 27],                     // lanes
  [21, 3], [17, 38], [26, 38], [30, 12], [14, 23], [31, 21],
];
export const SITES = {
  A: { x0: 32, z0: 2, x1: 40, z1: 9 },
  B: { x0: 3, z0: 2, x1: 11, z1: 9 },
};
export const SPAWNS = {
  D: [[19, 2], [21, 2], [23, 2], [25, 3], [18, 4]],
  T: [[19, 36], [21, 37], [22, 35], [23, 37], [25, 36]],
};
// Defender hold points per site (tile coords)
export const HOLDS = {
  A: [[37, 2], [40, 5], [32, 3], [38, 9], [35, 6]],
  B: [[3, 3], [8, 2], [11, 5], [5, 9], [8, 6]],
};

export function buildGrid() {
  const g = new Uint8Array(W * H).fill(1); // 1 = wall
  for (const [x0, z0, x1, z1] of FLOOR)
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) g[z * W + x] = 0;
  for (const [x, z] of CRATES) g[z * W + x] = 2; // 2 = crate (solid)
  return g;
}
export const GRID = buildGrid();

export function solidAt(tx, tz) {
  if (tx < 0 || tz < 0 || tx >= W || tz >= H) return true;
  return GRID[tz * W + tx] !== 0;
}
export function solidWorld(x, z) { return solidAt(Math.floor(x / TILE), Math.floor(z / TILE)); }
export function tileCenter(tx, tz) { return [tx * TILE + TILE / 2, tz * TILE + TILE / 2]; }
export function inSite(x, z) {
  const tx = x / TILE, tz = z / TILE;
  for (const k of ['A', 'B']) {
    const s = SITES[k];
    if (tx >= s.x0 && tx < s.x1 + 1 && tz >= s.z0 && tz < s.z1 + 1) return k;
  }
  return null;
}

// Circle-vs-grid collision resolve. Returns new [x, z].
export function moveCollide(x, z, dx, dz, r = PLAYER_R) {
  let nx = x + dx;
  if (collides(nx, z, r)) nx = x;
  let nz = z + dz;
  if (collides(nx, nz, r)) nz = z;
  return [nx, nz];
}
export function collides(x, z, r) {
  const minX = Math.floor((x - r) / TILE), maxX = Math.floor((x + r) / TILE);
  const minZ = Math.floor((z - r) / TILE), maxZ = Math.floor((z + r) / TILE);
  for (let tz = minZ; tz <= maxZ; tz++)
    for (let tx = minX; tx <= maxX; tx++) {
      if (!solidAt(tx, tz)) continue;
      const cx = Math.max(tx * TILE, Math.min(x, (tx + 1) * TILE));
      const cz = Math.max(tz * TILE, Math.min(z, (tz + 1) * TILE));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
  return false;
}

// 2D DDA ray vs grid; returns horizontal distance to first solid tile (or maxD).
export function rayGrid(ox, oz, dx, dz, maxD = 300) {
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return maxD;
  dx /= len; dz /= len;
  let tx = Math.floor(ox / TILE), tz = Math.floor(oz / TILE);
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDX = Math.abs(TILE / dx), tDZ = Math.abs(TILE / dz);
  let tMaxX = dx !== 0 ? ((dx > 0 ? (tx + 1) * TILE - ox : ox - tx * TILE) / Math.abs(dx)) : Infinity;
  let tMaxZ = dz !== 0 ? ((dz > 0 ? (tz + 1) * TILE - oz : oz - tz * TILE) / Math.abs(dz)) : Infinity;
  let t = 0;
  while (t < maxD) {
    if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDX; tx += stepX; }
    else { t = tMaxZ; tMaxZ += tDZ; tz += stepZ; }
    if (solidAt(tx, tz)) return t;
  }
  return maxD;
}
// 3D ray (unit dir) -> distance along ray to wall or floor.
export function rayWorld(o, d, maxD = 300) {
  const h = Math.hypot(d[0], d[2]);
  let t = h > 1e-6 ? rayGrid(o[0], o[2], d[0], d[2], maxD * h) / h : maxD;
  if (d[1] < 0) t = Math.min(t, o[1] / -d[1]);
  else if (d[1] > 0) { // above wall height = open sky, no hit beyond
    const tTop = (WALL_H - o[1]) / d[1];
    if (t > tTop) t = Math.min(maxD, t); // walls are capped; keep wall hit if below top
  }
  return Math.min(t, maxD);
}
export function losClear(ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  return rayGrid(ax, az, bx - ax, bz - az, d + 0.01) >= d;
}
// Ray vs player hitbox. Returns {t, head} or null.
export function rayPlayer(o, d, p) {
  // body cylinder (horizontal closest approach)
  const ox = o[0] - p.x, oz = o[2] - p.z;
  const a = d[0] * d[0] + d[2] * d[2];
  const b = 2 * (ox * d[0] + oz * d[2]);
  const r = PLAYER_R + 0.05;
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (a < 1e-9 || disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t < 0) continue;
    const y = o[1] + d[1] * t - p.y;
    if (y >= 0 && y <= PLAYER_H) return { t, head: y > 1.42 };
  }
  // check cap crossing from above/below (rare) — ignored
  return null;
}

// A* over walkable tiles (8-dir, no corner cutting)
export function findPath(sx, sz, gx, gz) {
  if (solidAt(gx, gz) || solidAt(sx, sz)) return null;
  const N = W * H, start = sz * W + sx, goal = gz * W + gx;
  const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = [start]; g[start] = 0;
  const f = new Float32Array(N).fill(Infinity);
  const hfn = (i) => { const x = i % W, z = (i / W) | 0; const dx = Math.abs(x - gx), dz = Math.abs(z - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  f[start] = hfn(start);
  let iter = 0;
  while (open.length && iter++ < 4000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    if (cur === goal) {
      const path = []; let c = cur;
      while (c !== -1) { path.push([c % W, (c / W) | 0]); c = came[c]; }
      return path.reverse();
    }
    closed[cur] = 1;
    const cx = cur % W, cz = (cur / W) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (solidAt(nx, nz)) continue;
      if (dx && dz && (solidAt(cx + dx, cz) || solidAt(cx, cz + dz))) continue;
      const ni = nz * W + nx;
      if (closed[ni]) continue;
      const ng = g[cur] + (dx && dz ? 1.414 : 1);
      if (ng < g[ni]) {
        if (g[ni] === Infinity) open.push(ni);
        g[ni] = ng; came[ni] = cur; f[ni] = ng + hfn(ni);
      }
    }
  }
  return null;
}
