import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box3, CanvasTexture, DoubleSide, Quaternion, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  GRID,
  HUB,
  isGridNode,
  occupiedEdges,
  panelCells,
  quat,
  quatFromDir,
  roofGeometry,
  tubeEdgeKeys,
  tubeEnds,
  v3,
  type PanelCell,
} from '../core/geometry';
import { newId, type ColorKey, type Node, type Panel, type Part, type Roof45, type Tube, type Vec3 } from '../core/types';
import { translate, partLabel } from '../i18n';
import { GROUND_DIRS, useStore } from '../store';
import { usePlan } from './usePlan';

const HEX: Record<ColorKey, string> = {
  red: '#d42a2a',
  green: '#1f9440',
  blue: '#1d5fb5',
  yellow: '#f2c112',
  black: '#26282b',
  white: '#f1f1ee',
  grey: '#9aa0a6',
};
const FADED = '#c5c9cf';
const CONNECTOR = '#2b2d31';
const HIGHLIGHT = '#ff8a00';
const TUBE_RADIUS = 17.5;
const PANEL_THICKNESS = 8;
// Mouse travel in pixels below which a press still counts as a click, not a camera drag.
const CLICK_SLOP = 4;

const Y = new Vector3(0, 1, 0);
const Y_TO_X = new Quaternion().setFromUnitVectors(Y, new Vector3(1, 0, 0));
const alongY = (dir: Vector3) => new Quaternion().setFromUnitVectors(Y, dir);

let holeTexture: CanvasTexture | null = null;
function holes(): CanvasTexture {
  if (holeTexture) return holeTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  const n = 5;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      ctx.beginPath();
      ctx.arc(((i + 0.5) * size) / n, ((j + 0.5) * size) / n, size / n / 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return (holeTexture = new CanvasTexture(canvas));
}

interface Look {
  color: string;
  emissive?: string;
  opacity?: number;
}

type PartEvents = {
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: () => void;
};

function Surface({ look }: { look: Look }) {
  return (
    <meshStandardMaterial
      color={look.color}
      emissive={look.emissive ?? '#000'}
      emissiveIntensity={look.emissive ? 0.55 : 0}
      roughness={0.45}
      transparent={look.opacity !== undefined}
      opacity={look.opacity ?? 1}
      depthWrite={look.opacity === undefined}
    />
  );
}

function Rod({ from, to, radius, look }: { from: Vector3; to: Vector3; radius: number; look: Look }) {
  const dir = to.clone().sub(from);
  const length = dir.length();
  return (
    <mesh position={from.clone().add(to).multiplyScalar(0.5)} quaternion={alongY(dir.normalize())} scale={[1, length, 1]}>
      <cylinderGeometry args={[radius, radius, 1, 20]} />
      <Surface look={look} />
    </mesh>
  );
}

function TubeMesh({ tube, look, events }: { tube: Tube; look: Look; events?: PartEvents }) {
  const q = quat(tube.quat);
  const mid = v3(tube.pos).addScaledVector(new Vector3(1, 0, 0).applyQuaternion(q), (tube.length + HUB) / 2);
  return (
    <mesh position={mid} quaternion={q.multiply(Y_TO_X)} scale={[1, tube.length, 1]} {...events}>
      <cylinderGeometry args={[TUBE_RADIUS, TUBE_RADIUS, 1, 20]} />
      <Surface look={look} />
    </mesh>
  );
}

function PanelMesh({ panel, look, events }: { panel: Pick<Panel, 'pos' | 'quat' | 'w' | 'h' | 'perforated'>; look: Look; events?: PartEvents }) {
  return (
    <mesh position={panel.pos} quaternion={quat(panel.quat)} {...events}>
      <boxGeometry args={[panel.w, panel.h, PANEL_THICKNESS]} />
      {panel.perforated ? (
        <meshStandardMaterial color={look.color} emissive={look.emissive ?? '#000'} emissiveIntensity={look.emissive ? 0.55 : 0} alphaMap={holes()} alphaTest={0.5} side={DoubleSide} roughness={0.6} />
      ) : (
        <Surface look={look} />
      )}
    </mesh>
  );
}

function RoofMesh({ roof, look, events }: { roof: Roof45; look: Look; events?: PartEvents }) {
  const g = roofGeometry(roof);
  const elbow = g.node.clone().addScaledVector(g.arm, 62).addScaledVector(g.up, 14);
  return (
    <group {...events}>
      <Rod from={g.node} to={elbow} radius={21} look={look} />
      <Rod from={elbow} to={g.virtualNode.clone().addScaledVector(g.tubeDir, HUB / 2 + 12)} radius={21} look={look} />
    </group>
  );
}

function ConnectorMesh({ node, faded }: { node: Node; faded: boolean }) {
  const look: Look = { color: node.invalid ? '#e0218a' : faded ? FADED : CONNECTOR };
  return (
    <group position={node.pos}>
      <mesh>
        <sphereGeometry args={[25, 20, 14]} />
        <Surface look={look} />
      </mesh>
      {node.arms.map((arm, i) => (
        <Rod key={i} from={new Vector3()} to={v3(arm).multiplyScalar(36)} radius={21} look={look} />
      ))}
    </group>
  );
}

interface TubeCandidate {
  tube: Tube;
  valid: boolean;
}

/** Frames the whole design when it is loaded, and once on start. */
function CameraFit() {
  const fitVersion = useStore((s) => s.fitVersion);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  useEffect(() => {
    if (!controls) return;
    const box = new Box3();
    for (const p of useStore.getState().design.parts) {
      if (p.type === 'tube') tubeEnds(p).forEach((e) => box.expandByPoint(e));
      else box.expandByPoint(v3(p.pos));
    }
    if (box.isEmpty()) box.set(new Vector3(-400, 0, -400), new Vector3(400, 800, 400));
    const center = box.getCenter(new Vector3());
    const radius = Math.max(box.getSize(new Vector3()).length() / 2, 600);
    controls.target.copy(center);
    camera.position.copy(center).add(new Vector3(1, 0.75, 1.2).normalize().multiplyScalar(radius * 3));
    controls.update();
  }, [fitVersion, controls, camera]);
  return null;
}

function Scene() {
  const parts = useStore((s) => s.design.parts);
  const tool = useStore((s) => s.tool);
  const view = useStore((s) => s.view);
  const selection = useStore((s) => s.selection);
  const plan = usePlan();
  const [candidate, setCandidate] = useState<TubeCandidate | null>(null);
  const [hoverCell, setHoverCell] = useState<string | null>(null);
  const [hoverPart, setHoverPart] = useState<string | null>(null);
  const rightPress = useRef<{ id: string; x: number; y: number } | null>(null);

  const building = view === 'build';
  const nodes = plan.nodes;
  const edges = useMemo(() => occupiedEdges(parts), [parts]);
  const cells = useMemo(() => (building && tool === 'panel' ? panelCells(parts).filter((c) => !c.occupied) : []), [parts, tool, building]);

  useEffect(() => {
    setCandidate(null);
    setHoverCell(null);
    setHoverPart(null);
  }, [tool, view, parts]);

  const makeCandidate = (pos: Vec3, dir: Vec3): TubeCandidate => {
    const { tubeLength, color } = useStore.getState();
    const tube: Tube = { id: newId(), type: 'tube', pos, quat: quatFromDir(dir), length: tubeLength, color };
    const [start, end] = tubeEnds(tube);
    const valid = start.y > -1 && end.y > -1 && !tubeEdgeKeys(tube).some((k) => edges.has(k));
    return { tube, valid };
  };

  const show = (c: TubeCandidate) =>
    setCandidate((old) =>
      old && old.valid === c.valid && old.tube.pos.join() === c.tube.pos.join() && old.tube.quat.join() === c.tube.quat.join() && old.tube.length === c.tube.length ? old : c,
    );

  const place = (e: ThreeEvent<MouseEvent>, c: TubeCandidate) => {
    e.stopPropagation();
    if (e.delta > CLICK_SLOP) return;
    const { addPart, lang, set } = useStore.getState();
    if (!c.valid) return set({ toast: translate(lang, 'occupied') });
    const blockedBy = addPart(c.tube);
    if (blockedBy) set({ toast: translate(lang, 'blocked', { part: partLabel(lang, blockedBy) }) });
  };

  const groundCandidate = (e: ThreeEvent<MouseEvent>) => {
    const snap = (c: number) => Math.round(c / GRID) * GRID;
    return makeCandidate([snap(e.point.x), 0, snap(e.point.z)], GROUND_DIRS[useStore.getState().groundDir]);
  };
  const nodeCandidate = (e: ThreeEvent<MouseEvent>, node: Node) => {
    const n = e.face!.normal;
    return makeCandidate(node.pos, [Math.round(n.x), Math.round(n.y), Math.round(n.z)]);
  };

  const placePanel = (e: ThreeEvent<MouseEvent>, cell: PanelCell) => {
    e.stopPropagation();
    if (e.delta > CLICK_SLOP) return;
    const { addPart, color, perforated, lang, set } = useStore.getState();
    const blockedBy = addPart({
      id: newId(),
      type: 'panel',
      pos: cell.pos,
      quat: cell.quat,
      w: cell.w,
      h: cell.h,
      perforated: perforated && cell.w === cell.h,
      color,
    });
    if (blockedBy) set({ toast: translate(lang, 'blocked', { part: partLabel(lang, blockedBy) }) });
  };

  const picking = building && (tool === 'select' || tool === 'erase');
  const partEvents = (p: Part): PartEvents | undefined => {
    if (!building) return undefined;
    // A right click removes the part with any tool; dragging with the right button still pans.
    const events: PartEvents = {
      onPointerDown: (e) => {
        if (e.button !== 2) return;
        e.stopPropagation();
        rightPress.current = { id: p.id, x: e.clientX, y: e.clientY };
      },
      onPointerUp: (e) => {
        const press = rightPress.current;
        if (e.button !== 2 || press?.id !== p.id) return;
        e.stopPropagation();
        rightPress.current = null;
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= CLICK_SLOP) useStore.getState().removeParts([p.id]);
      },
    };
    if (!picking) return events;
    return {
      ...events,
      onClick: (e) => {
        e.stopPropagation();
        if (e.delta > CLICK_SLOP) return;
        const native = e.nativeEvent;
        if (tool === 'erase') useStore.getState().removeParts([p.id]);
        else useStore.getState().select(p.id, native.shiftKey || native.ctrlKey || native.metaKey);
      },
      onPointerOver: (e) => {
        e.stopPropagation();
        setHoverPart(p.id);
      },
      onPointerOut: () => setHoverPart((id) => (id === p.id ? null : id)),
    };
  };

  const lookOf = (p: Part): Look => {
    if (!building) return { color: plan.current.has(p.id) ? HEX[p.color] : FADED };
    if (hoverPart === p.id) return { color: HEX[p.color], emissive: tool === 'erase' ? '#ff2020' : HIGHLIGHT };
    if (selection.includes(p.id)) return { color: HEX[p.color], emissive: HIGHLIGHT };
    return { color: HEX[p.color] };
  };

  const visibleParts = building ? parts : parts.filter((p) => plan.shown.has(p.id));
  const visibleNodes = building ? nodes : nodes.filter((n) => plan.shownNodes.has(n.key));

  return (
    <>
      {visibleParts.map((p) =>
        p.type === 'tube' ? (
          <TubeMesh key={p.id} tube={p} look={lookOf(p)} events={partEvents(p)} />
        ) : p.type === 'panel' ? (
          <PanelMesh key={p.id} panel={p} look={lookOf(p)} events={partEvents(p)} />
        ) : (
          <RoofMesh key={p.id} roof={p} look={lookOf(p)} events={partEvents(p)} />
        ),
      )}
      {visibleNodes.map((n) => (n.kind || n.invalid ? <ConnectorMesh key={n.key} node={n} faded={!building && !plan.currentNodes.has(n.key)} /> : null))}

      {building && tool === 'tube' && (
        <>
          <mesh rotation-x={-Math.PI / 2} onPointerMove={(e) => show(groundCandidate(e))} onPointerOut={() => setCandidate(null)} onClick={(e) => place(e, groundCandidate(e))}>
            <planeGeometry args={[60000, 60000]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {nodes.filter(isGridNode).map((n) => (
            <mesh
              key={n.key}
              position={n.pos}
              onPointerMove={(e) => {
                e.stopPropagation();
                show(nodeCandidate(e, n));
              }}
              onClick={(e) => place(e, nodeCandidate(e, n))}
            >
              <boxGeometry args={[110, 110, 110]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          ))}
          {candidate && <TubeMesh tube={candidate.tube} look={{ color: candidate.valid ? HEX[candidate.tube.color] : '#ff2020', opacity: 0.55 }} />}
        </>
      )}

      {cells.map((c) => (
        <mesh
          key={c.key}
          position={c.pos}
          quaternion={quat(c.quat)}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHoverCell(c.key);
          }}
          onPointerOut={() => setHoverCell((k) => (k === c.key ? null : k))}
          onClick={(e) => placePanel(e, c)}
        >
          <planeGeometry args={[c.w, c.h]} />
          <meshBasicMaterial color={HEX[useStore.getState().color]} transparent opacity={hoverCell === c.key ? 0.6 : 0.1} side={DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

export function Viewport() {
  const press = useRef({ x: 0, y: 0 });
  return (
    <Canvas
      camera={{ position: [2600, 2000, 3000], fov: 40, near: 20, far: 200000 }}
      onPointerDownCapture={(e) => (press.current = { x: e.clientX, y: e.clientY })}
      onPointerMissed={(e) => {
        // Clicking empty space clears the selection, but not while adding to it or after a camera drag.
        const dragged = Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > CLICK_SLOP;
        if (e.button === 0 && !dragged && !e.shiftKey && !e.ctrlKey && !e.metaKey) useStore.getState().select(null);
      }}
    >
      <color attach="background" args={['#eef1f5']} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[3000, 6000, 2000]} intensity={2.2} />
      <directionalLight position={[-4000, 2000, -3000]} intensity={0.7} />
      <Grid position={[0, -18, 0]} infiniteGrid cellSize={GRID} sectionSize={GRID * 2} cellColor="#cfd5dd" sectionColor="#aab3bf" cellThickness={0.6} sectionThickness={1} fadeDistance={24000} fadeStrength={1.5} />
      <Scene />
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.02} minDistance={300} maxDistance={40000} />
      <CameraFit />
    </Canvas>
  );
}
