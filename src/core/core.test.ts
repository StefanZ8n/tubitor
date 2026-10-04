import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveNodes, occupiedEdges, panelCells, posKey, quatFromDir, tubeEnds, v3 } from './geometry';
import { countParts, missingParts } from './partslist';
import { parseQdf } from './qdf';
import { buildSteps, nodeSteps } from './steps';
import { newId, type Part, type Tube, type Vec3 } from './types';

const tube = (pos: Vec3, dir: Vec3, length = 350): Tube => ({
  id: newId(),
  type: 'tube',
  pos,
  quat: quatFromDir(dir),
  length,
  color: 'red',
});

/** A 400 mm cube frame: 12 tubes, 8 corner connectors. */
function cube(): Part[] {
  const parts: Part[] = [];
  for (const a of [0, 400]) {
    for (const b of [0, 400]) {
      parts.push(tube([0, a, b], [1, 0, 0]), tube([a, 0, b], [0, 1, 0]), tube([a, b, 0], [0, 0, 1]));
    }
  }
  return parts;
}

describe('geometry', () => {
  it('spans a tube from node to node', () => {
    const [, end] = tubeEnds(tube([0, 0, 0], [0, 0, -1], 150));
    expect(end.distanceTo(v3([0, 0, -200]))).toBeLessThan(1e-6);
  });

  it('derives corner connectors for a cube', () => {
    const counts = countParts(cube());
    expect(counts).toEqual({ 'tube-350': 12, 'conn-c3': 8, 'screw-tube': 24 });
  });

  it('tells flat from spatial connectors', () => {
    const kind = (dirs: Vec3[]) =>
      deriveNodes(dirs.map((d) => tube([0, 0, 0], d))).find((n) => posKey(v3(n.pos)) === '0,0,0')?.kind;
    expect(kind([[1, 0, 0], [-1, 0, 0]])).toBe('s2');
    expect(kind([[1, 0, 0], [0, 1, 0]])).toBe('f2');
    expect(kind([[1, 0, 0], [-1, 0, 0], [0, 1, 0]])).toBe('f3');
    expect(kind([[1, 0, 0], [0, 0, 1], [0, 1, 0]])).toBe('c3');
    expect(kind([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]])).toBe('f4');
    expect(kind([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1]])).toBe('c4');
  });

  it('finds one panel cell per cube face', () => {
    const cells = panelCells(cube());
    expect(cells).toHaveLength(6);
    expect(cells.every((c) => c.w === 350 && c.h === 350 && !c.occupied)).toBe(true);
  });

  it('finds half panel cells', () => {
    const cells = panelCells([tube([0, 0, 0], [1, 0, 0]), tube([0, 200, 0], [1, 0, 0])]);
    expect(cells.map((c) => [c.w, c.h])).toEqual([[150, 350]]);
  });

  it('tracks occupied grid edges', () => {
    expect(occupiedEdges([tube([0, 0, 0], [1, 0, 0]), tube([0, 0, 0], [0, 1, 0], 150)]).size).toBe(3);
  });
});

describe('parts and steps', () => {
  it('lists missing parts', () => {
    expect(missingParts({ 'tube-350': 12, 'conn-c3': 8 }, { 'tube-350': 20, 'conn-c3': 5 })).toEqual({ 'conn-c3': 3 });
  });

  it('orders build steps bottom-up', () => {
    const steps = buildSteps(cube());
    expect(steps.map((s) => [s.level, s.phase, s.partIds.length])).toEqual([
      [0, 'horizontal', 4],
      [0, 'upright', 4],
      [2, 'horizontal', 4],
    ]);
  });

  it('puts connectors on with the frame of their level, not with the uprights', () => {
    const parts = cube();
    const at = [...nodeSteps(parts, buildSteps(parts)).values()];
    expect(at.filter((i) => i === 0)).toHaveLength(4);
    expect(at.filter((i) => i === 1)).toHaveLength(0);
    expect(at.filter((i) => i === 2)).toHaveLength(4);
  });

  it('counts screws only where a tube meets a connector', () => {
    const upright = tube([0, 0, 0], [0, 1, 0]);
    const flat = tube([0, 0, 0], [1, 0, 0]);
    expect(countParts([upright])['screw-tube']).toBeUndefined();
    expect(countParts([upright, flat])['screw-tube']).toBe(2);
  });
});

describe('qdf import', () => {
  const sample = [
    '0, 0;',
    'material3{2,"red", 1, 1.,0.,0., 0.5,1.,1.,7.5, 0.3,0.,0.,7.5, "", 0}',
    'material3{6,"blue", 2, 1.,0.,0., 0.6,0.5,0.5,7.5, 0.6,0.5,0.5,7.5, "", 0}',
    'tube2{2, {4., 0., 0., 0., 0., 0., 0.}, 1, 350., 0., 0}',
    'tube2{2, {2., 0., 0., 2., 0., 0., 0.}, 1, 350., 0., 0}',
    'tube2{2, {2., 0., 2., 0., 0., 0., 0.}, 1, 150., 0., 0}',
    'panel2{6, {4., 0., 0., 0., 200., 200., 0.}, 1, 350., 0., 350., 0., 0}',
    'connector3{1, {4., 0., 0., 0., 0., 0., 0.}, 1, 0, 37, 26, 4095, 0}',
    'slide2{6, {4., 0., 0., 0., 0., 1200., -600.}, 1, 0}',
  ].join('\n');

  it('reads tubes, panels and colours', () => {
    const { design, skipped, fileConnectors } = parseQdf(sample);
    expect(design.parts.map((p) => p.type)).toEqual(['tube', 'tube', 'tube', 'panel']);
    expect(design.parts[3].color).toBe('blue');
    expect(skipped).toEqual({ slide2: 1 });
    expect(fileConnectors).toEqual([{ pos: [0, 0, 0], armCount: 3 }]);
    const ends = design.parts.slice(0, 3).map((t) => tubeEnds(t as Tube)[1].toArray().map((c) => Math.round(c) + 0));
    expect(ends).toEqual([[400, 0, 0], [0, 400, 0], [0, 0, -200]]);
  });
});

// Real models are copyrighted and not part of the repo: point QDF_SAMPLES_DIR at a folder
// of downloaded .qdf files to check derived connectors against the ones stored in them.
const dir = process.env.QDF_SAMPLES_DIR;
describe.skipIf(!dir || !existsSync(dir))('qdf samples', () => {
  for (const file of dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.qdf')) : []) {
    it(`matches connectors in ${file}`, () => {
      const { design, fileConnectors, skipped } = parseQdf(readFileSync(join(dir!, file), 'latin1'));
      const nodes = new Map(deriveNodes(design.parts).map((n) => [n.key, n]));
      let exact = 0;
      const diffs: string[] = [];
      for (const c of fileConnectors) {
        const n = nodes.get(posKey(v3(c.pos)));
        if (n && n.arms.length === c.armCount && !n.invalid) exact++;
        else diffs.push(`${c.pos.map(Math.round)}: file ${c.armCount}, derived ${n?.arms.length ?? 'none'}${n?.invalid ? ' (invalid)' : ''}`);
      }
      const derived = [...nodes.values()].filter((n) => n.kind || n.invalid).length;
      console.log(`${file}: ${exact}/${fileConnectors.length} connectors match, ${derived} derived, skipped ${JSON.stringify(skipped)}\n  ${diffs.join('\n  ')}`);
      expect(exact / fileConnectors.length).toBeGreaterThan(0.85);
    });
  }
});
