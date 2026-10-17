// DOM overlays (rules and settings): scrollable, keyboard friendly, readable on phones.
import { CONFIG } from '../data/balance';
import { getSettings, updateSettings, type Settings } from './settings';

function overlay(title: string): { root: HTMLDivElement; body: HTMLDivElement; close: () => void } {
  const root = document.createElement('div');
  root.className = 'overlay';
  root.innerHTML = `<div class="sheet"><div class="sheet-head"><h2>${title}</h2><button class="x" aria-label="Close">Close</button></div><div class="sheet-body"></div></div>`;
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
  const { body } = overlay('How to play');
  body.innerHTML = `
  <h3>Goal</h3>
  <p>Collect <b>${CONFIG.sealsToEnter} of the 4 Seals</b> from the Lairs, then enter the <b>Sanctum</b> in the middle of the map while the <b>Full moon</b> shines (days 9-12, 25-28) and defeat the Hollow Warden. If nobody manages it by day ${CONFIG.dayCap}, the knight with the most Seals wins (ties: gold).</p>
  <h3>Your turn</h3>
  <p>1. Use an item if you like. 2. <b>Roll the die</b>. 3. Tap a glowing place up to that many steps away (or your own to stay). 4. The place you stop on happens:</p>
  <ul>
    <li><b>Home</b> - full heal (your own home).</li>
    <li><b>Village</b> - shop for weapons, armour and potions; pay the healer.</li>
    <li><b>Lair</b> - fight its monster for its Seal, gold and loot (you may flee first, for some gold).</li>
    <li><b>Ruins</b> - gold, loot or a trap. Picked clean for 3 days after.</li>
    <li><b>Road</b> - half the time a road event: merchants, ambushes, shrines, bone dice and stranger things.</li>
    <li><b>Sanctum</b> - open only at Full moon, and only with ${CONFIG.sealsToEnter}+ Seals.</li>
  </ul>
  <p>The turn order (initiative) is re-rolled every dawn. One round of turns is a day; 4 days make a moon phase.</p>
  <h3>Combat</h3>
  <p>Each exchange both sides pick <b>Strike</b>, <b>Guard</b> or <b>Feint</b>. Strike beats Feint, Feint beats Guard, Guard beats Strike. The winner hits for <b>double damage</b>, the loser deals none; the same move means both hit normally. Damage = Attack + weapon + d6 - (Defense + armour), at least 1.</p>
  <p>Strike and Feint cost Stamina; Guard restores it. With too little Stamina you can only Guard.</p>
  <p><b>Arena mode:</b> watch the monster wind up. A <span style="color:#6ec8ff">blue ward</span> means Guard; a raised weapon that glows <span style="color:#ff6b5a">red</span> means Strike; one that <span style="color:#ffd23a">flickers gold</span> means Feint. Strike and Feint look the same at first - wait for the tell, but answer before the blow lands (no answer = Guard). Keys: J/K/L (or A/S/D, 1/2/3); Space to start.</p>
  <h3>The moon</h3>
  <p>Monsters are weaker at New moon and stronger at Full moon. Each monster also has its own favourite phase - the Dire Wolf is at its worst under the Full moon.</p>
  <h3>Death and scars</h3>
  <p>At 0 HP you are not out: you lose half your gold and one random Seal, gain a permanent <b>Scar</b>, and rise at Home on your next turn.</p>
  <h3>Renown</h3>
  <p>Victories build renown. At 2, 4, 7, 11 and 16 victories you level up and choose one of three permanent boons.</p>
  <h3>Duels</h3>
  <p>Stop where a rival stands to challenge them. The winner takes a Seal they lack, or half the loser's gold; the loser suffers a normal death. In arena duels both players press at the same time on one device (left A/S/D, right J/K/L); presses stay hidden until the clash.</p>`;
}

export function showSettings(opts: { inGame?: boolean; onQuit?: () => void; onChange?: (s: Settings) => void } = {}): void {
  const { body, close } = overlay(opts.inGame ? 'Menu' : 'Settings');
  const render = () => {
    const s = getSettings();
    body.innerHTML = '';
    const row = (label: string, el: HTMLElement) => {
      const r = document.createElement('div');
      r.className = 'row';
      const l = document.createElement('label');
      l.textContent = label;
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
        b.textContent = text;
        if (v === current) b.className = 'sel';
        b.onclick = () => { onPick(v); opts.onChange?.(getSettings()); render(); };
        g.appendChild(b);
      }
      return g;
    };
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
    row('Reaction time', group([['relaxed', 'Relaxed'], ['normal', 'Normal'], ['expert', 'Expert']], s.reaction, (v) => updateSettings({ reaction: v as Settings['reaction'] })));
    row('Animation', group([['0.75', 'Slow'], ['1', 'Normal'], ['1.5', 'Fast'], ['2', 'Very fast']], String(s.animSpeed), (v) => updateSettings({ animSpeed: Number(v) })));
    row('Blood', group([['on', 'On'], ['off', 'Off (sparks)']], s.blood ? 'on' : 'off', (v) => updateSettings({ blood: v === 'on' })));
    row('Tutorial', group([['on', 'Show at game start'], ['off', 'Off']], s.tutorial ? 'on' : 'off', (v) => updateSettings({ tutorial: v === 'on' })));
    const actions = document.createElement('div');
    actions.className = 'row';
    const rules = document.createElement('button');
    rules.textContent = 'How to play';
    rules.onclick = () => showRules();
    actions.appendChild(rules);
    if (opts.inGame) {
      const resume = document.createElement('button');
      resume.textContent = 'Resume';
      resume.onclick = close;
      const quit = document.createElement('button');
      quit.textContent = 'Save and quit to title';
      quit.onclick = () => { close(); opts.onQuit?.(); };
      actions.append(resume, quit);
    }
    body.appendChild(actions);
    const note = document.createElement('p');
    note.className = 'sub';
    note.textContent = opts.inGame ? 'The game is saved automatically after every action.' : 'Settings are stored in this browser.';
    body.appendChild(note);
  };
  render();
}
