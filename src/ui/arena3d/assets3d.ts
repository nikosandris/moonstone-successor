// Loads and caches the CC0 KayKit models (public/assets/3d, see scripts/fetch-assets.ts)
// and the realistic CC-BY Sketchfab models (public/assets/sf, see scripts/sketchfab.ts).
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { capTextures } from '../gfx';
import { lowGraphics } from '../settings';

const BASE = `${import.meta.env.BASE_URL}assets/3d/`;
const SF_BASE = `${import.meta.env.BASE_URL}assets/sf/`;

/** Realistic models, keyed by the monster id they replace ('knight' is the player). */
export const SF_FILES = ['knight', 'direWolf', 'bogTroll', 'rustKnight', 'caveDrake', 'giantSpider', 'marshSerpent', 'boneGolem', 'guardian'] as const;
export type SfFile = (typeof SF_FILES)[number];
/** Static realistic props (weapons) from the same pipeline. */
export const SF_PROPS = ['sword', 'axe'] as const;
export type SfProp = (typeof SF_PROPS)[number];

export const CHARACTER_FILES = ['knight', 'barbarian', 'rogue', 'skeleton_warrior', 'skeleton_minion', 'skeleton_rogue', 'skeleton_mage'] as const;
export const PROP_FILES = [
  'tree_single_A', 'tree_single_B', 'trees_A_large', 'trees_A_medium', 'trees_B_large',
  'rock_single_A', 'rock_single_B', 'rock_single_C', 'hill_single_A', 'mountain_A_grass_trees',
  'w_skeleton_blade', 'w_skeleton_axe', 'w_skeleton_staff', 'w_skeleton_shield', 'w_axe', 'w_axe2h', 'w_dagger', 'w_shield_round',
] as const;

export type CharacterFile = (typeof CHARACTER_FILES)[number];
export type PropFile = (typeof PROP_FILES)[number];

const cache = new Map<string, GLTF>();
let clips: THREE.AnimationClip[] = [];
let loading: Promise<void> | null = null;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

function load(name: string, base = BASE): Promise<GLTF> {
  return new Promise((resolve, reject) => loader.load(`${base}${name}.glb`, resolve, undefined, reject));
}

const sfCache = new Map<string, GLTF>();
const sfLoading = new Map<string, Promise<GLTF | null>>();

/** Load one realistic model in the background (about 0.3-2 MB each); resolves null on failure. */
export function preloadSf(name: SfFile | SfProp): Promise<GLTF | null> {
  let p = sfLoading.get(name);
  if (!p) {
    p = load(name, SF_BASE).then((g) => {
      if (lowGraphics()) capTextures(g.scene, 512);
      sfCache.set(name, g);
      return g;
    }, () => { sfLoading.delete(name); return null; });
    sfLoading.set(name, p);
  }
  return p;
}

/** Load all realistic models one after another so they never compete with the game's own loading. */
export async function preloadAllSf(): Promise<void> {
  for (const n of [...SF_PROPS, ...SF_FILES]) await preloadSf(n);
}

/** The realistic models a fight needs: the knight, its weapons and the monster (if it has one). */
export function sfForFight(monsterId: string | null | undefined): (SfFile | SfProp)[] {
  const need: (SfFile | SfProp)[] = ['knight', ...SF_PROPS];
  if (monsterId && isSf(monsterId)) need.push(monsterId);
  return need;
}

export function isSf(name: string): name is SfFile {
  return (SF_FILES as readonly string[]).includes(name);
}

export function sfReady(name: string): boolean {
  return sfCache.has(name);
}

export function cloneSfProp(name: SfProp): THREE.Object3D | null {
  return sfCache.get(name)?.scene.clone(true) ?? null;
}

/** A fresh copy of a realistic model plus its own animation clips. */
export function cloneSf(name: SfFile): { scene: THREE.Object3D; clips: THREE.AnimationClip[] } {
  const src = sfCache.get(name);
  if (!src) throw new Error(`model not loaded: ${name}`);
  return { scene: SkeletonUtils.clone(src.scene), clips: src.animations };
}

/** Load everything once (about 2 MB). Safe to call repeatedly. */
export function preload3d(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const names = ['anims', ...CHARACTER_FILES, ...PROP_FILES];
      const results = await Promise.all(names.map((n) => load(n)));
      names.forEach((n, i) => cache.set(n, results[i]));
      clips = cache.get('anims')!.animations;
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

export function is3dReady(): boolean {
  return cache.has('anims');
}

/** A fresh, independently animatable copy of a character (skinned meshes cloned properly). */
export function cloneCharacter(name: CharacterFile): THREE.Object3D {
  const src = cache.get(name);
  if (!src) throw new Error(`model not loaded: ${name}`);
  return SkeletonUtils.clone(src.scene);
}

export function cloneProp(name: PropFile): THREE.Object3D {
  const src = cache.get(name);
  if (!src) throw new Error(`model not loaded: ${name}`);
  return src.scene.clone(true);
}

export function getClips(): THREE.AnimationClip[] {
  return clips;
}

export function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}
