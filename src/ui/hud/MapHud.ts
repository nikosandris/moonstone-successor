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
import { getEventDef } from '../../data/events';
import { getItem } from '../../data/items';
import { getMonster } from '../../data/monsters';
import { getScar } from '../../data/scars';
import { drawMoon } from '../art/textures';
import { getLang, t, td, tlog, tn } from '../i18n';
import { getSettings } from '../settings';
import { SEAL_COLORS, hex } from '../theme';
import { icon } from './icons';

export interface MapHudHost {
  dispatch(a: Action): void;
  onMenu(): void;
  onHelp(): void;
  onToggleSound(): void;
  onExit(): void;
  onTutorial(step: number): void;
  /** where a place is on screen (3D map), for the tutorial spotlight */
  nodeScreen(id: number): { x: number; y: number } | null;
}

export interface TutorialStep {
  /** what to spotlight: a HUD part ('moon', 'hero', 'roster', 'dock', 'chron'), 'map', or a place 'node:<id>' */
  target: string;
  text: string;
  title?: string;
  wait?: boolean;
}

export interface NodeTip {
  node: number;
  title: string;
  kind: string;
  text: string;
  reach: boolean;
  screen: { x: number; y: number } | null;
}

const BOON_ICON: Record<string, string> = {
  vigor: 'hearts', might: 'broadsword', bulwark: 'checked-shield', endurance: 'lightning-helix',
  secondWind: 'sands-of-time', fleetfoot: 'run', haggler: 'two-coins', feinter: 'cloak-dagger',
};
const KIND_ICON = { weapon: 'broadsword', armor: 'checked-shield', consumable: 'potion-ball' } as const;
const SEAL_NAMES = ['Wolf', 'Troll', 'Rust', 'Drake'];
const TIP_ICON: Record<string, string> = { home: 'castle', village: 'village', lair: 'cave-entrance', ruins: 'tombstone', road: 'footsteps', sanctum: 'sun' };

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

const sealGems = (k: Knight, cls = '') => `<div class="hx-gems ${cls}">${[0, 1, 2, 3].map((i) => `<i class="${k.seals.includes(i) ? 'on' : ''}" style="--c:${hex(SEAL_COLORS[i])}" title="${t(`Seal of the ${SEAL_NAMES[i]}`)}"></i>`).join('')}</div>`;

export class MapHud {
  readonly root = h('div', 'mh-root hx');
  private moon = h('div', 'hx-moon hx-glass');
  private tools = h('div', 'hx-tools');
  private roster = h('div', 'hx-roster');
  private hero = h('div', 'hx-hero hx-glass');
  private actions = h('div', 'hx-dock');
  private chronicle = h('div', 'hx-chron');
  private tip = h('div', 'hx-tip hx-glass');
  private turnBanner = h('div', 'hx-turn');
  private modal = h('div', 'mh-modal');
  private tut = h('div', 'mh-tut');
  private onResize = () => this.layout();
  private lastLogLen = -1;
  private lastLogLang = '';
  private dieTimer = 0;
  private tutTimer = 0;
  private tutFollow = 0;
  private lastTurnKey = '';
  private chronOpen = false;
  private heroOpen = true;

  constructor(private host: MapHudHost) {
    this.root.append(this.moon, this.tools, this.roster, this.hero, this.chronicle, this.actions, this.tip, this.turnBanner, this.modal, this.tut);
    document.body.appendChild(this.root);
    window.addEventListener('resize', this.onResize);
    this.heroOpen = window.innerHeight > 520;
    this.layout();
  }

  /** The HUD covers the whole window; its type scale follows the window size. */
  layout(): void {
    const w = window.innerWidth, hh = window.innerHeight;
    const base = Math.max(10, Math.min(17, Math.min(w / 78, hh / 44)));
    Object.assign(this.root.style, { left: '0px', top: '0px', width: `${w}px`, height: `${hh}px`, fontSize: `${base}px` });
    this.root.classList.toggle('compact', hh < 520);
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    window.clearInterval(this.dieTimer);
    window.clearTimeout(this.tutTimer);
    this.root.remove();
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  render(s: GameState, ui: { justRolled: boolean; tutorial: TutorialStep | null; tutIndex: number; tutTotal: number; actorBot: boolean }): void {
    this.layout();
    const over = s.stage === 'gameOver';
    for (const e of [this.moon, this.tools, this.roster, this.hero, this.chronicle, this.actions]) e.style.display = over ? 'none' : '';
    this.renderMoon(s);
    this.renderTools();
    this.renderRoster(s);
    this.renderHero(s);
    this.renderChronicle(s);
    this.renderActions(s, ui.justRolled, ui.actorBot);
    this.renderTurnBanner(s);
    this.renderModal(s);
    this.renderTutorial(ui.tutorial, ui.tutIndex, ui.tutTotal);
  }

  // ------------------------------------------------------------ moon & day

  private renderMoon(s: GameState): void {
    const phase = phaseForDay(s.day);
    const open = isSanctumOpen(s.day);
    const until = daysUntilFull(s.day);
    this.moon.innerHTML = `
      <div class="mh-moondisc ${phase}"><img src="${moonUrl(phase)}" alt=""></div>
      <div class="hx-moontext">
        <div class="hx-day">${t('Day {n}', { n: s.day })}<span> ${t('of {n}', { n: CONFIG.dayCap })}</span></div>
        <div class="mh-phase ${phase}">${tn(PHASE_NAMES[phase])}</div>
        <div class="mh-sanctum ${open ? 'open' : ''}">${open ? t('The Sanctum stands open') : t(until === 1 ? 'Sanctum opens in {n} day' : 'Sanctum opens in {n} days', { n: until })}</div>
        <div class="hx-eff">${td(moonEffect(s.day).text)}</div>
      </div>`;
  }

  private renderTools(): void {
    const muted = getSettings().muted;
    this.tools.innerHTML = `
      <button class="hx-ibtn hx-help" data-act="help" title="${t('How to play')}">${icon('help')}</button>
      <button class="hx-ibtn ${muted ? 'off' : ''}" data-act="sound" title="${t('Sound')}">${icon(muted ? 'sands-of-time' : 'campfire')}</button>
      <button class="hx-ibtn" data-act="menu" title="${t('Menu')}">${icon('scroll-unfurled')}</button>`;
    this.tools.querySelector('[data-act="menu"]')!.addEventListener('click', () => this.host.onMenu());
    this.tools.querySelector('[data-act="help"]')!.addEventListener('click', () => this.host.onHelp());
    this.tools.querySelector('[data-act="sound"]')!.addEventListener('click', () => this.host.onToggleSound());
  }

  // ------------------------------------------------------------ all knights, in today's order

  private renderRoster(s: GameState): void {
    this.roster.innerHTML = `<div class="hx-cap">${t("Today's order")}</div>` + s.order.map((id, i) => {
      const p = s.players[id];
      const pe = effectiveStats(p);
      const cur = p.id === s.current && s.stage !== 'gameOver';
      return `<div class="hx-knight ${cur ? 'cur' : ''} ${i < s.step ? 'done' : ''} ${p.downed ? 'down' : ''}" style="--pc:${hex(p.color)}">
        <div class="hx-num">${i + 1}</div>
        <div class="hx-pmedal">${icon('visored-helm')}</div>
        <div class="hx-kbody">
          <div class="hx-kname">${p.name}${p.bot ? `<em>${t('bot')}</em>` : ''}</div>
          <div class="hx-khp"><i style="width:${Math.max(0, p.hp / pe.maxHp) * 100}%"></i></div>
          <div class="hx-kmeta">${sealGems(p, 'sm')}<span class="g">${icon('two-coins')}${p.gold}</span></div>
        </div>
      </div>`;
    }).join('');
  }

  // ------------------------------------------------------------ the knight whose turn it is

  private renderHero(s: GameState): void {
    const k = s.players[s.current];
    const e = effectiveStats(k);
    const wep = k.weapon ? getItem(k.weapon) : null;
    const arm = k.armor ? getItem(k.armor) : null;
    const canUse = s.stage === 'roll' && !k.bot;
    const nextAt = LEVEL_THRESHOLDS[k.boons.length + k.pendingBoons];
    const prevAt = k.boons.length + k.pendingBoons > 0 ? LEVEL_THRESHOLDS[k.boons.length + k.pendingBoons - 1] : 0;
    const renownFrac = nextAt ? Math.min(1, (k.renown - prevAt) / (nextAt - prevAt)) : 1;
    const hpFrac = Math.max(0, k.hp / e.maxHp);
    const need = Math.max(0, CONFIG.sealsToEnter - k.seals.length);
    this.hero.className = `hx-hero hx-glass ${this.heroOpen ? 'open' : ''}`;
    this.hero.style.setProperty('--pc', hex(k.color));
    this.hero.innerHTML = `
      <div class="hx-hhead">
        <div class="mb-medal" style="color:${hex(k.color)}">${icon('visored-helm')}</div>
        <div class="hx-hcol">
          <div class="hx-hname" style="color:${hex(k.color)}">${k.name}${k.downed ? `<em class="red">${t('fallen')}</em>` : ''}</div>
          <div class="mb-bar-wrap"><div class="mb-bar ${hpFrac < 0.3 ? 'low' : ''}"><div class="ghost" style="width:${hpFrac * 100}%"></div><div class="fill" style="width:${hpFrac * 100}%"></div><div class="val">${k.hp} / ${e.maxHp}</div></div></div>
          <div class="hx-stats">
            <span title="${t('Attack: added to every blow you land')}">${icon('broadsword')}${e.attack}</span>
            <span title="${t('Defense: taken off every blow you suffer')}">${icon('checked-shield')}${e.defense}</span>
            <span title="${t('Stamina: Strike and Feint spend it, Guard restores it')}">${icon('lightning-helix')}${e.maxStamina}</span>
            <span class="gold" title="${t('Gold')}">${icon('two-coins')}${k.gold}</span>
          </div>
        </div>
        <button class="hx-fold" data-fold title="${t(this.heroOpen ? 'Hide details' : 'Show details')}">${this.heroOpen ? '&#9662;' : '&#9652;'}</button>
      </div>
      <div class="hx-seals"><span class="hx-cap">${t('Seals')}</span>${sealGems(k)}<span class="hx-need">${need ? t('{n} more to enter the Sanctum', { n: need }) : t('Ready for the Sanctum')}</span></div>
      <div class="hx-more">
        <div class="hx-gear">
          <div title="${wep ? td(wep.desc) : ''}">${icon('broadsword')}<b>${wep ? tn(wep.name) : t('Bare hands')}</b>${wep ? `<i>${td(wep.desc)}</i>` : ''}</div>
          <div title="${arm ? td(arm.desc) : ''}">${icon('checked-shield')}<b>${arm ? tn(arm.name) : t('No armour')}</b>${arm ? `<i>${td(arm.desc)}</i>` : ''}</div>
        </div>
        <div class="mh-items">${[0, 1, 2].map((i) => {
          const id = k.consumables[i];
          if (!id) return `<div class="mh-slot empty" title="${t('Empty pack slot - buy potions in villages')}"></div>`;
          const it = getItem(id);
          return `<button class="mh-slot" data-item="${i}" ${canUse ? '' : 'disabled'} title="${tn(it.name)}: ${td(it.desc)}${canUse ? '' : ' ' + t('(use before rolling)')}">${icon('potion-ball')}<span>${tn(it.name)}</span></button>`;
        }).join('')}</div>
        <div class="mh-renown"><span class="hx-cap">${t('Renown {n}', { n: k.renown })}</span><div class="mh-rbar"><i style="width:${renownFrac * 100}%"></i></div><span class="hx-need">${nextAt ? t('level up at {n}', { n: nextAt }) : t('max level')}</span></div>
        ${k.boons.length || k.scars.length ? `<div class="hx-tags">${k.boons.map((id) => `<span class="boon" title="${td(getBoon(id).desc)}">${icon(BOON_ICON[id] ?? 'winged-sword')}${tn(getBoon(id).name)}</span>`).join('')}${k.scars.map((id) => `<span class="scar" title="${td(getScar(id).desc)}">${icon('death-skull')}${tn(getScar(id).name)}</span>`).join('')}</div>` : ''}
      </div>`;
    this.hero.querySelector('[data-fold]')!.addEventListener('click', () => { this.heroOpen = !this.heroOpen; this.renderHero(s); });
    this.hero.querySelectorAll<HTMLButtonElement>('[data-item]').forEach((b) =>
      b.addEventListener('click', () => this.host.dispatch({ type: 'useItem', slot: Number(b.dataset.item) })));
  }

  // ------------------------------------------------------------ chronicle

  private renderChronicle(s: GameState): void {
    if (s.log.length === this.lastLogLen && this.lastLogLang === getLang() && this.chronicle.childElementCount) return;
    this.lastLogLen = s.log.length;
    this.lastLogLang = getLang();
    const rows = s.log.slice(this.chronOpen ? -40 : -4).map((e, i, arr) => `<div class="hx-entry ${i === arr.length - 1 ? 'new' : ''}"><b>${t('D{n}', { n: e.day })}</b>${tlog(e.text)}</div>`).join('');
    this.chronicle.className = `hx-chron ${this.chronOpen ? 'open hx-glass' : ''}`;
    this.chronicle.innerHTML = `<button class="hx-chead" data-chron>${icon('scroll-unfurled')} ${t('Chronicle')} <span>${t(this.chronOpen ? 'close' : 'all')}</span></button><div class="hx-clist">${rows}</div>`;
    const list = this.chronicle.querySelector('.hx-clist')!;
    list.scrollTop = list.scrollHeight;
    this.chronicle.querySelector('[data-chron]')!.addEventListener('click', () => { this.chronOpen = !this.chronOpen; this.lastLogLen = -1; this.renderChronicle(s); });
  }

  // ------------------------------------------------------------ place tooltip

  setTooltip(tip: NodeTip | null): void {
    if (!tip) { this.tip.classList.remove('on'); return; }
    const n = BOARD.nodes[tip.node];
    this.tip.innerHTML = `<div class="hx-tiphead"><span class="ic">${icon(TIP_ICON[n.type] ?? 'scroll-unfurled')}</span><div><div class="hx-tiptitle">${tip.title}</div><div class="hx-tipkind">${tip.kind}</div></div></div>
      <p>${tip.text}</p>${tip.reach ? `<div class="hx-tipgo">${t('Tap to travel here')}</div>` : ''}`;
    this.tip.classList.add('on');
    const r = this.root.getBoundingClientRect();
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    let x = tip.screen ? tip.screen.x - tw / 2 : r.width / 2 - tw / 2;
    let y = tip.screen ? tip.screen.y - th - 14 : r.height * 0.18;
    x = Math.max(8, Math.min(r.width - tw - 8, x));
    if (y < 8) y = (tip.screen?.y ?? 0) + 40;
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${Math.min(r.height - th - 8, y)}px`;
  }

  // ------------------------------------------------------------ whose turn

  private renderTurnBanner(s: GameState): void {
    const key = `${s.day}:${s.current}`;
    if (key === this.lastTurnKey || s.stage === 'gameOver') return;
    const firstShow = this.lastTurnKey === '';
    this.lastTurnKey = key;
    const k = s.players[s.current];
    this.turnBanner.innerHTML = `<div class="hx-turnin" style="--pc:${hex(k.color)}"><small>${t('Day {n}', { n: s.day })}</small><b>${k.name}</b><span>${t(k.bot ? 'takes their turn' : 'your turn')}</span></div>`;
    this.turnBanner.classList.remove('on');
    void this.turnBanner.offsetWidth;
    if (!firstShow || !k.bot) this.turnBanner.classList.add('on');
  }

  // ------------------------------------------------------------ action dock

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
    if (s.stage === 'gameOver') return;
    if (actorBot) {
      a.innerHTML = `<div class="mh-wait hx-glass"><div class="mh-spin"></div>${t('{name} is thinking&hellip;', { name: s.players[s.stage === 'pvpLoot' && s.pendingLoot ? s.pendingLoot.winner : s.current].name })}</div>`;
      return;
    }
    switch (s.stage) {
      case 'roll': {
        this.btn(a, `${icon('dice-six-faces-six')} ${t('Roll the die')}`, t('then choose where to go &middot; Space'), 'mb-big hx-main', () => this.host.dispatch({ type: 'roll' }));
        break;
      }
      case 'move': {
        const wrap = h('div', 'mh-rolled hx-glass');
        const die = h('div', 'mh-die');
        const setFace = (n: number) => { die.className = `mh-die f${n}`; die.innerHTML = '<i></i>'.repeat(n); };
        setFace(s.moveRoll);
        wrap.append(die, h('div', 'mh-rolltext', `<div class="mb-title">${t('You rolled {n}', { n: s.moveRoll })}</div><div class="mb-sub">${t(s.moveRoll > 1 ? 'Tap a glowing place on the map, up to {n} steps away. Your own spot = stay.' : 'Tap a glowing place on the map, up to {n} step away. Your own spot = stay.', { n: s.moveRoll })}</div>`));
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
        const col = h('div', 'mh-col hx-glass');
        col.appendChild(h('div', 'mh-who', t('A rival blocks the road')));
        for (const id of s.challengeable) {
          this.btn(col, `${icon('crossed-swords')} ${t('Challenge {name}', { name: s.players[id].name })}`, t('winner takes a Seal or half their gold'), 'mh-wide', () => this.host.dispatch({ type: 'challenge', target: id }));
        }
        this.btn(col, t('Leave in peace'), '', 'dark mh-wide', () => this.host.dispatch({ type: 'leave' }));
        a.appendChild(col);
        break;
      }
      case 'turnEnd': {
        const nextId = nextKnightId(s);
        this.btn(a, t('End turn'), nextId === null ? t('a new day dawns') : t('pass to {name}', { name: s.players[nextId].name }), 'mb-big hx-main green', () => this.host.dispatch({ type: 'endTurn' }));
        break;
      }
      default:
        a.innerHTML = `<div class="mh-wait hx-glass">${t('Resolve the encounter&hellip;')}</div>`;
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
        <div class="nm"><b>${tn(it.name)}</b><span class="tier t${it.tier}">${'◆'.repeat(it.tier)}</span><i>${td(it.desc)}</i></div>
        <div class="pr">${icon('two-coins')}${shopPrice(k, it.price)}</div>
        <button class="mb-btn" data-buy="${id}" ${why ? 'disabled' : ''}>${why ? t(why) : t('Buy')}</button></div>`;
    }).join('');
    const box = this.openModal('mh-shop', `
      <div class="mh-head"><div><div class="mb-title">${tn(nd.name)}</div><div class="mb-sub">${t('Village market &middot; HP {hp}/{max} &middot; pack {n}/3', { hp: k.hp, max: e.maxHp, n: k.consumables.length })}</div></div>
      <div class="mh-purse">${icon('two-coins')}${k.gold}</div></div>
      <div class="mb-rule"></div>
      <div class="mh-wares">${rows}
        <div class="mh-ware heal"><div class="ic">${icon('hearts')}</div><div class="nm"><b>${t('Healer')}</b><i>${q.hp > 0 ? t('Restore {n} HP', { n: q.hp }) : t(k.hp >= e.maxHp ? 'You are in full health' : 'You cannot afford healing')}</i></div>
        <div class="pr">${q.hp > 0 ? `${icon('two-coins')}${q.cost}` : ''}</div><button class="mb-btn" data-heal ${q.hp > 0 ? '' : 'disabled'}>${t('Heal')}</button></div>
      </div>
      <div class="mh-foot"><button class="mb-btn dark mb-big" data-leave>${t('Leave the village')}</button></div>`);
    box.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => b.addEventListener('click', () => this.host.dispatch({ type: 'buy', itemId: b.dataset.buy! })));
    box.querySelector('[data-heal]')?.addEventListener('click', () => this.host.dispatch({ type: 'heal' }));
    box.querySelector('[data-leave]')!.addEventListener('click', () => this.host.dispatch({ type: 'leave' }));
    void s;
  }

  private eventModal(s: GameState, k: Knight): void {
    const ev = s.event!;
    // re-fill the event's English templates with translated names (the core fills them in English)
    const def = getEventDef(ev.id);
    const d = ev.data;
    const vars: Record<string, string | number> = {
      item: d.item ? tn(getItem(String(d.item)).name) : '',
      price: d.price ?? '',
      desc: d.item ? td(getItem(String(d.item)).desc) : '',
      monster: d.monster ? tn(getMonster(String(d.monster)).name) : '',
      flee: d.flee ?? '',
    };
    const fill = (str: string) => str.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
    const opts = ev.options.map((o, i) => (def.options[i] ? { label: fill(td(def.options[i].label)), hint: fill(td(def.options[i].hint)) } : o));
    const icons: Record<string, string> = { merchant: 'shop', ambush: 'crossed-swords', shrine: 'sun', dice: 'dice-six-faces-six', traveler: 'campfire', wisp: 'crystal-ball', hermit: 'swords-emblem' };
    const box = this.openModal('mh-event', `
      <div class="mh-evicon">${icon(icons[ev.id] ?? 'scroll-unfurled')}</div>
      <div class="mb-title mh-evtitle">${tn(def.title)}</div>
      <div class="mb-rule"></div>
      <p class="mh-evtext">${fill(td(def.text))}</p>
      <div class="mh-purse small">${icon('two-coins')}${k.gold}</div>
      <div class="mh-options">${opts.map((o, i) => {
        const why = eventOptionBlock(s, i);
        const last = i === opts.length - 1;
        return `<button class="mb-btn ${last ? 'dark' : ''}" data-opt="${i}" ${why ? 'disabled' : ''}>${o.label}<small>${why ? t(why) : o.hint}</small></button>`;
      }).join('')}</div>`);
    box.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) => b.addEventListener('click', () => this.host.dispatch({ type: 'eventChoice', index: Number(b.dataset.opt) })));
  }

  private levelModal(s: GameState, k: Knight): void {
    const box = this.openModal('mh-level', `
      <div class="mb-banner mh-lvtitle">${t('Level Up')}</div>
      <div class="mb-sub mh-lvsub">${t("{name}'s renown grows &mdash; {n} victories. Choose a boon; it lasts the whole hunt.", { name: k.name, n: k.renown })}</div>
      <div class="mh-cards">${s.boonChoices!.map((id) => {
        const b = getBoon(id);
        return `<button class="mh-card" data-boon="${id}"><div class="ic">${icon(BOON_ICON[id] ?? 'winged-sword')}</div><div class="mb-title">${tn(b.name)}</div><div class="mb-rule"></div><div class="ds">${td(b.desc)}</div></button>`;
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
      <div class="mb-banner mh-lvtitle">${t('{name} prevails', { name: w.name })}</div>
      <div class="mb-sub mh-lvsub">${t('{name} falls in the dirt. Claim your spoils.', { name: l.name })}</div>
      <div class="mh-cards two">
        <button class="mh-card" data-take="seal" ${can ? '' : 'disabled'}><div class="ic" style="color:#ffd36a">${icon('crowned-skull')}</div><div class="mb-title">${t('Take a Seal')}</div><div class="mb-rule"></div><div class="ds">${can ? t('{name} holds {n}; one you lack is yours', { name: l.name, n: l.seals.length }) : t('{name} holds no Seal you lack', { name: l.name })}</div></button>
        <button class="mh-card" data-take="gold"><div class="ic" style="color:#ffd36a">${icon('two-coins')}</div><div class="mb-title">${t('Take {n} gold', { n: half })}</div><div class="mb-rule"></div><div class="ds">${t("Half of {name}'s purse", { name: l.name })}</div></button>
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
      <div class="mb-sub mh-oversub">${t('The hunt is over')}</div>
      <div class="mb-banner mh-overtitle" style="--who:${hex(w.color)}">${t('{name} triumphs', { name: w.name })}</div>
      <div class="mb-sub">${s.endReason === 'sanctum' ? t('Slew the Hollow Warden on day {n} and claimed the Sanctum.', { n: s.day }) : t('Day {n} ended: the most Seals (then gold) wins.', { n: CONFIG.dayCap })}</div>
      <table class="mh-table"><thead><tr><th>${t('Knight')}</th><th>${icon('crowned-skull')}${t('Seals')}</th><th>${icon('two-coins')}${t('Gold')}</th><th>${icon('crossed-swords')}${t('Wins')}</th><th>${t('Duels')}</th><th>${icon('death-skull')}${t('Deaths')}</th><th>${t('Levels')}</th><th>${t('Scars')}</th></tr></thead><tbody>
      ${ranked.map((p) => `<tr class="${p.id === w.id ? 'win' : ''}"><td><span class="dot" style="background:${hex(p.color)}"></span><b style="color:${hex(p.color)}">${p.name}</b><i>${p.boons.map((id) => tn(getBoon(id).name)).join(', ') || t('no boons')}</i></td>
        <td>${p.seals.length}/4</td><td class="g">${p.gold}</td><td>${p.kills}</td><td>${p.duelsWon}</td><td class="${p.deaths ? 'r' : ''}">${p.deaths}</td><td>${p.boons.length}</td>
        <td class="sc">${p.scars.map((id) => tn(getScar(id).name)).join(', ') || '&mdash;'}</td></tr>`).join('')}
      </tbody></table>
      <div class="mh-awards">
        <div>${icon('crossed-swords')}<b>${t('Most Feared')}</b>${feared.name} &middot; ${t('{n} wins', { n: feared.kills })}</div>
        <div>${icon('death-skull')}<b>${t('Most Scarred')}</b>${scarred.scars.length ? `${scarred.name} &middot; ${scarred.scars.length}` : t('nobody')}</div>
        <div>${icon('two-coins')}<b>${t('Deepest Purse')}</b>${rich.name} &middot; ${t('{n} earned', { n: rich.goldEarned })}</div>
      </div>
      <div class="mh-foot"><button class="mb-btn mb-big" data-exit>${t('Back to the title')}</button></div>`);
    box.querySelector('[data-exit]')!.addEventListener('click', () => this.host.onExit());
  }

  // ------------------------------------------------------------ tutorial

  private targetRect(target: string): DOMRect | null {
    const r = this.root.getBoundingClientRect();
    if (target === 'map') return new DOMRect(r.width * 0.18, r.height * 0.16, r.width * 0.64, r.height * 0.6);
    if (target.startsWith('node:')) {
      const p = this.host.nodeScreen(Number(target.slice(5)));
      if (!p) return null;
      const sz = Math.min(r.width, r.height) * 0.2;
      return new DOMRect(p.x - sz / 2, p.y - sz * 0.6, sz, sz);
    }
    const el = this.root.querySelector<HTMLElement>(`.hx-${target}`);
    return el && el.offsetParent ? el.getBoundingClientRect() : null;
  }

  private renderTutorial(step: TutorialStep | null, index: number, total: number, follow = false): void {
    window.clearTimeout(this.tutTimer);
    this.tut.innerHTML = '';
    this.tut.className = step ? 'mh-tut on' : 'mh-tut';
    if (!step) return;
    // places move on screen while the camera glides: keep the spotlight on them for a moment
    if (step.target.startsWith('node:') || step.target === 'map') {
      if (!follow) this.tutFollow = 0;
      if (this.tutFollow++ < 12) this.tutTimer = window.setTimeout(() => this.renderTutorial(step, index, total, true), 250);
    }
    const R = this.root.getBoundingClientRect();
    const tr = this.targetRect(step.target);
    const pad = 6;
    const x = tr ? tr.left - pad : R.width / 2, y = tr ? tr.top - pad : R.height / 2;
    const w = tr ? tr.width + pad * 2 : 0, hh = tr ? tr.height + pad * 2 : 0;
    const frame = h('div', 'mh-spot');
    Object.assign(frame.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hh}px` });
    if (step.wait) frame.classList.add('pass');
    this.tut.appendChild(frame);
    if (step.wait) this.tut.classList.add('pass');
    const box = h('div', 'mh-coach mb-frame', `<div class="mh-coachstep">${step.title ?? t('Tutorial')} &middot; ${index + 1} / ${total}</div><p>${step.text}</p><div class="mh-coachbtns">
      <button class="mb-btn dark" data-skip>${t('Skip tutorial')}</button>${step.wait ? `<span class="mh-coachwait">${t('Your move&hellip;')}</span>` : `<button class="mb-btn" data-next>${t(index === total - 1 ? 'Done' : 'Next')}</button>`}</div>`);
    this.tut.appendChild(box);
    const bw = Math.min(R.width - 16, 24 * parseFloat(this.root.style.fontSize || '14'));
    box.style.width = `${bw}px`;
    const bh = box.offsetHeight;
    // beside the spotlight where there is room, else above/below it
    let bx = x + w + 14, by = Math.min(Math.max(8, y), R.height - bh - 8);
    if (bx + bw > R.width - 8) bx = x - bw - 14;
    if (bx < 8) {
      bx = Math.max(8, Math.min(R.width - bw - 8, x + w / 2 - bw / 2));
      by = y > R.height / 2 ? Math.max(8, y - bh - 14) : Math.min(R.height - bh - 8, y + hh + 14);
    }
    Object.assign(box.style, { left: `${bx}px`, top: `${by}px` });
    box.querySelector('[data-skip]')!.addEventListener('click', () => this.host.onTutorial(total));
    box.querySelector('[data-next]')?.addEventListener('click', () => this.host.onTutorial(index + 1));
  }
}
