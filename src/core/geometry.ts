import { Matrix4, Quaternion, Vector3 } from 'three';
import type { ConnectorKind, Node, Panel, Part, Quat, Roof45, Tube, Vec3 } from './types';

/** Space a connector takes up along a tube axis: a 350 tube spans 400 between nodes. */
export const HUB = 50;
export const GRID = 200;
export const TUBE_LENGTHS = [350, 150, 750] as const;

// Offset of the slanted tube's virtual node from the connector a roof adapter sits on,
// along the adapter's arm and its up axis (taken from QDF models).
const ROOF_ARM_OFFSET = 200 * (Math.SQRT2 - 1);
const ROOF_UP_OFFSET = 18 * Math.SQRT2;

const X = new Vector3(1, 0, 0);

export const v3 = (v: Vec3) => new Vector3(v[0], v[1], v[2]);
export const toVec3 = (v: Vector3): Vec3 => [v.x, v.y, v.z];
export const quat = (q: Quat) => new Quaternion(q[0], q[1], q[2], q[3]);
export const toQuat = (q: Quaternion): Quat => [q.x, q.y, q.z, q.w];

export function quatFromDir(dir: Vec3): Quat {
  return toQuat(new Quaternion().setFromUnitVectors(X, v3(dir).normalize()));
}

export function tubeDir(t: Tube): Vector3 {
  return X.clone().applyQuaternion(quat(t.quat));
}

export function tubeEnds(t: Tube): [Vector3, Vector3] {
  const start = v3(t.pos);
  return [start, start.clone().addScaledVector(tubeDir(t), t.length + HUB)];
}

export function roofGeometry(r: Roof45) {
  const q = quat(r.quat);
  const arm = new Vector3(1, 0, 0).applyQuaternion(q);
  const up = new Vector3(0, 1, 0).applyQuaternion(q);
  const node = v3(r.pos);
  const virtualNode = node.clone().addScaledVector(arm, ROOF_ARM_OFFSET).addScaledVector(up, ROOF_UP_OFFSET);
  const tubeDir = up.clone().sub(arm).normalize();
  return { node, arm, up, virtualNode, tubeDir };
}

export function posKey(v: Vector3): string {
  return `${Math.round(v.x / 2)},${Math.round(v.y / 2)},${Math.round(v.z / 2)}`;
}

function classify(arms: Vector3[]): { kind: ConnectorKind | null; invalid: boolean } {
  const n = arms.length;
  if (n < 2) return { kind: null, invalid: false };
  let oppositePairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = arms[i].dot(arms[j]);
      if (d < -0.99) oppositePairs++;
      else if (Math.abs(d) > 0.02) return { kind: null, invalid: true };
    }
  }
  if (n > 6) return { kind: null, invalid: true };
  if (n === 6) return { kind: 'c6', invalid: false };
  if (n === 5) return { kind: 'c5', invalid: false };
  if (n === 4) return { kind: oppositePairs === 2 ? 'f4' : 'c4', invalid: false };
  if (n === 3) return { kind: oppositePairs === 1 ? 'f3' : 'c3', invalid: false };
  return { kind: oppositePairs === 1 ? 's2' : 'f2', invalid: false };
}

/**
 * Connectors are never stored: they follow from where tube ends (and roof adapters) meet.
 * Returns every node, including free tube ends that need no connector.
 */
export function deriveNodes(parts: Part[]): Node[] {
  const virtual = new Set<string>();
  const nodes = new Map<string, { pos: Vector3; arms: Vector3[] }>();
  const addArm = (pos: Vector3, arm: Vector3) => {
    const key = posKey(pos);
    let node = nodes.get(key);
    if (!node) nodes.set(key, (node = { pos, arms: [] }));
    if (!node.arms.some((a) => a.dot(arm) > 0.99)) node.arms.push(arm);
  };

  for (const p of parts) {
    if (p.type !== 'roof45') continue;
    const g = roofGeometry(p);
    virtual.add(posKey(g.virtualNode));
    addArm(g.node, g.arm);
  }
  for (const p of parts) {
    if (p.type !== 'tube') continue;
    const [start, end] = tubeEnds(p);
    const dir = tubeDir(p);
    if (!virtual.has(posKey(start))) addArm(start, dir);
    if (!virtual.has(posKey(end))) addArm(end, dir.clone().negate());
  }

  return [...nodes.entries()].map(([key, n]) => ({
    key,
    pos: toVec3(n.pos),
    arms: n.arms.map(toVec3),
    ...classify(n.arms),
  }));
}

const isAxisAligned = (d: Vector3) =>
  Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)) > 0.9999;
const isOnGrid = (v: Vector3) =>
  [v.x, v.y, v.z].every((c) => Math.abs(c - Math.round(c / GRID) * GRID) < 0.5);

export function isGridNode(n: Node): boolean {
  return isOnGrid(v3(n.pos)) && n.arms.every((a) => isAxisAligned(v3(a)));
}

/** Keys of the 200 mm grid edges a grid-aligned tube runs along; empty for off-grid tubes. */
export function tubeEdgeKeys(t: Tube): string[] {
  const [start, end] = tubeEnds(t);
  const dir = tubeDir(t);
  if (!isAxisAligned(dir) || !isOnGrid(start) || !isOnGrid(end)) return [];
  const units = Math.round(start.distanceTo(end) / GRID);
  const keys: string[] = [];
  for (let i = 0; i < units; i++) {
    keys.push(posKey(start.clone().addScaledVector(dir, (i + 0.5) * GRID)));
  }
  return keys;
}

export function occupiedEdges(parts: Part[]): Set<string> {
  const set = new Set<string>();
  for (const p of parts) if (p.type === 'tube') for (const k of tubeEdgeKeys(p)) set.add(k);
  return set;
}

export interface PanelCell {
  key: string;
  pos: Vec3;
  quat: Quat;
  w: number;
  h: number;
  occupied: boolean;
}

const PANEL_SIZES = new Set(['350x350', '150x350']);

/** Frames a panel can be clipped into: two parallel tubes of equal length facing each other. */
export function panelCells(parts: Part[]): PanelCell[] {
  const tubes = parts
    .filter((p): p is Tube => p.type === 'tube')
    .map((t) => ({ t, start: tubeEnds(t)[0], end: tubeEnds(t)[1], dir: tubeDir(t) }));
  const panels = parts.filter((p): p is Panel => p.type === 'panel').map((p) => v3(p.pos));
  const cells = new Map<string, PanelCell>();

  for (let i = 0; i < tubes.length; i++) {
    for (let j = i + 1; j < tubes.length; j++) {
      const a = tubes[i];
      const b = tubes[j];
      if (a.t.length !== b.t.length) continue;
      const dot = a.dir.dot(b.dir);
      if (Math.abs(dot) < 0.999) continue;
      const offset = (dot > 0 ? b.start : b.end).clone().sub(a.start);
      if (Math.abs(offset.dot(a.dir)) > 1) continue;
      const gap = offset.length();
      if (Math.abs(gap - 400) > 1 && Math.abs(gap - 200) > 1) continue;
      const across = Math.round(gap) - HUB;
      const along = a.t.length;
      const [w, h] = along <= across ? [along, across] : [across, along];
      if (!PANEL_SIZES.has(`${w}x${h}`)) continue;

      const o = offset.clone().normalize();
      // Local x carries the short side so half panels keep w = 150.
      const [xAxis, yAxis] = along <= across ? [a.dir.clone(), o] : [o, a.dir.clone()];
      const zAxis = new Vector3().crossVectors(xAxis, yAxis);
      const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(xAxis, yAxis, zAxis));
      const center = a.start
        .clone()
        .addScaledVector(a.dir, (along + HUB) / 2)
        .addScaledVector(offset, 0.5);
      const key = `${posKey(center)}|${[zAxis.x, zAxis.y, zAxis.z].map((c) => Math.round(Math.abs(c) * 10)).join(',')}`;
      if (cells.has(key)) continue;
      cells.set(key, {
        key,
        pos: toVec3(center),
        quat: toQuat(q),
        w,
        h,
        occupied: panels.some((p) => p.distanceTo(center) < 5),
      });
    }
  }
  return [...cells.values()];
}

/** Keys of the nodes a part plugs into, to tell which connectors a build step needs. */
export function touchedNodeKeys(p: Part): string[] {
  if (p.type === 'tube') return tubeEnds(p).map(posKey);
  if (p.type === 'roof45') return [posKey(roofGeometry(p).node)];
  return [];
}
