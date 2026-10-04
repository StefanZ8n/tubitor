import { useMemo } from 'react';
import { countParts, countScrews, missingParts, orderedKeys, type Counts, type Screws } from '../core/partslist';
import { partLabel, translate, type MsgKey } from '../i18n';
import { useStore } from '../store';
import { usePlan } from './usePlan';

const PHASE_LABEL: Record<string, MsgKey> = { horizontal: 'phaseHorizontal', upright: 'phaseUpright', panels: 'phasePanels' };
const sum = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);

export function Sidebar() {
  const s = useStore();
  const plan = usePlan();
  const t = (k: MsgKey, vars?: Record<string, string | number>) => translate(s.lang, k, vars);
  const used = useMemo(() => countParts(s.design.parts, plan.info), [s.design.parts, plan.info]);
  const unfixed = plan.fixing.unfixed.length;
  const screws = useMemo(() => countScrews(s.design.parts, plan.info), [s.design.parts, plan.info]);
  const screwInfo = (n: Screws) => (n.tube + n.panel > 0 ? <p className="note">{t('screws', { tube: n.tube, panel: n.panel })}</p> : null);
  const invalid = plan.nodes.filter((n) => n.invalid).length;

  if (s.view === 'plan') {
    const { steps, index, step, stepCounts, stepScrews } = plan;
    return (
      <aside className="sidebar">
        <h2>{t('plan')}</h2>
        {step ? (
          <>
            <p className="stepno">{t('step', { i: index + 1, n: steps.length })}</p>
            <p>
              <strong>{t(step.phase === 'horizontal' && step.level > 0 ? 'phaseFrameOn' : PHASE_LABEL[step.phase])}</strong>
              <br />
              {t('level', { n: step.level })} · {(step.level * 20)} cm
            </p>
            <div className="row">
              <button disabled={index === 0} onClick={() => s.set({ planStep: index - 1 })}>← {t('prev')}</button>
              <button disabled={index >= steps.length - 1} onClick={() => s.set({ planStep: index + 1 })}>{t('next')} →</button>
            </div>
            <input type="range" min={0} max={steps.length - 1} value={index} onChange={(e) => s.set({ planStep: Number(e.target.value) })} />
            <table>
              <tbody>
                {orderedKeys(stepCounts).filter((k) => stepCounts[k]).map((k) => (
                  <tr key={k}>
                    <td>{partLabel(s.lang, k)}</td>
                    <td className="num">{stepCounts[k]}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {screwInfo(stepScrews)}
          </>
        ) : (
          <p>{t('empty')}</p>
        )}
      </aside>
    );
  }

  const missing = missingParts(used, s.inventory);
  const keys = orderedKeys(used, s.inventoryMode ? s.inventory : {}).filter((k) => s.inventoryMode || used[k]);

  return (
    <aside className="sidebar">
      <h2>{t('parts')}</h2>
      <div className="segmented">
        <button className={!s.inventoryMode ? 'on' : ''} onClick={() => s.setPrefs({ inventoryMode: false })}>{t('freeBuild')}</button>
        <button className={s.inventoryMode ? 'on' : ''} onClick={() => s.setPrefs({ inventoryMode: true })}>{t('myParts')}</button>
      </div>
      {s.inventoryMode && (
        <>
          <label className="check">
            <input type="checkbox" checked={s.strict} onChange={(e) => s.setPrefs({ strict: e.target.checked })} /> {t('strict')}
          </label>
          <p className={sum(missing) ? 'warn' : 'ok'}>{sum(missing) ? t('missingCount', { n: sum(missing) }) : t('allAvailable')}</p>
        </>
      )}
      {invalid > 0 && <p className="warn">{t('invalidNodes', { n: invalid })}</p>}
      {unfixed > 0 && <p className="warn">{t('unfixedPanels', { n: unfixed })}</p>}
      <table>
        <thead>
          <tr>
            <th>{t('part')}</th>
            <th className="num">{t('used')}</th>
            {s.inventoryMode && <th className="num">{t('have')}</th>}
            {s.inventoryMode && <th className="num">{t('missing')}</th>}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className={missing[k] && s.inventoryMode ? 'short' : ''}>
              <td>{partLabel(s.lang, k)}</td>
              <td className="num">{used[k] ?? 0}</td>
              {s.inventoryMode && (
                <td className="num">
                  <input type="number" min={0} aria-label={`${t('have')}: ${partLabel(s.lang, k)}`} value={s.inventory[k] ?? 0} onChange={(e) => s.setInventory(k, Number(e.target.value))} />
                </td>
              )}
              {s.inventoryMode && <td className="num">{missing[k] ?? ''}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{t('total')}</td>
            <td className="num">{sum(used)}</td>
            {s.inventoryMode && <td />}
            {s.inventoryMode && <td className="num">{sum(missing) || ''}</td>}
          </tr>
        </tfoot>
      </table>
      {screwInfo(screws)}
    </aside>
  );
}
