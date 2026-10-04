import { posKey, tubeEnds } from './geometry';
import type { PanelFixing } from './panels';
import type { ColorKey, Part } from './types';

export const AUTO_COLORS: ColorKey[] = ['red', 'green', 'blue', 'yellow'];

/**
 * Recolours tubes and panels at random, steering away from the colours already next to
 * a part: tubes meeting at the same connector, and the tubes framing a panel.
 */
export function autoColor(parts: Part[], fixing: PanelFixing, random: () => number = Math.random): Part[] {
  const colorOf = new Map<string, ColorKey>();
  const atNode = new Map<string, string[]>();
  for (const p of parts) {
    if (p.type !== 'tube') continue;
    for (const end of tubeEnds(p)) {
      const key = posKey(end);
      atNode.set(key, [...(atNode.get(key) ?? []), p.id]);
    }
  }

  const pick = (neighbours: string[]): ColorKey => {
    const taken = AUTO_COLORS.map((c) => neighbours.filter((id) => colorOf.get(id) === c).length);
    const least = Math.min(...taken);
    const choices = AUTO_COLORS.filter((_, i) => taken[i] === least);
    return choices[Math.floor(random() * choices.length)];
  };

  // Tubes first, in random order so the pattern does not follow the order they were built in.
  const tubes = parts.filter((p) => p.type === 'tube');
  for (let i = tubes.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tubes[i], tubes[j]] = [tubes[j], tubes[i]];
  }
  for (const t of tubes) {
    if (t.type !== 'tube') continue;
    colorOf.set(t.id, pick(tubeEnds(t).flatMap((end) => atNode.get(posKey(end)) ?? [])));
  }
  for (const p of parts) {
    if (p.type === 'panel') colorOf.set(p.id, pick(fixing.frame.get(p.id) ?? []));
  }
  return parts.map((p) => (colorOf.has(p.id) ? { ...p, color: colorOf.get(p.id)! } : p));
}
