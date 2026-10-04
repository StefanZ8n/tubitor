import { useEffect, useRef, useState } from 'react';
import { TUBE_LENGTHS } from '../core/geometry';
import { parseQdf } from '../core/qdf';
import { COLORS, emptyDesign, type Design } from '../core/types';
import { translate, type MsgKey } from '../i18n';
import { GROUND_DIRS, useStore, type Tool } from '../store';
import { Sidebar } from './Sidebar';
import { Viewport } from './Viewport';

declare const __APP_VERSION__: string;

const TOOLS: { tool: Tool; label: MsgKey; key: string }[] = [
  { tool: 'select', label: 'toolSelect', key: 'V' },
  { tool: 'tube', label: 'toolTube', key: 'T' },
  { tool: 'panel', label: 'toolPanel', key: 'P' },
  { tool: 'erase', label: 'toolErase', key: 'E' },
];
const HINTS: Record<Tool, MsgKey> = { select: 'hintSelect', tube: 'hintTube', panel: 'hintPanel', erase: 'hintErase' };
const DIR_LABELS = ['↑', 'X', 'Z'];
const SWATCH: Record<string, string> = { red: '#d42a2a', green: '#1f9440', blue: '#1d5fb5', yellow: '#f2c112', black: '#26282b', white: '#f1f1ee', grey: '#9aa0a6' };

function isDesign(value: unknown): value is Design {
  const d = value as Design;
  // 'rohrwerk-design' was the format name under the first working title.
  return !!d && ['tubecraft-design', 'rohrwerk-design'].includes(d.format) && Array.isArray(d.parts);
}

async function openFile(file: File) {
  const { lang, loadDesign, set } = useStore.getState();
  const t = (k: MsgKey, vars?: Record<string, string | number>) => translate(lang, k, vars);
  try {
    const text = await file.text();
    const name = file.name.replace(/\.(qdf|(tubecraft\.|rohrwerk\.)?json)$/i, '');
    if (/\.qdf$/i.test(file.name)) {
      const { design, skipped } = parseQdf(text, name);
      if (!design.parts.length) throw new Error('empty');
      loadDesign(design);
      const list = Object.entries(skipped).map(([type, n]) => `${n}× ${type}`).join(', ');
      set({ toast: t('imported', { n: design.parts.length }) + (list ? ` ${t('importSkipped', { list })}` : '') });
    } else {
      const design: unknown = JSON.parse(text);
      if (!isDesign(design)) throw new Error('format');
      loadDesign({ ...design, format: 'tubecraft-design' });
    }
  } catch {
    set({ toast: t('importFailed') });
  }
}

function download(design: Design, fallbackName: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(design)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${design.name || fallbackName}.tubecraft.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input:not([type=checkbox]), textarea, select')) return;
      const s = useStore.getState();
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z') (e.shiftKey ? s.redo : s.undo)();
        else if (key === 'y') s.redo();
        else return;
        e.preventDefault();
        return;
      }
      if (s.view === 'plan') {
        if (key === 'home' || key === 'h') s.set({ fitVersion: s.fitVersion + 1 });
        if (key === 'arrowright') s.set({ planStep: s.planStep + 1 });
        if (key === 'arrowleft') s.set({ planStep: Math.max(0, s.planStep - 1) });
        return;
      }
      const tool = TOOLS.find((t) => t.key.toLowerCase() === key);
      if (tool) s.set({ tool: tool.tool });
      else if (['1', '2', '3'].includes(key)) s.set({ tubeLength: TUBE_LENGTHS[Number(key) - 1] });
      else if (key === 'r') s.set({ groundDir: (s.groundDir + 1) % GROUND_DIRS.length });
      else if (key === 'escape') s.select(null);
      else if (key === 'home' || key === 'h') s.set({ fitVersion: s.fitVersion + 1 });
      else if (key === 'delete' || key === 'backspace') s.removeParts(s.selection);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const s = useStore();
  const t = (k: MsgKey, vars?: Record<string, string | number>) => translate(s.lang, k, vars);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  useShortcuts();

  useEffect(() => {
    document.documentElement.lang = s.lang;
  }, [s.lang]);

  useEffect(() => {
    if (!s.toast) return;
    const timer = setTimeout(() => useStore.getState().set({ toast: null }), 6000);
    return () => clearTimeout(timer);
  }, [s.toast]);

  const building = s.view === 'build';

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void openFile(file);
      }}
    >
      <header className="topbar">
        <strong className="brand">TubeCraft</strong>
        <input className="name" value={s.design.name} placeholder={t('untitled')} onChange={(e) => s.setName(e.target.value)} />
        <button onClick={() => (!s.design.parts.length || confirm(t('confirmNew'))) && s.loadDesign(emptyDesign())}>{t('new')}</button>
        <button onClick={() => fileInput.current?.click()}>{t('open')}</button>
        <button onClick={() => download(s.design, t('untitled'))}>{t('save')}</button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.qdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openFile(file);
            e.target.value = '';
          }}
        />
        <span className="sep" />
        <button disabled={!s.past.length} onClick={s.undo} title="Ctrl+Z">{t('undo')}</button>
        <button disabled={!s.future.length} onClick={s.redo} title="Ctrl+Y">{t('redo')}</button>
        <span className="sep" />
        <button onClick={() => s.set({ fitVersion: s.fitVersion + 1 })} title={t('fitHint')}>{t('fit')}</button>
        <span className="grow" />
        <div className="segmented">
          <button className={building ? 'on' : ''} onClick={() => s.set({ view: 'build' })}>{t('build')}</button>
          <button className={!building ? 'on' : ''} onClick={() => s.set({ view: 'plan', planStep: 0 })}>{t('plan')}</button>
        </div>
        <div className="segmented">
          {(['de', 'en'] as const).map((lang) => (
            <button key={lang} className={s.lang === lang ? 'on' : ''} onClick={() => s.setPrefs({ lang })}>{lang.toUpperCase()}</button>
          ))}
        </div>
      </header>

      {building && (
        <aside className="tools">
          {TOOLS.map(({ tool, label, key }) => (
            <button key={tool} className={s.tool === tool ? 'on' : ''} onClick={() => s.set({ tool })}>
              {t(label)} <kbd>{key}</kbd>
            </button>
          ))}
          {s.tool === 'tube' && (
            <>
              <label>{t('length')}</label>
              <div className="segmented">
                {TUBE_LENGTHS.map((len, i) => (
                  <button key={len} className={s.tubeLength === len ? 'on' : ''} onClick={() => s.set({ tubeLength: len })} title={String(i + 1)}>{len / 10}</button>
                ))}
              </div>
              <label>{t('groundDir')}</label>
              <div className="segmented">
                {DIR_LABELS.map((label, i) => (
                  <button key={label} className={s.groundDir === i ? 'on' : ''} onClick={() => s.set({ groundDir: i })} title={i === 0 ? t('dirUp') : label}>{label}</button>
                ))}
              </div>
            </>
          )}
          {(s.tool === 'tube' || s.tool === 'panel') && (
            <>
              <label>{t('color')}</label>
              <div className="swatches">
                {COLORS.map((c) => (
                  <button key={c} className={s.color === c ? 'on' : ''} style={{ background: SWATCH[c] }} title={t(c)} aria-label={t(c)} onClick={() => s.set({ color: c })} />
                ))}
              </div>
            </>
          )}
          {s.tool === 'panel' && (
            <label className="check">
              <input type="checkbox" checked={s.perforated} onChange={(e) => s.set({ perforated: e.target.checked })} /> {t('perforated')}
            </label>
          )}
        </aside>
      )}

      <main className="stage">
        <Viewport />
        {!s.design.parts.length && <div className="empty">{t('empty')}</div>}
        {s.toast && <div className="toast" role="status">{s.toast}</div>}
        {dragging && <div className="drop">.qdf / .json</div>}
      </main>

      <Sidebar />

      <footer className="status">
        <span>{building ? `${t(HINTS[s.tool])} ${t('hintCamera')}` : t('hintCamera')}</span>
        {building && s.selection.length > 0 && <strong>{t('selected', { n: s.selection.length })}</strong>}
        <span className="grow" />
        <span>{t('disclaimer')}</span>
        <span>v{__APP_VERSION__}</span>
      </footer>
    </div>
  );
}
