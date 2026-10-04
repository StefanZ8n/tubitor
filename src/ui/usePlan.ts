import { useMemo } from 'react';
import { deriveNodes } from '../core/geometry';
import { countParts } from '../core/partslist';
import { buildSteps, nodeSteps } from '../core/steps';
import { useStore } from '../store';

/** Derived view of the design: its nodes, the build steps and what the active step adds. */
export function usePlan() {
  const parts = useStore((s) => s.design.parts);
  const planStep = useStore((s) => s.planStep);

  const nodes = useMemo(() => deriveNodes(parts), [parts]);
  const steps = useMemo(() => buildSteps(parts), [parts]);
  const nodeStep = useMemo(() => nodeSteps(parts, steps), [parts, steps]);

  return useMemo(() => {
    const index = Math.min(planStep, Math.max(steps.length - 1, 0));
    const step = steps[index];
    const shown = new Set(steps.slice(0, index + 1).flatMap((s) => s.partIds));
    const current = new Set(step?.partIds ?? []);
    const shownNodes = new Set<string>();
    const currentNodes = new Set<string>();
    for (const [key, at] of nodeStep) {
      if (at <= index) shownNodes.add(key);
      if (at === index) currentNodes.add(key);
    }
    const stepCounts = countParts(
      parts.filter((p) => current.has(p.id)),
      nodes.filter((n) => currentNodes.has(n.key)),
      nodes,
    );
    return { nodes, steps, index, step, shown, current, shownNodes, currentNodes, stepCounts };
  }, [parts, nodes, steps, nodeStep, planStep]);
}
