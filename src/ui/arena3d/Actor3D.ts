// One animated 3D fighter: a cloned KayKit character driven by the shared animation clips.
import * as THREE from 'three';
import { cloneCharacter, cloneProp, getClips, type CharacterFile, type PropFile } from './assets3d';

export interface ActorLook {
  model: CharacterFile;
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

export class Actor3D {
  readonly root = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private materials: THREE.MeshStandardMaterial[] = [];
  private handR: THREE.Object3D | null = null;
  private chestBone: THREE.Object3D | null = null;
  private glowLight: THREE.PointLight;
  readonly height: number;

  constructor(look: ActorLook) {
    this.model = cloneCharacter(look.model);
    // normalise to a common height so every character fits the arena framing
    const box = new THREE.Box3().setFromObject(this.model);
    const h = box.max.y - box.min.y || 1;
    const s = (HEIGHT / h) * (look.scale ?? 1);
    this.model.scale.setScalar(s);
    this.height = HEIGHT * (look.scale ?? 1);
    this.root.add(this.model);

    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // skinned bounds lag behind big animations
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const cloned = mats.map((m) => {
          const c = (m as THREE.MeshStandardMaterial).clone();
          const name = (o.name + ' ' + (m.name ?? '')).toLowerCase();
          if (look.tint !== undefined && /(cape|cloak|tabard|badge)/.test(name)) c.color = new THREE.Color(look.tint);
          if (look.wash !== undefined) c.color.lerp(new THREE.Color(look.wash), look.washAmount ?? 0.35);
          c.emissive = new THREE.Color(look.aura ?? 0x000000);
          c.emissiveIntensity = look.aura ? 0.35 : 0;
          this.materials.push(c);
          return c;
        });
        mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
      }
      if (o.name === SLOT_R) this.handR = o;
      if (o.name === 'chest') this.chestBone = o;
    });
    this.setupHeldItems(look);

    this.glowLight = new THREE.PointLight(0xffffff, 0, 3.5, 2);
    this.glowLight.position.set(0, this.height * 0.8, 0.6);
    this.root.add(this.glowLight);

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of getClips()) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.play('Idle_Combat', { fade: 0 });
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

  play(name: string, opts: { fade?: number; loop?: boolean; speed?: number; clamp?: boolean } = {}): THREE.AnimationAction | null {
    const next = this.actions.get(name) ?? this.actions.get('Idle');
    if (!next) return null;
    const fade = opts.fade ?? 0.18;
    next.reset();
    next.paused = false;
    next.enabled = true;
    next.setEffectiveTimeScale(opts.speed ?? 1);
    next.setEffectiveWeight(1);
    next.setLoop(opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = opts.clamp ?? opts.loop === false;
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, fade, false);
    next.play();
    this.current = next;
    return next;
  }

  /** Hold a clip at a fraction of its length (used to scrub wind-ups in sync with the window). */
  pose(name: string, frac: number, fade = 0.12): void {
    const a = this.actions.get(name);
    if (!a) return;
    if (this.current !== a) this.play(name, { fade, loop: false, clamp: true });
    a.paused = true;
    a.time = Math.max(0, Math.min(1, frac)) * a.getClip().duration;
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
  }

  handWorld(target = new THREE.Vector3()): THREE.Vector3 {
    return (this.handR ?? this.root).getWorldPosition(target);
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
