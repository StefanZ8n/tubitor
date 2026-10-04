import { Vector3 } from 'three';
import { HUB, quat, roofGeometry, touchedNodeKeys, tubeEnds } from './geometry';
import { fixPanels, type PanelFixing } from './panels';
import type { Panel, Part } from './types';

export interface BuildStep {
  level: number;
  phase: 'horizontal' | 'upright' | 'panels';
  /** Position within the level: frame, then uprights, with panels right after what closes their frame. */
  order: number;
  partIds: string[];
}

const LEVEL = 200;
const ORDER = { horizontal: 0, upright: 1 };

type Slot = Pick<BuildStep, 'level' | 'phase' | 'order'>;
const later = (a: Slot, b: Slot) => (a.level - b.level || a.order - b.order) > 0;

function tubeSlot(p: Exclude<Part, Panel>): Slot {
  if (p.type === 'roof45') return { level: Math.round(roofGeometry(p).node.y / LEVEL), phase: 'horizontal', order: ORDER.horizontal };
  const [a, b] = tubeEnds(p);
  const phase = Math.abs(a.y - b.y) < 1 ? 'horizontal' : 'upright';
  return { level: Math.round(Math.min(a.y, b.y) / LEVEL), phase, order: ORDER[phase] };
}

/** A panel without any tube around it is placed by the height of its lower edge. */
function loosePanelSlot(p: Panel): Slot {
  const q = quat(p.quat);
  const rise = (axis: Vector3, size: number) => Math.abs(axis.applyQuaternion(q).y) * size;
  const halfHeight = (rise(new Vector3(1, 0, 0), p.w) + rise(new Vector3(0, 1, 0), p.h) + HUB) / 2;
  return { level: Math.round((p.pos[1] - halfHeight) / LEVEL), phase: 'panels', order: ORDER.upright + 0.5 };
}

/**
 * Build order from the ground up: per height level the frame first, then the uprights.
 * A panel goes in right after the last tube of its frame, once it is enclosed on all sides.
 */
export function buildSteps(parts: Part[], fixing: PanelFixing = fixPanels(parts)): BuildStep[] {
  const slots = new Map<string, Slot>();
  for (const p of parts) if (p.type !== 'panel') slots.set(p.id, tubeSlot(p));
  for (const p of parts) {
    if (p.type !== 'panel') continue;
    const frame = (fixing.frame.get(p.id) ?? []).map((id) => slots.get(id)!);
    if (!frame.length) {
      slots.set(p.id, loosePanelSlot(p));
      continue;
    }
    const last = frame.reduce((a, b) => (later(b, a) ? b : a));
    slots.set(p.id, { level: last.level, phase: 'panels', order: last.order + 0.5 });
  }

  const groups = new Map<string, BuildStep>();
  for (const p of parts) {
    const slot = slots.get(p.id)!;
    const key = `${slot.level}|${slot.order}`;
    let step = groups.get(key);
    if (!step) groups.set(key, (step = { ...slot, partIds: [] }));
    step.partIds.push(p.id);
  }
  return [...groups.values()].sort((a, b) => a.level - b.level || a.order - b.order);
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
