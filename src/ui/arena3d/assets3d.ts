// Loads and caches the CC0 KayKit models (public/assets/3d, see scripts/fetch-assets.ts).
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const BASE = `${import.meta.env.BASE_URL}assets/3d/`;

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

function load(name: string): Promise<GLTF> {
  return new Promise((resolve, reject) => loader.load(`${BASE}${name}.glb`, resolve, undefined, reject));
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
