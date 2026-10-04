import { deriveNodes, posKey, roofGeometry, tubeEnds } from './geometry';
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

export function partKey(p: Part): string {
  if (p.type === 'tube') return `tube-${Math.round(p.length)}`;
  if (p.type === 'panel') return `panel-${Math.round(p.w)}x${Math.round(p.h)}${p.perforated ? '-perf' : ''}`;
  return 'roof45';
}

export const nodeKey = (n: Node) => (n.kind ? `conn-${n.kind}` : null);

/**
 * Counts `parts`, the connectors at `nodes` and the screws the parts need.
 * `allNodes` is the whole design's node list when `parts` is only a subset of it:
 * a tube end needs a screw wherever it meets a connector or a roof adapter.
 */
export function countParts(parts: Part[], nodes: Node[] = deriveNodes(parts), allNodes: Node[] = nodes): Counts {
  const counts: Counts = {};
  const add = (k: string | null, n = 1) => {
    if (k && n) counts[k] = (counts[k] ?? 0) + n;
  };
  const byKey = new Map(allNodes.map((n) => [n.key, n]));
  // Tube ends without a node sit on a roof adapter, which is screwed as well.
  const joints = (keys: string[]) => keys.filter((k) => !byKey.has(k) || byKey.get(k)!.kind).length;

  for (const p of parts) {
    add(partKey(p));
    if (p.type === 'tube') add('screw-tube', joints(tubeEnds(p).map(posKey)));
    else if (p.type === 'roof45') add('screw-tube', joints([posKey(roofGeometry(p).node)]));
    else add('screw-panel', SCREWS_PER_PANEL);
  }
  nodes.forEach((n) => add(nodeKey(n)));
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
