export type Vec3 = [number, number, number];
/** Quaternion as x, y, z, w (three.js order). */
export type Quat = [number, number, number, number];

export const COLORS = ['red', 'green', 'blue', 'yellow', 'black', 'white', 'grey'] as const;
export type ColorKey = (typeof COLORS)[number];

interface PartBase {
  id: string;
  /** Position in millimetres, y is up. */
  pos: Vec3;
  quat: Quat;
  color: ColorKey;
}

/** Starts at the node `pos` and runs along its local +x axis. */
export interface Tube extends PartBase {
  type: 'tube';
  length: number;
}

/** Centred on `pos`, lies in its local xy plane (w along x, h along y). */
export interface Panel extends PartBase {
  type: 'panel';
  w: number;
  h: number;
  perforated: boolean;
}

/** 45° roof adapter, plugged into the local +x arm of the connector at `pos`. */
export interface Roof45 extends PartBase {
  type: 'roof45';
}

export type Part = Tube | Panel | Roof45;

export interface Design {
  format: 'tubecraft-design';
  version: 1;
  name: string;
  tags: string[];
  parts: Part[];
}

export type ConnectorKind = 'c6' | 'c5' | 'c4' | 'c3' | 'f4' | 'f3' | 'f2' | 's2';

/** A point where tube ends meet. `kind` is null when no real connector fits. */
export interface Node {
  key: string;
  pos: Vec3;
  arms: Vec3[];
  kind: ConnectorKind | null;
  /** Arms are not at right angles to each other, so no connector exists for it. */
  invalid: boolean;
}

export function emptyDesign(name = ''): Design {
  return { format: 'tubecraft-design', version: 1, name, tags: [], parts: [] };
}

let idCounter = 0;
export function newId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
