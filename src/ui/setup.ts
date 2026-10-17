import type { GameState, PlayerSetup } from '../core/types';
import { showRules, showSettings } from './overlays';
import { clearSave, loadGame, saveInfo } from './save';
import { getSettings, updateSettings } from './settings';
import { PLAYER_COLORS, hex } from './theme';

const DEFAULT_NAMES = ['Aldric', 'Brenna', 'Corwin', 'Dara'];

interface Row {
  name: string;
  color: number;
  bot: boolean;
}

/** DOM setup screen: 2-4 players, names, colours, optional bot seats. */
export function showSetup(root: HTMLElement, onStart: (players: PlayerSetup[], seed: number) => void, onResume: (s: GameState) => void): void {
  let count = 2;
  const rows: Row[] = DEFAULT_NAMES.map((name, i) => ({ name, color: PLAYER_COLORS[i], bot: false }));

  const render = () => {
    root.classList.remove('hidden');
    root.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h1>MOONBLOOD</h1>
      <p class="sub">Hot-seat knights hunt four Seals. The Sanctum opens only under the Full moon.</p>
      <div class="row count"><label>Knights</label></div>`;
    const info = saveInfo();
    if (info) {
      const res = document.createElement('div');
      res.className = 'row';
      const b = document.createElement('button');
      b.className = 'resume';
      b.textContent = `Resume: day ${info.day} - ${info.names.join(', ')}`;
      b.style.flex = '1';
      b.onclick = () => {
        const s = loadGame();
        if (!s) { clearSave(); render(); return; }
        root.classList.add('hidden');
        onResume(s);
      };
      const d = document.createElement('button');
      d.textContent = 'Discard';
      d.onclick = () => { clearSave(); render(); };
      res.append(b, d);
      card.insertBefore(res, card.querySelector('.count'));
    }
    const countRow = card.querySelector('.count') as HTMLElement;
    for (const n of [2, 3, 4]) {
      const b = document.createElement('button');
      b.textContent = `${n} players`;
      if (n === count) b.className = 'sel';
      b.onclick = () => { count = n; render(); };
      countRow.appendChild(b);
    }
    for (let i = 0; i < count; i++) {
      const row = rows[i];
      const el = document.createElement('div');
      el.className = 'row';
      const lab = document.createElement('label');
      lab.textContent = `Knight ${i + 1}`;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = row.name;
      input.maxLength = 14;
      input.oninput = () => { row.name = input.value; };
      el.append(lab, input);
      for (const c of PLAYER_COLORS) {
        const sw = document.createElement('button');
        sw.className = 'swatch' + (c === row.color ? ' sel' : '');
        sw.style.background = hex(c);
        sw.title = 'Colour';
        sw.onclick = () => {
          // swap with whoever currently uses this colour so colours stay unique
          const other = rows.slice(0, count).find((r, j) => j !== i && r.color === c);
          if (other) other.color = row.color;
          row.color = c;
          render();
        };
        el.appendChild(sw);
      }
      const botLab = document.createElement('label');
      botLab.style.minWidth = '0';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = row.bot;
      cb.onchange = () => { row.bot = cb.checked; };
      botLab.append(cb, ' Bot');
      el.appendChild(botLab);
      card.appendChild(el);
    }
    const modeRow = document.createElement('div');
    modeRow.className = 'row count';
    const modeLab = document.createElement('label');
    modeLab.textContent = 'Duels';
    modeRow.appendChild(modeLab);
    for (const [mode, text] of [['arena3d', '3D Arena'], ['arena', '2D Arena'], ['classic', 'Classic']] as const) {
      const b = document.createElement('button');
      b.textContent = text;
      if (getSettings().duelMode === mode) b.className = 'sel';
      b.onclick = () => { updateSettings({ duelMode: mode }); render(); };
      modeRow.appendChild(b);
    }
    card.appendChild(modeRow);

    const start = document.createElement('button');
    start.className = 'big';
    start.textContent = 'Begin the hunt';
    start.onclick = () => {
      const players = rows.slice(0, count).map((r, i) => ({
        name: r.name.trim() || DEFAULT_NAMES[i],
        color: r.color,
        bot: r.bot,
      }));
      root.classList.add('hidden');
      onStart(players, (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    };
    card.appendChild(start);
    const extra = document.createElement('div');
    extra.className = 'row';
    const rulesBtn = document.createElement('button');
    rulesBtn.textContent = 'How to play';
    rulesBtn.onclick = () => showRules();
    const setBtn = document.createElement('button');
    setBtn.textContent = 'Settings';
    setBtn.onclick = () => showSettings({ onChange: () => render() });
    extra.append(rulesBtn, setBtn);
    card.appendChild(extra);
    const tip = document.createElement('p');
    tip.className = 'sub';
    tip.style.marginTop = '12px';
    tip.textContent = 'Tip: tick "Bot" to let the computer play a seat. Duels hide choices behind a pass-the-device screen.';
    card.appendChild(tip);
    root.appendChild(card);
  };
  render();
}
