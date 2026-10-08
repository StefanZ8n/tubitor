import { deriveNodes, posKey, roofGeometry, tubeEnds } from './geometry';
import { fixPanels, type PanelFixing } from './panels';
import type { Node, Part } from './types';

export type Counts = Record<string, number>;

/** Standard parts in display order; anything else found in a design is appended. */
export const CATALOG = [
  'tube-750',
  'tube-350',
  'tube-250',
  'tube-150',
  'tube-100',
  'conn-c6',
  'conn-c5',
  'conn-c4',
  'conn-c3',
  'conn-f4',
  'conn-f3',
  'conn-f2',
  'conn-s2',
  'roof45',
  'panel-350x350',
  'panel-150x350',
  'panel-350x350-perf',
] as const;

const SCREWS_PER_PANEL = 4;

/** What follows from a whole design: where connectors sit and how panels are screwed on. */
export interface DesignInfo {
  nodes: Node[];
  fixing: PanelFixing;
}

export function analyse(parts: Part[]): DesignInfo {
  return { nodes: deriveNodes(parts), fixing: fixPanels(parts) };
}

export function partKey(p: Part): string {
  if (p.type === 'tube') return `tube-${Math.round(p.length)}`;
  if (p.type === 'panel') {
    // Short side first, whichever way round the panel is stored.
    const [short, long] = [Math.round(p.w), Math.round(p.h)].sort((a, b) => a - b);
    return `panel-${short}x${long}${p.perforated ? '-perf' : ''}`;
  }
  return 'roof45';
}

export const nodeKey = (n: Node) => (n.kind ? `conn-${n.kind}` : null);

/** Counts `parts` and the connectors at `connectors` (by default all the design needs). */
export function countParts(parts: Part[], info: DesignInfo = analyse(parts), connectors: Node[] = info.nodes): Counts {
  const counts: Counts = {};
  const add = (k: string | null) => {
    if (k) counts[k] = (counts[k] ?? 0) + 1;
  };
  parts.forEach((p) => add(partKey(p)));
  connectors.forEach((n) => add(nodeKey(n)));
  return counts;
}

export interface Screws {
  tube: number;
  panel: number;
}

/**
 * Screws `parts` need; `info` describes the whole design when `parts` is only a subset of it.
 * A tube end takes a tube screw wherever it meets a connector or a roof adapter,
 * unless a panel is screwed on there: the panel screw then holds the tube as well.
 * Screws are extra information, not part of the parts list.
 */
export function countScrews(parts: Part[], info: DesignInfo = analyse(parts)): Screws {
  const byKey = new Map(info.nodes.map((n) => [n.key, n]));
  // Tube ends without a node sit on a roof adapter, which is screwed as well.
  const isJoint = (key: string) => !byKey.has(key) || !!byKey.get(key)!.kind;
  const screws: Screws = { tube: 0, panel: 0 };
  for (const p of parts) {
    if (p.type === 'tube') {
      screws.tube += tubeEnds(p).filter((end, i) => isJoint(posKey(end)) && !info.fixing.panelJoints.has(`${p.id}:${i}`)).length;
    } else if (p.type === 'roof45') {
      screws.tube += isJoint(posKey(roofGeometry(p).node)) ? 1 : 0;
    } else if (info.fixing.fixedTo.has(p.id)) {
      screws.panel += SCREWS_PER_PANEL;
    }
  }
  return screws;
}

export function orderedKeys(...counts: Counts[]): string[] {
  const extra = new Set<string>();
  for (const c of counts) for (const k of Object.keys(c)) if (!(CATALOG as readonly string[]).includes(k)) extra.add(k);
  return [...CATALOG, ...[...extra].sort()];
}

export function missingParts(used: Counts, have: Counts): Counts {
  const missing: Counts = {};
  for (const [k, n] of Object.entries(used)) {
    const short = n - (have[k] ?? 0);
    if (short > 0) missing[k] = short;
  }
  return missing;
}
