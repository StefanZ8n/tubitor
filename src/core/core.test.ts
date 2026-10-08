import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { autoColor, AUTO_COLORS } from './autocolor';
import { deriveNodes, occupiedEdges, panelCells, posKey, quatFromDir, tubeEnds, v3 } from './geometry';
import { fixPanels, jointsOf } from './panels';
import { countParts, countScrews, missingParts } from './partslist';
import { parseQbl } from './qbl';
import { parseQdf } from './qdf';
import { buildSteps, nodeSteps } from './steps';
import { newId, type Panel, type Part, type Tube, type Vec3 } from './types';

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
    expect(counts).toEqual({ 'tube-350': 12, 'conn-c3': 8 });
    expect(countScrews(cube())).toEqual({ tube: 24, panel: 0 });
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

/** Fills the panel cells of `parts` picked by `pick`. */
function withPanels(parts: Part[], pick: (pos: Vec3) => boolean): Part[] {
  const panels: Panel[] = panelCells(parts)
    .filter((c) => pick(c.pos.map((v) => Math.round(v) + 0) as Vec3))
    .map((c) => ({ id: newId(), type: 'panel', pos: c.pos, quat: c.quat, w: c.w, h: c.h, perforated: false, color: 'blue' }));
  return [...parts, ...panels];
}

describe('panel fixing', () => {
  it('lets panel screws replace the tube screws they pass through', () => {
    const parts = withPanels(cube(), (pos) => pos[2] === 0);
    expect(countScrews(parts)).toEqual({ tube: 20, panel: 4 });
    expect(countParts(parts)).toEqual({ 'tube-350': 12, 'conn-c3': 8, 'panel-350x350': 1 });
  });

  it('screws neighbouring panels to different tube ends', () => {
    // Two cubes side by side with the three panels of the shared front wall and the wall between them.
    const second = cube().map((p) => ({ ...p, id: newId(), pos: [p.pos[0] + 400, p.pos[1], p.pos[2]] as Vec3 }));
    const frame = [...cube(), ...second.filter((t) => !(t.pos[0] === 400 && tubeEnds(t as Tube)[1].x === 400))];
    const parts = withPanels(frame, (pos) => pos[2] === 0 || pos[0] === 400);
    const fixing = fixPanels(parts);
    expect(fixing.unfixed).toEqual([]);
    expect(fixing.fixedTo.size).toBe(3);
    const joints = [...fixing.fixedTo.values()].flatMap(jointsOf);
    expect(new Set(joints).size).toBe(joints.length);
  });

  it('reports a panel that has no pair of opposite tubes', () => {
    const cell = panelCells([tube([0, 0, 0], [1, 0, 0]), tube([0, 400, 0], [1, 0, 0])])[0];
    const panel: Panel = { id: 'p', type: 'panel', pos: cell.pos, quat: cell.quat, w: 350, h: 350, perforated: false, color: 'red' };
    expect(fixPanels([panel]).unfixed).toEqual(['p']);
  });

  it('waits for a long tube that closes the frame from above', () => {
    // Two uprights joined at the bottom by a 35 cm tube and at the top by a 75 cm tube running on.
    const frame = [tube([0, 0, 0], [1, 0, 0]), tube([0, 0, 0], [0, 1, 0]), tube([400, 0, 0], [0, 1, 0]), tube([0, 400, 0], [1, 0, 0], 750)];
    const cell = panelCells(frame).find((c) => c.w === 350 && c.h === 350)!;
    const panel: Panel = { id: 'p', type: 'panel', pos: cell.pos, quat: cell.quat, w: 350, h: 350, perforated: false, color: 'red' };
    const steps = buildSteps([...frame, panel]);
    expect(steps[steps.length - 1]).toMatchObject({ level: 2, phase: 'panels', partIds: ['p'] });
  });

  it('fits a wall panel only once the frame above closes it in', () => {
    const steps = buildSteps(withPanels(cube(), (pos) => pos[2] === 0));
    expect(steps.map((s) => [s.level, s.phase])).toEqual([
      [0, 'horizontal'],
      [0, 'upright'],
      [2, 'horizontal'],
      [2, 'panels'],
    ]);
  });
});

describe('auto colour', () => {
  it('never gives all tubes at a connector the same colour', () => {
    const parts = withPanels(cube(), (pos) => pos[2] === 0);
    const colored = autoColor(parts, fixPanels(parts));
    expect(colored.every((p) => AUTO_COLORS.includes(p.color))).toBe(true);
    expect(colored.map((p) => p.id)).toEqual(parts.map((p) => p.id));
    for (const node of deriveNodes(colored)) {
      const tubes = colored.filter((p) => p.type === 'tube' && tubeEnds(p).some((e) => posKey(e) === node.key));
      expect(new Set(tubes.map((t) => t.color)).size).toBeGreaterThan(1);
    }
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
    expect(countScrews([upright]).tube).toBe(0);
    expect(countScrews([upright, flat]).tube).toBe(2);
  });
});

describe('stock list import', () => {
  it('maps part names, adds up colours and reports unknown parts', () => {
    const text = ['6way connector, black;8', 'T connector, black;32', 'elbow, black;3', 'diagonal connector, black;8', 'tube, 35 cm, red;260', 'tube, 35 cm, blue;4', 'panel, for 15 cm x 35 cm, red;14', 'multi wheel, red;2'].join('\r\n');
    expect(parseQbl(text)).toEqual({
      inventory: { 'conn-c6': 8, 'conn-f3': 32, 'conn-f2': 3, roof45: 8, 'tube-350': 264, 'panel-150x350': 14 },
      skipped: { 'multi wheel': 2 },
    });
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
    'panel2{6, {4., 0., 0., 0., 200., 500., 0.}, 1, 150., 0., 350., 0., 0}',
    'connector3{1, {4., 0., 0., 0., 0., 0., 0.}, 1, 0, 37, 26, 4095, 0}',
    'slide2{6, {4., 0., 0., 0., 0., 1200., -600.}, 1, 0}',
  ].join('\n');

  it('reads tubes, panels and colours', () => {
    const { design, skipped, fileConnectors } = parseQdf(sample);
    expect(design.parts.map((p) => p.type)).toEqual(['tube', 'tube', 'tube', 'panel', 'panel']);
    // A half panel lies flat: 350 along its local x axis, 150 along y.
    expect(design.parts[4]).toMatchObject({ w: 350, h: 150 });
    expect(countParts(design.parts)['panel-150x350']).toBe(1);
    expect(design.parts[3].color).toBe('blue');
    expect(skipped).toEqual({ slide2: 1 });
    expect(fileConnectors).toEqual([{ pos: [0, 0, 0], armCount: 3 }]);
    const ends = design.parts.slice(0, 3).map((t) => tubeEnds(t as Tube)[1].toArray().map((c) => Math.round(c) + 0));
    expect(ends).toEqual([[400, 0, 0], [0, 400, 0], [0, 0, -200]]);
  });

  it('drops parts that were deleted or not yet created at the saved undo step', () => {
    const text = [
      '5, 7;',
      'tube2{2, {4., 0., 0., 0., 0., 0., 0.}, 1, 350., 0., 0}',
      'tube2{2, {2., 0., 0., 2., 0., 0., 0.}, 1, 350., 0., 0, 3}',
      'tube2{2, {2., 0., 2., 0., 0., 0., 0.}, 1, 150., 0., 2, 6}',
      'tube2{2, {2., 0., 2., 0., 400., 0., 0.}, 1, 150., 0., 6}',
      'panel2{6, {4., 0., 0., 0., 200., 200., 0.}, 1, 350., 0., 350., 0., 4, 5}',
      'connector45_2{1, {2., 0., 2., 0., 0., 0., 0.}, 1, 0, 0}',
      'connector45_2{1, {2., 0., 2., 0., 400., 0., 0.}, 1, 1, 1, 2}',
      'connector3{1, {4., 0., 0., 0., 0., 0., 0.}, 1, 0, 37, 26, 4095, 0, 2}',
      'connector3{1, {4., 0., 0., 0., 0., 0., 0.}, 1, 0, 5, 58, 4095, 3}',
      'clamp2{2, {0., 0., 4., 0., 740., 600., -400.}, 1, 0}',
      'bearing2{1, {4., 0., 0., 0., 400., 800., 1200.}, 1, 50., 0., 1, 4}',
    ].join('\r\n');
    const { design, skipped, fileConnectors } = parseQdf(text);
    expect(design.parts.map((p) => [p.type, p.pos[0]])).toEqual([['tube', 0], ['tube', 0], ['roof45', 0]]);
    expect(design.parts.map((p) => (p.type === 'tube' ? p.length : 0))).toEqual([350, 150, 0]);
    expect(fileConnectors).toEqual([{ pos: [0, 0, 0], armCount: 2 }]);
    expect(skipped).toEqual({ clamp2: 1 });
  });

  it('ends a squeezed roof tube at the connector the file puts there', () => {
    const text = [
      '0, 0;',
      'connector45_2{1, {2., 0., 2., 0., -200., 800., -400.}, 1, 0, 0}',
      'tube2{4, {0.292893218813, 1.707106781187, 0.292893218813, 1.707106781187, -200., 825.455844122716, -482.844155877284}, 0, 250., -8.57762336731, 0}',
      'tube2{2, {2., 0., 2., 0., -200., 0., 0.}, 1, 350., 0., 0}',
    ].join('\r\n');
    const [, slanted, straight] = parseQdf(text).design.parts as Tube[];
    expect(slanted.stretch).toBeCloseTo(-8.5776);
    expect(tubeEnds(slanted)[1].distanceTo(v3([-200, 1031.5226, -276.7774]))).toBeLessThan(0.01);
    expect(straight.stretch).toBeUndefined();
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
