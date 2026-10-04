// Layers panel actions (R4). The only writers of `layers[*]`.
//
// Child lists are cached per parent and fetched on first expand. Each load carries a
// token; a reply is applied only if its token is still current, so collapse/re-expand
// (even mid-load) can't duplicate or lose rows (R4.3). A collapse cancels the load —
// that's the user moving on, not a failure (R6.4).

import type { Nid, NodeInfo } from "../../protocol";
import { getConnection } from "../bridge";
import { CHILDREN_TIMEOUT_MS } from "../config";
import { failRegion, isCancel, reportFailure } from "../errors/failures";
import { parentKey, useStore, type ChildList, type LayersState, type ParentKey } from "../store";
import { rememberNodes } from "../store/actions";

const get = useStore.getState;

let tokenSeq = 0;
const inflight = new Map<string, AbortController>(); // `${screenId}|${parentKey}`

/** Panel scroll positions, per preview session. Not in the store: scrolling shouldn't re-render. */
const scrollMemory = new Map<string, number>();

export function rememberScroll(screenId: string, top: number) {
  const ch = get().layers[screenId]?.ch;
  if (ch) scrollMemory.set(ch, top);
}
export function recallScroll(screenId: string): number {
  const ch = get().layers[screenId]?.ch;
  return (ch && scrollMemory.get(ch)) || 0;
}

function patchLayers(screenId: string, fn: (l: LayersState) => Partial<LayersState>) {
  useStore.setState((s) => {
    const l = s.layers[screenId];
    if (!l) return s;
    return { layers: { ...s.layers, [screenId]: { ...l, ...fn(l) } } };
  });
}

function setChildList(screenId: string, key: ParentKey, list: ChildList | null) {
  patchLayers(screenId, (l) => {
    const children = { ...l.children };
    if (list) children[key] = list;
    else delete children[key];
    return { children };
  });
}

/** Make sure the preview has layers state for its current session (R4.9: reset on navigation). */
export function ensureLayers(screenId: string): LayersState | null {
  const s = get();
  const ch = s.previews[screenId]?.ch;
  if (!ch) return null;
  const cur = s.layers[screenId];
  if (cur?.ch === ch) return cur;
  const fresh: LayersState = { ch, children: {}, expanded: {}, search: null, revealNid: null };
  useStore.setState({ layers: { ...s.layers, [screenId]: fresh } });
  return fresh;
}

export function resetLayers(screenId: string): void {
  cancelLoads(screenId);
  useStore.setState((s) => {
    if (!s.layers[screenId]) return s;
    const { [screenId]: _, ...layers } = s.layers;
    return { layers };
  });
}

/** Cancel every in-flight load for a preview and forget the half-loaded lists. Used when
 *  the panel stops showing that preview: those row regions are gone (R6.6). */
export function cancelLoads(screenId: string) {
  const prefix = `${screenId}|`;
  for (const [k, ac] of inflight) {
    if (!k.startsWith(prefix)) continue;
    ac.abort();
    inflight.delete(k);
  }
  patchLayers(screenId, (l) => {
    const children: Record<ParentKey, ChildList> = {};
    for (const [k, v] of Object.entries(l.children)) if (v.status === "loaded") children[k] = v;
    return { children };
  });
}

export function loadChildren(screenId: string, parent: Nid | null, opts: { force?: boolean } = {}) {
  const layers = ensureLayers(screenId);
  const conn = getConnection(screenId);
  if (!layers || !conn) return;
  const key = parentKey(parent);
  const cur = layers.children[key];
  if (cur && (cur.status === "loading" || (cur.status === "loaded" && !opts.force))) return;

  const token = ++tokenSeq;
  const ch = layers.ch;
  const flightKey = `${screenId}|${key}`;
  inflight.get(flightKey)?.abort();
  const ac = new AbortController();
  inflight.set(flightKey, ac);
  setChildList(screenId, key, { status: "loading", ids: cur?.ids ?? [], token });

  const isCurrent = () => {
    const l = get().layers[screenId];
    return !!l && l.ch === ch && l.children[key]?.token === token;
  };

  conn
    .request({ op: "children", parent }, { timeout: CHILDREN_TIMEOUT_MS, signal: ac.signal })
    .then((res) => {
      if (!isCurrent()) return;
      if (res.nodes === null) return setChildList(screenId, key, null); // parent vanished; `gone` will prune it
      rememberNodes(screenId, res.nodes);
      setChildList(screenId, key, { status: "loaded", ids: res.nodes.map((n) => n.nid), token });
    })
    .catch((err) => {
      if (isCancel(err) || !isCurrent()) return;
      if (parent === null) {
        // Top-level rows are the panel itself: fail the layers region.
        setChildList(screenId, key, null);
        failRegion("layers", screenId, err);
        return;
      }
      // R4.3 / R6.2: the row shows "Couldn't load" + retry. One report per failed attempt.
      setChildList(screenId, key, { status: "error", ids: [], token });
      reportFailure(err, { region: "layers-row", screenId });
    })
    .finally(() => {
      if (inflight.get(flightKey) === ac) inflight.delete(flightKey);
    });
}

export function expand(screenId: string, nid: Nid) {
  patchLayers(screenId, (l) => ({ expanded: { ...l.expanded, [nid]: true } }));
  loadChildren(screenId, nid);
}

export function collapse(screenId: string, nid: Nid) {
  const key = parentKey(nid);
  const flightKey = `${screenId}|${key}`;
  const list = get().layers[screenId]?.children[key];
  if (list && list.status !== "loaded") {
    inflight.get(flightKey)?.abort();
    inflight.delete(flightKey);
    setChildList(screenId, key, null);
  }
  patchLayers(screenId, (l) => {
    const { [nid]: _, ...expanded } = l.expanded;
    return { expanded };
  });
}

export function retryRow(screenId: string, nid: Nid) {
  setChildList(screenId, parentKey(nid), null);
  loadChildren(screenId, nid);
}

/** Live child-list changes from the agent (R4.10). */
export function applyTreeUpdates(screenId: string, updates: { parent: Nid | null; nodes: NodeInfo[] }[]): void {
  const layers = get().layers[screenId];
  if (layers?.search?.query) scheduleSearch(screenId);
  if (!layers || !updates.length) return;
  const all: NodeInfo[] = [];
  const changed: Record<ParentKey, ChildList> = {};
  for (const { parent, nodes } of updates) {
    const key = parentKey(parent);
    const cur = layers.children[key];
    if (!cur || cur.status !== "loaded") continue;
    all.push(...nodes);
    changed[key] = { ...cur, ids: nodes.map((n) => n.nid) };
  }
  rememberNodes(screenId, all);
  if (Object.keys(changed).length) patchLayers(screenId, (l) => ({ children: { ...l.children, ...changed } }));
}

/** Elements that no longer exist: drop their expanded state and child lists. */
export function pruneGone(screenId: string, nids: Nid[]) {
  const layers = get().layers[screenId];
  if (!layers) return;
  const gone = new Set(nids.map(String));
  const hit = nids.some((n) => layers.expanded[n] || layers.children[String(n)]);
  if (!hit) return;
  patchLayers(screenId, (l) => {
    const expanded = { ...l.expanded };
    const children = { ...l.children };
    for (const k of gone) {
      delete expanded[Number(k)];
      delete children[k];
    }
    return { expanded, children };
  });
}

/** Expand every ancestor of `nid` (loading as needed, any depth) and scroll its row into view (R4.5). */
export async function revealInLayers(screenId: string, nid: Nid): Promise<void> {
  const layers = ensureLayers(screenId);
  const conn = getConnection(screenId);
  if (!layers || !conn) return;
  const ch = layers.ch;
  let res;
  try {
    res = await conn.request({ op: "reveal", nid });
  } catch (err) {
    if (get().layers[screenId]?.ch === ch) failRegion("layers", screenId, err);
    return;
  }
  const l = get().layers[screenId];
  if (!res || !l || l.ch !== ch) return;
  // While searching, the tree shown is the search result; leave the normal tree's
  // expanded state untouched so clearing the search restores it exactly (R4.11).
  if (l.search) return patchLayers(screenId, () => ({ revealNid: nid }));
  const children = { ...l.children };
  const expanded = { ...l.expanded };
  const nodes: NodeInfo[] = [];
  for (const level of res.levels) {
    const key = parentKey(level.parent);
    // Supersede any in-flight load for this parent: the reveal answer is newer.
    inflight.get(`${screenId}|${key}`)?.abort();
    children[key] = { status: "loaded", ids: level.nodes.map((n) => n.nid), token: ++tokenSeq };
    if (level.parent !== null) expanded[level.parent] = true;
    nodes.push(...level.nodes);
  }
  rememberNodes(screenId, nodes);
  patchLayers(screenId, () => ({ children, expanded, revealNid: nid }));
}

export function consumeReveal(screenId: string) {
  patchLayers(screenId, () => ({ revealNid: null }));
}

/** Clicking a row scrolls only that page to the element if it's out of view (R4.6). */
export function scrollPageTo(screenId: string, nid: Nid) {
  getConnection(screenId)
    ?.request({ op: "scrollTo", nid })
    .catch((err) => failRegion("preview", screenId, err));
}

// ---- search (R4.11) ----

const searchTimers = new Map<string, number>();
const searchAborts = new Map<string, AbortController>();

export function setSearch(screenId: string, query: string) {
  const layers = ensureLayers(screenId);
  if (!layers) return;
  if (!query) {
    searchAborts.get(screenId)?.abort();
    window.clearTimeout(searchTimers.get(screenId));
    // Clearing restores the tree exactly: we never touched `expanded` while searching.
    patchLayers(screenId, () => ({ search: null }));
    return;
  }
  patchLayers(screenId, (l) => ({
    search: { query, status: "loading", nodes: l.search?.nodes ?? [], matches: l.search?.matches ?? [] },
  }));
  scheduleSearch(screenId, 120);
}

function scheduleSearch(screenId: string, delay = 300) {
  window.clearTimeout(searchTimers.get(screenId));
  searchTimers.set(screenId, window.setTimeout(() => void runSearch(screenId), delay));
}

async function runSearch(screenId: string) {
  const l = get().layers[screenId];
  const conn = getConnection(screenId);
  const query = l?.search?.query;
  if (!l || !conn || !query) return;
  searchAborts.get(screenId)?.abort();
  const ac = new AbortController();
  searchAborts.set(screenId, ac);
  try {
    const res = await conn.request({ op: "search", query }, { signal: ac.signal });
    const now = get().layers[screenId];
    if (!now || now.ch !== l.ch || now.search?.query !== query) return; // replaced
    rememberNodes(screenId, res.nodes);
    patchLayers(screenId, () => ({ search: { query, status: "ready", nodes: res.nodes, matches: res.matches } }));
  } catch (err) {
    if (get().layers[screenId]?.search?.query === query) failRegion("layers", screenId, err);
  }
}
