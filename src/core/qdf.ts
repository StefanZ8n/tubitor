import { Quaternion } from 'three';
import { toQuat } from './geometry';
import { emptyDesign, newId, type ColorKey, type Design, type Quat, type Vec3 } from './types';

export interface QdfImport {
  design: Design;
  /** Record types we do not model yet (wheels, slides, pools, ...) with their count. */
  skipped: Record<string, number>;
  /** connector3 records as stored in the file, kept to cross-check derived connectors. */
  fileConnectors: { pos: Vec3; armCount: number }[];
}

const COLOR_NAMES: Record<string, ColorKey> = {
  red: 'red',
  green: 'green',
  blue: 'blue',
  yellow: 'yellow',
  black: 'black',
  white: 'white',
};

/**
 * QDF stores rotations as (w, x, y, z) with each component squared (sign kept)
 * and the whole scaled so the absolute values sum to 4.
 */
function decodeQuat(n: number[]): Quat {
  const c = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v) / 4);
  return toQuat(new Quaternion(c(n[1]), c(n[2]), c(n[3]), c(n[0])).normalize());
}

const popcount = (n: number) => n.toString(2).replace(/0/g, '').length;

export function parseQdf(text: string, name = ''): QdfImport {
  const design = emptyDesign(name);
  const skipped: Record<string, number> = {};
  const fileConnectors: QdfImport['fileConnectors'] = [];
  const materials = new Map<number, ColorKey>();

  for (const raw of text.split(/\r?\n/)) {
    const m = /^([a-z0-9_-]+)\{(.*)\}\s*$/i.exec(raw.trim());
    if (!m) continue;
    const type = m[1];
    const fields = m[2].replace(/[{}]/g, '').split(',').map((f) => f.trim());
    const n = fields.map(Number);

    if (type === 'material3') {
      materials.set(n[0], COLOR_NAMES[fields[1].replace(/"/g, '')] ?? 'grey');
      continue;
    }
    if (type === 'camera2') continue;

    const base = () => ({
      id: newId(),
      pos: [n[5], n[6], n[7]] as Vec3,
      quat: decodeQuat(n.slice(1, 5)),
      color: materials.get(n[0]) ?? 'grey',
    });

    if (type === 'tube2') {
      design.parts.push({ ...base(), type: 'tube', length: n[9] });
    } else if (type === 'panel2') {
      // The file gives the size along the panel's local y axis first, then along x.
      design.parts.push({ ...base(), type: 'panel', w: n[11], h: n[9], perforated: false });
    } else if (type === 'connector45_2') {
      design.parts.push({ ...base(), type: 'roof45', color: 'black' });
    } else if (type === 'connector3') {
      fileConnectors.push({ pos: [n[5], n[6], n[7]], armCount: popcount(n[10]) });
    } else {
      skipped[type] = (skipped[type] ?? 0) + 1;
    }
  }
  return { design, skipped, fileConnectors };
}
