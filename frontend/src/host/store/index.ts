// The host's state. One store, sliced by owner (AGENTS rule 14):
//   previews[*]  written by the bridge (connection + what the agent streams)
//   layers[*]    written by layers actions; keyed per preview and reset per session (R4.9)
//   view, mode, hover, selection, activeScreenId  written by user-action handlers
//   dev          written by the dev menu
// Components read with selectors and call actions; they never set state directly.

import { create } from "zustand";
import type { LiveInfo, Mode, Nid, NodeInfo, Rect, TreeNode } from "../../protocol";
import type { Screen } from "../api";

export interface PreviewState {
  status: "connecting" | "ready";
  /** Session id; changes when the page navigates. */
  ch: string | null;
  href: string | null;
  pageErrors: string[];
  /** Every node this session has told us about, for labels and the tree. */
  nodes: Record<Nid, NodeInfo>;
  rects: Record<Nid, Rect | null>;
  live: Record<Nid, LiveInfo>;
}

export const ROOT = "root";
/** Parent key in `children`: ROOT for <body>, else the parent's nid. */
export type ParentKey = string;
export const parentKey = (parent: Nid | null): ParentKey => (parent === null ? ROOT : String(parent));

export interface ChildList {
  status: "loading" | "loaded" | "error";
  ids: Nid[];
  /** Id of the request whose answer we'll accept; anything else is stale. */
  token: number;
}

export interface LayersState {
  ch: string;
  children: Record<ParentKey, ChildList>;
  expanded: Record<Nid, true>;
  /** Row to scroll into view once rendered (set by reveal, cleared by the panel). */
  revealNid: Nid | null;
  search: {
    query: string;
    status: "idle" | "loading" | "ready";
    nodes: TreeNode[];
    matches: Nid[];
  } | null;
}

export interface Hover {
  screenId: string;
  nid: Nid;
  /** Where the hover came from: the page (pointer) or a layers row. */
  source: "page" | "layers";
  /** Ancestor path, top-level first, for highlighting the nearest visible row (R4.4). */
  path: Nid[];
}

export interface Selection {
  screenId: string | null;
  /** In selection order; the last one is "most recently selected" (R3.5). */
  nids: Nid[];
  /** Everything selected disappeared: inspector says "This element no longer exists" (R3.7). */
  gone: boolean;
}

export interface DevState {
  api: { latency: number; failRate: number };
  /** Bumped to reload the whole board (refetch /screens). */
  boardGeneration: number;
  failNextScreens: boolean;
  failNextDetails: boolean;
  /** Previews whose next mount loads a URL with no agent, to exercise the 10s timeout. */
  brokenPreviews: Record<string, true>;
  /** Bumped per preview to remount its iframe. */
  previewGeneration: Record<string, number>;
  /** One-shot render errors, per region. `overlay` holds the screen whose outlines throw. */
  throwIn: { inspector: boolean; layers: boolean; overlay: string | null };
  /** One-shot errors in non-render code paths (R6.5). */
  throwOnMessage: string | null;
  throwOnKey: boolean;
  open: boolean;
}

export interface State {
  screens: Screen[] | null;
  mode: Mode;
  view: { x: number; y: number; zoom: number };
  /** True while the board is being panned/zoomed; hover is suppressed (R2.3). */
  gesture: boolean;
  previews: Record<string, PreviewState>;
  layers: Record<string, LayersState>;
  hover: Hover | null;
  selection: Selection;
  activeScreenId: string | null;
  dev: DevState;
}

export const emptySelection: Selection = { screenId: null, nids: [], gone: false };

export const useStore = create<State>()(() => ({
  screens: null,
  mode: "select",
  view: { x: 40, y: 80, zoom: 0.3 },
  gesture: false,
  previews: {},
  layers: {},
  hover: null,
  selection: emptySelection,
  activeScreenId: null,
  dev: {
    api: { latency: 0, failRate: 0 },
    boardGeneration: 0,
    failNextScreens: false,
    failNextDetails: false,
    brokenPreviews: {},
    previewGeneration: {},
    throwIn: { inspector: false, layers: false, overlay: null },
    throwOnMessage: null,
    throwOnKey: false,
    open: false,
  },
}));

export function newPreview(): PreviewState {
  return { status: "connecting", ch: null, href: null, pageErrors: [], nodes: {}, rects: {}, live: {} };
}

/** Immutable update of one preview's slice. No-op if the preview isn't registered. */
export function patchPreview(screenId: string, fn: (p: PreviewState) => Partial<PreviewState>) {
  useStore.setState((s) => {
    const p = s.previews[screenId];
    if (!p) return s;
    return { previews: { ...s.previews, [screenId]: { ...p, ...fn(p) } } };
  });
}
