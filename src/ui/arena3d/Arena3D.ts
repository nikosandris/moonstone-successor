// The 3D real-time duel. Same contract as the 2D arena: it only dispatches choose/useItem/flee/continue
// actions, so every rule stays in src/core. Timing adds the "perfect read" flag (core perfectMult).
import * as THREE from 'three';
import { botAction } from '../../core/bot';
import { allowedChoices } from '../../core/combat';
import { affinityText, canFlee, combatFighters, combatHp, fleeCost, previewMonsterChoice } from '../../core/game';
import { moonEffect, phaseForDay } from '../../core/moon';
import type { Action, Choice, GameState, Knight } from '../../core/types';
import { CONFIG } from '../../data/balance';
import { getItem } from '../../data/items';
import { getMonster } from '../../data/monsters';
import { audio } from '../audio';
import { t, td, tlog, tn } from '../i18n';
import { getSettings, reactionScale } from '../settings';
import { hex } from '../theme';
import { icon } from '../hud/icons';
import { Actor3D, type ActorLook } from './Actor3D';
import { World3D, type Stage3D } from './World3D';

export interface Arena3DHost {
  getState(): GameState;
  dispatch(action: Action): void;
  /** the Phaser canvas, so the overlay can sit exactly on top of it */
  canvas(): HTMLCanvasElement;
}

type Side = 'a' | 'b';
type Phase = 'prep' | 'window' | 'impact' | 'over' | 'closed';

const PVP_WINDOW = 1500;
/** pressing in the last part of the reaction window counts as a perfect read */
export const PERFECT_FROM = 0.7;
const KEYS: Record<string, Choice> = { j: 'strike', k: 'guard', l: 'feint', a: 'strike', s: 'guard', d: 'feint', '1': 'strike', '2': 'guard', '3': 'feint', arrowright: 'strike', arrowup: 'guard', arrowdown: 'feint' };
const LEFT = new Set(['a', 's', 'd']);
const RIGHT = new Set(['j', 'k', 'l']);
const LABEL: Record<Choice, string> = { strike: 'Strike', guard: 'Guard', feint: 'Feint' };
const BEATS: Record<Choice, string> = { strike: 'beats Feint', guard: 'beats Strike', feint: 'beats Guard' };
const ACT_ICON: Record<Choice, string> = { strike: 'broadsword', guard: 'checked-shield', feint: 'cloak-dagger' };
const MONSTER_ICON: Record<string, string> = {
  direWolf: 'wolf-head', bogTroll: 'troll', rustKnight: 'death-skull', caveDrake: 'dragon-head', bandit: 'bandit',
  giantSpider: 'spider-face', marshSerpent: 'snake', boneGolem: 'golem-head', guardian: 'spectre',
};

/** Stylised KayKit fallbacks (re-coloured, re-armed, re-scaled); `sf` names the realistic model used once it has loaded. */
export const MONSTER_LOOK: Record<string, ActorLook> = {
  direWolf: { sf: 'direWolf', model: 'skeleton_minion', wash: 0x6b6f80, washAmount: 0.25, weapon: 'w_skeleton_blade', scale: 0.95 },
  bogTroll: { sf: 'bogTroll', model: 'barbarian', wash: 0x4f6b3a, washAmount: 0.55, scale: 1.3, weapon: 'w_axe2h' },
  rustKnight: { sf: 'rustKnight', model: 'skeleton_warrior', wash: 0x8a5a3a, washAmount: 0.45, weapon: 'w_skeleton_axe', offhand: 'w_skeleton_shield' },
  caveDrake: { sf: 'caveDrake', model: 'skeleton_mage', wash: 0x7a2f2f, washAmount: 0.45, scale: 1.15, weapon: 'w_skeleton_staff' },
  bandit: { model: 'rogue', wash: 0x5a4a3a, washAmount: 0.3, weapon: 'w_dagger' },
  giantSpider: { sf: 'giantSpider', model: 'skeleton_rogue', wash: 0x3a2a3a, washAmount: 0.5, weapon: 'w_dagger' },
  marshSerpent: { sf: 'marshSerpent', model: 'skeleton_minion', wash: 0x2f5a4a, washAmount: 0.5, weapon: 'w_skeleton_blade' },
  boneGolem: { sf: 'boneGolem', model: 'skeleton_warrior', wash: 0xbab8a0, washAmount: 0.3, scale: 1.4, weapon: 'w_axe2h' },
  guardian: { sf: 'guardian', model: 'skeleton_warrior', wash: 0x3a3f80, washAmount: 0.5, scale: 1.45, weapon: 'w_skeleton_axe', offhand: 'w_skeleton_shield', aura: 0x4a6aff },
};

const CSS = `
.a3d-root{position:fixed;z-index:20;overflow:hidden;background:#000;color:var(--parch);user-select:none;-webkit-user-select:none;touch-action:none;font-family:var(--text)}
.a3d-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.a3d-hud{position:absolute;inset:0;pointer-events:none}
.a3d-hud button{pointer-events:auto}
.a3d-plate{position:absolute;top:1.1em;display:flex;gap:.9em;align-items:center;width:18.5em}
.a3d-left{left:1.3em}.a3d-right{right:1.3em;flex-direction:row-reverse;text-align:right}
.a3d-col{flex:1;min-width:0}
.a3d-name{font:700 1.15em/1.1 var(--serif);letter-spacing:.1em;text-transform:uppercase;text-shadow:0 2px 0 #000,0 0 10px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.a3d-stats{font:600 .62em/1 var(--serif);letter-spacing:.12em;color:var(--dim);margin-top:.35em;text-transform:uppercase}
.a3d-ready{font:700 .7em var(--serif);color:#9ff0a8;letter-spacing:.2em;margin:0 .6em;text-shadow:0 0 8px #3f8}
.a3d-title{position:absolute;top:.8em;left:50%;transform:translateX(-50%);text-align:center;width:19em}
.a3d-title .mb-title{font-size:1.05em}
.a3d-title .hint{font:italic .78em/1.3 var(--text);color:#f0d9b0;text-shadow:0 1px 3px #000}
.a3d-title .aff{font:italic .7em var(--text);color:#ff9d8a;text-shadow:0 1px 3px #000}
.a3d-banner{position:absolute;top:23%;left:0;right:0;opacity:0;transform:scale(1.25);filter:blur(4px);transition:opacity .22s,transform .3s cubic-bezier(.2,1.4,.4,1),filter .25s}
.a3d-banner.show{opacity:1;transform:scale(1);filter:blur(0)}
.a3d-banner .mb-banner{font-size:2.3em}
.a3d-banner.perfect .mb-banner{font-size:3.4em}
.a3d-log{position:absolute;bottom:12.4em;left:50%;transform:translateX(-50%);width:34em;text-align:center;font:italic .82em/1.35 var(--text);color:#e9dfcc;text-shadow:0 1px 3px #000,0 0 8px #000}
.a3d-intent{position:absolute;display:flex;align-items:center;gap:.55em;padding:.45em 1.1em .45em .45em;border-radius:2em;transform:translate(-50%,-100%) scale(.8);opacity:0;pointer-events:none;transition:opacity .15s,transform .2s cubic-bezier(.2,1.6,.4,1);white-space:nowrap;background:linear-gradient(#0d0a12f0,#0d0a12d0);box-shadow:0 0 0 2px var(--k),0 0 24px var(--k),0 8px 20px #000c}
.a3d-intent.on{opacity:1;transform:translate(-50%,-100%) scale(1)}
.a3d-intent .ic{width:2.3em;height:2.3em;border-radius:50%;display:grid;place-items:center;color:#fff;background:radial-gradient(circle at 50% 35%,var(--k),#000 120%);box-shadow:0 0 0 2px #000,0 0 12px var(--k)}
.a3d-intent .ic .ico{width:62%;height:62%}
.a3d-intent .tx b{display:block;font:700 1.15em/1 var(--serif);letter-spacing:.14em;text-transform:uppercase;color:var(--k);text-shadow:0 0 10px var(--k),0 2px 0 #000}
.a3d-intent .tx small{display:block;font:italic .72em/1.3 var(--text);color:#efe3c8;margin-top:.2em}
.a3d-intent .tx small b{display:inline;font:inherit;font-weight:700;font-style:normal;letter-spacing:0;text-transform:none;color:#fff;text-shadow:none}
.a3d-intent .tx small b.r{color:#ff6a50}.a3d-intent .tx small b.g{color:#ffd23a}
.a3d-intent.k-guard{--k:#3aa0ff}.a3d-intent.k-strike{--k:#ff3a1c}.a3d-intent.k-feint{--k:#ffc030;animation:a3dflick .18s steps(2) infinite}.a3d-intent.k-windup{--k:#b9b0d8}
@keyframes a3dflick{50%{filter:brightness(1.6)}}
.a3d-pop{position:absolute;pointer-events:none;transform:translate(-50%,0);animation:a3dpop 1.15s ease-out forwards;white-space:nowrap}
@keyframes a3dpop{0%{transform:translate(-50%,.3em) scale(.5);opacity:0}14%{transform:translate(-50%,-.3em) scale(1.25);opacity:1}30%{transform:translate(-50%,-.5em) scale(1)}100%{transform:translate(-50%,-2.8em) scale(.95);opacity:0}}
.a3d-arc{position:absolute;left:50%;bottom:8.3em;transform:translateX(-50%);width:26em;height:4.4em;opacity:0;transition:opacity .15s;overflow:visible}
.a3d-arc.on{opacity:1}
.a3d-arc .bg{stroke:#000a;stroke-width:9;fill:none}
.a3d-arc .rail{stroke:#3a3046;stroke-width:5;fill:none}
.a3d-arc .zone{stroke:url(#a3dgold);stroke-width:5;fill:none;filter:drop-shadow(0 0 4px #ffb020)}
.a3d-arc .prog{stroke:#efe3c8;stroke-width:3;fill:none;filter:drop-shadow(0 0 3px #fff)}
.a3d-arc .mark{fill:#fff;filter:drop-shadow(0 0 6px #fff)}
.a3d-arc text{font:700 9px var(--serif);letter-spacing:2px;fill:#f6e1a6}
.a3d-controls{position:absolute;left:0;right:0;bottom:.7em;display:flex;justify-content:center;align-items:flex-end;gap:1em}
.a3d-split{display:flex;justify-content:space-between;width:100%;padding:0 1.2em;box-sizing:border-box}
.a3d-group{display:flex;gap:.6em;align-items:flex-end}
.a3d-help{position:absolute;left:50%;transform:translateX(-50%);bottom:7.2em;width:40em;text-align:center;font:italic .84em/1.4 var(--text);color:#d9cfbd;text-shadow:0 1px 3px #000,0 0 10px #000}
.a3d-help b{font-style:normal}
.a3d-items{position:absolute;left:1.3em;bottom:1.2em;display:flex;flex-direction:column;gap:.4em}
.a3d-items.r{left:auto;right:1.3em;align-items:flex-end}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

interface Move { obj: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; back: boolean }

export class Arena3D {
  private static current: Arena3D | null = null;
  static isOpen(): boolean {
    return !!Arena3D.current;
  }
  static open(host: Arena3DHost): Arena3D {
    Arena3D.current?.close();
    Arena3D.current = new Arena3D(host);
    (window as unknown as { __arena3d?: Arena3D }).__arena3d = Arena3D.current; // test hook
    return Arena3D.current;
  }
  static closeCurrent(): void {
    Arena3D.current?.close();
  }

  private root: HTMLDivElement;
  private hud: HTMLDivElement;
  private world: World3D;
  private a: Actor3D;
  private b: Actor3D;
  private phase: Phase = 'prep';
  private clock = performance.now();
  private raf = 0;
  private timeScale = 1;
  private windowMs = 1000;
  private windowT = 0; // ms elapsed in the window
  private intent: Partial<Record<Side, Choice>> = {};
  private locked: Partial<Record<Side, Choice>> = {};
  private lockedAt: Partial<Record<Side, number>> = {};
  private botAt: Partial<Record<Side, number>> = {};
  private timers: { at: number; fn: () => void }[] = [];
  private now = 0; // scaled ms since open
  private moves: Move[] = [];
  private homeA = new THREE.Vector3(-1.55, 0, 0);
  private homeB = new THREE.Vector3(1.55, 0, 0);
  private els!: {
    plates: Record<Side, HTMLDivElement>; title: HTMLDivElement; banner: HTMLDivElement; log: HTMLDivElement;
    timing: HTMLDivElement; tfill: HTMLDivElement; tmark: HTMLDivElement; controls: HTMLDivElement; help: HTMLDivElement;
    items: HTMLDivElement; itemsR: HTMLDivElement; intent: HTMLDivElement;
  };
  private onKey = (e: KeyboardEvent) => this.key(e);
  private onResize = () => this.layout();
  private speed: number;

  private constructor(private host: Arena3DHost) {
    if (!document.getElementById('a3d-css')) {
      const st = el('style');
      st.id = 'a3d-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const url = Number(new URLSearchParams(window.location.search).get('speed')) || 1;
    this.speed = getSettings().animSpeed * url;
    this.root = el('div', 'a3d-root');
    const canvas = el('canvas');
    this.hud = el('div', 'a3d-hud');
    this.root.append(canvas, this.hud);
    document.body.appendChild(this.root);

    const s = this.s;
    const c = s.combat!;
    const stage: Stage3D = c.kind === 'guardian' ? 'sanctum' : c.kind === 'monster' ? 'lair' : 'forest';
    this.world = new World3D(canvas, stage, phaseForDay(s.day), s.seed + s.day);
    this.world.fx.bloodOn = getSettings().blood;

    const ka = s.players[c.a];
    this.a = new Actor3D({ model: 'knight', sf: 'knight', tint: ka.color });
    if (c.monsterId) this.b = new Actor3D(MONSTER_LOOK[c.monsterId] ?? MONSTER_LOOK.rustKnight);
    else {
      const kb = s.players[c.b!];
      this.b = new Actor3D({ model: 'knight', sf: 'knight', tint: kb.color });
    }
    // big creatures stand further back so bodies never interpenetrate
    // (the front of each body keeps its old mark; long tails and wings extend backwards)
    this.homeA.x = -1.55 - Math.max(0, this.a.reach - 0.45) * 0.7;
    this.homeB.x = 1.55 + Math.max(0, this.b.reach - 0.45) * 0.7;
    this.a.root.position.copy(this.homeA);
    this.a.root.rotation.y = Math.PI / 2;
    this.b.root.position.copy(this.homeB);
    this.b.root.rotation.y = -Math.PI / 2;
    this.world.scene.add(this.a.root, this.b.root);
    const mid = (this.homeA.x + this.homeB.x) / 2;
    const pull = 1 + Math.max(0, this.homeB.x - this.homeA.x - 3.1) * 0.12;
    this.world.setCamera(new THREE.Vector3(mid - 1.2, 1.9 * pull, 7.4 * pull), new THREE.Vector3(mid, 1.0, 0));
    if (c.monsterId) this.b.play(c.round === 0 && c.kind !== 'wild' ? 'Spawn_Ground' : 'Idle_Combat', { loop: false, fade: 0 });
    this.after(1600, () => { if (this.phase === 'prep') this.b.play('Idle_Combat'); });

    this.buildHud();
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.onResize);
    this.layout();
    this.prep();
    this.loop();
  }

  private get s(): GameState {
    return this.host.getState();
  }

  private knight(side: Side): Knight | null {
    const c = this.s.combat!;
    return side === 'a' ? this.s.players[c.a] : c.b !== null ? this.s.players[c.b] : null;
  }

  private human(side: Side): boolean {
    const k = this.knight(side);
    return !!k && !k.bot;
  }

  private actor(side: Side): Actor3D {
    return side === 'a' ? this.a : this.b;
  }

  /** Overlay exactly covers the Phaser canvas (which keeps its 16:9 letterbox). */
  private layout(): void {
    const r = this.host.canvas().getBoundingClientRect();
    Object.assign(this.root.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, fontSize: `${(r.height / 576) * 16}px` });
    this.world.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push({ at: this.now + ms, fn });
  }

  // ---------------------------------------------------------------- loop

  private loop = (): void => {
    if (this.phase === 'closed') return;
    const t = performance.now();
    const realDt = Math.min(0.05, (t - this.clock) / 1000);
    this.clock = t;
    const dt = realDt * this.speed * this.timeScale;
    this.now += dt * 1000;
    const due = this.timers.filter((x) => x.at <= this.now);
    this.timers = this.timers.filter((x) => x.at > this.now);
    for (const x of due) x.fn();
    if (this.phase === 'window') this.tickWindow(dt * 1000);
    this.tickMoves(dt);
    this.a.update(dt);
    this.b.update(dt);
    this.world.render(dt);
    this.raf = requestAnimationFrame(this.loop);
  };

  private tickMoves(dt: number): void {
    for (const m of this.moves) {
      m.t += dt;
      let k = Math.min(1, m.t / m.dur);
      if (m.back) k = k < 0.5 ? k * 2 : 2 - k * 2;
      const e = 1 - Math.pow(1 - k, 3);
      m.obj.position.lerpVectors(m.from, m.to, e);
    }
    this.moves = this.moves.filter((m) => m.t < m.dur);
  }

  private lunge(side: Side, dist: number, dur: number, back = true): void {
    const actor = this.actor(side);
    const home = side === 'a' ? this.homeA : this.homeB;
    const dir = side === 'a' ? 1 : -1;
    if (dist > 0) {
      const gap = this.homeB.x - this.homeA.x - this.a.reach - this.b.reach;
      dist = Math.min(dist, Math.max(0.15, gap - 0.3));
    }
    this.moves = this.moves.filter((m) => m.obj !== actor.root);
    this.moves.push({ obj: actor.root, from: home.clone(), to: home.clone().add(new THREE.Vector3(dist * dir, 0, 0)), t: 0, dur, back });
  }

  private hitStop(ms: number, scale = 0.04): void {
    this.timeScale = scale;
    window.setTimeout(() => { if (this.timeScale === scale) this.timeScale = 1; }, ms);
  }

  // ---------------------------------------------------------------- HUD

  private buildHud(): void {
    const plate = (side: Side) => el('div', `a3d-plate ${side === 'a' ? 'a3d-left' : 'a3d-right'}`);
    const plates = { a: plate('a'), b: plate('b') };
    const title = el('div', 'a3d-title');
    const banner = el('div', 'a3d-banner');
    const log = el('div', 'a3d-log');
    // crescent timing arc: the gold end is the perfect zone
    const arcPath = 'M 14 56 Q 200 -18 386 56';
    const timing = el('div', 'a3d-arc', `<svg viewBox="0 0 400 70" width="100%" height="100%">
      <defs><linearGradient id="a3dgold" x1="0" x2="1"><stop offset="0" stop-color="#a87a1a"/><stop offset="1" stop-color="#ffe9a8"/></linearGradient></defs>
      <path class="bg" d="${arcPath}"/><path class="rail" d="${arcPath}" pathLength="100"/>
      <path class="zone" d="${arcPath}" pathLength="100" stroke-dasharray="${(1 - PERFECT_FROM) * 100} 100" stroke-dashoffset="${-PERFECT_FROM * 100}"/>
      <path class="prog" d="${arcPath}" pathLength="100" stroke-dasharray="0 100"/>
      <circle class="mark" r="5" cx="-50" cy="-50"/>
      <text x="372" y="70" text-anchor="end">${t('PERFECT')}</text></svg>`);
    const controls = el('div', 'a3d-controls');
    const help = el('div', 'a3d-help');
    const items = el('div', 'a3d-items');
    const itemsR = el('div', 'a3d-items r');
    const intent = el('div', 'a3d-intent');
    this.hud.append(plates.a, plates.b, title, log, banner, timing, help, items, itemsR, controls, intent);
    this.els = {
      plates, title, banner, log, timing, tfill: timing.querySelector('.prog') as unknown as HTMLDivElement, tmark: timing.querySelector('.mark') as unknown as HTMLDivElement,
      controls, help, items, itemsR, intent,
    };
    this.refreshHud();
  }

  private setArc(p: number): void {
    (this.els.tfill as unknown as SVGPathElement).setAttribute('stroke-dasharray', `${p * 100} 100`);
  }

  private markArc(p: number | null): void {
    const mark = this.els.tmark as unknown as SVGCircleElement;
    if (p === null) {
      mark.setAttribute('cx', '-50');
      return;
    }
    const path = this.els.tfill as unknown as SVGPathElement;
    const pt = path.getPointAtLength(path.getTotalLength() * p);
    mark.setAttribute('cx', String(pt.x));
    mark.setAttribute('cy', String(pt.y));
  }

  private refreshHud(): void {
    const s = this.s;
    const c = s.combat;
    if (!c) return;
    const fighters = combatFighters(s);
    for (const side of ['a', 'b'] as Side[]) {
      const k = this.knight(side);
      const hp = combatHp(s, side);
      const sta = side === 'a' ? c.staminaA : c.staminaB;
      const max = side === 'a' ? c.maxStaminaA : c.maxStaminaB;
      const f = side === 'a' ? fighters.a : fighters.b;
      const name = k ? k.name : tn(c.monster!.name);
      const color = k ? hex(k.color) : '#ff8a70';
      const pct = Math.max(0, (hp.hp / hp.maxHp) * 100);
      const plateEl = this.els.plates[side];
      const right = side === 'b' ? ' right' : '';
      if (!plateEl.dataset.built) {
        const glyph = k ? 'visored-helm' : MONSTER_ICON[c.monsterId ?? ''] ?? 'crowned-skull';
        plateEl.innerHTML = `<div class="mb-medal" style="color:${color}">${icon(glyph)}</div>
          <div class="a3d-col"><div class="a3d-name"></div>
          <div class="mb-bar-wrap"><div class="mb-bar${right}"><div class="ghost"></div><div class="fill"></div><div class="val"></div></div></div>
          <div class="mb-runes${right}"></div><div class="a3d-stats"></div></div>`;
        plateEl.dataset.built = '1';
      }
      const ready = this.locked[side] && c.kind === 'pvp' && this.phase === 'window' ? `<span class="a3d-ready">${t('Ready')}</span>` : '';
      (plateEl.querySelector('.a3d-name') as HTMLElement).innerHTML = side === 'a' ? `<span style="color:${color}">${name}</span>${ready}` : `${ready}<span style="color:${color}">${name}</span>`;
      const bar = plateEl.querySelector('.mb-bar') as HTMLElement;
      bar.classList.toggle('low', pct < 30);
      (bar.querySelector('.fill') as HTMLElement).style.width = `${pct}%`;
      (bar.querySelector('.ghost') as HTMLElement).style.width = `${pct}%`;
      (bar.querySelector('.val') as HTMLElement).textContent = `${hp.hp} / ${hp.maxHp}`;
      (plateEl.querySelector('.mb-runes') as HTMLElement).innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < sta ? 'on' : ''}"></i>`).join('');
      (plateEl.querySelector('.a3d-stats') as HTMLElement).textContent = t('Attack {a} · Defense {d}', { a: f.offense, d: f.defense });
    }
    const kind = t(c.kind === 'pvp' ? 'Duel' : c.kind === 'guardian' ? 'The Warden' : c.kind === 'wild' ? 'Ambush' : 'Lair');
    const aff = c.monsterId ? affinityText(c.monsterId, s.day) : null;
    this.els.title.innerHTML = `<div class="mb-title">${kind} &nbsp;·&nbsp; ${t('Round {n}', { n: c.round + 1 })}</div><div class="mb-rule"></div>${c.monsterId ? `<div class="hint">${td(getMonster(c.monsterId).hint)}</div><div class="aff">${aff ? tlog(aff) : td(moonEffect(s.day).text)}</div>` : ''}`;
    this.els.log.textContent = this.phase !== 'window' && c.roundLog.length ? c.roundLog.slice(1).map(tlog).join('  ') : '';
  }

  private banner(text: string, perfect = false, ms = 900, red = false): void {
    const b = this.els.banner;
    b.innerHTML = `<div class="mb-banner${red ? ' red' : ''}">${text}</div>`;
    b.className = `a3d-banner show${perfect ? ' perfect' : ''}`;
    window.setTimeout(() => { if (b.textContent === text) b.className = 'a3d-banner'; }, ms / this.speed);
  }

  private pop(side: Side, text: string, cls = ''): void {
    const v = this.actor(side).chestWorld().add(new THREE.Vector3(0, 0.5, 0)).project(this.world.camera);
    const p = el('div', 'a3d-pop', `<div class="mb-num ${cls}">${text}</div>`);
    p.style.left = `${((v.x + 1) / 2) * 100}%`;
    p.style.top = `${((1 - v.y) / 2) * 100}%`;
    this.hud.appendChild(p);
    window.setTimeout(() => p.remove(), 1250);
  }

  private button(parent: HTMLElement, label: string, sub: string, cls: string, onClick: () => void, enabled = true): HTMLButtonElement {
    const b = el('button', `mb-btn ${cls}`, `${label}${sub ? `<small>${sub}</small>` : ''}`);
    b.disabled = !enabled;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!b.disabled) onClick();
    });
    parent.appendChild(b);
    return b;
  }

  private moveButtons(parent: HTMLElement, side: Side, keys: string): void {
    const f = side === 'a' ? combatFighters(this.s).a : combatFighters(this.s).b;
    const allowed = allowedChoices(f);
    const pvp = this.s.combat!.kind === 'pvp';
    const small = pvp && this.human('a') && this.human('b');
    (['strike', 'guard', 'feint'] as Choice[]).forEach((ch, i) => {
      const b = el('button', `mb-act ${ch}${small ? ' small' : ''}`, `<span class="key">${keys[i]}</span>${icon(ACT_ICON[ch])}<span class="lbl">${t(LABEL[ch])}</span>${small ? '' : `<span class="beats">${t(BEATS[ch])}</span>`}`);
      b.disabled = !allowed.includes(ch) || !!this.locked[side];
      if (!pvp && this.locked[side] === ch) b.classList.add('sel');
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (!b.disabled) this.commit(side, ch);
      });
      parent.appendChild(b);
    });
  }

  private itemButtons(side: Side): void {
    const k = this.knight(side);
    const box = side === 'a' ? this.els.items : this.els.itemsR;
    box.innerHTML = '';
    if (!k || k.bot || this.phase !== 'prep') return;
    k.consumables.forEach((id, i) => {
      const b = el('button', 'mb-chip', `${icon('potion-ball')}<span>${tn(getItem(id).name)}</span>`);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.host.dispatch({ type: 'useItem', slot: i, who: k.id });
        audio.play('heal');
        this.refreshHud();
        this.itemButtons(side);
      });
      box.appendChild(b);
    });
  }

  private drawControls(): void {
    const ctl = this.els.controls;
    ctl.innerHTML = '';
    this.els.help.textContent = '';
    const s = this.s;
    const c = s.combat;
    if (!c) return;
    if (this.phase === 'prep') {
      this.itemButtons('a');
      if (c.kind === 'pvp') this.itemButtons('b');
      if (c.round === 0 && (this.human('a') || this.human('b'))) {
        this.button(ctl, t('Fight'), t('Space / Enter'), 'mb-big', () => this.startWindow());
        if (canFlee(s) && this.human('a')) {
          const cost = fleeCost(s.players[c.a]);
          this.button(ctl, t('Flee'), cost ? t('drop {n} gold', { n: cost }) : t('free'), 'dark', () => this.host.dispatch({ type: 'flee' }));
        }
        this.els.help.innerHTML = c.kind === 'pvp'
          ? t('Both press together &mdash; left <b>A S D</b>, right <b>J K L</b>. Choices stay hidden until the clash. Late presses on the <b style="color:#ffd36a">gold</b> end of the arc are perfect.')
          : t('Read the wind-up: <b style="color:#6ec8ff">blue ward</b> Guard, <b style="color:#ff6b5a">red blade</b> Strike, <b style="color:#ffd23a">flicker</b> Feint. Answer late, on the <b style="color:#ffd36a">gold</b> end of the arc, for a perfect blow (×{n}).', { n: CONFIG.perfectMult });
      }
      return;
    }
    if (this.phase === 'window') {
      if (c.kind === 'pvp') {
        const wrap = el('div', 'a3d-split');
        const left = el('div', 'a3d-group');
        const right = el('div', 'a3d-group');
        if (this.human('a')) this.moveButtons(left, 'a', 'ASD');
        if (this.human('b')) this.moveButtons(right, 'b', 'JKL');
        wrap.append(left, right);
        ctl.appendChild(wrap);
      } else if (this.human('a')) this.moveButtons(ctl, 'a', 'JKL');
      return;
    }
    if (this.phase === 'over' && (this.human('a') || this.human('b'))) {
      this.button(ctl, t('Continue'), t('Space / Enter'), 'mb-big', () => this.finish());
    }
  }

  // ---------------------------------------------------------------- flow

  private prep(): void {
    this.phase = 'prep';
    this.intent = {};
    this.locked = {};
    this.lockedAt = {};
    this.botAt = {};
    this.els.timing.classList.remove('on');
    const c = this.s.combat;
    if (!c) return;
    if (c.over) return this.over();
    for (const side of ['a', 'b'] as Side[]) {
      const k = this.knight(side);
      if (!k || !k.bot) continue;
      for (let guard = 0; guard < 6; guard++) {
        const act = botAction(this.s, side);
        if (act.type === 'choose') { this.intent[side] = act.choice; break; }
        this.host.dispatch(act);
        if (act.type === 'flee' || this.s.stage !== 'combat') return;
      }
      this.botAt[side] = 0.45 + Math.random() * 0.5;
    }
    this.refreshHud();
    this.drawControls();
    const anyHuman = this.human('a') || this.human('b');
    if (c.round === 0 && anyHuman) return;
    if (c.round > 0) this.after(350, () => { if (this.phase === 'prep') this.banner(t('Round {n}', { n: c.round + 1 }), false, 900); });
    this.after(c.round === 0 ? 1100 : 1900, () => this.startWindow());
  }

  private startWindow(): void {
    if (this.phase !== 'prep' || this.s.stage !== 'combat' || !this.s.combat) return;
    const c = this.s.combat;
    this.timers = [];
    this.phase = 'window';
    this.windowT = 0;
    if (c.kind !== 'pvp') {
      this.intent.b = previewMonsterChoice(this.s) ?? 'guard';
      this.windowMs = getMonster(c.monsterId!).tellMs * reactionScale();
    } else this.windowMs = PVP_WINDOW * reactionScale();
    this.els.timing.classList.add('on');
    this.setArc(0);
    this.markArc(null);
    this.els.items.innerHTML = '';
    this.els.itemsR.innerHTML = '';
    this.world.zoomTo(1.12);
    this.refreshHud();
    this.drawControls();
    audio.play('tick');
    if (c.kind !== 'pvp' && Math.random() < 0.35) audio.play('growl');
  }

  private tickWindow(dtMs: number): void {
    this.windowT += dtMs;
    const p = Math.min(1, this.windowT / this.windowMs);
    this.setArc(p);
    const c = this.s.combat!;
    if (c.kind !== 'pvp' && this.intent.b) this.telegraph(this.b, this.intent.b, p);
    for (const side of ['a', 'b'] as Side[]) {
      const t = this.botAt[side];
      if (t !== undefined && p >= t && !this.locked[side] && this.intent[side]) this.commit(side, this.intent[side]!, true);
    }
    if (p >= 1) this.impact();
  }

  /**
   * The monster's wind-up, readable three ways at once: its body (clip or procedural pose), a coloured
   * aura (model glow, ground ring, light) and a badge over its head. Strike and Feint share the first
   * half of the wind-up; then Strike turns red and Feint flickers gold. Guard shows blue from the start.
   */
  private telegraph(actor: Actor3D, choice: Choice, p: number): void {
    if (choice === 'guard') {
      const g = Math.min(1, p / 0.15);
      actor.pose('Blocking', Math.min(1, p * 1.6) * 0.5);
      actor.setGlow(0x3aa0ff, 0.35 + 0.65 * g);
      this.showIntent('guard', p);
      return;
    }
    if (p <= 0.55) {
      actor.pose('1H_Melee_Attack_Chop', (p / 0.55) * 0.3);
      actor.setGlow(0xd8d0ff, 0.15 + 0.15 * Math.sin(p * 30) ** 2);
      this.showIntent('windup', p);
      return;
    }
    const q = (p - 0.55) / 0.45;
    if (choice === 'strike') {
      actor.pose('1H_Melee_Attack_Chop', 0.3 + q * 0.08);
      actor.setGlow(0xff2a10, 0.55 + q * 0.45);
      this.showIntent('strike', p);
    } else {
      actor.pose('1H_Melee_Attack_Slice_Horizontal', 0.08 + q * 0.18);
      actor.setGlow(0xffc030, (0.45 + 0.55 * q) * (0.4 + 0.6 * Math.abs(Math.sin(p * 40))));
      this.showIntent('feint', p);
    }
  }

  /** Badge over the monster's head naming the move it is winding up, and what beats it. */
  private showIntent(kind: 'guard' | 'strike' | 'feint' | 'windup' | null, p: number): void {
    const box = this.els.intent;
    if (!kind) { box.className = 'a3d-intent'; box.dataset.kind = ''; return; }
    if (box.dataset.kind !== kind) {
      box.dataset.kind = kind;
      const info = {
        guard: ['checked-shield', t('Guard'), t('beat it with <b>Feint</b>')],
        strike: ['broadsword', t('Strike'), t('beat it with <b>Guard</b>')],
        feint: ['cloak-dagger', t('Feint'), t('beat it with <b>Strike</b>')],
        windup: ['help', t('Strike or Feint?'), t('watch for <b class="r">red</b> or <b class="g">gold</b>')],
      }[kind];
      box.innerHTML = `<div class="ic">${icon(info[0])}</div><div class="tx"><b>${info[1]}</b><small>${info[2]}</small></div>`;
      box.className = `a3d-intent on k-${kind}`;
    }
    const head = this.b.root.position.clone().add(new THREE.Vector3(0, Math.min(this.b.height, 2.6) + 0.35, 0)).project(this.world.camera);
    box.style.left = `${((head.x + 1) / 2) * 100}%`;
    box.style.top = `${Math.max(26, ((1 - head.y) / 2) * 100)}%`;
    box.style.setProperty('--p', String(p));
  }

  private key(e: KeyboardEvent): void {
    if (this.phase === 'closed') return;
    const k = e.key.toLowerCase();
    e.stopPropagation();
    if ((k === ' ' || k === 'enter') && this.phase === 'prep') { e.preventDefault(); return this.startWindow(); }
    if ((k === ' ' || k === 'enter') && this.phase === 'over') { e.preventDefault(); return this.finish(); }
    const choice = KEYS[k];
    if (!choice || this.phase !== 'window') return;
    const c = this.s.combat!;
    let side: Side = 'a';
    if (c.kind === 'pvp') {
      const ha = this.human('a');
      const hb = this.human('b');
      if (ha && hb) {
        if (LEFT.has(k)) side = 'a';
        else if (RIGHT.has(k)) side = 'b';
        else return;
      } else side = ha ? 'a' : 'b';
    }
    if (this.human(side)) this.commit(side, choice);
  }

  private commit(side: Side, choice: Choice, fromBot = false): void {
    if (this.phase !== 'window' || this.locked[side]) return;
    const f = side === 'a' ? combatFighters(this.s).a : combatFighters(this.s).b;
    if (!allowedChoices(f).includes(choice)) {
      if (!fromBot) this.pop(side, t('No stamina'), 'info');
      return;
    }
    const p = Math.min(1, this.windowT / this.windowMs);
    this.locked[side] = choice;
    this.lockedAt[side] = p;
    const c = this.s.combat!;
    if (c.kind !== 'pvp' && side === 'a') {
      // your stance shows at once against a monster; in a duel nothing is shown until the clash
      if (choice === 'guard') this.a.pose('Blocking', 0.45);
      else if (choice === 'strike') this.a.pose('1H_Melee_Attack_Chop', 0.3);
      else this.a.pose('1H_Melee_Attack_Slice_Horizontal', 0.18);
      this.markArc(p);
      audio.play('click');
    }
    this.refreshHud();
    this.drawControls();
    if (c.kind === 'pvp' && this.locked.a && this.locked.b) this.after(120, () => this.impact());
  }

  private impact(): void {
    if (this.phase !== 'window') return;
    this.phase = 'impact';
    this.els.timing.classList.remove('on');
    this.els.controls.innerHTML = '';
    this.showIntent(null, 0);
    this.world.zoomTo(1);
    const before = this.s;
    const c0 = before.combat!;
    const hesitated: Side[] = [];
    const pick = (side: Side): { choice: Choice; perfect: boolean } => {
      const ch = this.locked[side];
      if (!ch) { hesitated.push(side); return { choice: 'guard', perfect: false }; }
      const late = (this.lockedAt[side] ?? 0) >= PERFECT_FROM;
      const bot = this.knight(side)?.bot ?? false;
      return { choice: ch, perfect: late && (!bot || Math.random() < 0.6) };
    };
    const pa = pick('a');
    const pb = c0.kind === 'pvp' ? pick('b') : { choice: this.intent.b!, perfect: false };
    const hpA0 = combatHp(before, 'a').hp;
    const hpB0 = combatHp(before, 'b').hp;
    this.host.dispatch({ type: 'choose', side: 'a', choice: pa.choice, perfect: pa.perfect });
    if (c0.kind === 'pvp') this.host.dispatch({ type: 'choose', side: 'b', choice: pb.choice, perfect: pb.perfect });
    const after = this.s;
    const c = after.combat;
    if (!c) return;
    const winner = c.lastWinner ?? 'tie';
    const perfect = c.lastPerfect;
    const dmgA = hpA0 - combatHp(after, 'a').hp;
    const dmgB = hpB0 - combatHp(after, 'b').hp;
    this.a.setGlow(0, 0);
    this.b.setGlow(0, 0);

    const perform = (side: Side, choice: Choice) => {
      const actor = this.actor(side);
      const won = winner === side;
      if (choice === 'guard') {
        actor.play(won ? 'Block_Attack' : 'Blocking', { loop: false, speed: 1.3 });
        if (won) this.lunge(side, 0.8, 0.5);
      } else {
        actor.play(choice === 'strike' ? '1H_Melee_Attack_Chop' : '1H_Melee_Attack_Slice_Horizontal', { loop: false, speed: 1.55, fade: 0.06 });
        this.lunge(side, choice === 'strike' ? 1.05 : 0.7, 0.62);
        this.world.fx.kickDust(actor.root.position.clone());
      }
    };
    perform('a', c.lastA ?? pa.choice);
    perform('b', c.lastB ?? pb.choice);
    audio.play((c.lastA ?? pa.choice) === 'feint' || (c.lastB ?? pb.choice) === 'feint' ? 'whoosh' : 'swing');

    this.after(240, () => {
      const mid = this.a.root.position.clone().lerp(this.b.root.position, 0.5).add(new THREE.Vector3(0, 1.2, 0));
      const guardWin = (c.lastA === 'guard' && winner === 'a') || (c.lastB === 'guard' && winner === 'b');
      if (winner === 'tie' || guardWin) {
        this.world.fx.spark(mid, 28);
        audio.play(winner === 'tie' ? 'clash' : 'block');
      }
      const hit = (side: Side, dmg: number) => {
        if (dmg <= 0) return;
        const heavy = winner !== 'tie';
        const actor = this.actor(side);
        actor.play(heavy ? 'Hit_B' : 'Hit_A', { loop: false, speed: 1.2, fade: 0.05 });
        actor.flash();
        const dir = side === 'a' ? -1 : 1;
        this.world.fx.bleed(actor.chestWorld(), heavy, dir);
        this.lunge(side, heavy ? -0.55 : -0.25, 0.45);
        this.pop(side, `${dmg}${heavy ? ' ×2' : ''}`, perfect && perfect !== side ? 'gold' : '');
      };
      hit('a', dmgA);
      hit('b', dmgB);
      const big = Math.max(dmgA, dmgB);
      if (big > 0) {
        audio.play(winner !== 'tie' ? 'heavy' : 'hit', Math.min(1.4, big / 12));
        this.world.addShake(Math.min(0.25, 0.04 + big * 0.008));
      }
      if (perfect) {
        this.hitStop(170, 0.03);
        this.world.flash(0xffd36a, 0.35);
        this.world.zoomTo(1.25);
        this.after(420, () => this.world.zoomTo(1));
        this.banner(t('Perfect'), true, 1000);
        audio.play('chime');
      } else if (winner !== 'tie' && big > 0) {
        this.hitStop(90);
        this.world.flash(0x5a0a0a, 0.25);
        this.banner(t('{name} wins the exchange', { name: this.nameOf(winner) }));
      } else if (winner === 'tie') this.banner(t('Clash'));
    });
    for (const side of hesitated) this.pop(side, t('Hesitated - Guard'), 'info');
    this.after(1900, () => {
      this.refreshHud();
      if (this.s.combat?.over) this.over();
      else {
        this.a.play('Idle_Combat');
        this.b.play('Idle_Combat');
        this.prep();
      }
    });
  }

  private nameOf(side: 'a' | 'b'): string {
    return this.knight(side)?.name ?? tn(this.s.combat!.monster!.name);
  }

  private over(): void {
    this.phase = 'over';
    const c = this.s.combat!;
    const loserSide: Side = c.outcome === 'a' ? 'b' : 'a';
    const winSide: Side = c.outcome === 'a' ? 'a' : 'b';
    const loser = this.actor(loserSide);
    this.refreshHud();
    // slow-motion finish with the camera swinging around the fallen
    this.timeScale = 0.35;
    window.setTimeout(() => { this.timeScale = 1; }, 1100);
    loser.play(Math.random() < 0.5 ? 'Death_A' : 'Death_B', { loop: false, fade: 0.08 });
    loser.flash();
    this.world.fx.bleed(loser.chestWorld(), true, loserSide === 'a' ? -1 : 1);
    this.world.setCamera(new THREE.Vector3(loserSide === 'a' ? -2.4 : 2.4, 1.5, 4.6), loser.root.position.clone().add(new THREE.Vector3(0, 0.8, 0)));
    this.world.zoomTo(1.15);
    this.world.orbit = 0;
    let tt = 0;
    const spin = () => {
      if (this.phase !== 'over') return;
      tt += 0.016;
      this.world.orbit = Math.sin(tt * 0.6) * 0.5;
      requestAnimationFrame(spin);
    };
    spin();
    audio.play('death');
    this.after(900, () => this.actor(winSide).play(this.knight(winSide) ? 'Cheer' : 'Taunt', { loop: false }));
    const humanWon = (c.outcome === 'a' && this.human('a')) || (c.outcome === 'b' && this.human('b'));
    const humanLost = (c.outcome === 'b' && this.human('a')) || (c.outcome === 'a' && this.human('b'));
    this.after(600, () => audio.play(humanWon || !humanLost ? 'victory' : 'defeat'));
    this.banner(t('{name} is victorious', { name: this.nameOf(winSide) }), false, 60000, humanLost);
    this.drawControls();
    if (!(this.human('a') || this.human('b'))) this.after(1800, () => this.finish());
  }

  private finish(): void {
    if (this.phase !== 'over') return;
    this.phase = 'prep';
    this.host.dispatch({ type: 'continue' });
  }

  close(): void {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onResize);
    this.a.dispose();
    this.b.dispose();
    this.world.dispose();
    this.root.remove();
    if (Arena3D.current === this) Arena3D.current = null;
  }
}
