import { Vector3 } from 'three';
import { HUB, quat, roofGeometry, touchedNodeKeys, tubeEnds } from './geometry';
import type { Part } from './types';

export interface BuildStep {
  level: number;
  phase: 'horizontal' | 'upright' | 'panels';
  partIds: string[];
}

const LEVEL = 200;
const PHASES = ['horizontal', 'upright', 'panels'] as const;

function placement(p: Part): { base: number; phase: BuildStep['phase'] } {
  if (p.type === 'tube') {
    const [a, b] = tubeEnds(p);
    const base = Math.min(a.y, b.y);
    return { base, phase: Math.abs(a.y - b.y) < 1 ? 'horizontal' : 'upright' };
  }
  if (p.type === 'roof45') return { base: roofGeometry(p).node.y, phase: 'horizontal' };
  // Lower edge of the frame the panel sits in.
  const q = quat(p.quat);
  const rise = (axis: Vector3, size: number) => Math.abs(axis.applyQuaternion(q).y) * size;
  const halfHeight = (rise(new Vector3(1, 0, 0), p.w) + rise(new Vector3(0, 1, 0), p.h) + HUB) / 2;
  return { base: p.pos[1] - halfHeight, phase: 'panels' };
}

/** Build order from the ground up: per height level the frame first, then uprights, then panels. */
export function buildSteps(parts: Part[]): BuildStep[] {
  const groups = new Map<string, BuildStep>();
  for (const p of parts) {
    const { base, phase } = placement(p);
    const level = Math.round(base / LEVEL);
    const key = `${level}|${phase}`;
    let step = groups.get(key);
    if (!step) groups.set(key, (step = { level, phase, partIds: [] }));
    step.partIds.push(p.id);
  }
  return [...groups.values()].sort(
    (a, b) => a.level - b.level || PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase),
  );
}

/**
 * The step in which each connector goes on. A connector is part of the flat frame of its
 * level, so it comes with that level's horizontal tubes rather than with the uprights
 * below it: tubes cannot be pushed in between connectors that are already fixed.
 */
export function nodeSteps(parts: Part[], steps: BuildStep[]): Map<string, number> {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const result = new Map<string, number>();
  const framed = new Set<string>();
  steps.forEach((step, index) => {
    for (const id of step.partIds) {
      for (const key of touchedNodeKeys(byId.get(id)!)) {
        if (step.phase === 'horizontal' && !framed.has(key)) {
          framed.add(key);
          result.set(key, index);
        } else if (!result.has(key)) {
          result.set(key, index);
        }
      }
    }
  });
  return result;
}
