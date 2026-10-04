import { deriveNodes, posKey, roofGeometry, tubeEnds } from './geometry';
import { fixPanels, type PanelFixing } from './panels';
import type { Node, Part } from './types';

export type Counts = Record<string, number>;

/** Standard parts in display order; anything else found in a design is appended. */
export const CATALOG = [
  'tube-750',
  'tube-350',
  'tube-150',
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
  'screw-tube',
  'screw-panel',
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
  if (p.type === 'panel') return `panel-${Math.round(p.w)}x${Math.round(p.h)}${p.perforated ? '-perf' : ''}`;
  return 'roof45';
}

export const nodeKey = (n: Node) => (n.kind ? `conn-${n.kind}` : null);

/**
 * Counts `parts`, the connectors at `connectors` and the screws the parts need.
 * `info` describes the whole design when `parts` is only a subset of it.
 * A tube end takes a tube screw wherever it meets a connector or a roof adapter,
 * unless a panel is screwed on there: the panel screw then holds the tube as well.
 */
export function countParts(parts: Part[], info: DesignInfo = analyse(parts), connectors: Node[] = info.nodes): Counts {
  const counts: Counts = {};
  const add = (k: string | null, n = 1) => {
    if (k && n) counts[k] = (counts[k] ?? 0) + n;
  };
  const byKey = new Map(info.nodes.map((n) => [n.key, n]));
  // Tube ends without a node sit on a roof adapter, which is screwed as well.
  const isJoint = (key: string) => !byKey.has(key) || !!byKey.get(key)!.kind;

  for (const p of parts) {
    add(partKey(p));
    if (p.type === 'tube') {
      const free = tubeEnds(p).filter((end, i) => isJoint(posKey(end)) && !info.fixing.panelJoints.has(`${p.id}:${i}`));
      add('screw-tube', free.length);
    } else if (p.type === 'roof45') {
      add('screw-tube', isJoint(posKey(roofGeometry(p).node)) ? 1 : 0);
    } else if (info.fixing.fixedTo.has(p.id)) {
      add('screw-panel', SCREWS_PER_PANEL);
    }
  }
  connectors.forEach((n) => add(nodeKey(n)));
  return counts;
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
