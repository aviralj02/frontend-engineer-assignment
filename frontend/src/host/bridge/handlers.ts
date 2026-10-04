// What the host does with each agent message. Runs inside guard("preview", …), so a
// throw here becomes that preview's region error.

import type { AgentMessage } from "../../protocol";
import { previewOrigin } from "../config";
import { applyTreeUpdates, pruneGone, resetLayers } from "../layers/actions";
import { emptySelection, patchPreview, useStore } from "../store";
import {
  clearHoverFrom,
  dropGone,
  handleShortcut,
  pick,
  rememberNodes,
  setHover,
  wheelZoomFactor,
  zoomAt,
} from "../store/actions";

const get = useStore.getState;

/** A new page session: first load, navigation (R3.8) or a remounted iframe. */
export function startSession(screenId: string, ch: string, href: string) {
  patchPreview(screenId, () => ({ status: "ready", ch, href, nodes: {}, rects: {}, live: {}, pageErrors: [] }));
  // Old nids mean nothing in the new document.
  const { selection, hover } = get();
  if (hover?.screenId === screenId) useStore.setState({ hover: null });
  if (selection.screenId === screenId) useStore.setState({ selection: { ...emptySelection, screenId } });
  resetLayers(screenId);
}

export function handleAgentMessage(screenId: string, msg: AgentMessage) {
  const state = get();
  if (state.dev.throwOnMessage === screenId) {
    useStore.setState((s) => ({ dev: { ...s.dev, throwOnMessage: null } }));
    throw new Error(`Injected error while handling a "${msg.kind}" message`);
  }
  switch (msg.kind) {
    case "pointer": {
      if (state.mode !== "select" || state.gesture) return;
      if (!msg.node) return clearHoverFrom(screenId, "page");
      rememberNodes(screenId, [msg.node]);
      patchPreview(screenId, (p) => ({ rects: { ...p.rects, [msg.node!.nid]: msg.rect } }));
      setHover({ screenId, nid: msg.node.nid, source: "page", path: msg.path });
      return;
    }
    case "leave":
      // Only page-sourced hover: the pointer may already be on a layers row.
      return clearHoverFrom(screenId, "page");
    case "pick": {
      if (state.mode !== "select") return;
      if (msg.node) {
        rememberNodes(screenId, [msg.node]);
        patchPreview(screenId, (p) => ({ rects: { ...p.rects, [msg.node!.nid]: msg.rect } }));
      }
      return pick(screenId, msg.node, msg.shift);
    }
    case "key":
      handleShortcut(msg);
      return;
    case "zoom": {
      const index = state.screens?.findIndex((s) => s.id === screenId) ?? -1;
      if (index < 0) return;
      const o = previewOrigin(index);
      const { view } = state;
      zoomAt(view.x + (o.x + msg.x) * view.zoom, view.y + (o.y + msg.y) * view.zoom, wheelZoomFactor(msg.deltaY, msg.deltaMode));
      return;
    }
    case "frame": {
      // Merge, then keep only what's tracked now: a frame computed for the previous
      // tracked set must not wipe the rect a `pointer` message just delivered.
      const { hover, selection } = state;
      const keep = new Set<number>(selection.screenId === screenId ? selection.nids : []);
      if (hover?.screenId === screenId) keep.add(hover.nid);
      patchPreview(screenId, (p) => {
        const merged = { ...p.rects, ...msg.rects };
        const rects: typeof merged = {};
        for (const nid of keep) if (nid in merged) rects[nid] = merged[nid];
        return { rects, live: msg.live ?? {} };
      });
      return;
    }
    case "gone":
      dropGone(screenId, msg.nids);
      pruneGone(screenId, msg.nids);
      return;
    case "tree":
      return applyTreeUpdates(screenId, msg.updates);
    case "pageError":
      patchPreview(screenId, (p) => ({ pageErrors: [...p.pageErrors, msg.message].slice(-20) }));
      return;
    case "hello":
    case "response":
      return; // handled by the connection
  }
}
