import { useMemo } from 'react';
import { analyse, countParts, countScrews } from '../core/partslist';
import { buildSteps, nodeSteps } from '../core/steps';
import { useStore } from '../store';

/** Derived view of the design: its nodes, the build steps and what the active step adds. */
export function usePlan() {
  const parts = useStore((s) => s.design.parts);
  const planStep = useStore((s) => s.planStep);

  const info = useMemo(() => analyse(parts), [parts]);
  const { nodes, fixing } = info;
  const steps = useMemo(() => buildSteps(parts, fixing), [parts, fixing]);
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
    const stepParts = parts.filter((p) => current.has(p.id));
    const stepScrews = countScrews(stepParts, info);
    const stepCounts = countParts(
      stepParts,
      info,
      nodes.filter((n) => currentNodes.has(n.key)),
    );
    return { info, nodes, fixing, steps, index, step, shown, current, shownNodes, currentNodes, stepCounts, stepScrews };
  }, [parts, info, nodes, fixing, steps, nodeStep, planStep]);
}
