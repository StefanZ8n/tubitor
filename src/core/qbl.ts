import type { Counts } from './partslist';

export interface QblImport {
  inventory: Counts;
  /** Entries for parts we do not model yet, as named in the file, with their count. */
  skipped: Record<string, number>;
}

const NAMED: Record<string, string> = {
  '6way connector': 'conn-c6',
  '5way connector': 'conn-c5',
  '4way connector': 'conn-c4',
  '3way connector': 'conn-c3',
  'cross connector': 'conn-f4',
  'T connector': 'conn-f3',
  elbow: 'conn-f2',
  '2way connector': 'conn-s2',
  'diagonal connector': 'roof45',
  'multi wheel': 'wheel',
  'bearing for multi wheel': 'bearing',
  'steering lock': 'steering-lock',
};

function keyOf(name: string): string | null {
  if (name in NAMED) return NAMED[name];
  const tube = /^tube, (\d+) cm$/.exec(name);
  if (tube) return `tube-${Number(tube[1]) * 10}`;
  const panel = /^panel, for (\d+) cm x (\d+) cm$/.exec(name);
  if (panel) return `panel-${Number(panel[1]) * 10}x${Number(panel[2]) * 10}`;
  return null;
}

/**
 * Reads a parts stock list of the QUADRO 3D program: one `name, colour;count` per line.
 * Colours are added up, since the parts list does not tell them apart.
 */
export function parseQbl(text: string): QblImport {
  const inventory: Counts = {};
  const skipped: Record<string, number> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^(.+);\s*(\d+)\s*$/.exec(line);
    if (!m) continue;
    const full = m[1].trim();
    const name = full.replace(/,\s*[a-z]+$/i, '');
    const key = keyOf(name) ?? keyOf(full);
    const target = key ? inventory : skipped;
    const label = key ?? name;
    target[label] = (target[label] ?? 0) + Number(m[2]);
  }
  return { inventory, skipped };
}
