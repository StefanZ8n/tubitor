import { HUB, quat, tubeEnds, v3 } from './geometry';
import type { Panel, Part, Tube } from './types';

export interface PanelFixing {
  /** Every tube lying on one of a panel's four edges, by panel id. */
  frame: Map<string, string[]>;
  /** The two opposite tubes a panel is screwed to, by panel id. */
  fixedTo: Map<string, [string, string]>;
  /** Tube ends (`tubeId:0` start, `tubeId:1` end) held by a panel screw instead of a tube screw. */
  panelJoints: Set<string>;
  /** Panels that cannot be screwed to two opposite tubes without clashing with another panel. */
  unfixed: string[];
}

const TOLERANCE = 2;
// Upper bound on search steps before falling back to a first-fit assignment.
const SEARCH_BUDGET = 50000;

export const jointsOf = (tubeIds: string[]) => tubeIds.flatMap((id) => [`${id}:0`, `${id}:1`]);

/** Tubes on the panel's edges, and per side (+x, -x, +y, -y) the tube spanning it corner to corner. */
function frameOf(panel: Panel, tubes: { tube: Tube; ends: ReturnType<typeof tubeEnds> }[]) {
  const inverse = quat(panel.quat).invert();
  const center = v3(panel.pos);
  const half = [(panel.w + HUB) / 2, (panel.h + HUB) / 2];
  const frame: string[] = [];
  const spanning: (string | undefined)[] = [];
  for (const { tube, ends } of tubes) {
    const [a, b] = ends.map((e) => e.clone().sub(center).applyQuaternion(inverse));
    if (Math.abs(a.z) > TOLERANCE || Math.abs(b.z) > TOLERANCE) continue;
    const local = [
      [a.x, a.y],
      [b.x, b.y],
    ];
    for (const axis of [0, 1]) {
      const other = 1 - axis;
      for (const sign of [1, -1]) {
        const onEdge = local.every(
          (p) => Math.abs(p[axis] - sign * half[axis]) < TOLERANCE && Math.abs(p[other]) < half[other] + TOLERANCE,
        );
        if (!onEdge) continue;
        frame.push(tube.id);
        if (Math.abs(Math.abs(local[0][other] - local[1][other]) - 2 * half[other]) < TOLERANCE) {
          spanning[axis * 2 + (sign > 0 ? 0 : 1)] = tube.id;
        }
      }
    }
  }
  const options: [string, string][] = [];
  if (spanning[0] && spanning[1]) options.push([spanning[0], spanning[1]]);
  if (spanning[2] && spanning[3]) options.push([spanning[2], spanning[3]]);
  return { frame, options };
}

/**
 * A panel is screwed to two opposite tubes of its frame, either pair. Its screws go through
 * into the tube ends and replace the tube screws there, so two panels can never share a tube end.
 * Picks a pair for every panel so that none clash.
 */
export function fixPanels(parts: Part[]): PanelFixing {
  const tubes = parts.filter((p): p is Tube => p.type === 'tube').map((tube) => ({ tube, ends: tubeEnds(tube) }));
  const frame = new Map<string, string[]>();
  const unfixed: string[] = [];
  const open: { id: string; options: [string, string][] }[] = [];
  for (const p of parts) {
    if (p.type !== 'panel') continue;
    const f = frameOf(p, tubes);
    frame.set(p.id, f.frame);
    if (f.options.length) open.push({ id: p.id, options: f.options });
    else unfixed.push(p.id);
  }
  open.sort((a, b) => a.options.length - b.options.length);

  const panelJoints = new Set<string>();
  const fixedTo = new Map<string, [string, string]>();
  const free = (option: [string, string]) => jointsOf(option).every((j) => !panelJoints.has(j));
  const take = (id: string, option: [string, string]) => {
    fixedTo.set(id, option);
    jointsOf(option).forEach((j) => panelJoints.add(j));
  };
  const release = (id: string, option: [string, string]) => {
    fixedTo.delete(id);
    jointsOf(option).forEach((j) => panelJoints.delete(j));
  };

  let visits = 0;
  const solve = (i: number): boolean => {
    if (i === open.length) return true;
    if (++visits > SEARCH_BUDGET) return false;
    for (const option of open[i].options) {
      if (!free(option)) continue;
      take(open[i].id, option);
      if (solve(i + 1)) return true;
      release(open[i].id, option);
    }
    return false;
  };

  if (!solve(0)) {
    // No clash-free assignment for all panels: fix as many as fit and report the rest.
    for (const { id, options } of open) {
      const option = options.find(free);
      if (option) take(id, option);
      else unfixed.push(id);
    }
  }
  return { frame, fixedTo, panelJoints, unfixed };
}
