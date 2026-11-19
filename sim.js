// Offline single-player match simulation: rounds, economy, bomb, bots. Runs in the browser.
import * as S from './shared.js';

const TICK = 1 / 30;
const SNAP_EVERY = 1; // ticks (30 Hz)
const BOT_NAMES = ['Viper', 'Kestrel', 'Onyx', 'Rook', 'Mako', 'Juno', 'Talon', 'Nyx', 'Bishop', 'Cinder', 'Vega', 'Ghost', 'Rift', 'Sable', 'Echo', 'Drift', 'Flint', 'Hex', 'Orbit', 'Quill'];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
let simT = 0;
const now = () => simT;
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };


export const DIFFICULTY = {
  easy:   { label: 'Recruit', skill: 0.5,  react: 1.9,  fov: 0.85, range: 45,  head: 0.06, dmg: 0.7 },
  normal: { label: 'Regular', skill: 1.0,  react: 1.0,  fov: 1.15, range: 80,  head: 0.25, dmg: 1.0 },
  hard:   { label: 'Veteran', skill: 1.45, react: 0.75, fov: 1.35, range: 100, head: 0.4,  dmg: 1.0 },
  elite:  { label: 'Elite',   skill: 2.1,  react: 0.55, fov: 1.55, range: 120, head: 0.55, dmg: 1.1 },
};
let nextId = 1;

class Room {
  constructor(code, difficulty) {
    this.code = code;
    this.setDifficulty(difficulty || 'normal');
    this.players = new Map();
    this.tick = 0;
    this.emptySince = now();
    this.botNameIdx = (Math.random() * BOT_NAMES.length) | 0;
    this.resetMatch();
  }
  setDifficulty(key) {
    this.diffKey = DIFFICULTY[key] ? key : 'normal';
    this.diff = DIFFICULTY[this.diffKey];
    if (this.players) for (const p of this.players.values()) if (p.isBot) p.skill = this.diff.skill * rnd(0.88, 1.12);
  }
  resetMatch() {
    this.score = { T: 0, D: 0 };
    this.round = 0;
    this.lossStreak = { T: 0, D: 0 };
    for (const p of this.players.values()) {
      p.money = S.ECON.start; p.primary = null; p.secondary = 'sidearm'; p.armor = 0; p.kit = false;
      p.kills = 0; p.deaths = 0; p.alive = false;
    }
    this.startRound();
  }
  humans(team) { return [...this.players.values()].filter((p) => !p.isBot && (!team || p.team === team)); }
  bots(team) { return [...this.players.values()].filter((p) => p.isBot && (!team || p.team === team)); }
  team(team) { return [...this.players.values()].filter((p) => p.team === team); }

  newBot(team, money) {
    const name = 'BOT ' + BOT_NAMES[this.botNameIdx++ % BOT_NAMES.length];
    const p = makePlayer(name, team, null);
    p.isBot = true; p.money = money ?? S.ECON.start;
    p.skill = this.diff.skill * rnd(0.88, 1.12);
    this.players.set(p.id, p);
    return p;
  }
  rebalance() {
    for (const team of ['T', 'D']) {
      const hs = this.humans(team);
      let bs = this.bots(team);
      const need = Math.max(0, 5 - hs.length);
      while (bs.length > need) { const b = bs.pop(); this.players.delete(b.id); }
      const avg = this.team(team).length ? this.team(team).reduce((s, p) => s + p.money, 0) / this.team(team).length : S.ECON.start;
      while (bs.length < need) bs.push(this.newBot(team, Math.round(avg / 50) * 50));
    }
  }
  startRound() {
    this.round++;
    this.rebalance();
    this.phase = 'buy';
    this.timer = S.ROUND.buyTime;
    this.roundWinner = null;
    const ts = this.team('T');
    const carrier = ts.length ? pick(ts) : null;
    this.bomb = { state: carrier ? 'carried' : 'none', carrier: carrier?.id, x: 0, z: 0, timer: 0, site: null };
    this.planter = null;
    this.targetSite = pick(['A', 'B']);
    for (const team of ['T', 'D']) {
      const list = this.team(team);
      const sites = ['A', 'A', 'B', 'B', Math.random() < 0.5 ? 'A' : 'B'];
      list.forEach((p, i) => {
        const [tx, tz] = S.SPAWNS[team][i % 5];
        const [x, z] = S.tileCenter(tx, tz);
        Object.assign(p, { x: x + rnd(-0.3, 0.3), y: 0, z: z + rnd(-0.3, 0.3), hp: 100, alive: true, using: false, useProg: 0, pitch: 0 });
        p.yaw = team === 'T' ? Math.PI : 0; // T faces -z (north), D faces +z
        p.cur = p.primary ? 'primary' : 'secondary';
        p.brain = { path: null, pi: 0, goal: null, target: null, reactAt: 0, think: 0, site: sites[i % 5], hold: null, stuck: 0, lastPos: [x, z], alertYaw: null, alertUntil: 0, burst: 0 };
        p.roundMoney = p.money;
        if (p.isBot) botBuy(p);
      });
    }
    this.broadcast({ t: 'event', kind: 'roundStart', round: this.round });
    this.sendSnap(true);
  }
  endRound(winner, reason) {
    if (this.phase === 'end' || this.phase === 'matchEnd') return;
    this.phase = 'end';
    this.timer = S.ROUND.endTime;
    this.roundWinner = winner;
    this.score[winner]++;
    const loser = winner === 'T' ? 'D' : 'T';
    this.lossStreak[winner] = 0;
    this.lossStreak[loser] = Math.min(this.lossStreak[loser] + 1, 4);
    const lossPay = Math.min(S.ECON.loss + S.ECON.lossBonus * (this.lossStreak[loser] - 1), S.ECON.lossMax);
    for (const p of this.players.values()) {
      if (p.team === winner) addMoney(p, S.ECON.win);
      else addMoney(p, lossPay + (p.team === 'T' && this.bomb.state === 'exploded' ? 0 : 0));
      if (p.team === 'T' && this.bomb.state === 'defused') addMoney(p, 600); // plant consolation
    }
    this.broadcast({ t: 'event', kind: 'roundEnd', winner, reason, score: this.score });
  }
  afterRound() {
    const played = this.score.T + this.score.D;
    if (this.score.T >= S.ROUND.winRounds || this.score.D >= S.ROUND.winRounds || played >= S.ROUND.halftime * 2) {
      this.phase = 'matchEnd';
      this.timer = S.ROUND.matchEndTime;
      const w = this.score.T === this.score.D ? 'draw' : this.score.T > this.score.D ? 'T' : 'D';
      this.broadcast({ t: 'event', kind: 'matchEnd', winner: w, score: this.score });
      return;
    }
    // dead players lose gear
    for (const p of this.players.values()) if (!p.alive) { p.primary = null; p.secondary = 'sidearm'; p.armor = 0; p.kit = false; }
    if (played === S.ROUND.halftime) {
      for (const p of this.players.values()) {
        p.team = p.team === 'T' ? 'D' : 'T';
        p.money = S.ECON.start; p.primary = null; p.secondary = 'sidearm'; p.armor = 0; p.kit = false;
      }
      this.score = { T: this.score.D, D: this.score.T };
      this.lossStreak = { T: 0, D: 0 };
      this.broadcast({ t: 'event', kind: 'halftime', score: this.score });
    }
    this.startRound();
  }

  addHuman(ws, name, pref) {
    if (this.humans().length >= 10) return null;
    const hT = this.humans('T').length, hD = this.humans('D').length;
    let team = pref === 'T' || pref === 'D' ? pref : (hT <= hD ? 'T' : 'D');
    if (this.humans(team).length >= 5) team = team === 'T' ? 'D' : 'T';
    const p = makePlayer(name, team, ws);
    if (this.phase === 'buy') {
      // take over a bot immediately
      const bots = this.bots(team);
      const b = bots[0];
      if (b) {
        Object.assign(p, { x: b.x, y: 0, z: b.z, yaw: b.yaw, money: b.roundMoney ?? b.money, primary: null, secondary: 'sidearm', alive: true, hp: 100, cur: 'secondary' });
        if (this.bomb.carrier === b.id) this.bomb.carrier = p.id;
        this.players.delete(b.id);
      }
    } else {
      p.alive = false;
      const t = this.team(team);
      p.money = t.length ? Math.round(t.reduce((s, q) => s + q.money, 0) / t.length / 50) * 50 : S.ECON.start;
    }
    this.players.set(p.id, p);
    this.emptySince = null;
    this.broadcast({ t: 'event', kind: 'joined', name: p.name, team });
    return p;
  }
  removeHuman(p) {
    if (!this.players.has(p.id)) return;
    // a bot takes over the slot right where the player left off
    p.isBot = true; p.ws = null; p.name = 'BOT ' + p.name.slice(0, 10); p.skill = this.diff.skill;
    p.using = false;
    p.brain = { path: null, pi: 0, goal: null, target: null, reactAt: 0, think: 0, site: pick(['A', 'B']), hold: null, stuck: 0, lastPos: [p.x, p.z], alertYaw: null, alertUntil: 0, burst: 0 };
    this.broadcast({ t: 'event', kind: 'left', name: p.name });
    if (!this.humans().length) this.emptySince = now();
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.ws && p.ws.readyState === 1) p.ws.send(s);
  }

  // ------------------------------------------------------------------ simulation
  update(dt) {
    this.tick++;
    this.timer -= dt;
    if (this.phase === 'buy') {
      if (this.timer <= 0) { this.phase = 'live'; this.timer = S.ROUND.liveTime; this.broadcast({ t: 'event', kind: 'live' }); }
    } else if (this.phase === 'live') {
      for (const p of this.players.values()) if (p.isBot && p.alive) updateBot(this, p, dt);
      this.updateObjective(dt);
      if (this.bomb.state === 'planted') {
        this.bomb.timer -= dt;
        if (this.bomb.timer <= 0) this.explode();
      } else if (this.timer <= 0) {
        this.endRound('D', 'Time ran out');
      }
      this.checkElimination();
    } else if (this.phase === 'end') {
      for (const p of this.players.values()) if (p.isBot && p.alive) updateBot(this, p, dt);
      if (this.bomb.state === 'planted') { this.bomb.timer -= dt; if (this.bomb.timer <= 0) this.explode(true); }
      if (this.timer <= 0) this.afterRound();
    } else if (this.phase === 'matchEnd') {
      if (this.timer <= 0) this.resetMatch();
    }
    if (this.tick % SNAP_EVERY === 0) this.sendSnap();
  }
  updateObjective(dt) {
    const b = this.bomb;
    // pick up dropped bomb
    if (b.state === 'dropped') {
      for (const p of this.team('T')) if (p.alive && Math.hypot(p.x - b.x, p.z - b.z) < 1.4) {
        b.state = 'carried'; b.carrier = p.id;
        this.sendTo(p, { t: 'event', kind: 'bombPickup' });
        break;
      }
    }
    for (const p of this.players.values()) {
      if (!p.alive || !p.using) { p.useProg = 0; continue; }
      const moved = Math.hypot(p.x - (p.useX ?? p.x), p.z - (p.useZ ?? p.z)) > 0.25;
      if (moved) { p.useProg = 0; p.useX = p.x; p.useZ = p.z; continue; }
      if (p.team === 'T' && b.state === 'carried' && b.carrier === p.id && S.inSite(p.x, p.z)) {
        p.useProg += dt;
        if (p.useProg >= S.ROUND.plantTime) {
          b.state = 'planted'; b.x = p.x; b.z = p.z; b.timer = S.ROUND.bombTime; b.site = S.inSite(p.x, p.z); b.carrier = null;
          p.using = false; p.useProg = 0; addMoney(p, S.ECON.plant);
          this.planter = p.id;
          this.broadcast({ t: 'event', kind: 'planted', site: b.site, by: p.name });
        }
      } else if (p.team === 'D' && b.state === 'planted' && Math.hypot(p.x - b.x, p.z - b.z) < 1.8) {
        p.useProg += dt;
        if (p.useProg >= (p.kit ? S.ROUND.defuseKitTime : S.ROUND.defuseTime)) {
          b.state = 'defused'; p.using = false; p.useProg = 0; addMoney(p, S.ECON.defuse);
          this.broadcast({ t: 'event', kind: 'defused', by: p.name });
          this.endRound('D', 'Bomb defused');
        }
      } else p.useProg = 0;
    }
  }
  explode(late) {
    const b = this.bomb;
    b.state = 'exploded';
    this.broadcast({ t: 'event', kind: 'exploded', x: b.x, z: b.z });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < 22) this.damage(p, null, Math.round(500 * (1 - d / 22) ** 1.5), false, 'bomb');
    }
    if (!late) this.endRound('T', 'Target destroyed');
  }
  checkElimination() {
    if (this.phase !== 'live') return;
    const tAlive = this.team('T').some((p) => p.alive);
    const dAlive = this.team('D').some((p) => p.alive);
    if (!dAlive) this.endRound('T', 'Defenders eliminated');
    else if (!tAlive && this.bomb.state !== 'planted') this.endRound('D', 'Attackers eliminated');
  }
  damage(target, attacker, dmg, head, weapon) {
    if (!target.alive) return;
    let hpDmg = dmg;
    if (target.armor > 0 && weapon !== 'bomb') {
      const absorbed = Math.min(target.armor, dmg * 0.45);
      target.armor = Math.max(0, Math.round(target.armor - absorbed));
      hpDmg = dmg - absorbed;
    }
    hpDmg = Math.max(1, Math.round(hpDmg));
    target.hp -= hpDmg;
    if (attacker) {
      this.sendTo(attacker, { t: 'hitConfirm', head, kill: target.hp <= 0 });
      if (target.isBot) { target.brain.alertYaw = Math.atan2(attacker.x - target.x, attacker.z - target.z); target.brain.alertUntil = now() + 2.5; target.brain.alertId = attacker.id; }
    }
    this.sendTo(target, { t: 'hurt', dmg: hpDmg, fx: attacker ? attacker.x : target.x, fz: attacker ? attacker.z : target.z });
    if (target.hp <= 0) {
      target.hp = 0; target.alive = false; target.using = false; target.deaths++;
      if (attacker && attacker !== target) {
        attacker.kills++;
        if (attacker.team !== target.team) addMoney(attacker, S.WEAPONS[weapon]?.reward ?? 300);
      }
      if (this.bomb.state === 'carried' && this.bomb.carrier === target.id) {
        this.bomb.state = 'dropped'; this.bomb.x = target.x; this.bomb.z = target.z; this.bomb.carrier = null;
      }
      this.broadcast({ t: 'kill', killer: attacker?.name ?? 'World', kt: attacker?.team, victim: target.name, vt: target.team, w: weapon, head, vid: target.id });
      this.checkElimination();
    }
  }
  fire(p, o, d, wKey) {
    const w = S.WEAPONS[wKey];
    const tWall = S.rayWorld(o, d, 250);
    let best = null;
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      const h = S.rayPlayer(o, d, q);
      if (h && h.t < tWall && (!best || h.t < best.t)) best = { ...h, q };
    }
    const tEnd = best ? best.t : tWall;
    const e = [o[0] + d[0] * tEnd, o[1] + d[1] * tEnd, o[2] + d[2] * tEnd];
    this.broadcast({ t: 'shot', id: p.id, o, e, w: wKey, hitP: !!best });
    if (best && best.q.team !== p.team) {
      let dmg = w.dmg;
      if (best.t > w.range) dmg *= Math.max(w.falloff, 1 - (best.t - w.range) / (w.range * 2));
      if (best.head) dmg *= w.head;
      if (p.isBot && !best.q.isBot) dmg *= this.diff.dmg;
      this.damage(best.q, p, dmg, best.head, wKey);
    }
  }
  sendTo(p, msg) { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); }
  sendSnap(force) {
    const list = [...this.players.values()].map((p) => ({
      id: p.id, n: p.name, tm: p.team, b: p.isBot ? 1 : 0,
      x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yw: +p.yaw.toFixed(3), pt: +p.pitch.toFixed(3),
      hp: p.hp, a: p.alive ? 1 : 0, w: p.cur === 'primary' && p.primary ? p.primary : p.secondary,
      k: p.kills, d: p.deaths, mv: p.moving ? 1 : 0, u: p.useProg > 0 ? 1 : 0, ar: p.armor > 0 ? 1 : 0, m: p.money,
    }));
    const b = this.bomb;
    const base = {
      t: 'snap', ph: this.phase, tm: +this.timer.toFixed(2), r: this.round, sc: this.score, ts: this.targetSite,
      bomb: { s: b.state, c: b.carrier, x: +b.x.toFixed(2), z: +b.z.toFixed(2), tm: +b.timer.toFixed(2), site: b.site },
      pl: list, room: this.code,
    };
    for (const p of this.players.values()) {
      if (!p.ws || p.ws.readyState !== 1) continue;
      base.you = { id: p.id, money: p.money, armor: p.armor, hp: p.hp, kit: p.kit, primary: p.primary, secondary: p.secondary, team: p.team, alive: p.alive, useProg: p.useProg, force: force ? 1 : 0, x: p.x, z: p.z, yaw: p.yaw };
      p.ws.send(JSON.stringify(base));
    }
  }

  // ------------------------------------------------------------------ client messages
  onMessage(p, m) {
    if (m.t === 'state') {
      if (!p.alive || this.phase === 'buy' || this.phase === 'matchEnd') { if (p.alive) { p.yaw = +m.yaw || 0; p.pitch = +m.pitch || 0; } return; }
      const nx = +m.x, nz = +m.z;
      if (!Number.isFinite(nx) || !Number.isFinite(nz)) return;
      const dist = Math.hypot(nx - p.x, nz - p.z);
      if (dist < 4 && !S.collides(nx, nz, S.PLAYER_R * 0.8)) { p.x = nx; p.z = nz; }
      p.y = Math.max(0, Math.min(2, +m.y || 0));
      p.yaw = +m.yaw || 0; p.pitch = Math.max(-1.5, Math.min(1.5, +m.pitch || 0));
      p.moving = !!m.mv;
      if (m.c === 'primary' || m.c === 'secondary') p.cur = m.c;
    } else if (m.t === 'shoot') {
      if (!p.alive || this.phase === 'buy' || this.phase === 'matchEnd') return;
      const wKey = m.w;
      if (wKey !== p.primary && wKey !== p.secondary) return;
      const w = S.WEAPONS[wKey];
      const t = now();
      if (t - (p.lastShot || 0) < (60 / w.rpm) * 0.75) return;
      p.lastShot = t;
      let o = Array.isArray(m.o) ? m.o.map(Number) : null;
      if (!o || o.some((v) => !Number.isFinite(v)) || Math.hypot(o[0] - p.x, o[2] - p.z) > 2) o = [p.x, p.y + S.EYE, p.z];
      let d = Array.isArray(m.d) ? m.d.map(Number) : [0, 0, 1];
      const l = Math.hypot(...d) || 1; d = d.map((v) => v / l);
      this.fire(p, o, d, wKey);
    } else if (m.t === 'buy') {
      if (this.phase !== 'buy' || !p.alive) return;
      buyItem(p, m.item);
      this.sendSnap();
    } else if (m.t === 'use') {
      p.using = !!m.on; p.useX = p.x; p.useZ = p.z;
      if (!p.using) p.useProg = 0;
    }
  }
}

function makePlayer(name, team, ws) {
  return {
    id: nextId++, name, team, ws, isBot: false, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, armor: 0, alive: false,
    money: S.ECON.start, primary: null, secondary: 'sidearm', cur: 'secondary', kit: false, kills: 0, deaths: 0,
    lastShot: 0, moving: false, using: false, useProg: 0, brain: null, skill: 1,
  };
}
function addMoney(p, v) { p.money = Math.min(S.ECON.max, p.money + v); }
function buyItem(p, item) {
  const w = S.WEAPONS[item];
  if (w) {
    if (p[w.slot] === item || p.money < w.price) return false;
    p.money -= w.price; p[w.slot] = item; p.cur = w.slot; return true;
  }
  if (item === 'armor' && p.armor < 100 && p.money >= S.GEAR.armor.price) { p.money -= S.GEAR.armor.price; p.armor = 100; return true; }
  if (item === 'kit' && p.team === 'D' && !p.kit && p.money >= S.GEAR.kit.price) { p.money -= S.GEAR.kit.price; p.kit = true; return true; }
  return false;
}
function botBuy(p) {
  const m = p.money;
  if (!p.primary) {
    if (m >= 5600 && Math.random() < 0.2) buyItem(p, 'longbow');
    else if (m >= 3700) buyItem(p, 'raptor');
    else if (m >= 2700 && Math.random() < 0.6) buyItem(p, 'raptor');
    else if (m >= 2250 && Math.random() < 0.7) buyItem(p, 'vector');
  }
  if (p.money >= 1000 && p.armor < 100 && (p.primary || p.money > 2000 || Math.random() < 0.3)) buyItem(p, 'armor');
  if (p.team === 'D' && p.money >= 400 && p.primary) buyItem(p, 'kit');
  if (!p.primary && p.money >= 700 && p.secondary === 'sidearm' && Math.random() < 0.5) buyItem(p, 'cannon');
  p.cur = p.primary ? 'primary' : 'secondary';
}

// ------------------------------------------------------------------ bot AI
function eyeOf(p) { return [p.x, p.y + S.EYE, p.z]; }
function botSee(room, bot) {
  let best = null, bd = Infinity;
  for (const q of room.players.values()) {
    if (!q.alive || q.team === bot.team) continue;
    const dx = q.x - bot.x, dz = q.z - bot.z, d = Math.hypot(dx, dz);
    if (d > room.diff.range) continue;
    const yawTo = Math.atan2(dx, dz);
    const inFov = Math.abs(angDiff(bot.yaw, yawTo)) < room.diff.fov || d < 5 || (bot.brain.alertId === q.id && now() < bot.brain.alertUntil);
    if (!inFov) continue;
    if (!S.losClear(bot.x, bot.z, q.x, q.z)) continue;
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
function setGoal(bot, tx, tz) {
  const b = bot.brain;
  if (b.goal && b.goal[0] === tx && b.goal[1] === tz && b.path) return;
  const sx = Math.floor(bot.x / S.TILE), sz = Math.floor(bot.z / S.TILE);
  b.goal = [tx, tz];
  b.path = S.findPath(sx, sz, tx, tz);
  b.pi = 1;
}
function randSiteTile(site) {
  const s = S.SITES[site];
  for (let i = 0; i < 30; i++) {
    const tx = Math.floor(rnd(s.x0 + 1, s.x1)), tz = Math.floor(rnd(s.z0 + 1, s.z1));
    if (!S.solidAt(tx, tz)) return [tx, tz];
  }
  return [Math.floor((s.x0 + s.x1) / 2), Math.floor((s.z0 + s.z1) / 2)];
}
function nearTile(x, z, r) {
  for (let i = 0; i < 30; i++) {
    const tx = Math.floor(x / S.TILE + rnd(-r, r)), tz = Math.floor(z / S.TILE + rnd(-r, r));
    if (!S.solidAt(tx, tz)) return [tx, tz];
  }
  return [Math.floor(x / S.TILE), Math.floor(z / S.TILE)];
}
function updateBot(room, bot, dt) {
  const b = bot.brain, t = now();
  const w = S.WEAPONS[bot.cur === 'primary' && bot.primary ? bot.primary : bot.secondary];
  const wKey = bot.cur === 'primary' && bot.primary ? bot.primary : bot.secondary;
  // perception
  if (t >= b.think) {
    b.think = t + 0.15 + Math.random() * 0.1;
    const seen = botSee(room, bot);
    if (seen && (!b.target || b.target.id !== seen.id)) {
      const d = Math.hypot(seen.x - bot.x, seen.z - bot.z);
      b.reactAt = t + (rnd(0.22, 0.5) * room.diff.react + d * 0.004) / bot.skill;
    }
    b.target = seen;
    if (!seen) planObjective(room, bot);
  }
  const tgt = b.target && b.target.alive ? b.target : null;
  bot.moving = false;
  if (tgt) {
    // combat
    const aimY = Math.random() < room.diff.head ? 1.62 : 1.2;
    const dx = tgt.x - bot.x, dz = tgt.z - bot.z, dh = Math.hypot(dx, dz);
    const yawTo = Math.atan2(dx, dz), pitchTo = Math.atan2(tgt.y + aimY - (bot.y + S.EYE), dh);
    const turn = 7 * bot.skill * dt;
    const dy = angDiff(bot.yaw, yawTo);
    bot.yaw += Math.max(-turn, Math.min(turn, dy));
    bot.pitch += (pitchTo - bot.pitch) * Math.min(1, 10 * dt);
    if (bot.using) { bot.using = false; bot.useProg = 0; }
    // small strafe
    if (Math.random() < 0.02) b.strafe = Math.random() < 0.5 ? -1 : Math.random() < 0.5 ? 1 : 0;
    if (b.strafe && dh > 4) {
      const sp = w.speed * 0.45 * dt;
      [bot.x, bot.z] = S.moveCollide(bot.x, bot.z, Math.cos(bot.yaw) * sp * b.strafe, -Math.sin(bot.yaw) * sp * b.strafe);
      bot.moving = true;
    }
    if (t >= b.reactAt && Math.abs(dy) < 0.12 && t - bot.lastShot >= 60 / w.rpm * (w.auto ? 1.15 : 1.6)) {
      bot.lastShot = t;
      const sigma = (0.022 + (bot.moving ? 0.015 : 0) + (w.auto && b.burst > 4 ? 0.02 : 0) + w.spread) / bot.skill;
      const yaw = yawTo + gauss() * sigma, pitch = pitchTo + gauss() * sigma * 0.7;
      const d = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
      room.fire(bot, eyeOf(bot), d, wKey);
      b.burst = (b.burst || 0) + 1;
      if (b.burst > 7 + Math.random() * 6) { b.burst = 0; b.reactAt = t + rnd(0.25, 0.5); }
    }
    return;
  }
  b.burst = 0;
  // turn toward recent damage source
  if (b.alertYaw != null && t < b.alertUntil) {
    const dy = angDiff(bot.yaw, b.alertYaw);
    bot.yaw += Math.max(-6 * dt, Math.min(6 * dt, dy));
    if (Math.abs(dy) > 0.3) return;
  }
  // objective actions
  const bomb = room.bomb;
  if (bot.team === 'T' && bomb.state === 'carried' && bomb.carrier === bot.id && S.inSite(bot.x, bot.z) && b.atGoal) {
    if (!bot.using) { bot.using = true; bot.useX = bot.x; bot.useZ = bot.z; }
    return;
  }
  if (bot.team === 'D' && bomb.state === 'planted' && Math.hypot(bot.x - bomb.x, bot.z - bomb.z) < 1.5) {
    if (!bot.using) { bot.using = true; bot.useX = bot.x; bot.useZ = bot.z; }
    return;
  }
  if (bot.using) { bot.using = false; bot.useProg = 0; }
  // follow path
  if (!b.path || b.pi >= b.path.length) {
    b.atGoal = true;
    // idle look-around
    if (Math.random() < 0.01) b.lookYaw = bot.yaw + rnd(-1.5, 1.5);
    if (b.lookYaw != null) bot.yaw += angDiff(bot.yaw, b.lookYaw) * Math.min(1, 3 * dt);
    return;
  }
  b.atGoal = false;
  const [nx, nz] = S.tileCenter(...b.path[b.pi]);
  const dx = nx - bot.x, dz = nz - bot.z, d = Math.hypot(dx, dz);
  if (d < 0.45) { b.pi++; return; }
  const sp = Math.min(d, w.speed * 0.95 * dt);
  const ox = bot.x, oz = bot.z;
  [bot.x, bot.z] = S.moveCollide(bot.x, bot.z, (dx / d) * sp, (dz / d) * sp, S.PLAYER_R * 0.9);
  bot.moving = true;
  const yawTo = Math.atan2(dx, dz);
  bot.yaw += angDiff(bot.yaw, yawTo) * Math.min(1, 6 * dt);
  bot.pitch *= 0.9;
  if (Math.hypot(bot.x - ox, bot.z - oz) < sp * 0.3) {
    if ((b.stuck += dt) > 0.6) { b.stuck = 0; b.path = null; b.goal = null; bot.x += rnd(-0.1, 0.1); bot.z += rnd(-0.1, 0.1); if (S.collides(bot.x, bot.z, S.PLAYER_R)) { bot.x = ox; bot.z = oz; } }
  } else b.stuck = 0;
}
function planObjective(room, bot) {
  const b = bot.brain, bomb = room.bomb;
  if (bot.team === 'T') {
    if (bomb.state === 'carried' && bomb.carrier === bot.id) {
      if (!b.plantTile) b.plantTile = randSiteTile(room.targetSite);
      setGoal(bot, ...b.plantTile);
    } else if (bomb.state === 'dropped') {
      // nearest living T goes for the bomb, others push the site
      const ts = room.team('T').filter((p) => p.alive);
      ts.sort((a, c) => Math.hypot(a.x - bomb.x, a.z - bomb.z) - Math.hypot(c.x - bomb.x, c.z - bomb.z));
      if (ts[0] === bot) setGoal(bot, Math.floor(bomb.x / S.TILE), Math.floor(bomb.z / S.TILE));
      else { if (!b.hold) b.hold = randSiteTile(room.targetSite); setGoal(bot, ...b.hold); }
    } else if (bomb.state === 'planted') {
      if (!b.guard) b.guard = nearTile(bomb.x, bomb.z, 4);
      setGoal(bot, ...b.guard);
    } else {
      if (!b.hold) b.hold = randSiteTile(room.targetSite);
      setGoal(bot, ...b.hold);
    }
  } else {
    if (bomb.state === 'planted') {
      const ds = room.team('D').filter((p) => p.alive);
      ds.sort((a, c) => Math.hypot(a.x - bomb.x, a.z - bomb.z) - Math.hypot(c.x - bomb.x, c.z - bomb.z));
      if (ds[0] === bot || ds.length === 1) setGoal(bot, Math.floor(bomb.x / S.TILE), Math.floor(bomb.z / S.TILE));
      else { if (!b.retake) b.retake = nearTile(bomb.x, bomb.z, 3); setGoal(bot, ...b.retake); }
    } else {
      if (!b.hold) b.hold = pick(S.HOLDS[b.site]);
      setGoal(bot, ...b.hold);
    }
  }
}


// ------------------------------------------------------------------ local "connection"
// Behaves like a WebSocket so the client code stays the same.
export function createLocalGame() {
  let room = null, player = null, paused = false, last = performance.now() / 1000;
  const queue = [];
  const deliver = (msg) => { queue.push(msg); if (queue.length === 1) queueMicrotask(flush); };
  function flush() { const q = queue.splice(0); for (const m of q) conn.onmessage?.({ data: JSON.stringify(m) }); }
  const sock = { readyState: 1, send: (s) => deliver(JSON.parse(s)) };
  const conn = {
    readyState: 1, onmessage: null, onopen: null, onclose: null,
    send(raw) {
      const m = JSON.parse(raw);
      if (m.t === 'join' && !player) {
        room = new Room('SOLO', m.difficulty);
        const name = String(m.name || 'Player').replace(/[<>]/g, '').slice(0, 14) || 'Player';
        player = room.addHuman(sock, name, m.team);
        deliver({ t: 'welcome', id: player.id, room: 'SOLO', team: player.team, difficulty: room.diffKey });
        room.sendSnap(true);
        return;
      }
      if (m.t === 'ping') { deliver({ t: 'pong', ts: m.ts }); return; }
      if (m.t === 'difficulty') { room?.setDifficulty(m.v); return; }
      if (room && player) room.onMessage(player, m);
    },
    close() { clearInterval(timer); conn.readyState = 3; },
    setPaused(v) { paused = !!v; last = performance.now() / 1000; },
    get paused() { return paused; },
    get room() { return room; },
  };
  const timer = setInterval(() => {
    const t = performance.now() / 1000;
    const dt = Math.min(t - last, 0.1); last = t;
    if (paused || !room) return;
    simT += dt;
    try { room.update(dt); } catch (e) { console.error(e); }
  }, TICK * 1000);
  queueMicrotask(() => conn.onopen?.());
  return conn;
}
