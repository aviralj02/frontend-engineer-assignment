// Derives the visible row list from layers state (AGENTS rule 15: derived, not stored).

import type { Nid, NodeInfo } from "../../protocol";
import { ROOT, type LayersState } from "../store";

export type Row =
  | { kind: "node"; nid: Nid; parent: Nid | null; depth: number; node: NodeInfo; expanded: boolean; match: boolean }
  /** An expanded row whose children are loading (or not requested yet: `pending`). */
  | { kind: "loading"; parent: Nid; depth: number; pending: boolean }
  | { kind: "error"; parent: Nid; depth: number };

export function buildRows(layers: LayersState, nodes: Record<Nid, NodeInfo>): Row[] {
  return layers.search ? searchRows(layers.search, nodes) : treeRows(layers, nodes);
}

function treeRows(layers: LayersState, nodes: Record<Nid, NodeInfo>): Row[] {
  const rows: Row[] = [];
  const walk = (key: string, parent: Nid | null, depth: number) => {
    const list = layers.children[key];
    if (!list) return;
    for (const nid of list.ids) {
      const node = nodes[nid];
      if (!node) continue;
      const expanded = !!layers.expanded[nid] && node.hasChildren;
      rows.push({ kind: "node", nid, parent, depth, node, expanded, match: false });
      if (!expanded) continue;
      const sub = layers.children[String(nid)];
      if (!sub || sub.status === "loading") rows.push({ kind: "loading", parent: nid, depth: depth + 1, pending: !sub });
      else if (sub.status === "error") rows.push({ kind: "error", parent: nid, depth: depth + 1 });
      else walk(String(nid), nid, depth + 1);
    }
  };
  walk(ROOT, null, 0);
  return rows;
}

function searchRows(search: NonNullable<LayersState["search"]>, nodes: Record<Nid, NodeInfo>): Row[] {
  const depth = new Map<Nid, number>();
  const matches = new Set(search.matches);
  const shownParents = new Set(search.nodes.map((n) => n.parent));
  const rows: Row[] = [];
  for (const n of search.nodes) {
    const d = n.parent === null ? 0 : (depth.get(n.parent) ?? 0) + 1;
    depth.set(n.nid, d);
    rows.push({
      kind: "node",
      nid: n.nid,
      parent: n.parent,
      depth: d,
      node: nodes[n.nid] ?? n,
      expanded: shownParents.has(n.nid),
      match: matches.has(n.nid),
    });
  }
  return rows;
}
