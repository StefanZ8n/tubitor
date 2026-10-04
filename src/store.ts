import { create } from 'zustand';
import { countParts, type Counts } from './core/partslist';
import { emptyDesign, type ColorKey, type Design, type Part, type Vec3 } from './core/types';
import type { Lang } from './i18n';

export type Tool = 'select' | 'tube' | 'panel' | 'erase';
export const GROUND_DIRS: Vec3[] = [
  [0, 1, 0],
  [1, 0, 0],
  [0, 0, 1],
];

const DESIGN_KEY = 'tubecraft.design';
const INVENTORY_KEY = 'tubecraft.inventory';
const PREFS_KEY = 'tubecraft.prefs';
const HISTORY_LIMIT = 200;

function load<T>(key: string, fallback: T): T {
  try {
    // Falls back to keys written under the project's first working title.
    const raw = localStorage.getItem(key) ?? localStorage.getItem(key.replace('tubecraft.', 'rohrwerk.'));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode, quota); the design still lives in memory.
  }
}

interface Prefs {
  lang: Lang;
  inventoryMode: boolean;
  strict: boolean;
}

interface State extends Prefs {
  design: Design;
  past: Part[][];
  future: Part[][];
  selection: string[];
  tool: Tool;
  tubeLength: number;
  color: ColorKey;
  perforated: boolean;
  groundDir: number;
  inventory: Counts;
  view: 'build' | 'plan';
  planStep: number;
  toast: string | null;
  /** Bumped whenever the camera should frame the whole design again. */
  fitVersion: number;

  /** Returns the catalogue key of the part that blocked the change in strict mode, if any. */
  addPart: (part: Part) => string | null;
  removeParts: (ids: string[]) => void;
  undo: () => void;
  redo: () => void;
  loadDesign: (design: Design) => void;
  setName: (name: string) => void;
  select: (id: string | null, additive?: boolean) => void;
  setInventory: (key: string, n: number) => void;
  setPrefs: (prefs: Partial<Prefs>) => void;
  set: (patch: Partial<Pick<State, 'tool' | 'tubeLength' | 'color' | 'perforated' | 'groundDir' | 'view' | 'planStep' | 'toast'>>) => void;
}

const defaultLang: Lang = typeof navigator !== 'undefined' && navigator.language.startsWith('de') ? 'de' : 'en';
const prefs = load<Prefs>(PREFS_KEY, { lang: defaultLang, inventoryMode: false, strict: false });

export const useStore = create<State>((set, get) => {
  const commit = (parts: Part[]) => {
    const { design, past } = get();
    const next = { ...design, parts };
    save(DESIGN_KEY, next);
    set({ design: next, past: [...past, design.parts].slice(-HISTORY_LIMIT), future: [] });
  };

  return {
    ...prefs,
    design: load<Design>(DESIGN_KEY, emptyDesign()),
    past: [],
    future: [],
    selection: [],
    tool: 'tube',
    tubeLength: 350,
    color: 'red',
    perforated: false,
    groundDir: 0,
    inventory: load<Counts>(INVENTORY_KEY, {}),
    view: 'build',
    planStep: 0,
    toast: null,
    fitVersion: 0,

    addPart: (part) => {
      const { design, inventoryMode, strict, inventory } = get();
      const parts = [...design.parts, part];
      if (inventoryMode && strict) {
        const before = countParts(design.parts);
        const after = countParts(parts);
        const short = Object.keys(after).find(
          (k) => after[k] > (before[k] ?? 0) && after[k] > (inventory[k] ?? 0),
        );
        if (short) return short;
      }
      commit(parts);
      return null;
    },
    removeParts: (ids) => {
      const drop = new Set(ids);
      const { design, selection } = get();
      if (!design.parts.some((p) => drop.has(p.id))) return;
      commit(design.parts.filter((p) => !drop.has(p.id)));
      set({ selection: selection.filter((id) => !drop.has(id)) });
    },
    undo: () => {
      const { design, past, future } = get();
      if (!past.length) return;
      const next = { ...design, parts: past[past.length - 1] };
      save(DESIGN_KEY, next);
      set({ design: next, past: past.slice(0, -1), future: [design.parts, ...future], selection: [] });
    },
    redo: () => {
      const { design, past, future } = get();
      if (!future.length) return;
      const next = { ...design, parts: future[0] };
      save(DESIGN_KEY, next);
      set({ design: next, past: [...past, design.parts], future: future.slice(1), selection: [] });
    },
    loadDesign: (design) => {
      save(DESIGN_KEY, design);
      set({ design, past: [], future: [], selection: [], planStep: 0, fitVersion: get().fitVersion + 1 });
    },
    setName: (name) => {
      const design = { ...get().design, name };
      save(DESIGN_KEY, design);
      set({ design });
    },
    select: (id, additive = false) => {
      const { selection } = get();
      if (!id) set({ selection: [] });
      else if (!additive) set({ selection: [id] });
      else set({ selection: selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id] });
    },
    setInventory: (key, n) => {
      const inventory = { ...get().inventory, [key]: Math.max(0, Math.floor(n) || 0) };
      save(INVENTORY_KEY, inventory);
      set({ inventory });
    },
    setPrefs: (patch) => {
      set(patch);
      const { lang, inventoryMode, strict } = get();
      save(PREFS_KEY, { lang, inventoryMode, strict });
    },
    set: (patch) => set(patch),
  };
});
