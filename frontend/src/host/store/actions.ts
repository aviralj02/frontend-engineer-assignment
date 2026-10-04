// User-intent actions: the only writers of view, mode, hover, selection and activeScreenId.

import type { Direction, KeyPayload, Mode, Nid, NodeInfo } from "../../protocol";
import { ZOOM_MAX, ZOOM_MIN } from "../config";
import { getConnection } from "../bridge";
import { failRegion } from "../errors/failures";
import { revealInLayers } from "../layers/actions";
import { emptySelection, patchPreview, useStore, type Hover } from ".";

const get = useStore.getState;
const set = useStore.setState;

// ---- nodes ----

export function rememberNodes(screenId: string, nodes: NodeInfo[]) {
  if (!nodes.length) return;
  patchPreview(screenId, (p) => {
    const next = { ...p.nodes };
    for (const n of nodes) next[n.nid] = n;
    return { nodes: next };
  });
}

// ---- mode (R1.5) ----

export function setMode(mode: Mode) {
  if (get().mode === mode) return;
  set({ mode, hover: null });
}

// ---- hover (R2) ----

export function setHover(hover: Hover | null) {
  const cur = get().hover;
  if (cur === hover) return;
  if (cur && hover && cur.screenId === hover.screenId && cur.nid === hover.nid && cur.source === hover.source) return;
  set({ hover });
}

export function clearHoverFrom(screenId: string, source?: Hover["source"]) {
  const h = get().hover;
  if (h && h.screenId === screenId && (!source || h.source === source)) set({ hover: null });
}

// ---- selection (R3) ----

export function selectOnly(screenId: string, nid: Nid) {
  set({ selection: { screenId, nids: [nid], gone: false }, activeScreenId: screenId });
  void revealInLayers(screenId, nid);
}

/** A click in a preview (R3.1–3.3). */
export function pick(screenId: string, node: NodeInfo | null, shift: boolean) {
  const { selection } = get();
  set({ activeScreenId: screenId });
  if (!node) {
    clearSelection();
    return;
  }
  if (shift && selection.screenId === screenId) {
    toggleInSelection(screenId, node.nid);
    return;
  }
  selectOnly(screenId, node.nid);
}

export function toggleInSelection(screenId: string, nid: Nid) {
  const { selection } = get();
  if (selection.screenId !== screenId) return selectOnly(screenId, nid);
  const has = selection.nids.includes(nid);
  const nids = has ? selection.nids.filter((n) => n !== nid) : [...selection.nids, nid];
  set({ selection: { screenId, nids, gone: false } });
  if (!has) void revealInLayers(screenId, nid);
}

export function clearSelection() {
  const { selection } = get();
  if (!selection.nids.length && !selection.gone) return;
  set({ selection: { ...emptySelection, screenId: selection.screenId } });
}

/** The agent says these elements no longer exist and could not be re-bound (R3.7). */
export function dropGone(screenId: string, nids: Nid[]) {
  const gone = new Set(nids);
  const { selection, hover } = get();
  if (hover && hover.screenId === screenId && gone.has(hover.nid)) set({ hover: null });
  if (selection.screenId === screenId && selection.nids.some((n) => gone.has(n))) {
    const rest = selection.nids.filter((n) => !gone.has(n));
    set({ selection: { screenId, nids: rest, gone: rest.length === 0 } });
  }
}

/** Enter / Shift+Enter / Tab / Shift+Tab, acting on the most recently selected element (R3.5).
 *  Moves are queued so fast repeated keys chain (each acts on the previous result). */
let navQueue: Promise<void> = Promise.resolve();
export function moveSelection(dir: Direction): Promise<void> {
  navQueue = navQueue.then(() => moveSelectionNow(dir));
  return navQueue;
}

async function moveSelectionNow(dir: Direction) {
  const { selection } = get();
  const last = selection.nids[selection.nids.length - 1];
  if (!selection.screenId || last === undefined) return;
  const screenId = selection.screenId;
  const conn = getConnection(screenId);
  if (!conn) return;
  let res;
  try {
    res = await conn.request({ op: "relative", nid: last, dir });
  } catch (err) {
    failRegion("preview", screenId, err); // R6.5: a failing key handler fails its preview
    return;
  }
  // The user may have selected something else while we waited: theirs wins.
  const now = get().selection;
  if (!res || now.screenId !== screenId || now.nids[now.nids.length - 1] !== last) return;
  rememberNodes(screenId, [res.node]);
  selectOnly(screenId, res.node.nid);
}

// ---- view (R1.2, R1.3) ----

export function panBy(dx: number, dy: number) {
  const { view } = get();
  set({ view: { ...view, x: view.x + dx, y: view.y + dy }, hover: null });
}

/** Zoom by `factor`, keeping the board point under (px, py) fixed on screen. */
export function zoomAt(px: number, py: number, factor: number) {
  const { view } = get();
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom * factor));
  if (zoom === view.zoom) return;
  const k = zoom / view.zoom;
  set({ view: { zoom, x: px - (px - view.x) * k, y: py - (py - view.y) * k }, hover: null });
}

export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-px * 0.0025);
}

export function setGesture(gesture: boolean) {
  if (get().gesture === gesture) return;
  set(gesture ? { gesture, hover: null } : { gesture });
}

// ---- keyboard (R1.5, R3.3, R3.5, R3.6) ----

/** Shared by the host's keydown listener and keys forwarded from previews. Returns true if handled. */
export function handleShortcut(k: KeyPayload): boolean {
  if (k.ctrl || k.meta || k.alt) return false;
  if (get().dev.throwOnKey) {
    set((s) => ({ dev: { ...s.dev, throwOnKey: false } }));
    throw new Error(`Injected error while handling the "${k.key}" key`);
  }
  const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;
  switch (key) {
    case "v":
      setMode("select");
      return true;
    case "i":
      setMode("interact");
      return true;
    case "Escape":
      clearSelection();
      return true;
  }
  if (get().mode !== "select") return false;
  switch (key) {
    case "Enter":
      void moveSelection(k.shift ? "parent" : "firstChild");
      return true;
    case "Tab":
      void moveSelection(k.shift ? "prev" : "next");
      return true;
  }
  return false;
}
