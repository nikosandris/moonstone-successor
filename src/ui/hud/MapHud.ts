// The map-screen interface as HTML over the Phaser canvas: side panel, chronicle, action bar, modals, tutorial.
// It only reads the game state and dispatches actions; the map itself stays in Phaser.
import {
  buyCheck, eventOptionBlock, healQuote, nextKnightId, stealableSeals,
} from '../../core/game';
import { daysUntilFull, isSanctumOpen, moonEffect, phaseForDay } from '../../core/moon';
import { effectiveStats, shopPrice } from '../../core/stats';
import type { Action, GameState, Knight, MoonPhase } from '../../core/types';
import { CONFIG, PHASE_NAMES } from '../../data/balance';
import { BOARD } from '../../data/board';
import { LEVEL_THRESHOLDS, getBoon } from '../../data/boons';
import { getItem } from '../../data/items';
import { getScar } from '../../data/scars';
import { drawMoon } from '../art/textures';
import { getSettings } from '../settings';
import { SEAL_COLORS, hex } from '../theme';
import { icon } from './icons';

export interface MapHudHost {
  canvas(): HTMLCanvasElement;
  dispatch(a: Action): void;
  onMenu(): void;
  onToggleSound(): void;
  onExit(): void;
  onTutorial(step: number): void;
}

export interface TutorialStep {
  /** highlight rectangle in logical canvas pixels (1024 x 576) */
  rect: [number, number, number, number];
  text: string;
  wait?: boolean;
}

const BOON_ICON: Record<string, string> = {
  vigor: 'hearts', might: 'broadsword', bulwark: 'checked-shield', endurance: 'lightning-helix',
  secondWind: 'sands-of-time', fleetfoot: 'run', haggler: 'two-coins', feinter: 'cloak-dagger',
};
const KIND_ICON = { weapon: 'broadsword', armor: 'checked-shield', consumable: 'potion-ball' } as const;
const SEAL_NAMES = ['Wolf', 'Troll', 'Rust', 'Drake'];

const moonCache = new Map<MoonPhase, string>();
function moonUrl(p: MoonPhase): string {
  if (!moonCache.has(p)) moonCache.set(p, drawMoon(p, 160).toDataURL());
  return moonCache.get(p)!;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const pct = (x: number) => `${(x * 100).toFixed(3)}%`;

export class MapHud {
  readonly root = h('div', 'mh-root');
  private panel = h('div', 'mh-panel mb-frame nogems');
  private chronicle = h('div', 'mh-chron mb-frame nogems');
  private actions = h('div', 'mh-actions mb-frame nogems');
  private modal = h('div', 'mh-modal');
  private tut = h('div', 'mh-tut');
  private onResize = () => this.layout();
  private lastLogLen = -1;
  private dieTimer = 0;

  constructor(private host: MapHudHost) {
    this.root.append(this.panel, this.chronicle, this.actions, this.modal, this.tut);
    document.body.appendChild(this.root);
    window.addEventListener('resize', this.onResize);
    this.layout();
  }

  layout(): void {
    const r = this.host.canvas().getBoundingClientRect();
    Object.assign(this.root.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, fontSize: `${Math.max(9.5, (r.height / 576) * 16)}px` });
  }

  /** Place an element at logical canvas coordinates (1024 x 576). */
  private place(e: HTMLElement, x: number, y: number, w: number, hh: number): void {
    Object.assign(e.style, { left: pct(x / 1024), top: pct(y / 576), width: pct(w / 1024), height: pct(hh / 576) });
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    window.clearInterval(this.dieTimer);
    this.root.remove();
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  render(s: GameState, ui: { justRolled: boolean; tutorial: TutorialStep | null; tutIndex: number; tutTotal: number; actorBot: boolean }): void {
    this.layout();
    this.place(this.panel, 698, 6, 320, 564);
    this.place(this.chronicle, 6, 438, 422, 132);
    this.place(this.actions, 434, 438, 258, 132);
    this.renderPanel(s);
    this.renderChronicle(s);
    this.renderActions(s, ui.justRolled, ui.actorBot);
    this.renderModal(s);
    this.renderTutorial(ui.tutorial, ui.tutIndex, ui.tutTotal);
  }

  // ------------------------------------------------------------ side panel

  private renderPanel(s: GameState): void {
    const k = s.players[s.current];
    const e = effectiveStats(k);
    const phase = phaseForDay(s.day);
    const open = isSanctumOpen(s.day);
    const wep = k.weapon ? getItem(k.weapon) : null;
    const arm = k.armor ? getItem(k.armor) : null;
    const canUse = s.stage === 'roll' && !k.bot;
    const nextAt = LEVEL_THRESHOLDS[k.boons.length + k.pendingBoons];
    const prevAt = k.boons.length + k.pendingBoons > 0 ? LEVEL_THRESHOLDS[k.boons.length + k.pendingBoons - 1] : 0;
    const renownFrac = nextAt ? Math.min(1, (k.renown - prevAt) / (nextAt - prevAt)) : 1;
    const hpFrac = Math.max(0, k.hp / e.maxHp);
    const muted = getSettings().muted;

    this.panel.innerHTML = `
      <div class="mh-moon">
        <div class="mh-moondisc ${phase}"><img src="${moonUrl(phase)}" alt=""></div>
        <div class="mh-moontext">
          <div class="mb-title mh-day">Day ${s.day} <span>/ ${CONFIG.dayCap}</span></div>
          <div class="mh-phase ${phase}">${PHASE_NAMES[phase]}</div>
          <div class="mh-sanctum ${open ? 'open' : ''}">${open ? 'The Sanctum stands open' : `Sanctum opens in ${daysUntilFull(s.day)} day${daysUntilFull(s.day) === 1 ? '' : 's'}`}</div>
        </div>
        <div class="mh-tools">
          <button class="mh-icon" data-act="menu" title="Menu">${icon('scroll-unfurled')}</button>
          <button class="mh-icon ${muted ? 'off' : ''}" data-act="sound" title="Sound">${icon(muted ? 'sands-of-time' : 'campfire')}</button>
        </div>
      </div>
      <div class="mh-eff">${moonEffect(s.day).text}</div>
      <div class="mb-rule"></div>
      <div class="mh-knight">
        <div class="mb-medal" style="color:${hex(k.color)}">${icon('visored-helm')}</div>
        <div class="mh-kcol">
          <div class="mh-kname" style="color:${hex(k.color)}">${k.name}${k.bot ? '<span class="tag">bot</span>' : ''}${k.downed ? '<span class="tag red">fallen</span>' : ''}</div>
          <div class="mb-bar-wrap"><div class="mb-bar ${hpFrac < 0.3 ? 'low' : ''}"><div class="ghost" style="width:${hpFrac * 100}%"></div><div class="fill" style="width:${hpFrac * 100}%"></div><div class="val">${k.hp} / ${e.maxHp}</div></div></div>
          <div class="mh-stats">
            <span title="Attack (base + weapon)">${icon('broadsword')}${e.attack}<i>+${e.weaponBonus}</i></span>
            <span title="Defense (base + armor)">${icon('checked-shield')}${e.defense}<i>+${e.armorBonus}</i></span>
            <span title="Max stamina">${icon('lightning-helix')}${e.maxStamina}</span>
            <span class="gold" title="Gold">${icon('two-coins')}${k.gold}</span>
          </div>
        </div>
      </div>
      <div class="mh-gear">
        <div>${icon('broadsword')}<b>${wep ? wep.name : 'Bare hands'}</b><i>${wep ? wep.desc : ''}</i></div>
        <div>${icon('checked-shield')}<b>${arm ? arm.name : 'No armour'}</b><i>${arm ? arm.desc : ''}</i></div>
      </div>
      <div class="mh-items">${[0, 1, 2].map((i) => {
        const id = k.consumables[i];
        if (!id) return '<div class="mh-slot empty"></div>';
        const it = getItem(id);
        return `<button class="mh-slot" data-item="${i}" ${canUse ? '' : 'disabled'} title="${it.name}: ${it.desc}">${icon('potion-ball')}<span>${it.name}</span></button>`;
      }).join('')}</div>
      <div class="mh-seals"><span class="mh-label">Seals</span><div class="mh-gems">${[0, 1, 2, 3].map((i) => `<div class="mh-seal ${k.seals.includes(i) ? 'on' : ''}" style="--c:${hex(SEAL_COLORS[i])}" title="Seal of the ${SEAL_NAMES[i]}"></div>`).join('')}</div><span class="mh-need">${k.seals.length}/${CONFIG.sealsToEnter} to enter</span></div>
      <div class="mh-scars">${k.scars.length ? k.scars.map((id) => `<span title="${getScar(id).desc}">${icon('death-skull')}${getScar(id).name}</span>`).join('') : '<em>Unscarred</em>'}</div>
      <div class="mh-renown"><span class="mh-label">Renown ${k.renown}</span><div class="mh-rbar"><i style="width:${renownFrac * 100}%"></i></div><span class="mh-need">${nextAt ? `level ${k.boons.length + k.pendingBoons + 1} at ${nextAt}` : 'max level'}</span></div>
      ${k.boons.length ? `<div class="mh-boons">${k.boons.map((id) => `<span title="${getBoon(id).desc}">${icon(BOON_ICON[id] ?? 'winged-sword')}${getBoon(id).name}</span>`).join('')}</div>` : ''}
      <div class="mh-init">
        <div class="mh-label">Today's initiative</div>
        ${s.order.map((id, i) => {
          const p = s.players[id];
          const pe = effectiveStats(p);
          return `<div class="mh-row ${i < s.step ? 'done' : ''} ${p.id === s.current ? 'cur' : ''}">
            <span class="dot" style="background:${hex(p.color)}"></span><span class="nm">${i + 1}. ${p.name}</span>
            <span class="hp"><i style="width:${Math.max(0, p.hp / pe.maxHp) * 100}%"></i></span>
            <span class="sl">${p.seals.length}<b>◆</b></span><span class="gd">${p.gold}</span></div>`;
        }).join('')}
      </div>`;
    this.panel.querySelector('[data-act="menu"]')!.addEventListener('click', () => this.host.onMenu());
    this.panel.querySelector('[data-act="sound"]')!.addEventListener('click', () => this.host.onToggleSound());
    this.panel.querySelectorAll<HTMLButtonElement>('[data-item]').forEach((b) =>
      b.addEventListener('click', () => this.host.dispatch({ type: 'useItem', slot: Number(b.dataset.item) })));
  }

  // ------------------------------------------------------------ chronicle

  private renderChronicle(s: GameState): void {
    if (s.log.length === this.lastLogLen && this.chronicle.childElementCount) return;
    this.lastLogLen = s.log.length;
    const rows = s.log.slice(-14).map((e, i, arr) => `<div class="mh-entry ${i === arr.length - 1 ? 'new' : ''}"><b>D${e.day}</b>${e.text}</div>`).join('');
    this.chronicle.innerHTML = `<div class="mh-chron-title">${icon('scroll-unfurled')} Chronicle</div><div class="mh-chron-list">${rows}</div>`;
    const list = this.chronicle.querySelector('.mh-chron-list')!;
    list.scrollTop = list.scrollHeight;
  }

  // ------------------------------------------------------------ action bar

  private btn(parent: HTMLElement, label: string, sub: string, cls: string, onClick: () => void, disabled = false): HTMLButtonElement {
    const b = h('button', `mb-btn ${cls}`, `${label}${sub ? `<small>${sub}</small>` : ''}`);
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    parent.appendChild(b);
    return b;
  }

  private renderActions(s: GameState, justRolled: boolean, actorBot: boolean): void {
    const a = this.actions;
    a.innerHTML = '';
    window.clearInterval(this.dieTimer);
    const k = s.players[s.current];
    if (s.stage === 'gameOver') return;
    if (actorBot) {
      a.innerHTML = `<div class="mh-wait"><div class="mh-spin"></div>${s.players[s.stage === 'pvpLoot' && s.pendingLoot ? s.pendingLoot.winner : s.current].name} is thinking&hellip;</div>`;
      return;
    }
    switch (s.stage) {
      case 'roll': {
        a.appendChild(h('div', 'mh-who', `<span style="color:${hex(k.color)}">${k.name}</span>, your move`));
        this.btn(a, `${icon('dice-six-faces-six')} Roll`, 'Space / Enter', 'mb-big mh-wide', () => this.host.dispatch({ type: 'roll' }));
        break;
      }
      case 'move': {
        const wrap = h('div', 'mh-rolled');
        const die = h('div', 'mh-die');
        const setFace = (n: number) => { die.className = `mh-die f${n}`; die.innerHTML = '<i></i>'.repeat(n); };
        setFace(s.moveRoll);
        wrap.append(die, h('div', 'mh-rolltext', `<div class="mb-title">Rolled ${s.moveRoll}</div><div class="mb-sub">Tap a glowing place, up to ${s.moveRoll} step${s.moveRoll > 1 ? 's' : ''}. Tap your own to stay.</div>`));
        a.appendChild(wrap);
        if (justRolled) {
          let n = 0;
          die.classList.add('tumble');
          this.dieTimer = window.setInterval(() => {
            n++;
            if (n >= 9) {
              window.clearInterval(this.dieTimer);
              setFace(s.moveRoll);
              return;
            }
            setFace(1 + Math.floor(Math.random() * 6));
            die.classList.add('tumble');
          }, 55);
        }
        break;
      }
      case 'pvpOffer': {
        a.appendChild(h('div', 'mh-who', 'A rival blocks the road'));
        const col = h('div', 'mh-col');
        for (const id of s.challengeable) {
          this.btn(col, `${icon('crossed-swords')} Challenge ${s.players[id].name}`, '', 'mh-wide', () => this.host.dispatch({ type: 'challenge', target: id }));
        }
        this.btn(col, 'Leave in peace', '', 'dark mh-wide', () => this.host.dispatch({ type: 'leave' }));
        a.appendChild(col);
        break;
      }
      case 'turnEnd': {
        const nextId = nextKnightId(s);
        a.appendChild(h('div', 'mh-who', 'Turn complete'));
        this.btn(a, 'End turn', nextId === null ? 'A new day dawns' : `Pass to ${s.players[nextId].name}`, 'mb-big mh-wide green', () => this.host.dispatch({ type: 'endTurn' }));
        break;
      }
      default:
        a.innerHTML = '<div class="mh-wait">Resolve the encounter&hellip;</div>';
    }
  }

  // ------------------------------------------------------------ modals

  private openModal(cls: string, html: string): HTMLDivElement {
    this.modal.className = 'mh-modal on';
    const box = h('div', `mh-box mb-frame ${cls}`, html);
    this.modal.innerHTML = '';
    this.modal.appendChild(box);
    return box;
  }

  private closeModal(): void {
    this.modal.className = 'mh-modal';
    this.modal.innerHTML = '';
  }

  private renderModal(s: GameState): void {
    const k = s.players[s.current];
    if (s.stage === 'shop' && !k.bot) return this.shopModal(s, k);
    if (s.stage === 'event' && s.event && !k.bot) return this.eventModal(s, k);
    if (s.stage === 'levelUp' && s.boonChoices && !k.bot) return this.levelModal(s, k);
    if (s.stage === 'pvpLoot' && s.pendingLoot && !s.players[s.pendingLoot.winner].bot) return this.lootModal(s);
    if (s.stage === 'gameOver') return this.overModal(s);
    this.closeModal();
  }

  private shopModal(s: GameState, k: Knight): void {
    const nd = BOARD.nodes[k.pos];
    const e = effectiveStats(k);
    const q = healQuote(k);
    const rows = (nd.stock ?? []).map((id) => {
      const it = getItem(id);
      const why = buyCheck(k, id);
      return `<div class="mh-ware ${why ? 'no' : ''}">
        <div class="ic">${icon(KIND_ICON[it.kind])}</div>
        <div class="nm"><b>${it.name}</b><span class="tier t${it.tier}">${'◆'.repeat(it.tier)}</span><i>${it.desc}</i></div>
        <div class="pr">${icon('two-coins')}${shopPrice(k, it.price)}</div>
        <button class="mb-btn" data-buy="${id}" ${why ? 'disabled' : ''}>${why ?? 'Buy'}</button></div>`;
    }).join('');
    const box = this.openModal('mh-shop', `
      <div class="mh-head"><div><div class="mb-title">${nd.name}</div><div class="mb-sub">Village market &middot; HP ${k.hp}/${e.maxHp} &middot; pack ${k.consumables.length}/3</div></div>
      <div class="mh-purse">${icon('two-coins')}${k.gold}</div></div>
      <div class="mb-rule"></div>
      <div class="mh-wares">${rows}
        <div class="mh-ware heal"><div class="ic">${icon('hearts')}</div><div class="nm"><b>Healer</b><i>${q.hp > 0 ? `Restore ${q.hp} HP` : k.hp >= e.maxHp ? 'You are in full health' : 'You cannot afford healing'}</i></div>
        <div class="pr">${q.hp > 0 ? `${icon('two-coins')}${q.cost}` : ''}</div><button class="mb-btn" data-heal ${q.hp > 0 ? '' : 'disabled'}>Heal</button></div>
      </div>
      <div class="mh-foot"><button class="mb-btn dark mb-big" data-leave>Leave the village</button></div>`);
    box.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => b.addEventListener('click', () => this.host.dispatch({ type: 'buy', itemId: b.dataset.buy! })));
    box.querySelector('[data-heal]')?.addEventListener('click', () => this.host.dispatch({ type: 'heal' }));
    box.querySelector('[data-leave]')!.addEventListener('click', () => this.host.dispatch({ type: 'leave' }));
    void s;
  }

  private eventModal(s: GameState, k: Knight): void {
    const ev = s.event!;
    const icons: Record<string, string> = { merchant: 'shop', ambush: 'crossed-swords', shrine: 'sun', dice: 'dice-six-faces-six', traveler: 'campfire', wisp: 'crystal-ball', hermit: 'swords-emblem' };
    const box = this.openModal('mh-event', `
      <div class="mh-evicon">${icon(icons[ev.id] ?? 'scroll-unfurled')}</div>
      <div class="mb-title mh-evtitle">${ev.title}</div>
      <div class="mb-rule"></div>
      <p class="mh-evtext">${ev.text}</p>
      <div class="mh-purse small">${icon('two-coins')}${k.gold}</div>
      <div class="mh-options">${ev.options.map((o, i) => {
        const why = eventOptionBlock(s, i);
        const last = i === ev.options.length - 1;
        return `<button class="mb-btn ${last ? 'dark' : ''}" data-opt="${i}" ${why ? 'disabled' : ''}>${o.label}<small>${why ?? o.hint}</small></button>`;
      }).join('')}</div>`);
    box.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) => b.addEventListener('click', () => this.host.dispatch({ type: 'eventChoice', index: Number(b.dataset.opt) })));
  }

  private levelModal(s: GameState, k: Knight): void {
    const box = this.openModal('mh-level', `
      <div class="mb-banner mh-lvtitle">Level Up</div>
      <div class="mb-sub mh-lvsub">${k.name}'s renown grows &mdash; ${k.renown} victories. Choose a boon; it lasts the whole hunt.</div>
      <div class="mh-cards">${s.boonChoices!.map((id) => {
        const b = getBoon(id);
        return `<button class="mh-card" data-boon="${id}"><div class="ic">${icon(BOON_ICON[id] ?? 'winged-sword')}</div><div class="mb-title">${b.name}</div><div class="mb-rule"></div><div class="ds">${b.desc}</div></button>`;
      }).join('')}</div>`);
    box.querySelectorAll<HTMLButtonElement>('[data-boon]').forEach((b) => b.addEventListener('click', () => this.host.dispatch({ type: 'chooseBoon', id: b.dataset.boon! })));
  }

  private lootModal(s: GameState): void {
    const { winner, loser } = s.pendingLoot!;
    const w = s.players[winner];
    const l = s.players[loser];
    const can = stealableSeals(s, winner, loser).length > 0;
    const half = Math.floor(l.gold * CONFIG.deathGoldLoss);
    const box = this.openModal('mh-loot', `
      <div class="mb-banner mh-lvtitle">${w.name} prevails</div>
      <div class="mb-sub mh-lvsub">${l.name} falls in the dirt. Claim your spoils.</div>
      <div class="mh-cards two">
        <button class="mh-card" data-take="seal" ${can ? '' : 'disabled'}><div class="ic" style="color:#ffd36a">${icon('crowned-skull')}</div><div class="mb-title">Take a Seal</div><div class="mb-rule"></div><div class="ds">${can ? `${l.name} holds ${l.seals.length}; one you lack is yours` : `${l.name} holds no Seal you lack`}</div></button>
        <button class="mh-card" data-take="gold"><div class="ic" style="color:#ffd36a">${icon('two-coins')}</div><div class="mb-title">Take ${half} gold</div><div class="mb-rule"></div><div class="ds">Half of ${l.name}'s purse</div></button>
      </div>`);
    box.querySelectorAll<HTMLButtonElement>('[data-take]').forEach((b) => b.addEventListener('click', () => this.host.dispatch({ type: 'pvpLoot', take: b.dataset.take as 'seal' | 'gold' })));
  }

  private overModal(s: GameState): void {
    const w = s.players[s.winner!];
    const ranked = [...s.players].sort((a, b) => (b.id === w.id ? 1 : 0) - (a.id === w.id ? 1 : 0) || b.seals.length - a.seals.length || b.gold - a.gold);
    const most = (f: (k: Knight) => number) => [...s.players].sort((a, b) => f(b) - f(a))[0];
    const feared = most((k) => k.kills);
    const scarred = most((k) => k.scars.length);
    const rich = most((k) => k.goldEarned);
    const box = this.openModal('mh-over', `
      <div class="mb-sub mh-oversub">The hunt is over</div>
      <div class="mb-banner mh-overtitle" style="--who:${hex(w.color)}">${w.name} triumphs</div>
      <div class="mb-sub">${s.endReason === 'sanctum' ? `Slew the Hollow Warden on day ${s.day} and claimed the Sanctum.` : `Day ${CONFIG.dayCap} ended: the most Seals (then gold) wins.`}</div>
      <table class="mh-table"><thead><tr><th>Knight</th><th>${icon('crowned-skull')}Seals</th><th>${icon('two-coins')}Gold</th><th>${icon('crossed-swords')}Wins</th><th>Duels</th><th>${icon('death-skull')}Deaths</th><th>Levels</th><th>Scars</th></tr></thead><tbody>
      ${ranked.map((p) => `<tr class="${p.id === w.id ? 'win' : ''}"><td><span class="dot" style="background:${hex(p.color)}"></span><b style="color:${hex(p.color)}">${p.name}</b><i>${p.boons.map((id) => getBoon(id).name).join(', ') || 'no boons'}</i></td>
        <td>${p.seals.length}/4</td><td class="g">${p.gold}</td><td>${p.kills}</td><td>${p.duelsWon}</td><td class="${p.deaths ? 'r' : ''}">${p.deaths}</td><td>${p.boons.length}</td>
        <td class="sc">${p.scars.map((id) => getScar(id).name).join(', ') || '&mdash;'}</td></tr>`).join('')}
      </tbody></table>
      <div class="mh-awards">
        <div>${icon('crossed-swords')}<b>Most Feared</b>${feared.name} &middot; ${feared.kills} wins</div>
        <div>${icon('death-skull')}<b>Most Scarred</b>${scarred.scars.length ? `${scarred.name} &middot; ${scarred.scars.length}` : 'nobody'}</div>
        <div>${icon('two-coins')}<b>Deepest Purse</b>${rich.name} &middot; ${rich.goldEarned} earned</div>
      </div>
      <div class="mh-foot"><button class="mb-btn mb-big" data-exit>Back to the title</button></div>`);
    box.querySelector('[data-exit]')!.addEventListener('click', () => this.host.onExit());
  }

  // ------------------------------------------------------------ tutorial

  private renderTutorial(step: TutorialStep | null, index: number, total: number): void {
    this.tut.innerHTML = '';
    this.tut.className = step ? 'mh-tut on' : 'mh-tut';
    if (!step) return;
    const [x, y, w, hh] = step.rect;
    const shade = (l: number, t: number, ww: number, hh2: number) => {
      const d = h('div', 'mh-shade');
      this.place(d, l, t, ww, hh2);
      this.tut.appendChild(d);
    };
    shade(0, 0, 1024, y);
    shade(0, y + hh, 1024, 576 - y - hh);
    shade(0, y, x, hh);
    shade(x + w, y, 1024 - x - w, hh);
    const frame = h('div', 'mh-spot');
    this.place(frame, x, y, w, hh);
    this.tut.appendChild(frame);
    // coach box beside the highlight
    const boxW = 400;
    const boxH = 150;
    let bx = x + w + 18;
    if (bx + boxW > 1016) bx = x - boxW - 18;
    let by = Math.min(Math.max(8, y), 576 - boxH - 8);
    if (bx < 8) {
      bx = (1024 - boxW) / 2;
      by = y > 288 ? Math.max(8, y - boxH - 14) : Math.min(576 - boxH - 8, y + hh + 14);
    }
    const box = h('div', 'mh-coach mb-frame', `<div class="mh-coachstep">Tutorial ${index + 1} / ${total}</div><p>${step.text}</p><div class="mh-coachbtns">
      <button class="mb-btn dark" data-skip>Skip</button>${step.wait ? '' : `<button class="mb-btn" data-next>${index === total - 1 ? 'Done' : 'Next'}</button>`}</div>`);
    this.place(box, bx, by, boxW, boxH);
    box.style.height = 'auto';
    this.tut.appendChild(box);
    box.querySelector('[data-skip]')!.addEventListener('click', () => this.host.onTutorial(total));
    box.querySelector('[data-next]')?.addEventListener('click', () => this.host.onTutorial(index + 1));
  }
}
