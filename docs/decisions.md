# Design decisions log

One line each: decision - reasoning.

## Phase 1
- Seals are held per knight (each lair can grant its Seal to every knight) - unique Seals stalemated: each bot took one and nobody reached 3.
- Duel loser suffers normal death; winner intercepts the Seal or the gold loss - keeps PvP loss equal to any death and avoids double penalties.
- Monster stamina 14 (knights 8) - monsters starving on stamina were trivially exploitable.

## Research notes (original 1991 game, used for inspiration only - no names/art/text copied)
- Original: 4 knights in the corners, turn-based map + real-time side-view fights, 4 keys from lairs (stealable from rivals) open the central valley guardian, moon phase changes which monsters are strong (wolves at full moon), XP into attributes, towns with shop/heal/tavern gambling, famous optional gore.
- Modern (2025-26) hooks to borrow: readable telegraphs and hit-stop feel (Hades II), build choices from small boon picks (Slay the Spire 2 / roguelites), short punchy party events (Mario Party-style road events), juicy feedback and quick sessions.

## Phase 2
- M1: Turn order is a seeded shuffle re-rolled every dawn ("initiative") instead of a fixed rotation - with 16-day moon cycles a rotation always gave the same seat first move on the decisive last Full-moon day; a shuffle makes every seat equally likely to act first on every day.
- M2: Arena is a separate Phaser scene layered over the map; it only dispatches the same `choose`/`useItem`/`flee`/`continue` actions - keeps all rules in src/core and the sim unchanged.
- M2: Monsters telegraph their real move (exact via `previewMonsterChoice`); difficulty comes from the reaction window (`tellMs`, 850-1200 ms) and from Strike/Feint sharing the first half of the wind-up - reading is the skill, so no hidden damage bonus was added.
- M2: No input before impact = Guard ("hesitated") - Guard is always legal, so the round always resolves.
- M2: Arena duels between two humans are simultaneous on one device (left A/S/D or left buttons, right J/K/L or right buttons); presses show only "READY" - hides choices without passing the device. Classic mode keeps the pass-and-reveal screens.
- M2: Duel mode is a localStorage setting chosen on the setup screen (default Arena).
- M3: All art is generated at boot (`src/ui/art/textures.ts`): seeded value-noise terrain with forests, ponds and dirt roads; tiling fog; radial glow; moon discs per phase with craters and terminator; node icons drawn with Graphics - no image files at all.
- M3: Real Phaser Light2D on the map terrain (villages warm, homes in player colour, lairs red, Sanctum blue/gold) with ambient light following the moon phase; additive glow sprites duplicate the lights so Canvas renderers still look lit.
- M3: Palette moved to dark fantasy (ink purples, bronze frames, parchment text, crimson primary) with serif headings from system fonts (Georgia/Palatino) - no web fonts to download.
- M3: Blood particles respect a `blood` setting (sparks instead when off), echoing the original's optional gore toggle.
- M4: Hit stop is done by scaling scene time and tweens to 3% for 50-110 ms on a real-time `setTimeout` - freezes everything (timers included) without touching game state.
- M4: All audio is synthesised (oscillators + filtered noise, `src/ui/audio.ts`); the AudioContext is created on the first pointer/key press to satisfy autoplay rules. Ambient = wandering-band wind + breathing low drone.
- M4: Sanctum opening gets a full-screen cinematic (darken, rising full moon, choir-like sting, shake); other phase changes only get a banner + chime so the big moment stays special.
- M5: Extra monsters appear as road ambushes (4 "wanderers": no Seal, gold + loot + renown) so lair difficulty and seat balance stay intact while there are 9 distinct foes.
- M5: Every monster has its own strong and weak moon phase (Dire Wolf strongest at Full, as in the original's werewolf-ish wolves) on top of the general moon effect.
- M5: Roads trigger one of 7 weighted events 50% of the time; the bone-dice game is a fair bet (ties push) as a nod to the original's tavern gambling.
- M5: Renown/level-ups (wins at 2, 4, 7, 11, 16) with a choice of 3 boons, offered at the start of the knight's own turn - borrows the roguelite "pick 1 of 3" hook and the original's XP-into-attributes; Warden raised to HP 66 / ATK 10 to keep game length in range.
- M6: Autosave after every action to localStorage (whole plain state, versioned key); a corrupt or unknown save is ignored rather than crashing the title screen.
- M6: Rules and Settings are DOM overlays (scrollable, real form controls, readable on phones) instead of Phaser modals; the in-game Menu adds Resume and "Save and quit to title".
- M6: Tutorial = 6 coach marks on the first human turn; two steps wait for the real action (roll, move) instead of a Next button. Shown once, re-enable in Settings.
- M6: Volume moved off the setup screen into Settings to keep setup usable at 800x360.
- M7: Text never renders below 12 logical px (about 7.5 CSS px at 800x360); the panel was reflowed and items got short labels to fit. Low-contrast "empty" text was brightened.
- M7: Space/Enter roll the die and end the turn (plus the arena keys) so a keyboard-only player never needs the mouse on desktop.
- M7: Leather Jerkin raised to +2 Defense - at +1 it was never an upgrade over the starting coat (0 uses in the sim).
- M7: Light2D `maxLights` raised to 16 so all 13 map lights render.

## Phase 3 (3D)
- N1: Browser 3D with three.js (WebGL2) instead of Unreal - it is the only option that can be built, screenshot-tested and deployed from this environment; GitHub Pages hosting stays.
- N1: Characters are CC0 KayKit (stylised low-poly) - no realistic, rigged, animated, freely licensed medieval characters are reachable from here (only GitHub raw and npm are allowed hosts). Realistic route = Mixamo characters/animations supplied by the owner (Adobe login required).
- N1: All KayKit characters share one rig, so animations live in one shared `anims.glb` (460 KB) and each character file has meshes only (~150 KB); meshopt compression; total 3D payload ~2 MB.
- N1: "Perfect read" = committing in the last 30% of the reaction window adds x1.5 damage on a won exchange (core `perfect` flag, tested); bots land it 25% of the time in the sim. Inspired by the reactive-timing turn combat of Clair Obscur: Expedition 33.
- N1: Monsters reuse recoloured/re-armed KayKit characters until bespoke monster models (N2).
- N1: The whole map interface moved from Phaser-drawn boxes to an HTML/CSS design system (Cinzel/Spectral, gilded frames, medallions, crest-shaped action sigils, game-icons.net glyphs) - CSS/SVG gives far richer, crisper UI than canvas primitives. Classic-duel mode screens stay in Phaser.
- N1: 3D Arena is the default duel mode; 2D Arena and Classic remain in Settings; the 3D arena falls back to 2D until models load or if WebGL2 is missing.
