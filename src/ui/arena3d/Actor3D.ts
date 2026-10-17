// One animated 3D fighter: either a cloned KayKit character driven by the shared clips, or a realistic
// Sketchfab model driven by its own clips. Sketchfab models rarely ship a full combat set, so missing
// moves (wind-ups, strikes, recoils, deaths) are synthesised procedurally on a wrapper group.
import * as THREE from 'three';
import { cloneCharacter, cloneProp, cloneSf, cloneSfProp, getClips, isSf, sfReady, type CharacterFile, type PropFile, type SfFile, type SfProp } from './assets3d';

export interface ActorLook {
  model: CharacterFile;
  /** realistic replacement, used when it has finished loading */
  sf?: SfFile;
  /** player / monster colour applied to cloth parts (capes, cloaks, tabards) */
  tint?: number;
  /** overall colour wash (e.g. rust, moss) mixed into every material */
  wash?: number;
  washAmount?: number;
  scale?: number;
  weapon?: PropFile;
  offhand?: PropFile;
  /** permanent faint glow (e.g. the Sanctum guardian) */
  aura?: number;
}

/** Items to keep in each hand when a character model ships with several. */
const PREFERRED_HELD = ['1H_Sword', 'Round_Shield', 'Badge_Shield', '1H_Axe', '2H_Axe', 'Knife', 'Dagger'];

const HEIGHT = 1.8;
/** three.js strips dots from node names, so 'handslot.r' becomes 'handslotr' */
const SLOT_R = THREE.PropertyBinding.sanitizeNodeName('handslot.r');
const SLOT_L = THREE.PropertyBinding.sanitizeNodeName('handslot.l');

/** What the arena asks for (KayKit clip names) mapped to a move category. */
type Move = 'idle' | 'attack' | 'attack2' | 'block' | 'hit' | 'death' | 'roar';
const KAY_MOVE: Record<string, Move> = {
  Idle_Combat: 'idle', Idle: 'idle',
  '1H_Melee_Attack_Chop': 'attack', '1H_Melee_Attack_Slice_Horizontal': 'attack2',
  Blocking: 'block', Block_Attack: 'block',
  Hit_A: 'hit', Hit_B: 'hit',
  Death_A: 'death', Death_B: 'death',
  Spawn_Ground: 'roar', Taunt: 'roar', Cheer: 'roar',
};

interface SfTune {
  /** target size in metres, measured as height or as the longest horizontal extent */
  size: number;
  by: 'height' | 'length';
  /** extra rotation so the model faces +Z like the KayKit rigs */
  yaw?: number;
  clips: Partial<Record<Move, string>>;
  idleSpeed?: number;
  /** material-name pattern recoloured with the player tint */
  tintMat?: RegExp;
  weapon?: PropFile;
  /** realistic weapon (preferred over `weapon` once loaded) and how it sits in the hand */
  sfWeapon?: SfProp;
  /** blade direction in the hand bone's local frame; flip swaps which end of the prop is the grip */
  grip?: { dir: [number, number, number]; flip?: boolean; len: number; twist?: number };
  /** hand bone for the weapon and hit effects */
  hand?: RegExp;
  /** procedural motion strength (big creatures sway less) */
  sway?: number;
  /** colour wash for models whose palette does not fit their role */
  wash?: number;
  washAmount?: number;
  /** turn the texture to greyscale before the wash, so a blue rock golem can become bone */
  desaturate?: boolean;
  /** drop translation tracks from the idle clip (walk cycles used as idle drift away otherwise) */
  stripRoot?: boolean;
}

export const SF_TUNE: Record<SfFile, SfTune> = {
  knight: { size: 1.85, by: 'height', yaw: Math.PI, clips: { idle: 'FIGHTIDLE_Root' }, tintMat: /cloth|plume/i, weapon: 'w_skeleton_blade', sfWeapon: 'sword', grip: { dir: [0, 1, 0], len: 1.05 }, hand: /R_Hand/ },
  rustKnight: { size: 1.9, by: 'height', clips: { idle: 'Idle' }, weapon: 'w_skeleton_axe', sfWeapon: 'axe', grip: { dir: [0, 1, 0], len: 0.85 }, hand: /RightHand/ },
  direWolf: { size: 2.4, by: 'length', yaw: -Math.PI / 2, clips: { idle: 'metarig.002|IDLE', roar: 'metarig.002|RRAR', attack: 'metarig.002|RRAR' } },
  bogTroll: { size: 2.6, by: 'height', clips: { idle: 'idle', attack: 'attack1', attack2: 'attack2', hit: 'take_damage', death: 'death', roar: 'attack2' }, sway: 0.6 },
  caveDrake: { size: 3.4, by: 'length', clips: { idle: 'Idle Stand' }, sway: 0.5 },
  giantSpider: { size: 3.0, by: 'length', clips: { idle: 'Armature|walk tight', attack: 'Armature|attack', death: 'Armature|die' }, idleSpeed: 0.25, stripRoot: true },
  marshSerpent: { size: 4.2, by: 'length', yaw: -Math.PI / 2, clips: { idle: 'f_idle', attack: 'f_attack', hit: 'f_hit', death: 'Death__f_knock' } },
  boneGolem: { size: 2.2, by: 'height', desaturate: true, clips: { idle: 'Idle', attack: 'Attack1', attack2: 'Attack2', block: 'Defence2', roar: 'Attack3' }, sway: 0.6, wash: 0xd8ccb0, washAmount: 0.75 },
  guardian: { size: 2.5, by: 'height', clips: { idle: 'Take 001' }, hand: /Hand_Right/, sway: 0.7 },
};

/** Some exporters keep the source timeline offset (a clip running from 13.8 s to 15 s): shift it to 0. */
function normaliseClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  let start = Infinity;
  for (const t of clip.tracks) if (t.times.length) start = Math.min(start, t.times[0]);
  const c = clip.clone();
  if (Number.isFinite(start) && start >= 0.05) {
    for (const t of c.tracks) t.shift(-start);
    c.resetDuration();
  }
  // single-key clips are static poses: give them a length so the mixer can hold them
  if (c.duration < 0.05) c.duration = 1;
  return c;
}

interface Proc { move: Move; t: number; dur: number; frac?: number }

/**
 * Wrap a static weapon so its grip sits at the hand bone's origin with the blade along `grip.dir`.
 * The grip is found from the bounding box: the long axis, a tenth of the way in from one end.
 */
function gripWeapon(prop: THREE.Object3D, grip: NonNullable<SfTune['grip']>): THREE.Object3D {
  prop.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = true; (o as THREE.Mesh).frustumCulled = false; } });
  prop.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(prop);
  const size = box.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
  const len = size.getComponent(axis) || 1;
  const centre = box.getCenter(new THREE.Vector3());
  const sign = grip.flip ? -1 : 1;
  const gripPt = centre.clone().setComponent(axis, centre.getComponent(axis) - sign * len * 0.4);
  const inner = new THREE.Group();
  prop.position.sub(gripPt);
  inner.add(prop);
  const along = new THREE.Vector3().setComponent(axis, sign);
  const holder = new THREE.Group();
  holder.add(inner);
  inner.quaternion.setFromUnitVectors(along, new THREE.Vector3(...grip.dir).normalize());
  if (grip.twist) inner.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...grip.dir).normalize(), grip.twist));
  holder.userData.wantLen = grip.len / len;
  return holder;
}

export class Actor3D {
  readonly root = new THREE.Group();
  /** wrapper for procedural motion; the model's own transform holds the normalisation */
  private proc = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private materials: THREE.MeshStandardMaterial[] = [];
  private handR: THREE.Object3D | null = null;
  private chestBone: THREE.Object3D | null = null;
  private glowLight: THREE.PointLight;
  readonly height: number;
  /** half the body's depth along its facing, for spacing and lunges */
  reach = 0.4;
  readonly realistic: boolean;
  private tune: SfTune | null = null;
  private procState: Proc | null = null;
  private deathSide = 1;

  constructor(look: ActorLook) {
    const sf = look.sf && isSf(look.sf) && sfReady(look.sf) ? look.sf : null;
    this.realistic = !!sf;
    let clips: THREE.AnimationClip[];
    if (sf) {
      const c = cloneSf(sf);
      this.model = c.scene;
      this.tune = SF_TUNE[sf];
      clips = c.clips.map(normaliseClip);
      if (this.tune.stripRoot) {
        const idle = clips.find((k) => k.name === this.tune!.clips.idle);
        if (idle) idle.tracks = idle.tracks.filter((t) => !t.name.endsWith('.position'));
      }
    } else {
      this.model = cloneCharacter(look.model);
      clips = getClips();
    }
    this.root.add(this.proc);
    this.proc.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    if (sf) {
      // measure in the idle pose, not the bind pose (legs splay, tails coil)
      const idle = this.actions.get(this.tune!.clips.idle ?? '');
      idle?.play();
      this.mixer.update(0);
    }
    this.height = this.normalise(look);

    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // skinned bounds lag behind big animations
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const cloned = mats.map((m) => this.adoptMaterial(m, o.name, look));
        mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
      }
      if (sf) {
        if (!this.handR && this.tune!.hand?.test(o.name)) this.handR = o;
      } else {
        if (o.name === SLOT_R) this.handR = o;
        if (o.name === 'chest') this.chestBone = o;
      }
    });
    if (sf) this.attachSfWeapon();
    else this.setupHeldItems(look);

    this.glowLight = new THREE.PointLight(0xffffff, 0, 3.5, 2);
    this.glowLight.position.set(0, this.height * 0.8, 0.6);
    this.root.add(this.glowLight);

    this.play('Idle_Combat', { fade: 0 });
  }

  /** Scale to the arena's size conventions, stand on the ground, centre on the origin. */
  private normalise(look: ActorLook): number {
    const t = this.tune;
    if (t?.yaw) this.model.rotation.y = t.yaw;
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model, !!t);
    const size = box.getSize(new THREE.Vector3());
    const extent = t?.by === 'length' ? Math.max(size.x, size.z) : size.y;
    const target = (t?.size ?? HEIGHT) * (t ? 1 : look.scale ?? 1);
    const s = target / (extent || 1);
    this.model.scale.multiplyScalar(s);
    if (t) {
      this.reach = Math.max(0.35, (size.z * s) / 2);
      const c = box.getCenter(new THREE.Vector3());
      this.model.position.set(-c.x * s, -box.min.y * s, -c.z * s);
    }
    return t ? size.y * s : HEIGHT * (look.scale ?? 1);
  }

  private adoptMaterial(m: THREE.Material, nodeName: string, look: ActorLook): THREE.Material {
    const c = m.clone() as THREE.MeshStandardMaterial;
    const name = (nodeName + ' ' + (m.name ?? '')).toLowerCase();
    if (!c.color) return c;
    const tintRe = this.tune ? this.tune.tintMat : /(cape|cloak|tabard|badge)/;
    if (look.tint !== undefined && tintRe?.test(name)) c.color = new THREE.Color(look.tint).lerp(new THREE.Color(0xffffff), this.tune ? 0.25 : 0);
    const wash = this.tune ? this.tune.wash : look.wash;
    const washAmount = this.tune ? this.tune.washAmount : look.washAmount;
    if (wash !== undefined) c.color.lerp(new THREE.Color(wash), washAmount ?? 0.35);
    if (this.tune?.desaturate) {
      c.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <alphamap_fragment>',
          '#include <alphamap_fragment>\n diffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))) * 1.6;');
      };
    }
    if (c.emissive) {
      const own = this.tune && c.emissiveMap ? c.emissive.clone() : null;
      if (!own) {
        c.emissive = new THREE.Color(look.aura ?? 0x000000);
        c.emissiveIntensity = look.aura ? 0.35 : 0;
        this.materials.push(c);
      }
    }
    return c;
  }

  /** Characters ship with several weapons/shields in each hand: keep one, or attach a prop. */
  private setupHeldItems(look: ActorLook): void {
    for (const side of [SLOT_R, SLOT_L]) {
      const slot = this.model.getObjectByName(side);
      if (!slot) continue;
      const held = slot.children.filter((c) => !(c as THREE.Bone).isBone);
      const keep = held.find((c) => PREFERRED_HELD.includes(c.name)) ?? held[0];
      for (const c of held) c.visible = c === keep;
      const prop = side === SLOT_R ? look.weapon : look.offhand;
      if (prop) {
        for (const c of held) c.visible = false;
        const p = cloneProp(prop);
        p.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
        slot.add(p);
      }
    }
  }

  /** Put a KayKit weapon in a realistic model's hand, sized in world metres whatever the rig's scale. */
  private attachSfWeapon(): void {
    const t = this.tune;
    if (!t || !this.handR) return;
    const real = t.sfWeapon && t.grip ? cloneSfProp(t.sfWeapon) : null;
    if (real) {
      const holder = gripWeapon(real, t.grip!);
      this.root.updateMatrixWorld(true);
      holder.scale.setScalar(holder.userData.wantLen / (this.handR.getWorldScale(new THREE.Vector3()).x || 1));
      this.handR.add(holder);
      return;
    }
    const prop = t.weapon;
    if (!prop) return;
    const p = cloneProp(prop);
    p.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    const len = new THREE.Box3().setFromObject(p).getSize(new THREE.Vector3()).length() || 1;
    this.root.updateMatrixWorld(true);
    const hs = this.handR.getWorldScale(new THREE.Vector3()).x || 1;
    p.scale.setScalar(0.85 / len / hs);
    this.handR.add(p);
  }

  private moveFor(name: string): Move | null {
    return KAY_MOVE[name] ?? null;
  }

  /** Clip to use for a requested move on a realistic model, or null to synthesise it. */
  private sfClip(move: Move): THREE.AnimationAction | null {
    const clips = this.tune!.clips;
    const n = clips[move] ?? (move === 'attack2' ? clips.attack : undefined);
    const a = n ? this.actions.get(n) : undefined;
    return a ?? null;
  }

  play(name: string, opts: { fade?: number; loop?: boolean; speed?: number; clamp?: boolean } = {}): THREE.AnimationAction | null {
    let next: THREE.AnimationAction | undefined | null;
    let speed = opts.speed ?? 1;
    let loop = opts.loop !== false;
    if (this.tune) {
      const move = this.moveFor(name) ?? 'idle';
      next = this.sfClip(move);
      this.startProc(move, !!next);
      if (!next || move === 'idle') {
        next = this.sfClip('idle') ?? [...this.actions.values()][0];
        speed = this.tune.idleSpeed ?? 1;
        loop = true;
      } else if (move === 'hit' || move === 'attack' || move === 'attack2') {
        // clips authored at cinematic pace: fit them inside the exchange
        speed *= Math.max(1, next.getClip().duration / 1.1);
      }
      if (!next) return null;
    } else {
      next = this.actions.get(name) ?? this.actions.get('Idle');
      if (!next) return null;
    }
    const fade = opts.fade ?? 0.18;
    next.reset();
    next.paused = false;
    next.enabled = true;
    next.setEffectiveTimeScale(speed);
    next.setEffectiveWeight(1);
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = opts.clamp ?? !loop;
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, fade, false);
    next.play();
    this.current = next;
    return next;
  }

  /** Hold a clip at a fraction of its length (used to scrub wind-ups in sync with the window). */
  pose(name: string, frac: number, fade = 0.12): void {
    frac = Math.max(0, Math.min(1, frac));
    if (this.tune) {
      const move = this.moveFor(name) ?? 'idle';
      const clip = this.sfClip(move);
      if (clip) {
        if (this.current !== clip) {
          this.play(name, { fade, loop: false, clamp: true });
        }
        clip.paused = true;
        clip.time = frac * clip.getClip().duration;
      } else if (this.current !== this.sfClip('idle')) this.play('Idle_Combat', { fade });
      this.procState = { move, t: 0, dur: Infinity, frac };
      return;
    }
    const a = this.actions.get(name);
    if (!a) return;
    if (this.current !== a) this.play(name, { fade, loop: false, clamp: true });
    a.paused = true;
    a.time = frac * a.getClip().duration;
  }

  /** Begin a procedural accent for a move; when the model has a real clip only a light accent is added. */
  private startProc(move: Move, hasClip: boolean): void {
    if (move === 'idle') { this.procState = null; return; }
    if (move === 'death') this.deathSide = Math.random() < 0.5 ? 1 : -1;
    const dur = move === 'death' ? Infinity : move === 'roar' ? 1.4 : move === 'hit' ? 0.5 : 0.7;
    this.procState = { move, t: 0, dur, frac: hasClip ? -1 : undefined };
  }

  private applyProc(dt: number): void {
    const p = this.proc;
    const st = this.procState;
    let pitch = 0, roll = 0, dy = 0, dz = 0, sc = 1;
    if (st) {
      st.t += dt;
      const k = this.tune?.sway ?? 1;
      const light = st.frac === -1 ? 0.35 : 1; // a real clip carries the motion
      const u = Math.min(1, st.t / Math.min(st.dur, 10));
      if (st.dur === Infinity && st.move !== 'death') {
        // held wind-up pose
        const f = st.frac ?? 0;
        if (st.move === 'block') { pitch = -0.14 * f; dy = -0.06 * f; sc = 1 - 0.03 * f; }
        else if (st.move === 'attack' || st.move === 'attack2') { pitch = -0.22 * f; dz = -0.12 * f; sc = 1 + 0.04 * f; }
      } else if (st.move === 'attack' || st.move === 'attack2') {
        // snap forward then settle
        const a = u < 0.3 ? u / 0.3 : Math.max(0, 1 - (u - 0.3) / 0.7);
        pitch = 0.32 * a * light; dz = 0.25 * a * light;
        if (st.move === 'attack2') roll = 0.12 * a * light;
      } else if (st.move === 'hit') {
        const a = Math.sin(Math.min(1, u) * Math.PI) * (1 - u * 0.5);
        pitch = -0.3 * a * light; dz = -0.1 * a * light;
      } else if (st.move === 'block') {
        const a = Math.sin(Math.min(1, u) * Math.PI);
        pitch = -0.15 * a * light; dy = -0.05 * a * light;
      } else if (st.move === 'roar') {
        const a = Math.sin(Math.min(1, u) * Math.PI);
        pitch = -0.2 * a * light; sc = 1 + 0.06 * a * light;
      } else if (st.move === 'death' && st.frac !== -1) {
        // topple onto the side and sink a little
        const f = Math.min(1, st.t / 0.9);
        const e = f * f * (3 - 2 * f);
        roll = this.deathSide * e * Math.PI * 0.48;
        dy = -e * this.height * 0.08;
      }
      if (st.move !== 'death') { pitch *= k; roll *= k; }
      if (st.t >= st.dur) this.procState = null;
    }
    // ease toward the target so poses never pop
    const ease = 1 - Math.exp(-dt * 14);
    p.rotation.x += (pitch - p.rotation.x) * ease;
    p.rotation.z += (roll - p.rotation.z) * ease;
    p.position.y += (dy - p.position.y) * ease;
    p.position.z += (dz - p.position.z) * ease;
    p.scale.setScalar(p.scale.x + (sc - p.scale.x) * ease);
  }

  clipDuration(name: string): number {
    return this.actions.get(name)?.getClip().duration ?? 1;
  }

  /** Coloured glow for telegraphs: emissive tint + a small light at the fighter. */
  setGlow(color: number, amount: number): void {
    for (const m of this.materials) {
      m.emissive.setHex(color);
      m.emissiveIntensity = amount * 0.18;
    }
    this.glowLight.color.setHex(color);
    this.glowLight.intensity = amount * 9;
  }

  flash(): void {
    this.setGlow(0xffd0c0, 0.5);
    window.setTimeout(() => this.setGlow(0x000000, 0), 90);
  }

  update(dt: number): void {
    this.mixer.update(dt);
    if (this.tune) this.applyProc(dt);
  }

  handWorld(target = new THREE.Vector3()): THREE.Vector3 {
    if (!this.handR) return this.chestWorld(target);
    return this.handR.getWorldPosition(target);
  }

  chestWorld(target = new THREE.Vector3()): THREE.Vector3 {
    if (this.chestBone) return this.chestBone.getWorldPosition(target);
    return this.root.getWorldPosition(target).add(new THREE.Vector3(0, this.height * 0.6, 0));
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const m of this.materials) m.dispose();
  }
}
