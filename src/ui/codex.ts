// The illustrated "How to play": short visual cards instead of a wall of text. Opened from the ? button,
// from the setup screen and from the fight screen. Bilingual (English / Greek) on its own.
import { CONFIG } from '../data/balance';
import { icon } from './hud/icons';
import { getLang } from './i18n';

const CSS = `
.cx-root{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:radial-gradient(ellipse at center,#05060dcc,#000e);animation:cxIn .25s ease-out;font-size:clamp(11px,min(1.25vw,2.1vh),17px);color:var(--parch);font-family:var(--text)}
@keyframes cxIn{from{opacity:0}}
.cx-sheet{position:relative;width:min(56em,94vw);max-height:92vh;display:grid;grid-template-columns:4.2em 1fr;grid-template-rows:1fr auto;background:var(--noise),linear-gradient(180deg,#1a1422,#0d0a12);box-shadow:0 0 0 1px var(--gold-lo),0 0 0 2px #000,0 0 0 3px #c9a45c66,0 30px 80px #000;border-radius:.6em;overflow:hidden}
.cx-tabs{grid-row:1/3;display:flex;flex-direction:column;gap:.35em;padding:.9em .5em;background:#0007;box-shadow:inset -1px 0 0 #c9a45c33}
.cx-tabs button{width:3.1em;height:3.1em;border:0;border-radius:50%;cursor:pointer;color:var(--dim);background:radial-gradient(circle at 50% 35%,#2a2233,#0d0a12);box-shadow:0 0 0 1px #000,0 0 0 2px #6b512666;transition:all .15s}
.cx-tabs button .ico{width:1.4em;height:1.4em}
.cx-tabs button.on{color:var(--gold-hi);box-shadow:0 0 0 1px #000,0 0 0 2px var(--gold),0 0 14px #ffd36a55}
.cx-card{padding:1.4em 2em .6em;overflow-y:auto;min-height:0}
.cx-kicker{font:700 .65em var(--serif);letter-spacing:.24em;text-transform:uppercase;color:var(--gold)}
.cx-card h2{margin:.25em 0 .7em;font:700 1.9em/1.1 'Cormorant Garamond','EB Garamond',var(--serif);color:var(--gold-hi);letter-spacing:.02em;text-shadow:0 0 18px #f6e1a633}
.cx-body p{line-height:1.55;margin:.5em 0}
.cx-body b{color:#fff1cf}
.cx-note{font-style:italic;color:var(--dim);border-left:2px solid var(--gold-lo);padding-left:.8em}
.cx-steps{display:grid;gap:.7em}
.cx-steps>div{display:grid;grid-template-columns:2em 2.6em 1fr;align-items:center;gap:.7em;padding:.6em .8em;border-radius:.5em;background:#ffffff08;box-shadow:inset 0 0 0 1px #ffffff10}
.cx-steps span{width:1.8em;height:1.8em;border-radius:50%;display:grid;place-items:center;font:700 .9em var(--serif);color:#120c06;background:linear-gradient(#f6e1a6,#c9a45c)}
.cx-steps .ico{width:2.2em;height:2.2em;color:var(--gold-hi)}
.cx-steps p{margin:0}
.cx-places{display:grid;grid-template-columns:repeat(3,1fr);gap:.7em}
.cx-places.three{grid-template-columns:repeat(3,1fr)}
.cx-places>div{padding:.8em;border-radius:.5em;background:#ffffff08;box-shadow:inset 0 0 0 1px #ffffff10;text-align:center}
.cx-places .ico{width:2.4em;height:2.4em;color:var(--gold-hi);display:block;margin:0 auto .35em}
.cx-places b{font:700 .95em var(--serif);letter-spacing:.06em;color:var(--gold-hi)}
.cx-places p{font-size:.88em;margin:.3em 0 0;color:#e2d6bf}
.cx-combat{display:grid;grid-template-columns:minmax(14em,1fr) 1.2fr;gap:1.2em;align-items:center}
.cx-triwrap{position:relative;aspect-ratio:320/250}
.cx-tri{position:absolute;inset:0;width:100%;height:100%}
.cx-tri .lbl{font:italic 600 15px 'Cormorant Garamond','EB Garamond',serif;fill:#f6e1a6}
.cx-node{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:.2em}
.cx-node .ico{width:2.8em;height:2.8em;padding:.45em;border-radius:50%;color:#fff;box-shadow:0 0 0 2px #000,0 0 18px var(--k)}
.cx-node b{font:700 .78em var(--serif);letter-spacing:.12em;text-transform:uppercase;color:var(--k);text-shadow:0 1px 2px #000}
.n-strike{--k:#ff4a2c}.n-strike .ico{background:radial-gradient(circle at 50% 35%,#ff6a4a,#5a0d08)}
.n-guard{--k:#3aa0ff}.n-guard .ico{background:radial-gradient(circle at 50% 35%,#5ab8ff,#0a2a55)}
.n-feint{--k:#ffc030}.n-feint .ico{background:radial-gradient(circle at 50% 35%,#ffd86a,#5a3a05)}
.cx-rules ul{margin:.4em 0;padding-left:1.1em;line-height:1.55}
.cx-tells{display:grid;gap:.6em;margin:.8em 0}
.cx-tell{display:flex;align-items:center;gap:.9em;padding:.6em .9em;border-radius:2em;background:linear-gradient(90deg,#0d0a12,#0d0a1299);box-shadow:0 0 0 1.5px var(--k),0 0 16px color-mix(in srgb,var(--k) 40%,transparent)}
.cx-tell .ic{width:2.6em;height:2.6em;border-radius:50%;display:grid;place-items:center;color:#fff;background:radial-gradient(circle at 50% 35%,var(--k),#000 120%);flex:0 0 auto}
.cx-tell .ic .ico{width:60%;height:60%}
.cx-tell b{display:block;font:700 .95em var(--serif);letter-spacing:.08em;color:var(--k)}
.cx-tell span{display:block;font-size:.88em;color:#e2d6bf}
.cx-tell em{display:block;font-style:normal;font-weight:600;font-size:.88em;color:#fff}
.cx-tell.k-guard{--k:#3aa0ff}.cx-tell.k-strike{--k:#ff3a1c}.cx-tell.k-feint{--k:#ffc030}
.cx-moons{display:grid;grid-template-columns:repeat(4,1fr);gap:.6em;text-align:center}
.cx-moons i.m{display:block;width:3.2em;height:3.2em;margin:0 auto .4em;border-radius:50%;background:#e9e4d6;box-shadow:0 0 18px #e9e4d655}
.cx-moons i.new{background:#1a1d2a;box-shadow:inset 0 0 0 1px #6a7088}
.cx-moons i.wax{background:linear-gradient(90deg,#1a1d2a 50%,#e9e4d6 50%)}
.cx-moons i.wan{background:linear-gradient(90deg,#e9e4d6 50%,#1a1d2a 50%)}
.cx-moons i.full{box-shadow:0 0 26px #ffe9a8aa}
.cx-moons b{font:700 .9em var(--serif);color:var(--gold-hi)}
.cx-moons p{font-size:.85em;margin:.2em 0 0;color:#e2d6bf}
.cx-foot{display:flex;justify-content:flex-end;gap:.7em;padding:.7em 1.4em 1em}
.cx-foot .mb-btn{font-size:.85em;padding:.75em 1.8em}
.cx-x{position:absolute;right:.5em;top:.4em;border:0;background:none;color:var(--dim);font-size:1.8em;cursor:pointer}
@media (max-height:520px){.cx-sheet{max-height:96vh}.cx-card{padding:.8em 1.2em .4em}.cx-card h2{font-size:1.5em;margin-bottom:.4em}.cx-places{grid-template-columns:repeat(3,1fr)}.cx-combat{grid-template-columns:1fr 1.4em 1.4fr}.cx-combat{grid-template-columns:13em 1fr}}
`;

type Two = [string, string];
const L = (p: Two) => (getLang() === 'el' ? p[1] : p[0]);

interface Card { id: string; icon: string; title: Two; body: () => string }

const triangle = () => `
<svg class="cx-tri" viewBox="0 0 320 250" aria-hidden="true">
  <defs>
    <marker id="cxa" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#f6e1a6"/></marker>
  </defs>
  <path d="M160 58 L262 196" stroke="#f6e1a6" stroke-width="2.5" fill="none" marker-end="url(#cxa)" stroke-dasharray="6 5"/>
  <path d="M232 214 L88 214" stroke="#f6e1a6" stroke-width="2.5" fill="none" marker-end="url(#cxa)" stroke-dasharray="6 5"/>
  <path d="M58 196 L140 70" stroke="#f6e1a6" stroke-width="2.5" fill="none" marker-end="url(#cxa)" stroke-dasharray="6 5"/>
  <text x="232" y="120" class="lbl">${L(['beats', 'νικά'])}</text>
  <text x="160" y="240" class="lbl" text-anchor="middle">${L(['beats', 'νικά'])}</text>
  <text x="62" y="120" class="lbl" text-anchor="end">${L(['beats', 'νικά'])}</text>
</svg>
<div class="cx-node n-strike" style="left:50%;top:6%">${icon('broadsword')}<b>${L(['Strike', 'Χτύπημα'])}</b></div>
<div class="cx-node n-feint" style="left:84%;top:78%">${icon('cloak-dagger')}<b>${L(['Feint', 'Παραπλάνηση'])}</b></div>
<div class="cx-node n-guard" style="left:16%;top:78%">${icon('checked-shield')}<b>${L(['Guard', 'Άμυνα'])}</b></div>`;

const tell = (cls: string, ic: string, name: Two, how: Two, answer: Two) => `
<div class="cx-tell ${cls}"><div class="ic">${icon(ic)}</div><div><b>${L(name)}</b><span>${L(how)}</span><em>${L(answer)}</em></div></div>`;

const CARDS: Card[] = [
  {
    id: 'goal', icon: 'trophy-cup', title: ['How to win', 'Πώς κερδίζεις'],
    body: () => `<div class="cx-steps">
      <div><span>1</span>${icon('crowned-skull')}<p>${L([`Defeat lair monsters and take <b>${CONFIG.sealsToEnter} of the 4 Seals</b>.`, `Νίκησε τα τέρατα στις φωλιές και πάρε <b>${CONFIG.sealsToEnter} από τις 4 Σφραγίδες</b>.`])}</p></div>
      <div><span>2</span>${icon('moon')}<p>${L(['Wait for the <b>Full moon</b> (days 9-12, 25-28): only then the Sanctum opens.', 'Περίμενε την <b>Πανσέληνο</b> (μέρες 9-12, 25-28): μόνο τότε ανοίγει το Ιερό.'])}</p></div>
      <div><span>3</span>${icon('sun')}<p>${L(['Reach the <b>Sanctum</b> in the middle and defeat its guardian.', 'Φτάσε στο <b>Ιερό</b> στο κέντρο και νίκησε τον φύλακά του.'])}</p></div>
    </div><p class="cx-note">${L([`No winner by day ${CONFIG.dayCap}? The most Seals wins (then gold).`, `Κανείς ως τη μέρα ${CONFIG.dayCap}; Κερδίζει όποιος έχει τις περισσότερες Σφραγίδες (μετά το χρυσάφι).`])}</p>`,
  },
  {
    id: 'turn', icon: 'dice-six-faces-six', title: ['Your turn', 'Η σειρά σου'],
    body: () => `<div class="cx-steps">
      <div><span>1</span>${icon('potion-ball')}<p>${L(['Drink a potion if you like (before rolling).', 'Πιες ένα φίλτρο αν θέλεις (πριν ρίξεις).'])}</p></div>
      <div><span>2</span>${icon('dice-six-faces-six')}<p>${L(['<b>Roll the die</b>. Glowing places on the map are within reach.', '<b>Ρίξε το ζάρι</b>. Τα φωτεινά σημεία στον χάρτη είναι στην εμβέλειά σου.'])}</p></div>
      <div><span>3</span>${icon('footsteps')}<p>${L(['Tap one to walk there. Where you stop, something happens.', 'Πάτα ένα για να πας. Εκεί που σταματάς, κάτι συμβαίνει.'])}</p></div>
    </div><p class="cx-note">${L(['The order of play is re-rolled every dawn. Four days make one moon phase.', 'Η σειρά παιξίματος ξαναρίχνεται κάθε αυγή. Τέσσερις μέρες κάνουν μια φάση της σελήνης.'])}</p>`,
  },
  {
    id: 'places', icon: 'castle', title: ['Places', 'Τοποθεσίες'],
    body: () => `<div class="cx-places">
      <div>${icon('castle')}<b>${L(['Your Keep', 'Ο Πύργος σου'])}</b><p>${L(['Full heal, free.', 'Πλήρης θεραπεία, δωρεάν.'])}</p></div>
      <div>${icon('village')}<b>${L(['Village', 'Χωριό'])}</b><p>${L(['Weapons, armour, potions, healer.', 'Όπλα, πανοπλίες, φίλτρα, θεραπευτής.'])}</p></div>
      <div>${icon('cave-entrance')}<b>${L(['Lair', 'Φωλιά'])}</b><p>${L(['Fight its monster for its Seal and loot.', 'Πολέμησε το τέρας για τη Σφραγίδα και λάφυρα.'])}</p></div>
      <div>${icon('tombstone')}<b>${L(['Ruins', 'Ερείπια'])}</b><p>${L(['Gold, loot - or a trap.', 'Χρυσάφι, λάφυρα - ή παγίδα.'])}</p></div>
      <div>${icon('footsteps')}<b>${L(['Road', 'Δρόμος'])}</b><p>${L(['Random events: merchants, ambushes, shrines.', 'Τυχαία γεγονότα: έμποροι, ενέδρες, βωμοί.'])}</p></div>
      <div>${icon('sun')}<b>${L(['Sanctum', 'Ιερό'])}</b><p>${L([`Full moon + ${CONFIG.sealsToEnter} Seals: the final fight.`, `Πανσέληνος + ${CONFIG.sealsToEnter} Σφραγίδες: η τελική μάχη.`])}</p></div>
    </div>`,
  },
  {
    id: 'combat', icon: 'crossed-swords', title: ['Combat: what beats what', 'Μάχη: τι νικά τι'],
    body: () => `<div class="cx-combat"><div class="cx-triwrap">${triangle()}</div>
      <div class="cx-rules">
        <p>${L(['Each exchange, you and your foe each choose one move at the same time.', 'Σε κάθε γύρο, εσύ και ο αντίπαλος διαλέγετε ταυτόχρονα μία κίνηση.'])}</p>
        <ul>
          <li>${L(['<b>The winner hits for double damage</b>, the loser deals nothing.', '<b>Ο νικητής χτυπά με διπλή ζημιά</b>, ο χαμένος δεν κάνει τίποτα.'])}</li>
          <li>${L(['<b>Same move</b>: both hit for normal damage.', '<b>Ίδια κίνηση</b>: χτυπάτε και οι δύο κανονικά.'])}</li>
          <li>${L(['Damage = Attack + weapon + d6 - (Defense + armour).', 'Ζημιά = Επίθεση + όπλο + ζάρι - (Άμυνα + πανοπλία).'])}</li>
          <li>${L(['Strike and Feint cost <b>Stamina</b>; Guard restores it.', 'Χτύπημα και Παραπλάνηση ξοδεύουν <b>Αντοχή</b>· η Άμυνα την αναπληρώνει.'])}</li>
        </ul>
      </div></div>`,
  },
  {
    id: 'tells', icon: 'magnifying-glass', title: ['Reading the monster', 'Διάβασε το τέρας'],
    body: () => `<p>${L(['Monsters show their move a moment before they act. A badge over their head and their glow tell you what is coming:', 'Τα τέρατα δείχνουν την κίνησή τους λίγο πριν δράσουν. Ένα σήμα πάνω από το κεφάλι τους και η λάμψη τους σου λένε τι έρχεται:'])}</p>
      <div class="cx-tells">
        ${tell('k-guard', 'checked-shield', ['Blue - Guard', 'Μπλε - Άμυνα'], ['shield raised, blue glow', 'σηκώνει ασπίδα, μπλε λάμψη'], ['answer with Feint', 'απάντα με Παραπλάνηση'])}
        ${tell('k-strike', 'broadsword', ['Red - Strike', 'Κόκκινο - Χτύπημα'], ['rears back, glows red', 'παίρνει φόρα, κόκκινη λάμψη'], ['answer with Guard', 'απάντα με Άμυνα'])}
        ${tell('k-feint', 'cloak-dagger', ['Flickering gold - Feint', 'Χρυσό που τρεμοπαίζει - Παραπλάνηση'], ['sways, flickers gold', 'ταλαντεύεται, χρυσή λάμψη'], ['answer with Strike', 'απάντα με Χτύπημα'])}
      </div>
      <p class="cx-note">${L(['Strike and Feint start the same way ("Strike or Feint?") - wait for the colour. Answer late, in the <b>gold end of the arc</b>, for a perfect blow (x1.5). No answer = Guard.', 'Χτύπημα και Παραπλάνηση ξεκινούν ίδια ("Χτύπημα ή Παραπλάνηση;") - περίμενε το χρώμα. Απάντησε αργά, στη <b>χρυσή άκρη του τόξου</b>, για τέλειο χτύπημα (x1,5). Χωρίς απάντηση = Άμυνα.'])}</p>`,
  },
  {
    id: 'moon', icon: 'moon', title: ['The moon', 'Η σελήνη'],
    body: () => `<div class="cx-moons">
      <div><i class="m new"></i><b>${L(['New', 'Νέα'])}</b><p>${L(['Monsters weakest', 'Τέρατα πιο αδύναμα'])}</p></div>
      <div><i class="m wax"></i><b>${L(['Waxing', 'Αύξουσα'])}</b><p>${L(['Normal', 'Κανονικά'])}</p></div>
      <div><i class="m full"></i><b>${L(['Full', 'Πανσέληνος'])}</b><p>${L(['Strongest - Sanctum open', 'Πιο δυνατά - Ιερό ανοιχτό'])}</p></div>
      <div><i class="m wan"></i><b>${L(['Waning', 'Φθίνουσα'])}</b><p>${L(['Normal', 'Κανονικά'])}</p></div>
    </div><p class="cx-note">${L(['Each monster also has a phase it loves or hates - check the place tooltip.', 'Κάθε τέρας έχει και μια φάση που αγαπά ή μισεί - δες την περιγραφή της τοποθεσίας.'])}</p>`,
  },
  {
    id: 'death', icon: 'death-skull', title: ['Falling, rivals, renown', 'Πτώση, αντίπαλοι, φήμη'],
    body: () => `<div class="cx-places three">
      <div>${icon('death-skull')}<b>${L(['At 0 health', 'Στο 0 υγεία'])}</b><p>${L(['You lose half your gold and one Seal, gain a permanent Scar, and rise at your Keep.', 'Χάνεις μισό χρυσάφι και μια Σφραγίδα, παίρνεις μόνιμη Ουλή και ξυπνάς στον Πύργο σου.'])}</p></div>
      <div>${icon('crossed-swords')}<b>${L(['Duels', 'Μονομαχίες'])}</b><p>${L(['Stop on a rival to challenge them. The winner takes a Seal or half their gold.', 'Σταμάτα πάνω σε αντίπαλο για να τον προκαλέσεις. Ο νικητής παίρνει Σφραγίδα ή μισό χρυσάφι.'])}</p></div>
      <div>${icon('winged-sword')}<b>${L(['Renown', 'Φήμη'])}</b><p>${L(['Victories level you up: pick one of three permanent boons.', 'Οι νίκες σε ανεβάζουν επίπεδο: διάλεξε ένα από τρία μόνιμα χαρίσματα.'])}</p></div>
    </div>`,
  },
];

/** Open the codex, optionally at a given card ('combat', 'tells', ...). */
export function showCodex(start = 'goal'): void {
  if (!document.getElementById('cx-css')) {
    const st = document.createElement('style');
    st.id = 'cx-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  document.querySelector('.cx-root')?.remove();
  const root = document.createElement('div');
  root.className = 'cx-root';
  let idx = Math.max(0, CARDS.findIndex((c) => c.id === start));
  const render = () => {
    const c = CARDS[idx];
    root.innerHTML = `<div class="cx-sheet">
      <div class="cx-tabs">${CARDS.map((k, i) => `<button class="${i === idx ? 'on' : ''}" data-i="${i}" title="${L(k.title)}">${icon(k.icon)}</button>`).join('')}</div>
      <div class="cx-card"><div class="cx-kicker">${L(['How to play', 'Πώς παίζεται'])} &middot; ${idx + 1} / ${CARDS.length}</div>
        <h2>${L(c.title)}</h2><div class="cx-body">${c.body()}</div></div>
      <div class="cx-foot">
        <button class="mb-btn dark" data-prev ${idx === 0 ? 'disabled' : ''}>${L(['Back', 'Πίσω'])}</button>
        <button class="mb-btn" data-next>${idx === CARDS.length - 1 ? L(['Close', 'Κλείσιμο']) : L(['Next', 'Επόμενο'])}</button>
      </div>
      <button class="cx-x" data-close aria-label="Close">&times;</button></div>`;
    root.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => b.addEventListener('click', () => { idx = Number(b.dataset.i); render(); }));
    root.querySelector('[data-prev]')!.addEventListener('click', () => { idx = Math.max(0, idx - 1); render(); });
    root.querySelector('[data-next]')!.addEventListener('click', () => { if (idx === CARDS.length - 1) close(); else { idx++; render(); } });
    root.querySelector('[data-close]')!.addEventListener('click', close);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' && idx < CARDS.length - 1) { idx++; render(); }
    else if (e.key === 'ArrowLeft' && idx > 0) { idx--; render(); }
    else return;
    e.stopPropagation();
  };
  const close = () => { window.removeEventListener('keydown', onKey, true); root.remove(); };
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  window.addEventListener('keydown', onKey, true);
  render();
  document.body.appendChild(root);
}
