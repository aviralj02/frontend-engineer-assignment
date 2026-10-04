// Host <-> agent protocol. Imported by both sides; the agent bundles it into its IIFE.
// Every message is an envelope `{ proto, v, ch, ...body }`.
//   ch: the session id the host assigned in `init`. A page load is one session;
//       a new `hello` from the same iframe means the page navigated (R3.8).

export const PROTO = "figr-agent";
export const VERSION = 1;

/** Element id, assigned by the agent and stable across re-renders it can prove (R3.7). */
export type Nid = number;
export type Mode = "select" | "interact";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NodeInfo {
  nid: Nid;
  name: string;
  tag: string;
  key: string | null;
  hasChildren: boolean;
}

/** A node plus its parent, for flat tree payloads (search, reveal). `parent: null` = child of <body>. */
export interface TreeNode extends NodeInfo {
  parent: Nid | null;
}

export interface LiveInfo {
  name: string;
  tag: string;
  id: string;
  classes: string[];
  width: number;
  height: number;
  x: number;
  y: number;
  text: string;
  color: string;
  background: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
}

export type Direction = "firstChild" | "parent" | "next" | "prev";

/** Faults the dev menu can inject into an agent (R6.7). */
export type AgentFault = "hang" | "slowChildren" | "throwOnRequest";

// ---- requests (host -> agent, answered with `response`) ----

export interface Requests {
  ping: { req: {}; res: { ok: true } };
  /** Children of `parent` (null = <body>). `nodes: null` when the parent no longer exists. */
  children: { req: { parent: Nid | null }; res: { nodes: NodeInfo[] | null } };
  /** Every ancestor's child list, top-down, so the host can expand a deep path in one round trip (R4.5). */
  reveal: {
    req: { nid: Nid };
    res: { levels: { parent: Nid | null; nodes: NodeInfo[] }[] } | null;
  };
  relative: { req: { nid: Nid; dir: Direction }; res: { node: NodeInfo; path: Nid[] } | null };
  /** Whole-tree search, including rows the host never loaded (R4.11). */
  search: { req: { query: string }; res: { nodes: TreeNode[]; matches: Nid[] } };
  scrollTo: { req: { nid: Nid }; res: { scrolled: boolean } };
}

export type Op = keyof Requests;
export type RequestOf<O extends Op> = { op: O } & Requests[O]["req"];
export type ResultOf<O extends Op> = Requests[O]["res"];
export type AnyRequest = { [O in Op]: RequestOf<O> }[Op];

// ---- host -> agent ----

export type HostMessage =
  | { kind: "init"; mode: Mode }
  | { kind: "mode"; mode: Mode }
  /** Which elements the agent should stream rects (and live info) for. */
  | { kind: "track"; hover: Nid | null; selected: Nid[] }
  | { kind: "request"; id: number; req: AnyRequest }
  | { kind: "fault"; fault: AgentFault | null };

// ---- agent -> host ----

export interface KeyPayload {
  key: string;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

export type AgentMessage =
  /** Sent (and retried) until `init`. `doc` is unique per document, so a repeated hello
   *  from the same document is not mistaken for a navigation. */
  | { kind: "hello"; doc: string; href: string; title: string }
  | { kind: "response"; id: number; ok: true; result: unknown }
  | { kind: "response"; id: number; ok: false; error: string }
  /** Pointer moved onto a different element (Select mode). `node: null` = page background. */
  | { kind: "pointer"; node: NodeInfo | null; path: Nid[]; rect: Rect | null }
  /** Pointer left the page. */
  | { kind: "leave" }
  /** Click in Select mode. `node: null` = page background. */
  | { kind: "pick"; node: NodeInfo | null; path: Nid[]; rect: Rect | null; shift: boolean }
  | ({ kind: "key" } & KeyPayload)
  /** Ctrl/Cmd + wheel, in iframe client coordinates (R1.3). */
  | { kind: "zoom"; x: number; y: number; deltaY: number; deltaMode: number }
  /** Rects for tracked elements (null = not rendered / gone) and live info for selected ones. */
  | { kind: "frame"; rects: Record<Nid, Rect | null>; live: Record<Nid, LiveInfo> | null }
  /** Elements that no longer exist and could not be re-bound. */
  | { kind: "gone"; nids: Nid[] }
  /** New child lists for parents the host has loaded (R4.10). */
  | { kind: "tree"; updates: { parent: Nid | null; nodes: NodeInfo[] }[] }
  | { kind: "pageError"; message: string };

export type Envelope<T> = T & { proto: typeof PROTO; v: typeof VERSION; ch: string | null };

export function isEnvelope(data: unknown): data is Envelope<{ kind: string }> {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { proto?: unknown }).proto === PROTO &&
    (data as { v?: unknown }).v === VERSION &&
    typeof (data as { kind?: unknown }).kind === "string"
  );
}
