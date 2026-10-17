import type { PlayerSetup } from '../core/types';
import { getSettings, updateSettings } from './settings';
import { PLAYER_COLORS, hex } from './theme';

const DEFAULT_NAMES = ['Aldric', 'Brenna', 'Corwin', 'Dara'];

interface Row {
  name: string;
  color: number;
  bot: boolean;
}

/** DOM setup screen: 2-4 players, names, colours, optional bot seats. */
export function showSetup(root: HTMLElement, onStart: (players: PlayerSetup[], seed: number) => void): void {
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
    for (const [mode, text] of [['arena', 'Arena (real-time)'], ['classic', 'Classic duel']] as const) {
      const b = document.createElement('button');
      b.textContent = text;
      if (getSettings().duelMode === mode) b.className = 'sel';
      b.onclick = () => { updateSettings({ duelMode: mode }); render(); };
      modeRow.appendChild(b);
    }
    card.appendChild(modeRow);
    const volRow = document.createElement('div');
    volRow.className = 'row';
    const volLab = document.createElement('label');
    volLab.textContent = 'Volume';
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.value = String(Math.round(getSettings().volume * 100));
    vol.style.flex = '1';
    vol.oninput = () => updateSettings({ volume: Number(vol.value) / 100, muted: false });
    const mute = document.createElement('button');
    mute.textContent = getSettings().muted ? 'Unmute' : 'Mute';
    mute.onclick = () => { updateSettings({ muted: !getSettings().muted }); render(); };
    volRow.append(volLab, vol, mute);
    card.appendChild(volRow);
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
    const tip = document.createElement('p');
    tip.className = 'sub';
    tip.style.marginTop = '12px';
    tip.textContent = 'Tip: tick "Bot" to let the computer play a seat. Duels hide choices behind a pass-the-device screen.';
    card.appendChild(tip);
    root.appendChild(card);
  };
  render();
}
