// One-shot builder for the phone (low) asset set. Phones would otherwise download the full
// ~28 MB of 1024 px textures and shrink them to 512 px on the main thread (capTexture/capTextures
// in src/ui/gfx.ts), which is slow and memory-hungry. Instead we build a ready-made low set once,
// offline, and phones load it directly: 512 px webp textures and meshopt-compressed geometry.
//   run: npx tsx scripts/make-low-assets.ts
// Output goes to public/assets/low/ (sf/ and ph/), keeping the same file names. The sources in
// public/assets/sf and public/assets/ph are only read, never written. No geometry, animation,
// skin or material is changed - only texture resize/re-encode (512 px webp) and meshopt compression.
// Idempotent: re-running overwrites the low set and leaves the sources untouched.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const sharp = (await import('sharp')).default;

const SF = [
  'keep', 'keepgate', 'house1', 'house2', 'house3', 'mill', 'ruin_arch', 'ruin_wall', 'stonehenge',
  'altar', 'lairgate', 'pine', 'spruce', 'deadpine', 'bush', 'ferns',
  'knight', 'direWolf', 'bogTroll', 'rustKnight', 'caveDrake', 'giantSpider', 'marshSerpent',
  'boneGolem', 'guardian', 'sword', 'axe',
];
const PH = ['rocks_a', 'rocks_b', 'cliff', 'cliff2', 'deadtree', 'lantern', 'barrel', 'crate', 'firepit', 'fort'];
const SIMPLIFY = new Set(['rocks_a', 'rocks_b', 'cliff', 'cliff2', 'deadtree', 'firepit']);
const TERRAIN_LAYERS = ['grass', 'dirt', 'rock', 'moss', 'mud'];

const LOW = 'public/assets/low';

const KB = (b: number): number => Math.round(b / 10.24) / 100;

async function main(): Promise<void> {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  mkdirSync(`${LOW}/sf`, { recursive: true });
  mkdirSync(`${LOW}/ph`, { recursive: true });

  let totalBefore = 0;
  let totalAfter = 0;

  const models: [string, string][] = [
    ...SF.map((n) => [`public/assets/sf/${n}.glb`, `${LOW}/sf/${n}.glb`] as [string, string]),
    ...PH.map((n) => [`public/assets/ph/${n}.glb`, `${LOW}/ph/${n}.glb`] as [string, string]),
  ];
  const tris = (doc: Document): number => {
    let n = 0;
    for (const m of doc.getRoot().listMeshes()) {
      for (const p of m.listPrimitives()) {
        const idx = p.getIndices();
        const pos = p.getAttribute('POSITION');
        n += Math.round((idx ? idx.getCount() : pos!.getCount()) / 3);
      }
    }
    return n;
  };
  for (const [src, out] of models) {
    const name = out.split('/').pop()!.replace(/\.glb$/, '');
    const before = readFileSync(src);
    const doc = await io.read(src);
    const beforeTris = SIMPLIFY.has(name) ? tris(doc) : 0;
    if (SIMPLIFY.has(name)) {
      await doc.transform(
        weld(),
        simplify({ simplifier: MeshoptSimplifier, ratio: 0.25, error: 0.01 }),
        textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512] }),
        meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
      );
    } else {
      await doc.transform(
        textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512] }),
        meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
      );
    }
    const buf = await io.writeBinary(doc);
    writeFileSync(out, buf);
    totalBefore += before.length;
    totalAfter += buf.length;
    console.log(`${out} KB ${KB(before.length)} -> ${KB(buf.length)}${SIMPLIFY.has(name) ? ` tris ${beforeTris} -> ${tris(doc)}` : ''}`);
  }

  // Terrain diffuse textures: resize to fit 512x512 (keep aspect) and re-encode as webp q82.
  // No low versions of the *_nor / *_rough maps or night.hdr.
  for (const layer of TERRAIN_LAYERS) {
    const src = `public/assets/ph/${layer}_diff.webp`;
    const out = `${LOW}/ph/${layer}_diff.webp`;
    const before = readFileSync(src);
    const buf = await sharp(before).resize(512, 512, { fit: 'inside' }).webp({ quality: 82 }).toBuffer();
    writeFileSync(out, buf);
    totalBefore += before.length;
    totalAfter += buf.length;
    console.log(`${out} KB ${KB(before.length)} -> ${KB(buf.length)}`);
  }

  // Water normals are used by both profiles and are already small: copy unchanged.
  {
    const src = 'public/assets/ph/waternormals.webp';
    const out = `${LOW}/ph/waternormals.webp`;
    const before = readFileSync(src);
    writeFileSync(out, before);
    totalBefore += before.length;
    totalAfter += before.length;
    console.log(`${out} KB ${KB(before.length)} -> ${KB(before.length)}`);
  }

  console.log(`TOTAL KB ${KB(totalBefore)} -> ${KB(totalAfter)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
