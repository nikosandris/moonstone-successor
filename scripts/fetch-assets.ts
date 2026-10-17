// Downloads the CC0 3D assets used by the 3D arena and optimises them into public/assets/3d/.
// Run with `npm run assets` (the optimised files are committed, so the build never needs the network).
// Sources: KayKit by Kay Lousberg (CC0) - https://github.com/KayKit-Game-Assets
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const RAW = 'https://raw.githubusercontent.com/KayKit-Game-Assets';
const OUT = 'public/assets/3d';
const ADV = `${RAW}/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf`;
const SKEL = `${RAW}/KayKit-Character-Pack-Skeletons-1.0/main/addons/kaykit_character_pack_skeletons/Characters/gltf`;
const HEX = `${RAW}/KayKit-Medieval-Hexagon-Pack-1.0/main/addons/kaykit_medieval_hexagon_pack/Assets/gltf`;

/** Animation clips the arena actually uses; the rest are stripped to keep downloads small. */
const KEEP = new Set([
  'Idle', 'Idle_Combat', 'Taunt', 'Cheer', 'Spawn_Ground',
  '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab',
  'Block', 'Block_Hit', 'Block_Attack', 'Blocking',
  'Dodge_Backward', 'Dodge_Forward', 'Dodge_Left', 'Dodge_Right',
  'Hit_A', 'Hit_B', 'Death_A', 'Death_B',
  'Walking_Backwards', 'Running_Strafe_Left', 'Running_Strafe_Right',
]);

const CHARACTERS: [string, string][] = [
  ['knight', `${ADV}/Knight.glb`],
  ['barbarian', `${ADV}/Barbarian.glb`],
  ['rogue', `${ADV}/Rogue_Hooded.glb`],
  ['skeleton_warrior', `${SKEL}/Skeleton_Warrior.glb`],
  ['skeleton_minion', `${SKEL}/Skeleton_Minion.glb`],
  ['skeleton_rogue', `${SKEL}/Skeleton_Rogue.glb`],
  ['skeleton_mage', `${SKEL}/Skeleton_Mage.glb`],
];

const NATURE = `${HEX}/decoration/nature`;
const SKEL_ASSETS = `${RAW}/KayKit-Character-Pack-Skeletons-1.0/main/addons/kaykit_character_pack_skeletons/Assets/gltf`;
const ADV_ASSETS = `${RAW}/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Assets/gltf`;

/** [output name, directory url, file name without extension] */
const GLTF_PARTS: [string, string, string][] = [
  ...['tree_single_A', 'tree_single_B', 'trees_A_large', 'trees_A_medium', 'trees_B_large', 'rock_single_A', 'rock_single_B', 'rock_single_C', 'hill_single_A', 'mountain_A_grass_trees']
    .map((n): [string, string, string] => [n, NATURE, n]),
  ['w_skeleton_blade', SKEL_ASSETS, 'Skeleton_Blade'],
  ['w_skeleton_axe', SKEL_ASSETS, 'Skeleton_Axe'],
  ['w_skeleton_staff', SKEL_ASSETS, 'Skeleton_Staff'],
  ['w_skeleton_shield', SKEL_ASSETS, 'Skeleton_Shield_Small_A'],
  ['w_axe', ADV_ASSETS, 'axe_1handed'],
  ['w_axe2h', ADV_ASSETS, 'axe_2handed'],
  ['w_dagger', ADV_ASSETS, 'dagger'],
  ['w_shield_round', ADV_ASSETS, 'shield_round'],
];

async function get(url: string): Promise<Uint8Array<ArrayBuffer>> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    if (res.status === 404) throw new Error(`404 ${url}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error(`failed ${url}`);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

async function optimise(doc: Document, keepAnims: boolean): Promise<Uint8Array> {
  const root = doc.getRoot();
  const dropAnim = (anim: ReturnType<typeof root.listAnimations>[number]) => {
    for (const ch of anim.listChannels()) ch.dispose();
    for (const s of anim.listSamplers()) s.dispose(); // orphaned accessors are removed by prune()
    anim.dispose();
  };
  for (const anim of root.listAnimations()) if (!keepAnims || !KEEP.has(anim.getName())) dropAnim(anim);
  // drop channels that animate rig helpers (IK targets, controls) rather than skinned joints
  const joints = new Set(root.listSkins().flatMap((s) => s.listJoints()));
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const out = ch.getSampler()?.getOutput()?.getArray();
      const path = ch.getTargetPath();
      const rest = node ? (path === 'rotation' ? node.getRotation() : path === 'translation' ? node.getTranslation() : node.getScale()) : null;
      // a channel whose every keyframe equals the bind pose does nothing
      const k = rest ? rest.length : 0;
      const constant = !!out && !!rest && Array.from(out).every((v, i) => Math.abs(v - rest[i % k]) < 1e-4);
      if (!node || !joints.has(node) || constant) {
        const sampler = ch.getSampler();
        ch.dispose();
        sampler?.dispose();
      }
    }
  }
  await MeshoptEncoder.ready;
  // meshopt quantises and compresses geometry and (mostly) animation keyframes; three.js decodes it
  await doc.transform(dedup(), resample(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return io.writeBinary(doc);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // All KayKit characters share one rig (same bone names), so the animation clips live in a single
  // shared file and every character file carries only its meshes and skeleton.
  for (const [name, url] of CHARACTERS) {
    const doc = await io.readBinary(await get(url));
    const bytes = await optimise(doc, false);
    writeFileSync(join(OUT, `${name}.glb`), bytes);
    console.log(`${name}.glb ${(bytes.length / 1024).toFixed(0)} KB`);
  }
  {
    const doc = await io.readBinary(await get(`${SKEL}/Skeleton_Warrior.glb`));
    for (const mesh of doc.getRoot().listMeshes()) mesh.dispose();
    const bytes = await optimise(doc, true);
    writeFileSync(join(OUT, 'anims.glb'), bytes);
    console.log(`anims.glb ${(bytes.length / 1024).toFixed(0)} KB, clips: ${doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')}`);
  }
  // props and weapons are .gltf with an external .bin and texture: fetch all parts, pack to .glb
  for (const [name, dir, file] of GLTF_PARTS) {
    const json = JSON.parse(new TextDecoder().decode(await get(`${dir}/${file}.gltf`)));
    const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
    for (const b of json.buffers ?? []) resources[b.uri] = await get(`${dir}/${b.uri}`);
    for (const im of json.images ?? []) resources[im.uri] = await get(`${dir}/${im.uri}`);
    const doc = await io.readJSON({ json, resources });
    const bytes = await optimise(doc, false);
    writeFileSync(join(OUT, `${name}.glb`), bytes);
    console.log(`${name}.glb ${(bytes.length / 1024).toFixed(0)} KB`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
