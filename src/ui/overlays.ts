// DOM overlays (rules and settings): scrollable, keyboard friendly, readable on phones.
import { CONFIG } from '../data/balance';
import SF_CREDITS from '../data/sfCredits.json';
import { getLang, t, type Lang } from './i18n';
import { getSettings, updateSettings, type Settings } from './settings';

/** English / Ελληνικά switch (each language names itself). */
export function langPicker(onPick: () => void): HTMLDivElement {
  const g = document.createElement('div');
  g.className = 'row count lang';
  g.style.justifyContent = 'flex-end';
  g.style.margin = '0 0 6px';
  for (const [v, text] of [['en', 'English'], ['el', 'Ελληνικά']] as [Lang, string][]) {
    const b = document.createElement('button');
    b.textContent = text;
    b.lang = v;
    if (getLang() === v) b.className = 'sel';
    b.onclick = () => { updateSettings({ lang: v }); onPick(); };
    g.appendChild(b);
  }
  return g;
}

function overlay(title: string): { root: HTMLDivElement; body: HTMLDivElement; close: () => void } {
  const root = document.createElement('div');
  root.className = 'overlay';
  root.innerHTML = `<div class="sheet"><div class="sheet-head"><h2>${title}</h2><button class="x" aria-label="${t('Close')}">${t('Close')}</button></div><div class="sheet-body"></div></div>`;
  document.body.appendChild(root);
  const close = () => root.remove();
  root.querySelector<HTMLButtonElement>('.x')!.onclick = close;
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { close(); window.removeEventListener('keydown', onKey, true); }
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  const body = root.querySelector<HTMLDivElement>('.sheet-body')!;
  return { root, body, close: () => { window.removeEventListener('keydown', onKey, true); close(); } };
}

export function showRules(): void {
  const { body } = overlay(t('How to play'));
  const days = { seals: CONFIG.sealsToEnter, cap: CONFIG.dayCap };
  body.innerHTML = `
  <h3>${t('Goal')}</h3>
  <p>${t('Collect <b>{seals} of the 4 Seals</b> from the Lairs, then enter the <b>Sanctum</b> in the middle of the map while the <b>Full moon</b> shines (days 9-12, 25-28) and defeat the Hollow Warden. If nobody manages it by day {cap}, the knight with the most Seals wins (ties: gold).', days)}</p>
  <h3>${t('Your turn')}</h3>
  <p>${t('1. Use an item if you like. 2. <b>Roll the die</b>. 3. Tap a glowing place up to that many steps away (or your own to stay). 4. The place you stop on happens:')}</p>
  <ul>
    <li>${t('<b>Home</b> - full heal (your own home).')}</li>
    <li>${t('<b>Village</b> - shop for weapons, armour and potions; pay the healer.')}</li>
    <li>${t('<b>Lair</b> - fight its monster for its Seal, gold and loot (you may flee first, for some gold).')}</li>
    <li>${t('<b>Ruins</b> - gold, loot or a trap. Picked clean for 3 days after.')}</li>
    <li>${t('<b>Road</b> - half the time a road event: merchants, ambushes, shrines, bone dice and stranger things.')}</li>
    <li>${t('<b>Sanctum</b> - open only at Full moon, and only with {seals}+ Seals.', days)}</li>
  </ul>
  <p>${t('The turn order (initiative) is re-rolled every dawn. One round of turns is a day; 4 days make a moon phase.')}</p>
  <h3>${t('Combat')}</h3>
  <p>${t('Each exchange both sides pick <b>Strike</b>, <b>Guard</b> or <b>Feint</b>. Strike beats Feint, Feint beats Guard, Guard beats Strike. The winner hits for <b>double damage</b>, the loser deals none; the same move means both hit normally. Damage = Attack + weapon + d6 - (Defense + armour), at least 1.')}</p>
  <p>${t('Strike and Feint cost Stamina; Guard restores it. With too little Stamina you can only Guard.')}</p>
  <p>${t('<b>Arena mode:</b> watch the monster wind up. A <span style="color:#6ec8ff">blue ward</span> means Guard; a raised weapon that glows <span style="color:#ff6b5a">red</span> means Strike; one that <span style="color:#ffd23a">flickers gold</span> means Feint. Strike and Feint look the same at first - wait for the tell, but answer before the blow lands (no answer = Guard). Keys: J/K/L (or A/S/D, 1/2/3); Space to start.')}</p>
  <h3>${t('The moon')}</h3>
  <p>${t('Monsters are weaker at New moon and stronger at Full moon. Each monster also has its own favourite phase - the Dire Wolf is at its worst under the Full moon.')}</p>
  <h3>${t('Death and scars')}</h3>
  <p>${t('At 0 HP you are not out: you lose half your gold and one random Seal, gain a permanent <b>Scar</b>, and rise at Home on your next turn.')}</p>
  <h3>${t('Renown')}</h3>
  <p>${t('Victories build renown. At 2, 4, 7, 11 and 16 victories you level up and choose one of three permanent boons.')}</p>
  <h3>${t('Duels')}</h3>
  <p>${t("Stop where a rival stands to challenge them. The winner takes a Seal they lack, or half the loser's gold; the loser suffers a normal death. In arena duels both players press at the same time on one device (left A/S/D, right J/K/L); presses stay hidden until the clash.")}</p>
  <h3>${t('Credits')}</h3>
  <p>${t('Realistic 3D models from Sketchfab, used under Creative Commons Attribution:')}</p>
  <ul class="credits">${SF_CREDITS.map((c) => `<li>${t('{name} by {author}', { name: `<a href="${c.url}" target="_blank" rel="noopener">${esc(c.name)}</a>`, author: esc(c.author) })}</li>`).join('')}</ul>
  <p>${t('Stylised characters and props: KayKit by Kay Lousberg (CC0). Icons: game-icons.net (CC BY 3.0). Fonts: Cinzel, Spectral (OFL).')}</p>`;
}

function esc(t: string): string {
  return t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

export function showSettings(opts: { inGame?: boolean; onQuit?: () => void; onChange?: (s: Settings) => void } = {}): void {
  const { root, body, close } = overlay(t(opts.inGame ? 'Menu' : 'Settings'));
  const render = () => {
    const s = getSettings();
    body.innerHTML = '';
    root.querySelector('h2')!.textContent = t(opts.inGame ? 'Menu' : 'Settings');
    root.querySelector('.x')!.textContent = t('Close');
    const row = (label: string, el: HTMLElement) => {
      const r = document.createElement('div');
      r.className = 'row';
      const l = document.createElement('label');
      l.textContent = t(label);
      r.append(l, el);
      body.appendChild(r);
    };
    const group = (choices: [string, string][], current: string, onPick: (v: string) => void) => {
      const g = document.createElement('div');
      g.className = 'count';
      g.style.display = 'flex';
      g.style.gap = '6px';
      g.style.flexWrap = 'wrap';
      for (const [v, text] of choices) {
        const b = document.createElement('button');
        b.textContent = v === 'el' ? text : t(text);
        if (v === current) b.className = 'sel';
        b.onclick = () => { onPick(v); opts.onChange?.(getSettings()); render(); };
        g.appendChild(b);
      }
      return g;
    };
    row('Language', group([['en', 'English'], ['el', 'Ελληνικά']], s.lang, (v) => updateSettings({ lang: v as Lang })));
    row('Duels', group([['arena3d', '3D Arena'], ['arena', '2D Arena'], ['classic', 'Classic']], s.duelMode, (v) => updateSettings({ duelMode: v as Settings['duelMode'] })));
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.value = String(Math.round(s.volume * 100));
    vol.oninput = () => updateSettings({ volume: Number(vol.value) / 100, muted: false });
    vol.style.flex = '1';
    row('Volume', vol);
    row('Sound', group([['on', 'On'], ['off', 'Muted']], s.muted ? 'off' : 'on', (v) => updateSettings({ muted: v === 'off' })));
    row('Graphics', group([['auto', 'Auto'], ['high', 'High'], ['low', 'Low (faster)']], s.graphics, (v) => updateSettings({ graphics: v as Settings['graphics'] })));
    row('Reaction time', group([['relaxed', 'Relaxed'], ['normal', 'Normal'], ['expert', 'Expert']], s.reaction, (v) => updateSettings({ reaction: v as Settings['reaction'] })));
    row('Animation', group([['0.75', 'Slow'], ['1', 'Normal'], ['1.5', 'Fast'], ['2', 'Very fast']], String(s.animSpeed), (v) => updateSettings({ animSpeed: Number(v) })));
    row('Blood', group([['on', 'On'], ['off', 'Off (sparks)']], s.blood ? 'on' : 'off', (v) => updateSettings({ blood: v === 'on' })));
    row('Tutorial', group([['on', 'Show at game start'], ['off', 'Off']], s.tutorial ? 'on' : 'off', (v) => updateSettings({ tutorial: v === 'on' })));
    const actions = document.createElement('div');
    actions.className = 'row';
    const rules = document.createElement('button');
    rules.textContent = t('How to play');
    rules.onclick = () => showRules();
    actions.appendChild(rules);
    if (opts.inGame) {
      const resume = document.createElement('button');
      resume.textContent = t('Resume');
      resume.onclick = close;
      const quit = document.createElement('button');
      quit.textContent = t('Save and quit to title');
      quit.onclick = () => { close(); opts.onQuit?.(); };
      actions.append(resume, quit);
    }
    body.appendChild(actions);
    const note = document.createElement('p');
    note.className = 'sub';
    note.textContent = t(opts.inGame ? 'The game is saved automatically after every action.' : 'Settings are stored in this browser.');
    body.appendChild(note);
  };
  render();
}
