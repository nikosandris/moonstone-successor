// One-shot optimiser for the static map models. Merges the many small primitives that share a
// material into a single mesh (one primitive per material), so each .glb costs ~1 draw call
// instead of dozens. No visual change: no texture resize/re-encode, no geometry simplify, no
// material changes. Skinned/animated files are left untouched.
//   run: npx tsx scripts/optimize-map-models.ts
// Idempotent: a second run succeeds and does not increase draws or tris.
import { readFileSync, writeFileSync } from 'node:fs';
import { NodeIO, type Mesh, type Node, type Root } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const SF = ['keep', 'keepgate', 'house1', 'house2', 'house3', 'mill', 'ruin_wall', 'stonehenge', 'altar', 'lairgate', 'pine', 'spruce', 'deadpine', 'bush', 'ferns'];
const PH = ['rocks_a', 'rocks_b', 'cliff', 'cliff2', 'deadtree', 'lantern', 'barrel', 'crate', 'firepit', 'fort'];

interface Stats { draws: number; tris: number }

/** Unique meshes reachable from any node under any scene, following node children. */
function reachableMeshes(root: Root): Set<Mesh> {
  const meshes = new Set<Mesh>();
  const seen = new Set<Node>();
  const stack: Node[] = [];
  for (const scene of root.listScenes()) for (const node of scene.listChildren()) stack.push(node);
  while (stack.length) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    const mesh = node.getMesh();
    if (mesh) meshes.add(mesh);
    for (const child of node.listChildren()) stack.push(child);
  }
  return meshes;
}

/** draws = total primitives over reachable meshes; tris = index (or position) count / 3. */
function meshStats(root: Root): Stats {
  let draws = 0;
  let counts = 0;
  for (const mesh of reachableMeshes(root)) {
    for (const prim of mesh.listPrimitives()) {
      draws += 1;
      const indices = prim.getIndices();
      const position = prim.getAttribute('POSITION');
      counts += indices ? indices.getCount() : position ? position.getCount() : 0;
    }
  }
  return { draws, tris: counts / 3 };
}

const round = (x: number): number => Math.round(x);

async function main(): Promise<void> {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  const jobs: [string, string][] = [
    ...SF.map((n) => [`public/assets/sf/${n}.glb`, n] as [string, string]),
    ...PH.map((n) => [`public/assets/ph/${n}.glb`, n] as [string, string]),
  ];

  for (const [path, label] of jobs) {
    const fileBytes = readFileSync(path);
    const beforeKB = fileBytes.length / 1024;
    const doc = await io.read(path);
    const root = doc.getRoot();
    if (root.listSkins().length > 0 || root.listAnimations().length > 0) {
      console.log(`skip ${label} (skinned/animated)`);
      continue;
    }
    const before = meshStats(root);
    await doc.transform(
      dedup(),
      flatten(),
      join({ keepNamed: false }),
      prune(),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    const after = meshStats(root);
    const out = await io.writeBinary(doc);
    writeFileSync(path, out);
    console.log(`${label} draws ${before.draws} -> ${after.draws}, tris ${round(before.tris)} -> ${round(after.tris)}, KB ${beforeKB.toFixed(1)} -> ${(out.length / 1024).toFixed(1)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
