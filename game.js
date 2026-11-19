import * as THREE from 'three';
import * as S from './shared.js';

import { createLocalGame, DIFFICULTY } from './sim.js';

// ======================================================================= local match
let ws = null, myId = null, joined = false, paused = false;
const net = { snaps: [], last: null, you: null, ping: 0 };
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

// ======================================================================= DOM
const $ = (id) => document.getElementById(id);
const ui = {
  menu: $('menu'), hud: $('hud'), buy: $('buy'), sb: $('scoreboard'), touch: $('touch'),
  name: $('in-name'), join: $('btn-join'), status: $('menu-status'), pause: $('pause'),
};
const LOWFX = /lowfx/.test(location.search);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
let teamPref = 'auto';
document.querySelectorAll('#seg-team button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#seg-team button').forEach((x) => x.classList.toggle('on', x === b));
  teamPref = b.dataset.v;
}));
ui.name.value = 'Player' + ((Math.random() * 900 + 100) | 0);

let difficulty = new URLSearchParams(location.search).get('d');
if (!DIFFICULTY[difficulty]) difficulty = 'normal';
function syncDiffButtons() {
  document.querySelectorAll('.seg-diff button').forEach((x) => x.classList.toggle('on', x.dataset.v === difficulty));
  document.querySelectorAll('.diff-label').forEach((x) => { x.textContent = DIFFICULTY[difficulty].label; });
}
function setDifficulty(v) {
  if (!DIFFICULTY[v]) return;
  difficulty = v;
  syncDiffButtons();
  if (joined) { send({ t: 'difficulty', v }); addFeedText(`Bot difficulty: ${DIFFICULTY[v].label}`); }
}
document.querySelectorAll('.seg-diff button').forEach((b) => b.addEventListener('click', () => setDifficulty(b.dataset.v)));
syncDiffButtons();

ui.join.onclick = () => {
  ui.join.disabled = true;
  initAudio();
  ws = createLocalGame();
  ws.onopen = () => send({ t: 'join', name: ui.name.value.trim() || 'Player', team: teamPref, difficulty });
  ws.onmessage = (ev) => onNet(JSON.parse(ev.data));
};

// pause menu
function setPaused(v) {
  if (!joined) return;
  paused = v;
  ws.setPaused(v);
  ui.pause.classList.toggle('hidden', !v);
  if (v) { keys.clear(); mouseDown = false; setUse(false); toggleBuy(false); }
}
$('btn-resume').onclick = () => setPaused(false);
$('btn-quit').onclick = () => { const q = new URLSearchParams(location.search); q.set('d', difficulty); location.search = q.toString(); };
$('btn-pause').onclick = () => setPaused(true);
ui.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.join.click(); });

// ======================================================================= renderer / scene
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(LOWFX ? 0.5 : Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = !LOWFX;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const SKY = new THREE.Color('#e9c79a');
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 40, 150);
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

scene.add(new THREE.HemisphereLight('#fff1d8', '#7a5a3a', 1.25));
const sun = new THREE.DirectionalLight('#ffe2b0', 2.4);
const MW = S.W * S.TILE, MH = S.H * S.TILE;
sun.position.set(MW / 2 + 30, 60, MH / 2 - 25);
sun.target.position.set(MW / 2, 0, MH / 2);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 160 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
function noise(ctx, w, h, base, amt, n = 3000) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = (Math.random() - 0.5) * amt;
    ctx.fillStyle = v > 0 ? `rgba(255,240,220,${v})` : `rgba(40,20,0,${-v})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}
const floorTex = canvasTex(256, 256, (c, w, h) => {
  noise(c, w, h, '#c9a678', 0.25, 5000);
  c.strokeStyle = 'rgba(90,60,30,0.18)'; c.lineWidth = 2;
  for (let i = 0; i <= 2; i++) { c.beginPath(); c.moveTo(i * 128, 0); c.lineTo(i * 128, h); c.stroke(); c.beginPath(); c.moveTo(0, i * 128); c.lineTo(w, i * 128); c.stroke(); }
}, [S.W / 2, S.H / 2]);
const wallTex = canvasTex(256, 256, (c, w, h) => {
  noise(c, w, h, '#d8b98c', 0.22, 4000);
  c.strokeStyle = 'rgba(110,75,40,0.35)'; c.lineWidth = 2;
  for (let y = 0; y < h; y += 32) {
    c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
    for (let x = ((y / 32) % 2) * 32; x < w; x += 64) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 32); c.stroke(); }
  }
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(70,40,15,0.3)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
});
const crateTex = canvasTex(128, 128, (c, w, h) => {
  noise(c, w, h, '#8a5d33', 0.3, 1500);
  c.strokeStyle = '#4a2f17'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
  c.lineWidth = 6; c.beginPath(); c.moveTo(8, 8); c.lineTo(w - 8, h - 8); c.moveTo(w - 8, 8); c.lineTo(8, h - 8); c.stroke();
});

// floor
const floor = new THREE.Mesh(new THREE.PlaneGeometry(MW, MH), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2; floor.position.set(MW / 2, 0, MH / 2); floor.receiveShadow = true;
scene.add(floor);
// walls & crates (instanced)
{
  const wallGeo = new THREE.BoxGeometry(S.TILE, S.WALL_H, S.TILE);
  const crateGeo = new THREE.BoxGeometry(S.TILE * 0.96, 2.6, S.TILE * 0.96);
  const walls = [], crates = [];
  for (let z = 0; z < S.H; z++) for (let x = 0; x < S.W; x++) {
    const v = S.GRID[z * S.W + x];
    if (v === 2) crates.push([x, z]);
    else if (v === 1) {
      let edge = false;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, nz = z + dz; if (nx >= 0 && nz >= 0 && nx < S.W && nz < S.H && S.GRID[nz * S.W + nx] !== 1) edge = true; }
      if (edge) walls.push([x, z]);
    }
  }
  const wm = new THREE.InstancedMesh(wallGeo, new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 }), walls.length);
  const cm = new THREE.InstancedMesh(crateGeo, new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.8 }), crates.length);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  walls.forEach(([x, z], i) => {
    const hj = 1 + ((x * 7 + z * 13) % 5 === 0 ? 0.25 : 0);
    m.makeScale(1, hj, 1); m.setPosition(x * S.TILE + 1, (S.WALL_H * hj) / 2, z * S.TILE + 1); wm.setMatrixAt(i, m);
    col.setHSL(0.09, 0.35, 0.82 + ((x * 31 + z * 17) % 7) * 0.02); wm.setColorAt(i, col);
  });
  crates.forEach(([x, z], i) => { m.makeRotationY(((x + z) % 3) * 0.05); m.setPosition(x * S.TILE + 1, 1.3, z * S.TILE + 1); cm.setMatrixAt(i, m); });
  for (const im of [wm, cm]) { im.castShadow = true; im.receiveShadow = true; scene.add(im); }
  // ground outside map (dunes)
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: '#c49a68', roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.set(MW / 2, -0.02, MH / 2); scene.add(outer);
}
// site markers
for (const k of ['A', 'B']) {
  const s = S.SITES[k];
  const w = (s.x1 - s.x0 + 1) * S.TILE, h = (s.z1 - s.z0 + 1) * S.TILE;
  const tex = canvasTex(512, 512 * (h / w), (c, cw, ch) => {
    c.clearRect(0, 0, cw, ch);
    c.strokeStyle = 'rgba(200,40,30,0.75)'; c.lineWidth = 10; c.setLineDash([30, 18]); c.strokeRect(8, 8, cw - 16, ch - 16);
    c.fillStyle = 'rgba(200,40,30,0.8)'; c.font = `700 ${ch * 0.5}px Chakra Petch, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(k, cw / 2, ch / 2);
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1 }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(s.x0 * S.TILE + w / 2, 0.02, s.z0 * S.TILE + h / 2);
  scene.add(mesh);
}
// some decor: hanging banners & lamps for silhouette interest
{
  const poleMat = new THREE.MeshStandardMaterial({ color: '#5a3d24' });
  const clothT = new THREE.MeshStandardMaterial({ color: '#b5452a', side: THREE.DoubleSide });
  const clothD = new THREE.MeshStandardMaterial({ color: '#2b6f8c', side: THREE.DoubleSide });
  const spots = [[21.5, 34, clothT], [24.5, 34, clothT], [20, 1, clothD], [26, 1, clothD]];
  for (const [tx, tz, mat] of spots) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5), poleMat); pole.position.y = 2.5; g.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2), mat); cloth.position.set(0.62, 3.8, 0); g.add(cloth);
    g.position.set(tx * S.TILE, 0, tz * S.TILE + 1); scene.add(g);
  }
}

// ======================================================================= character models
const TEAM_COL = { T: new THREE.Color('#d0702f'), D: new THREE.Color('#3f97c0') };
const skinMat = new THREE.MeshStandardMaterial({ color: '#c99a73', roughness: 0.8 });
const darkMat = new THREE.MeshStandardMaterial({ color: '#2e2a26', roughness: 0.7, metalness: 0.1 });
const gunMat = new THREE.MeshStandardMaterial({ color: '#4a4743', roughness: 0.5, metalness: 0.25 });
const teamMats = {
  T: { body: new THREE.MeshStandardMaterial({ color: '#a8592a', roughness: 0.85 }), leg: new THREE.MeshStandardMaterial({ color: '#5c4630', roughness: 0.9 }), head: new THREE.MeshStandardMaterial({ color: '#3a2f25', roughness: 0.9 }) },
  D: { body: new THREE.MeshStandardMaterial({ color: '#2f6f8f', roughness: 0.85 }), leg: new THREE.MeshStandardMaterial({ color: '#2b3a45', roughness: 0.9 }), head: new THREE.MeshStandardMaterial({ color: '#1f2c35', roughness: 0.6, metalness: 0.2 }) },
};
function box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; return m; }
function gunModel(key, scale = 1) {
  const g = new THREE.Group();
  const L = { sidearm: 0.22, cannon: 0.3, vector: 0.45, raptor: 0.7, longbow: 0.95 }[key] || 0.3;
  g.add(box(0.06, 0.08, L, gunMat, 0, 0, -L / 2));
  g.add(box(0.05, 0.12, 0.06, darkMat, 0, -0.08, -0.04));
  if (key === 'raptor' || key === 'vector') { g.add(box(0.045, 0.14, 0.06, darkMat, 0, -0.1, -L * 0.45)); g.add(box(0.05, 0.07, 0.18, darkMat, 0, -0.02, 0.1)); }
  if (key === 'raptor') g.add(box(0.03, 0.03, 0.25, gunMat, 0, 0.0, -L - 0.1));
  if (key === 'longbow') { g.add(box(0.05, 0.05, 0.28, darkMat, 0, 0.08, -0.35)); g.add(box(0.05, 0.08, 0.22, darkMat, 0, -0.02, 0.12)); }
  if (key === 'cannon') g.add(box(0.07, 0.03, L * 0.9, darkMat, 0, 0.05, -L / 2));
  g.scale.setScalar(scale);
  return g;
}
function makeAvatar(team) {
  const mats = teamMats[team];
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.13, 0.85, 0); legR.position.set(0.13, 0.85, 0);
  legL.add(box(0.2, 0.85, 0.24, mats.leg, 0, -0.42, 0)); legR.add(box(0.2, 0.85, 0.24, mats.leg, 0, -0.42, 0));
  legL.add(box(0.22, 0.1, 0.32, darkMat, 0, -0.82, 0.04)); legR.add(box(0.22, 0.1, 0.32, darkMat, 0, -0.82, 0.04));
  body.add(legL, legR);
  const torso = box(0.52, 0.6, 0.3, mats.body, 0, 1.15, 0); body.add(torso);
  body.add(box(0.56, 0.36, 0.34, darkMat, 0, 1.2, 0.01)); // vest
  const headG = new THREE.Group(); headG.position.set(0, 1.5, 0);
  headG.add(box(0.26, 0.28, 0.27, skinMat, 0, 0.1, 0));
  headG.add(box(0.3, 0.14, 0.31, mats.head, 0, 0.24, 0));
  if (team === 'T') headG.add(box(0.27, 0.1, 0.05, mats.head, 0, 0.07, 0.13)); else headG.add(box(0.24, 0.07, 0.04, new THREE.MeshStandardMaterial({ color: '#111', metalness: 0.8, roughness: 0.2 }), 0, 0.13, 0.14));
  body.add(headG);
  const arms = new THREE.Group(); arms.position.set(0, 1.32, 0);
  arms.add(box(0.13, 0.13, 0.5, mats.body, -0.22, -0.06, 0.2));
  arms.add(box(0.13, 0.13, 0.5, mats.body, 0.22, -0.06, 0.2));
  body.add(arms);
  const gunHolder = new THREE.Group(); gunHolder.position.set(0.12, 1.22, 0.45); body.add(gunHolder);
  root.userData = { body, legL, legR, headG, arms, gunHolder, gunKey: null, phase: 0 };
  return root;
}
function nameSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const x = c.getContext('2d');
  x.font = '600 26px Barlow, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = 'rgba(0,0,0,0.5)'; const w = x.measureText(text).width + 20; x.fillRect(128 - w / 2, 6, w, 36);
  x.fillStyle = color; x.fillText(text, 128, 25);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.3, 1); s.position.y = 2.25; s.renderOrder = 5;
  return s;
}

const avatars = new Map(); // id -> {root, team, tag}
function ensureAvatar(p) {
  let a = avatars.get(p.id);
  if (a && a.team !== p.tm) { scene.remove(a.root); avatars.delete(p.id); a = null; }
  if (!a) {
    const root = makeAvatar(p.tm); scene.add(root);
    a = { root, team: p.tm, tag: null, name: p.n, deadT: 0 };
    avatars.set(p.id, a);
  }
  if (a.name !== p.n && a.tag) { a.root.remove(a.tag); a.tag = null; }
  a.name = p.n;
  return a;
}

// bomb model
const bombMesh = new THREE.Group();
{
  bombMesh.add(box(0.5, 0.22, 0.34, new THREE.MeshStandardMaterial({ color: '#3b3a2a', roughness: 0.7 }), 0, 0.11, 0));
  bombMesh.add(box(0.22, 0.06, 0.16, new THREE.MeshStandardMaterial({ color: '#111' }), 0.05, 0.25, 0));
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.04), new THREE.MeshBasicMaterial({ color: '#ff2a1a' }));
  led.position.set(-0.17, 0.25, 0); bombMesh.add(led); bombMesh.userData.led = led;
  bombMesh.visible = false; scene.add(bombMesh);
}
const bombLight = new THREE.PointLight('#ff3a20', 0, 6); scene.add(bombLight);

// ======================================================================= first-person viewmodel
const vm = new THREE.Group(); camera.add(vm);
const vmGunHolder = new THREE.Group(); vm.add(vmGunHolder);
const vmArmMat = new THREE.MeshStandardMaterial({ color: '#a8592a', roughness: 0.85 });
const vmHand = box(0.09, 0.09, 0.32, vmArmMat, 0.02, -0.12, 0.12); vm.add(vmHand);
vm.position.set(0.24, -0.24, -0.42);
let vmKey = null;
const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
vm.add(flash);
const flashLight = new THREE.PointLight('#ffc070', 0, 8); camera.add(flashLight); flashLight.position.set(0.2, -0.1, -0.8);
function setViewmodel(key) {
  if (vmKey === key) return;
  vmKey = key;
  vmGunHolder.clear();
  const g = gunModel(key, 0.75);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.material = o.material.clone(); o.material.depthTest = true; } });
  vmGunHolder.add(g);
  const L = { sidearm: 0.22, cannon: 0.3, vector: 0.45, raptor: 0.7, longbow: 0.95 }[key] || 0.3;
  flash.position.set(0, 0.0, -L * 0.75 - 0.08);
  vmArmMat.color.set(me.team === 'D' ? '#2f6f8f' : '#a8592a');
}

// ======================================================================= effects
const fx = [];
const tracerMat = new THREE.LineBasicMaterial({ color: '#ffe3a0', transparent: true, opacity: 0.85 });
function tracer(o, e) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...o), new THREE.Vector3(...e)]);
  const l = new THREE.Line(g, tracerMat.clone()); scene.add(l);
  fx.push({ obj: l, life: 0.07, max: 0.07, kind: 'fade' });
}
const puffGeo = new THREE.SphereGeometry(0.08, 6, 4);
function impact(p, blood) {
  for (let i = 0; i < (blood ? 6 : 4); i++) {
    const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: blood ? '#a3121a' : '#d9c3a0', transparent: true }));
    m.position.set(...p);
    scene.add(m);
    fx.push({ obj: m, life: 0.35, max: 0.35, kind: 'puff', v: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3) });
  }
}
function explosionFx(x, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true }));
  m.position.set(x, 1, z); scene.add(m);
  fx.push({ obj: m, life: 1.4, max: 1.4, kind: 'boom' });
  const l = new THREE.PointLight('#ff8a30', 60, 60); l.position.set(x, 4, z); scene.add(l);
  fx.push({ obj: l, life: 1.2, max: 1.2, kind: 'light' });
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.life -= dt; const k = Math.max(0, f.life / f.max);
    if (f.kind === 'fade') f.obj.material.opacity = 0.85 * k;
    if (f.kind === 'puff') { f.v.y -= 9 * dt; f.obj.position.addScaledVector(f.v, dt); f.obj.material.opacity = k; }
    if (f.kind === 'boom') { const s = 1 + (1 - k) * 18; f.obj.scale.setScalar(s); f.obj.material.opacity = k * 0.8; }
    if (f.kind === 'light') f.obj.intensity = 60 * k;
    if (f.life <= 0) { scene.remove(f.obj); f.obj.geometry?.dispose?.(); fx.splice(i, 1); }
  }
}

// ======================================================================= audio (procedural)
let actx = null, master = null, noiseBuf = null;
function initAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0.55; master.connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 1.5, actx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // ambient desert wind
    const src = actx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 0.6;
    const g = actx.createGain(); g.gain.value = 0.035;
    const lfo = actx.createOscillator(); lfo.frequency.value = 0.07; const lg = actx.createGain(); lg.gain.value = 250; lfo.connect(lg).connect(f.frequency); lfo.start();
    src.connect(f).connect(g).connect(master); src.start();
  } catch { actx = null; }
}
function sfxShot(key, vol = 1, pan = 0) {
  if (!actx) return;
  const t = actx.currentTime;
  const prof = { sidearm: [1800, 0.12, 0.5], cannon: [900, 0.22, 0.8], vector: [2200, 0.08, 0.45], raptor: [1300, 0.14, 0.7], longbow: [600, 0.45, 1] }[key] || [1500, 0.1, 0.6];
  const src = actx.createBufferSource(); src.buffer = noiseBuf;
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(prof[0] * 2.5, t); f.frequency.exponentialRampToValueAtTime(prof[0] * 0.3, t + prof[1]);
  const g = actx.createGain(); g.gain.setValueAtTime(prof[2] * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + prof[1] * 1.6);
  const p = actx.createStereoPanner ? actx.createStereoPanner() : null;
  let node = src.connect(f).connect(g);
  if (p) { p.pan.value = pan; node = node.connect(p); }
  node.connect(master);
  src.start(t, Math.random() * 0.5, prof[1] * 2);
  // thump
  const o = actx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
  const og = actx.createGain(); og.gain.setValueAtTime(0.5 * vol * prof[2], t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  o.connect(og).connect(master); o.start(t); o.stop(t + 0.16);
}
function tone(freq, dur, type = 'sine', vol = 0.2, when = 0) {
  if (!actx) return;
  const t = actx.currentTime + when;
  const o = actx.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = actx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function sfxBoom() {
  if (!actx) return;
  const t = actx.currentTime;
  const src = actx.createBufferSource(); src.buffer = noiseBuf;
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1200, t); f.frequency.exponentialRampToValueAtTime(60, t + 1.4);
  const g = actx.createGain(); g.gain.setValueAtTime(1.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
  src.connect(f).connect(g).connect(master); src.start(t);
}
const sfx = {
  hit: () => tone(1400, 0.05, 'square', 0.08),
  head: () => { tone(2200, 0.06, 'square', 0.1); tone(1600, 0.08, 'triangle', 0.1, 0.03); },
  hurt: () => tone(180, 0.12, 'sawtooth', 0.12),
  reload: () => { tone(500, 0.04, 'square', 0.06); tone(320, 0.05, 'square', 0.06, 0.35); tone(700, 0.04, 'square', 0.07, 0.7); },
  empty: () => tone(900, 0.03, 'square', 0.05),
  buy: () => { tone(880, 0.06, 'triangle', 0.12); tone(1320, 0.08, 'triangle', 0.1, 0.06); },
  beep: (hi) => tone(hi ? 1900 : 1500, 0.07, 'square', 0.09),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.15, i * 0.12)),
  lose: () => [440, 370, 311, 262].forEach((f, i) => tone(f, 0.35, 'triangle', 0.13, i * 0.14)),
  step: () => { if (!actx) return; const t = actx.currentTime; const s = actx.createBufferSource(); s.buffer = noiseBuf; const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 300; const g = actx.createGain(); g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08); s.connect(f).connect(g).connect(master); s.start(t, Math.random(), 0.1); },
  plant: () => tone(1000, 0.05, 'square', 0.06),
};

// ======================================================================= local player state
const me = {
  team: 'T', x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, alive: false, onGround: true,
  primary: null, secondary: 'sidearm', cur: 'secondary', ammo: {}, reloadT: 0, fireT: 0, bloom: 0, recoilP: 0, recoilY: 0,
  scoped: false, using: false, stepT: 0, lastWeaponKey: null, money: 800, hp: 100, armor: 0, kit: false,
};
function curWeaponKey() { return me.cur === 'primary' && me.primary ? me.primary : me.secondary; }
function ammoFor(k) { if (!me.ammo[k]) me.ammo[k] = { mag: S.WEAPONS[k].mag, res: S.WEAPONS[k].reserve }; return me.ammo[k]; }
function refillAll() { me.ammo = {}; }

// ======================================================================= input
const keys = new Set();
let mouseDown = false, lookMode = 'free';
const cursor = { x: 0.5, y: 0.5, inside: false };
const touchState = { move: [0, 0], fire: false };
addEventListener('keydown', (e) => {
  if (!joined) return;
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'escape' || k === 'p') {
    if (k === 'escape' && !ui.buy.classList.contains('hidden')) { toggleBuy(false); return; }
    setPaused(!paused); return;
  }
  if (paused) return;
  if (k === 'tab') { e.preventDefault(); ui.sb.classList.remove('hidden'); renderScoreboard(); return; }
  keys.add(e.code);
  if (k === 'b') toggleBuy();
  if (k === 'r') startReload();
  if (k === '1') switchWeapon('primary');
  if (k === '2') switchWeapon('secondary');
  if (k === 'q') switchWeapon(me.cur === 'primary' ? 'secondary' : 'primary');
  if (k === 'e') setUse(true);
  if (k === ' ' && !me.alive) cycleSpectate();
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  const k = e.key.toLowerCase();
  if (k === 'tab') ui.sb.classList.add('hidden');
  if (k === 'e') setUse(false);
});
addEventListener('blur', () => { keys.clear(); mouseDown = false; setUse(false); });
canvas.addEventListener('mousedown', (e) => {
  if (!joined || paused) return;
  if (e.button === 0) { mouseDown = true; if (!me.alive) cycleSpectate(); }
  if (e.button === 2) toggleScope();
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
const SENS = 0.0022;
addEventListener('mousemove', (e) => {
  if (!joined || isTouch || paused) return;
  cursor.x = e.clientX / innerWidth; cursor.y = e.clientY / innerHeight; cursor.inside = true;
  if (!ui.buy.classList.contains('hidden')) return;
  const s = SENS * (me.scoped ? 0.35 : 1);
  me.yaw -= e.movementX * s; me.pitch -= e.movementY * s;
  me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch));
});

// touch controls
function setupTouch() {
  ui.touch.classList.remove('hidden');
  const stick = $('stick'), knob = $('stick-knob');
  let stickId = null, lookId = null, lx = 0, ly = 0;
  stick.addEventListener('touchstart', (e) => { e.preventDefault(); stickId = e.changedTouches[0].identifier; }, { passive: false });
  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        const r = stick.getBoundingClientRect();
        let dx = (t.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
        const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
        touchState.move = [dx, dy];
        knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
      } else if (t.identifier === lookId) {
        const s = 0.006 * (me.scoped ? 0.35 : 1);
        me.yaw -= (t.clientX - lx) * s; me.pitch -= (t.clientY - ly) * s;
        me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch));
        lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: false });
  canvas.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) if (lookId === null && t.clientX > innerWidth * 0.35) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
    if (!me.alive) cycleSpectate();
  }, { passive: true });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { stickId = null; touchState.move = [0, 0]; knob.style.transform = ''; }
      if (t.identifier === lookId) lookId = null;
    }
  };
  addEventListener('touchend', end); addEventListener('touchcancel', end);
  const hold = (id, on, off) => { const b = $(id); b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('on'); on(); const t = e.changedTouches[0]; if (lookId === null && id === 't-fire') { lookId = t.identifier; lx = t.clientX; ly = t.clientY; } }, { passive: false }); b.addEventListener('touchend', (e) => { e.preventDefault(); b.classList.remove('on'); off && off(); }); };
  hold('t-fire', () => { touchState.fire = true; }, () => { touchState.fire = false; });
  hold('t-jump', () => { keys.add('Space'); setTimeout(() => keys.delete('Space'), 120); });
  hold('t-reload', startReload);
  hold('t-use', () => setUse(true), () => setUse(false));
  hold('t-swap', () => switchWeapon(me.cur === 'primary' ? 'secondary' : 'primary'));
  hold('t-scope', toggleScope);
  hold('t-buy', () => toggleBuy());
  hold('t-score', () => { ui.sb.classList.toggle('hidden'); renderScoreboard(); });
}

function setUse(on) { if (me.using === on) return; me.using = on; send({ t: 'use', on }); }
function switchWeapon(slot) {
  if (slot === 'primary' && !me.primary) return;
  if (me.cur === slot) return;
  me.cur = slot; me.reloadT = 0; me.scoped = false; me.fireT = Math.max(me.fireT, 0.35);
  me.drawT = 0.35;
}
function toggleScope() { if (S.WEAPONS[curWeaponKey()].scope && me.alive) me.scoped = !me.scoped; }
function startReload() {
  const k = curWeaponKey(), w = S.WEAPONS[k], a = ammoFor(k);
  if (me.reloadT > 0 || a.mag >= w.mag || a.res <= 0 || !me.alive) return;
  me.reloadT = w.reload; me.scoped = false; sfx.reload();
}

// ======================================================================= buy menu
const ITEM_STATS = {
  sidearm: 'Default · 12 rds', cannon: 'High damage · 7 rds', vector: 'Fast fire · +$600 kills', raptor: 'All-rounder · 30 rds', longbow: 'One-shot body · scoped',
  armor: '100 armor + helmet', kit: 'Defuse in 3.5s',
};
function buildBuy() {
  for (const list of document.querySelectorAll('.buy-list')) {
    list.innerHTML = '';
    const cat = list.dataset.cat;
    const items = cat === 'gear' ? Object.keys(S.GEAR) : Object.keys(S.WEAPONS).filter((k) => S.WEAPONS[k].slot === cat);
    for (const k of items) {
      const it = S.WEAPONS[k] || S.GEAR[k];
      const b = document.createElement('button');
      b.className = 'buy-item'; b.dataset.item = k;
      b.innerHTML = `<span class="bi-top"><span>${it.name}</span><span class="bi-price">$${it.price}</span></span><span class="bi-stats">${ITEM_STATS[k]}</span>`;
      b.onclick = () => { send({ t: 'buy', item: k }); sfx.buy(); };
      list.appendChild(b);
    }
  }
}
buildBuy();
$('buy-close').onclick = () => toggleBuy(false);
function toggleBuy(force) {
  const open = force ?? ui.buy.classList.contains('hidden');
  if (open && (net.last?.ph !== 'buy' || !me.alive)) { flashHint('Buying is only allowed during the buy phase'); return; }
  ui.buy.classList.toggle('hidden', !open);
}
function refreshBuy() {
  if (ui.buy.classList.contains('hidden')) return;
  $('buy-money').textContent = '$' + me.money;
  for (const b of ui.buy.querySelectorAll('.buy-item')) {
    const k = b.dataset.item, it = S.WEAPONS[k] || S.GEAR[k];
    const owned = k === me.primary || k === me.secondary || (k === 'armor' && me.armor >= 100) || (k === 'kit' && me.kit);
    const blocked = (k === 'kit' && me.team !== 'D');
    b.classList.toggle('owned', owned);
    b.disabled = owned || blocked || me.money < it.price;
    if (k === 'kit') b.classList.toggle('hidden', me.team !== 'D');
  }
}

// ======================================================================= net handling
let lastPhase = null, spectateIdx = 0, spectateId = null;
function onNet(m) {
  if (m.t === 'welcome') {
    myId = m.id; joined = true;
    ui.menu.classList.add('hidden'); ui.hud.classList.remove('hidden'); document.body.classList.add('ingame');
    if (isTouch) setupTouch();
    return;
  }
  if (m.t === 'error') { ui.status.textContent = m.msg; ui.join.disabled = false; return; }
  if (m.t === 'snap') {
    m.recv = performance.now() / 1000;
    net.snaps.push(m); if (net.snaps.length > 30) net.snaps.shift();
    net.last = m;
    applyYou(m);
    if (!net.gotFirst) { net.gotFirst = true; if (m.ph === 'buy' && me.alive) toggleBuy(true); }
    return;
  }
  if (m.t === 'shot') {
    if (m.id === myId) { if (m.hitP) impact(m.e, true); return; }
    tracer(m.o, m.e); impact(m.e, m.hitP);
    const d = Math.hypot(m.o[0] - me.x, m.o[2] - me.z);
    const ang = Math.atan2(m.o[0] - me.x, m.o[2] - me.z) - me.yaw;
    sfxShot(m.w, Math.max(0.05, 1 - d / 70) * 0.8, Math.max(-1, Math.min(1, -Math.sin(ang))));
    const a = avatars.get(m.id); if (a) a.flashT = 0.05;
    return;
  }
  if (m.t === 'hitConfirm') {
    const hm = $('hitmarker'); hm.classList.toggle('head', !!m.head); hm.classList.add('show');
    setTimeout(() => hm.classList.remove('show'), 90);
    m.head ? sfx.head() : sfx.hit();
    return;
  }
  if (m.t === 'hurt') {
    const d = $('damage'); d.style.transition = 'none'; d.style.opacity = Math.min(1, 0.3 + m.dmg / 60);
    requestAnimationFrame(() => { d.style.transition = 'opacity 600ms'; d.style.opacity = 0; });
    sfx.hurt(); me.recoilP += 0.03;
    return;
  }
  if (m.t === 'kill') { addKill(m); return; }
  if (m.t === 'event') onEvent(m);
}
function applyYou(m) {
  const y = m.you; if (!y) return;
  const wasAlive = me.alive;
  me.team = y.team; me.money = y.money; me.armor = y.armor; me.hp = y.hp; me.kit = y.kit;
  if (me.primary !== y.primary && y.primary) { me.cur = 'primary'; me.ammo[y.primary] = null; }
  if (me.secondary !== y.secondary) { me.ammo[y.secondary] = null; if (!y.primary) me.cur = 'secondary'; }
  me.primary = y.primary; me.secondary = y.secondary;
  if (!me.primary && me.cur === 'primary') me.cur = 'secondary';
  me.alive = y.alive; me.useProg = y.useProg;
  if (y.force || (!wasAlive && y.alive)) {
    me.x = y.x; me.z = y.z; me.y = 0; me.vy = 0; me.yaw = y.yaw; me.pitch = 0; me.vx = me.vz = 0;
  }
  if (wasAlive && !y.alive) { me.scoped = false; setUse(false); spectateId = null; }
  refreshBuy();
}
function onEvent(m) {
  const mine = me.team;
  switch (m.kind) {
    case 'roundStart':
      refillAll(); me.reloadT = 0; me.bloom = 0; me.scoped = false;
      showBanner(`Round ${m.round}`, 'Buy phase — gear up', null, 2200);
      if (me.alive) toggleBuy(true);
      break;
    case 'live': toggleBuy(false); showBanner('Go go go', me.team === 'T' ? 'Plant the bomb at A or B' : 'Defend both sites', me.team, 1600); break;
    case 'planted': showBanner('Bomb planted', `Site ${m.site} · ${S.ROUND.bombTime}s to detonation`, 'warn', 2500); break;
    case 'defused': showBanner('Bomb defused', m.by, 'D', 2500); break;
    case 'exploded': explosionFx(net.last?.bomb.x ?? 0, net.last?.bomb.z ?? 0); sfxBoom(); break;
    case 'roundEnd': {
      const won = m.winner === mine;
      showBanner(won ? 'Round won' : 'Round lost', m.reason, m.winner, 4000);
      won ? sfx.win() : sfx.lose();
      break;
    }
    case 'halftime': showBanner('Halftime', 'Switching sides', null, 3500); break;
    case 'matchEnd': {
      const won = m.winner === mine;
      showBanner(m.winner === 'draw' ? 'Draw' : won ? 'Victory' : 'Defeat', `Final ${m.score.T} – ${m.score.D} · new match soon`, m.winner === 'draw' ? null : m.winner, 11000);
      ui.sb.classList.remove('hidden'); renderScoreboard(); setTimeout(() => ui.sb.classList.add('hidden'), 10000);
      break;
    }
    case 'joined': addFeedText(`${m.name} joined ${m.team === 'T' ? 'Attackers' : 'Defenders'}`); break;
    case 'left': addFeedText(`Player left — ${m.name} took over`); break;
    case 'bombPickup': flashHint('You picked up the bomb'); break;
  }
}
let bannerTimer = null;
function showBanner(title, sub, cls, ms = 2500) {
  const b = $('banner'); b.className = cls || ''; $('banner-title').textContent = title; $('banner-sub').textContent = sub || '';
  b.classList.remove('hidden'); void b.offsetWidth;
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.add('hidden'), ms);
}
let hintTimer = null;
function flashHint(t) { const h = $('hint'); h.textContent = t; h.classList.remove('hidden'); clearTimeout(hintTimer); hintTimer = setTimeout(() => h.classList.add('hidden'), 1800); }
const WNAME = { sidearm: 'P-9', cannon: 'Cannon', vector: 'Vector', raptor: 'Raptor', longbow: 'Longbow', bomb: 'Bomb' };
function addKill(m) {
  const li = document.createElement('li');
  const mineK = m.killer === myName();
  if (mineK || m.vid === myId) li.className = 'mine';
  li.innerHTML = `<span class="${m.kt || ''}"></span><span class="w">${WNAME[m.w] || m.w}${m.head ? ' · HS' : ''}</span><span class="${m.vt}"></span>`;
  li.children[0].textContent = m.killer; li.children[2].textContent = m.victim;
  pushFeed(li);
}
function addFeedText(t) { const li = document.createElement('li'); li.textContent = t; li.style.color = 'var(--muted)'; pushFeed(li); }
function pushFeed(li) { const kf = $('killfeed'); kf.appendChild(li); while (kf.children.length > 6) kf.firstChild.remove(); setTimeout(() => li.remove(), 7000); }
function myName() { return net.last?.pl.find((p) => p.id === myId)?.n; }

// ======================================================================= local simulation
const tmpV = new THREE.Vector3();
let sendT = 0;
function simulateMe(dt) {
  const snap = net.last; if (!snap) return;
  const frozen = snap.ph === 'buy' || snap.ph === 'matchEnd';
  const k = curWeaponKey(), w = S.WEAPONS[k];
  if (me.alive) {
    // movement
    let fx = 0, fz = 0;
    if (keys.has('KeyW')) fz += 1; if (keys.has('KeyS')) fz -= 1;
    if (keys.has('KeyD')) fx += 1; if (keys.has('KeyA')) fx -= 1;
    fx += touchState.move[0]; fz -= touchState.move[1];
    const l = Math.hypot(fx, fz); if (l > 1) { fx /= l; fz /= l; }
    const walk = keys.has('ShiftLeft') || keys.has('ShiftRight') || me.using;
    const speed = frozen ? 0 : w.speed * (walk ? 0.5 : 1) * (me.scoped ? 0.6 : 1);
    const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
    // forward = (sin yaw, cos yaw); right = (-cos yaw, sin yaw)
    let tvx = (sy * fz - cy * fx) * speed, tvz = (cy * fz + sy * fx) * speed;
    if (frozen || me.using) { tvx = 0; tvz = 0; }
    const accel = me.onGround ? 14 : 3;
    me.vx += (tvx - me.vx) * Math.min(1, accel * dt);
    me.vz += (tvz - me.vz) * Math.min(1, accel * dt);
    [me.x, me.z] = S.moveCollide(me.x, me.z, me.vx * dt, me.vz * dt);
    if (keys.has('Space') && me.onGround && !frozen) { me.vy = 5.2; me.onGround = false; }
    me.vy -= 16 * dt; me.y += me.vy * dt;
    if (me.y <= 0) { me.y = 0; me.vy = 0; me.onGround = true; }
    const hs = Math.hypot(me.vx, me.vz);
    me.moving = hs > 0.5;
    if (me.onGround && hs > 3.5) { me.stepT -= dt * hs; if (me.stepT <= 0) { me.stepT = 2.3; sfx.step(); } }
    // weapons
    me.fireT -= dt; me.drawT = Math.max(0, (me.drawT || 0) - dt);
    const a = ammoFor(k);
    if (me.reloadT > 0) {
      me.reloadT -= dt;
      if (me.reloadT <= 0) { const need = w.mag - a.mag, take = Math.min(need, a.res); a.mag += take; a.res -= take; }
    }
    const trigger = (mouseDown && ui.buy.classList.contains('hidden')) || touchState.fire;
    if (trigger && !frozen && me.fireT <= 0 && me.reloadT <= 0 && me.drawT <= 0) {
      if (a.mag <= 0) { if (me.fireT < -0.2) { sfx.empty(); startReload(); me.fireT = 0.2; } }
      else if (w.auto || !me.triggerHeld) {
        fireShot(k, w, a);
      }
    }
    me.triggerHeld = trigger;
    if (!trigger) me.bloom = Math.max(0, me.bloom - dt * 3.5);
    else me.bloom = Math.max(0, me.bloom - dt * 0.8);
    // edge-turn: keeps turning while the cursor rests near the screen edge (no pointer lock in the preview)
    if (!isTouch && cursor.inside && ui.buy.classList.contains('hidden')) {
      const E = 0.07, rate = 2.6 * (me.scoped ? 0.35 : 1);
      if (cursor.x < E) me.yaw += rate * dt * (1 - cursor.x / E + 0.3);
      else if (cursor.x > 1 - E) me.yaw -= rate * dt * (1 - (1 - cursor.x) / E + 0.3);
      if (cursor.y < E) me.pitch = Math.min(1.45, me.pitch + rate * 0.5 * dt);
      else if (cursor.y > 1 - E) me.pitch = Math.max(-1.45, me.pitch - rate * 0.5 * dt);
    }
    // recoil recovery
    const rec = Math.min(1, dt * 7);
    me.pitch -= me.recoilP * rec; me.recoilP -= me.recoilP * rec;
    me.yaw -= me.recoilY * rec; me.recoilY -= me.recoilY * rec;
    // use hint
    updateUseHint(snap);
  }
  sendT -= dt;
  if (sendT <= 0) {
    sendT = 1 / 30;
    send({ t: 'state', x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(4), pitch: +me.pitch.toFixed(4), mv: me.moving ? 1 : 0, c: me.cur });
  }
}
function fireShot(k, w, a) {
  me.fireT = 60 / w.rpm;
  a.mag--;
  const moveF = Math.min(1, Math.hypot(me.vx, me.vz) / 5) + (me.onGround ? 0 : 1.2);
  let spread = w.spread + w.moveSpread * moveF + me.bloom * w.recoil * 0.9;
  if (w.scope && !me.scoped) spread += 0.06;
  me.bloom = Math.min(8, me.bloom + 1);
  const dirYaw = me.yaw + (Math.random() - 0.5) * 2 * spread, dirPitch = me.pitch + (Math.random() - 0.5) * 2 * spread;
  const d = [Math.sin(dirYaw) * Math.cos(dirPitch), Math.sin(dirPitch), Math.cos(dirYaw) * Math.cos(dirPitch)];
  const o = [me.x, me.y + S.EYE, me.z];
  send({ t: 'shoot', o, d, w: k });
  // local prediction of tracer end point vs world + players
  let tEnd = S.rayWorld(o, d, 250); let hitP = false;
  for (const p of renderPlayers) { if (p.id === myId || !p.a) continue; const h = S.rayPlayer(o, d, p); if (h && h.t < tEnd) { tEnd = h.t; hitP = true; } }
  const e = [o[0] + d[0] * tEnd, o[1] + d[1] * tEnd, o[2] + d[2] * tEnd];
  camera.updateMatrixWorld();
  const muzzle = flash.getWorldPosition(new THREE.Vector3());
  tracer([muzzle.x, muzzle.y, muzzle.z], e);
  if (!hitP) impact(e, false);
  me.recoilP -= w.recoil * (1 + Math.random() * 0.5) * (me.bloom < 3 ? 0.6 : 1);
  me.pitch += w.recoil * 1.0;
  me.yaw += (Math.random() - 0.5) * w.recoil * 0.8;
  vmKick = Math.min(1, vmKick + 0.6);
  flash.material.opacity = 1; flash.rotation.z = Math.random() * 3; flashLight.intensity = 4;
  sfxShot(k, 1, 0);
  if (w.scope) me.scoped = false;
  if (a.mag <= 0) setTimeout(startReload, 250);
}
function updateUseHint(snap) {
  const b = snap.bomb;
  let hint = '';
  if (me.team === 'T' && b.s === 'carried' && b.c === myId) hint = S.inSite(me.x, me.z) ? 'Hold E to plant the bomb' : '';
  if (me.team === 'D' && b.s === 'planted' && Math.hypot(me.x - b.x, me.z - b.z) < 1.8) hint = 'Hold E to defuse';
  const pr = $('progress');
  if (me.useProg > 0) {
    const total = me.team === 'T' ? S.ROUND.plantTime : (me.kit ? S.ROUND.defuseKitTime : S.ROUND.defuseTime);
    pr.classList.remove('hidden'); $('progress-label').textContent = me.team === 'T' ? 'Planting' : 'Defusing';
    $('progress-fill').style.width = Math.min(100, (me.useProg / total) * 100) + '%';
    if (Math.random() < 0.08) sfx.plant();
  } else pr.classList.add('hidden');
  const h = $('hint');
  if (hint && me.useProg <= 0) { h.textContent = hint; h.classList.remove('hidden'); h.dataset.use = '1'; }
  else if (h.dataset.use) { h.classList.add('hidden'); delete h.dataset.use; }
}

// ======================================================================= interpolation & rendering of others
let renderPlayers = [];
function interpPlayers() {
  const sn = net.snaps; if (!sn.length) return [];
  const rt = performance.now() / 1000 - 0.1;
  let a = sn[sn.length - 1], b = null;
  for (let i = sn.length - 1; i > 0; i--) { if (sn[i - 1].recv <= rt) { a = sn[i - 1]; b = sn[i]; break; } }
  if (!b) return a.pl.map((p) => ({ ...p }));
  const t = Math.max(0, Math.min(1, (rt - a.recv) / (b.recv - a.recv || 1)));
  const prev = new Map(a.pl.map((p) => [p.id, p]));
  return b.pl.map((p) => {
    const q = prev.get(p.id); if (!q) return { ...p };
    let dy = p.yw - q.yw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    return { ...p, x: q.x + (p.x - q.x) * t, y: q.y + (p.y - q.y) * t, z: q.z + (p.z - q.z) * t, yw: q.yw + dy * t, pt: q.pt + (p.pt - q.pt) * t };
  });
}
function updateAvatars(dt) {
  renderPlayers = interpPlayers();
  const seen = new Set();
  for (const p of renderPlayers) {
    seen.add(p.id);
    const a = ensureAvatar(p);
    const r = a.root, u = r.userData;
    const isMe = p.id === myId;
    const fpv = isMe && me.alive;
    r.visible = !fpv;
    if (isMe && me.alive) { r.position.set(me.x, me.y, me.z); continue; }
    r.position.set(p.x, p.y, p.z);
    r.rotation.y = p.yw;
    // gun
    if (u.gunKey !== p.w) { u.gunHolder.clear(); u.gunHolder.add(gunModel(p.w, 1.1)); u.gunKey = p.w; u.gunHolder.rotation.y = Math.PI; }
    u.arms.rotation.x = -p.pt * 0.8; u.gunHolder.rotation.x = -p.pt * 0.8; u.headG.rotation.x = -p.pt * 0.5;
    if (p.a) {
      a.deadT = 0;
      u.body.rotation.set(0, 0, 0); u.body.position.y = p.u ? -0.4 : 0;
      if (p.mv) { u.phase += dt * 10; } else u.phase *= 0.8;
      u.legL.rotation.x = Math.sin(u.phase) * 0.6; u.legR.rotation.x = -Math.sin(u.phase) * 0.6;
    } else {
      a.deadT = Math.min(1, a.deadT + dt * 3);
      u.body.rotation.x = -Math.PI / 2 * a.deadT; u.body.position.y = 0.15 * a.deadT;
    }
    // teammate name tags
    const showTag = p.tm === me.team && !isMe && p.a;
    if (showTag && !a.tag) { a.tag = nameSprite(p.n, p.tm === 'T' ? '#f0a070' : '#8fd3ef'); r.add(a.tag); }
    if (a.tag) a.tag.visible = showTag;
  }
  for (const [id, a] of avatars) if (!seen.has(id)) { scene.remove(a.root); avatars.delete(id); }
}
function updateBomb(dt) {
  const b = net.last?.bomb; if (!b) { bombMesh.visible = false; return; }
  if (b.s === 'dropped' || b.s === 'planted') {
    bombMesh.visible = true; bombMesh.position.set(b.x, 0, b.z);
    if (b.s === 'planted') {
      const rate = b.tm > 20 ? 1 : b.tm > 10 ? 2 : b.tm > 5 ? 4 : 8;
      bombBlink += dt * rate;
      const on = (bombBlink % 1) < 0.25;
      bombMesh.userData.led.material.color.set(on ? '#ff2a1a' : '#401010');
      bombLight.position.set(b.x, 0.6, b.z); bombLight.intensity = on ? 3 : 0;
      if (on && !lastBlinkOn) { const d = Math.hypot(b.x - me.x, b.z - me.z); if (d < 45) sfx.beep(b.tm < 10); }
      lastBlinkOn = on;
    } else { bombLight.intensity = 0; bombMesh.userData.led.material.color.set('#401010'); }
  } else { bombMesh.visible = false; bombLight.intensity = 0; }
}
let bombBlink = 0, lastBlinkOn = false;

// ======================================================================= camera
let vmKick = 0, bobT = 0, menuOrbit = 0;
function cycleSpectate() { spectateIdx++; spectateId = null; }
function updateCamera(dt) {
  if (!joined) {
    menuOrbit += dt * 0.05;
    camera.position.set(MW / 2 + Math.sin(menuOrbit) * 55, 34, MH / 2 + Math.cos(menuOrbit) * 55);
    camera.lookAt(MW / 2, 0, MH / 2);
    vm.visible = false;
    return;
  }
  if (me.alive) {
    camera.position.set(me.x, me.y + S.EYE, me.z);
    camera.rotation.set(me.pitch, me.yaw + Math.PI, 0);
    const k = curWeaponKey();
    setViewmodel(k);
    vm.visible = !me.scoped;
    const hs = Math.hypot(me.vx, me.vz);
    bobT += dt * hs * 1.6;
    const bob = me.onGround ? Math.min(1, hs / 6) : 0;
    vmKick *= Math.pow(0.0005, dt);
    const reloadDip = me.reloadT > 0 ? Math.sin(Math.min(1, 1 - me.reloadT / S.WEAPONS[k].reload) * Math.PI) * 0.25 : 0;
    const drawDip = (me.drawT || 0) * 0.6;
    vm.position.set(0.24 + Math.sin(bobT) * 0.012 * bob, -0.24 + Math.abs(Math.cos(bobT)) * 0.012 * bob - reloadDip - drawDip, -0.42 + vmKick * 0.06);
    vm.rotation.set(vmKick * 0.12 + reloadDip * 0.8, 0, reloadDip * 0.5);
    flash.material.opacity *= Math.pow(0.0001, dt);
    flashLight.intensity *= Math.pow(0.0001, dt);
    const fov = me.scoped ? 22 : 78;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    $('spectate').classList.add('hidden');
  } else {
    vm.visible = false;
    if (camera.fov !== 78) { camera.fov = 78; camera.updateProjectionMatrix(); }
    const mates = renderPlayers.filter((p) => p.a && p.tm === me.team && p.id !== myId);
    const pool = mates.length ? mates : renderPlayers.filter((p) => p.a);
    let tgt = pool.find((p) => p.id === spectateId);
    if (!tgt && pool.length) { tgt = pool[spectateIdx % pool.length]; spectateId = tgt.id; }
    const sp = $('spectate');
    if (tgt) {
      const back = 3.2;
      let cx = tgt.x - Math.sin(tgt.yw) * back, cz = tgt.z - Math.cos(tgt.yw) * back;
      const dist = S.rayGrid(tgt.x, tgt.z, cx - tgt.x, cz - tgt.z, back);
      if (dist < back) { cx = tgt.x - Math.sin(tgt.yw) * (dist - 0.3); cz = tgt.z - Math.cos(tgt.yw) * (dist - 0.3); }
      camera.position.lerp(tmpV.set(cx, tgt.y + 2.3, cz), Math.min(1, dt * 8));
      camera.lookAt(tgt.x + Math.sin(tgt.yw) * 4, tgt.y + 1.3, tgt.z + Math.cos(tgt.yw) * 4);
      sp.innerHTML = '';
      sp.append(`Spectating ${tgt.n}`);
      const s = document.createElement('small'); s.textContent = net.last?.ph === 'buy' ? 'You will spawn next round' : 'Click / Space to switch player'; sp.appendChild(s);
      sp.classList.remove('hidden');
    } else {
      camera.position.set(MW / 2, 70, MH / 2 + 20); camera.lookAt(MW / 2, 0, MH / 2);
      sp.classList.add('hidden');
    }
  }
}

// ======================================================================= HUD
const radar = $('radar'), rctx = radar.getContext('2d');
const radarBase = document.createElement('canvas');
{
  radarBase.width = 200; radarBase.height = 182;
  const c = radarBase.getContext('2d'), sx = 200 / S.W, sz = 182 / S.H;
  for (let z = 0; z < S.H; z++) for (let x = 0; x < S.W; x++) {
    const v = S.GRID[z * S.W + x];
    if (v === 0) { c.fillStyle = S.inSite(x * S.TILE + 1, z * S.TILE + 1) ? 'rgba(200,70,50,0.45)' : 'rgba(230,210,180,0.32)'; c.fillRect(x * sx, z * sz, sx + 0.5, sz + 0.5); }
    if (v === 2) { c.fillStyle = 'rgba(120,80,40,0.7)'; c.fillRect(x * sx, z * sz, sx + 0.5, sz + 0.5); }
  }
  c.font = '700 14px Chakra Petch, sans-serif'; c.fillStyle = 'rgba(255,220,200,0.9)';
  for (const k of ['A', 'B']) { const s = S.SITES[k]; c.fillText(k, ((s.x0 + s.x1) / 2) * sx - 4, ((s.z0 + s.z1) / 2) * sz + 5); }
}
function drawRadar() {
  const w = radar.width, h = radar.height, sx = w / (S.W * S.TILE), sz = h / (S.H * S.TILE);
  rctx.clearRect(0, 0, w, h); rctx.drawImage(radarBase, 0, 0);
  const mates = renderPlayers.filter((p) => p.tm === me.team && p.a);
  for (const p of renderPlayers) {
    if (!p.a) continue;
    const mine = p.id === myId;
    const px = (mine ? me.x : p.x) * sx, pz = (mine ? me.z : p.z) * sz;
    let visible = p.tm === me.team;
    if (!visible) visible = mates.some((m) => Math.hypot(m.x - p.x, m.z - p.z) < 70 && S.losClear(m.x, m.z, p.x, p.z));
    if (!visible) continue;
    rctx.fillStyle = p.tm === 'T' ? '#e5793a' : '#4fb3d9';
    rctx.beginPath(); rctx.arc(px, pz, mine ? 4 : 3, 0, 7); rctx.fill();
    if (mine) {
      rctx.strokeStyle = '#fff'; rctx.lineWidth = 1.5; rctx.stroke();
      rctx.beginPath(); rctx.moveTo(px, pz); rctx.lineTo(px + Math.sin(me.yaw) * 10, pz + Math.cos(me.yaw) * 10); rctx.stroke();
    }
  }
  const b = net.last?.bomb;
  if (b && (b.s === 'planted' || (b.s === 'dropped' && me.team === 'T'))) {
    rctx.fillStyle = b.s === 'planted' ? '#ff3a2a' : '#f2c14e';
    rctx.fillRect(b.x * sx - 3, b.z * sz - 3, 6, 6);
  }
}
function fmtTime(t) { t = Math.max(0, Math.ceil(t)); return `${(t / 60) | 0}:${String(t % 60).padStart(2, '0')}`; }
let hudT = 0;
function updateHud(dt) {
  const s = net.last; if (!s) return;
  hudT -= dt;
  drawRadar();
  $('score-T').textContent = s.sc.T; $('score-D').textContent = s.sc.D;
  const clock = document.querySelector('.clock');
  const planted = s.bomb.s === 'planted';
  clock.classList.toggle('bomb', planted);
  $('timer').textContent = planted ? fmtTime(s.bomb.tm) : fmtTime(s.tm);
  $('phase-label').textContent = s.ph === 'buy' ? 'Buy phase' : planted ? 'Bomb' : s.ph === 'end' ? 'Round over' : s.ph === 'matchEnd' ? 'Match over' : 'Live';
  $('round-label').textContent = `Round ${s.r}`;
  if (hudT <= 0) {
    hudT = 0.25;
    for (const t of ['T', 'D']) {
      const el = $('pips-' + t), list = s.pl.filter((p) => p.tm === t);
      el.innerHTML = list.map((p) => `<i class="${p.a ? '' : 'dead'}"></i>`).join('');
    }
    if (!ui.sb.classList.contains('hidden')) renderScoreboard();
    $('buy-timer').textContent = s.ph === 'buy' ? `${Math.ceil(s.tm)}s left` : '';
  }
  $('money').textContent = '$' + me.money;
  $('hp').textContent = me.hp; $('hp').classList.toggle('low', me.hp <= 25);
  $('armor').textContent = me.armor;
  const tt = $('team-tag'); tt.className = me.team; tt.textContent = me.team === 'T' ? 'Attackers' : 'Defenders';
  const k = curWeaponKey(), a = ammoFor(k);
  $('weapon-name').textContent = S.WEAPONS[k].name + (me.reloadT > 0 ? ' · reloading' : '');
  $('mag').textContent = a.mag; $('reserve').textContent = a.res;
  $('ammo').classList.toggle('empty', a.mag === 0);
  $('bomb-tag').classList.toggle('hidden', !(s.bomb.s === 'carried' && s.bomb.c === myId));
  $('scope').classList.toggle('hidden', !me.scoped);
  $('crosshair').classList.toggle('hidden', me.scoped || !me.alive);
  const w = S.WEAPONS[k];
  const moveF = Math.min(1, Math.hypot(me.vx, me.vz) / 5) + (me.onGround ? 0 : 1.2);
  const spread = w.spread + w.moveSpread * moveF + me.bloom * w.recoil * 0.9;
  $('crosshair').style.setProperty('--gap', `${4 + spread * 380}px`);
  const lh = $('look-hint');
  lh.classList.toggle('hidden', isTouch || cursor.inside || !me.alive);
}
function renderScoreboard() {
  const s = net.last; if (!s) return;
  $('sb-score-T').textContent = s.sc.T; $('sb-score-D').textContent = s.sc.D;
  for (const t of ['T', 'D']) {
    const body = $('sb-' + t); body.innerHTML = '';
    for (const p of s.pl.filter((q) => q.tm === t).sort((a, b) => b.k - a.k)) {
      const tr = document.createElement('tr');
      tr.className = (p.a ? '' : 'dead') + (p.id === myId ? ' me' : '');
      const td = document.createElement('td'); td.textContent = p.n; if (p.b) { const b = document.createElement('span'); b.className = 'bot'; b.textContent = 'BOT'; td.appendChild(b); }
      tr.appendChild(td);
      for (const v of [p.k, p.d, t === me.team ? '$' + p.m : '—']) { const c = document.createElement('td'); c.textContent = v; tr.appendChild(c); }
      body.appendChild(tr);
    }
  }
}

// ======================================================================= main loop
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  step(dt);
  renderer.render(scene, camera);
}
function step(dt) {
  if (joined && !paused) simulateMe(dt);
  updateAvatars(dt);
  updateBomb(dt);
  updateCamera(dt);
  updateFx(dt);
  if (joined) updateHud(dt);
}
requestAnimationFrame(frame);

// test hooks
window.render_game_to_text = () => JSON.stringify({
  joined, myId, phase: net.last?.ph, timer: net.last?.tm, round: net.last?.r, score: net.last?.sc,
  me: { team: me.team, x: +me.x.toFixed(2), z: +me.z.toFixed(2), yaw: +me.yaw.toFixed(2), hp: me.hp, money: me.money, alive: me.alive, primary: me.primary, cur: curWeaponKey(), ammo: ammoFor(curWeaponKey()) },
  bomb: net.last?.bomb, players: net.last?.pl.length,
});
window.__game = { me, keys, net, send, setPaused, setDifficulty, get room() { return ws?.room; }, setLook: (m) => { lookMode = m; } };
document.addEventListener('mouseleave', () => { cursor.inside = false; });
