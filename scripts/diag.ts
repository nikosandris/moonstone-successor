import { botAction } from '../src/core/bot';
import { applyAction, createGame, sealCount } from '../src/core/game';
const N = Number(process.argv[2] ?? 200);
const c: Record<string, number> = {};
const inc = (k: string, n = 1) => (c[k] = (c[k] ?? 0) + n);
let sealsAt12 = 0, sealsAt28 = 0, g12 = 0, g28 = 0;
for (let g = 0; g < N; g++) {
  let s = createGame([0,1,2,3].map((i) => ({ name: 'b' + i, color: 0, bot: true })), 1 + g);
  let lastDay = 0;
  while (s.stage !== 'gameOver') {
    const a = botAction(s);
    if (s.day !== lastDay) {
      if (s.day === 13) { g12++; sealsAt12 += s.players.reduce((t, p) => t + sealCount(s, p.id), 0); }
      if (s.day === 29) { g28++; sealsAt28 += s.players.reduce((t, p) => t + sealCount(s, p.id), 0); }
      lastDay = s.day;
    }
    if (a.type === 'continue' && s.combat) {
      const cb = s.combat;
      inc(`${cb.kind}:${cb.monsterId ?? 'pvp'}:${cb.outcome === 'a' ? 'Awin' : 'Bwin'}`);
    }
    if (a.type === 'flee') inc('flee:' + s.combat!.monsterId);
    if (a.type === 'challenge') inc('challenge');
    s = applyAction(s, a);
  }
}
console.log(Object.entries(c).sort().map(([k, v]) => `${k}: ${(v / N).toFixed(2)}`).join('\n'));
console.log('avg total seals held at day13', (sealsAt12 / g12).toFixed(2), 'day29', (sealsAt28 / g28).toFixed(2));
// gear snapshot
import { knightFighter, monsterStatsForDay } from '../src/core/game';
import { effectiveStats } from '../src/core/stats';
for (const day of [9, 17, 25]) {
  let n = 0, off = 0, def = 0, gold = 0, mhp = 0, adv = 0, deaths = 0, seals = 0;
  for (let g = 0; g < 50; g++) {
    let s = createGame([0,1,2,3].map((i) => ({ name: 'b' + i, color: 0, bot: true })), 1000 + g);
    while (s.stage !== 'gameOver' && s.day < day) s = applyAction(s, botAction(s));
    if (s.stage === 'gameOver') continue;
    for (const p of s.players) {
      const f = knightFighter(p); const e = effectiveStats(p);
      const m = monsterStatsForDay('guardian', day <= 12 ? 9 : 25);
      n++; seals += p.seals.length; off += f.offense; def += f.defense; gold += p.gold; mhp += e.maxHp; deaths += p.deaths;
      adv += (e.maxHp / Math.max(1, m.attack + 3.5 - f.defense)) / (m.hp / Math.max(1, f.offense + 3.5 - m.defense));
    }
  }
  console.log(`day ${day}: off ${(off/n).toFixed(1)} def ${(def/n).toFixed(1)} gold ${(gold/n).toFixed(0)} maxhp ${(mhp/n).toFixed(1)} advGuardianFullHp ${(adv/n).toFixed(2)} deaths ${(deaths/n).toFixed(1)} seals ${(seals/n).toFixed(2)}`);
}
