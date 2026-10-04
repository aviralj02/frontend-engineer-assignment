import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { Nid } from "../../protocol";
import { Region } from "../errors/Region";
import { IconChevron, IconRetry, IconSearch, TagIcon } from "../icons";
import { ROOT, useStore } from "../store";
import { clearHoverFrom, selectOnly, setHover, toggleInSelection } from "../store/actions";
import { cx } from "../util";
import {
  cancelLoads,
  collapse,
  consumeReveal,
  ensureLayers,
  expand,
  loadChildren,
  recallScroll,
  rememberScroll,
  retryRow,
  scrollPageTo,
  setSearch,
} from "./actions";
import { buildRows, type Row } from "./rows";

const ROW_H = 26;
const INDENT = 14;

export function LayersPanel() {
  const screenId = useStore((s) => s.activeScreenId);
  const ch = useStore((s) => (screenId ? s.previews[screenId]?.ch : null));
  const name = useStore((s) => s.screens?.find((x) => x.id === screenId)?.name);

  return (
    <>
      <div className="panel-header">
        <span className="panel-header__title">Layers</span>
        {name && <span className="panel-header__sub">{name}</span>}
      </div>
      {!screenId || !ch ? (
        <div className="panel-empty">Click something in a preview</div>
      ) : (
        // One region per preview; a new session (navigation) starts a fresh tree (R3.8, R4.9).
        <Region key={screenId} region="layers" screenId={screenId} message="Couldn't load layers" className="region-error--panel">
          <Layers key={ch} screenId={screenId} />
        </Region>
      )}
    </>
  );
}

function Layers({ screenId }: { screenId: string }) {
  if (useStore((s) => s.dev.throwIn.layers)) throw new Error("Injected render error in the layers panel");

  const layers = useStore((s) => s.layers[screenId]);
  const nodes = useStore((s) => s.previews[screenId]?.nodes);
  const selection = useStore((s) => (s.selection.screenId === screenId ? s.selection.nids : null));
  const hover = useStore((s) => (s.hover?.screenId === screenId ? s.hover : null));
  const listRef = useRef<HTMLDivElement>(null);

  // Mount: make sure state exists and top-level rows load. Unmount (switching preview):
  // in-flight loads belong to rows that are no longer on screen, so cancel them (R6.6).
  useEffect(() => {
    ensureLayers(screenId);
    loadChildren(screenId, null);
    return () => cancelLoads(screenId);
  }, [screenId]);

  const rows = useMemo(() => (layers && nodes ? buildRows(layers, nodes) : []), [layers, nodes]);

  // Expanded rows whose children were cancelled (we left this preview mid-load): reload.
  useEffect(() => {
    for (const r of rows) if (r.kind === "loading" && r.pending) loadChildren(screenId, r.parent);
  }, [rows, screenId]);

  const selected = useMemo(() => new Set(selection ?? []), [selection]);
  const visible = useMemo(() => new Set(rows.flatMap((r) => (r.kind === "node" ? [r.nid] : []))), [rows]);

  // R4.4: preview hover highlights its row, or the nearest visible ancestor. Never expands.
  const hoveredRow = useMemo(() => {
    if (!hover) return null;
    if (visible.has(hover.nid)) return hover.nid;
    for (let i = hover.path.length - 1; i >= 0; i--) if (visible.has(hover.path[i])) return hover.path[i];
    return null;
  }, [hover, visible]);

  useScrollKeeping(listRef, screenId, rows, layers?.revealNid ?? null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (handleTreeKey(e.key, screenId, rows, selection ?? [])) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const rootList = layers?.children[ROOT];
  return (
    <div className="layers">
      <SearchBox screenId={screenId} query={layers?.search?.query ?? ""} />
      <div
        ref={listRef}
        className="layers__list"
        role="tree"
        aria-label="Layers"
        aria-multiselectable
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(e) => rememberScroll(screenId, e.currentTarget.scrollTop)}
        onMouseLeave={() => clearHoverFrom(screenId, "layers")}
      >
        {!rootList || rootList.status === "loading" ? (
          <div className="layers__note">
            <span className="spinner spinner--small" aria-hidden="true" />
            Loading layers…
          </div>
        ) : null}
        {layers?.search && layers.search.status === "ready" && rows.length === 0 ? <div className="layers__note">No matches</div> : null}
        <div className="layers__rows" style={{ minWidth: "max-content" }}>
          {rows.map((r) =>
            r.kind === "node" ? (
              <NodeRow
                key={r.nid}
                screenId={screenId}
                row={r}
                selected={selected.has(r.nid)}
                hovered={hoveredRow === r.nid}
                searching={!!layers?.search}
              />
            ) : (
              <StatusRow key={`${r.kind}:${r.parent}`} screenId={screenId} row={r} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

const NodeRow = memo(function NodeRow({
  screenId,
  row,
  selected,
  hovered,
  searching,
}: {
  screenId: string;
  row: Extract<Row, { kind: "node" }>;
  selected: boolean;
  hovered: boolean;
  searching: boolean;
}) {
  const { nid, node, depth, expanded } = row;
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (searching || !node.hasChildren) return;
    if (expanded) collapse(screenId, nid);
    else expand(screenId, nid);
  };
  return (
    <div
      className={cx("row", selected && "is-selected", hovered && "is-hovered", searching && !row.match && "is-context")}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={node.hasChildren ? expanded : undefined}
      data-nid={nid}
      style={{ paddingLeft: 8 + depth * INDENT, height: ROW_H, ["--depth" as string]: depth }}
      onMouseEnter={() => setHover({ screenId, nid, source: "layers", path: [] })}
      onClick={(e) => {
        if (e.shiftKey) toggleInSelection(screenId, nid); // R4.7
        else {
          selectOnly(screenId, nid); // R4.5
          scrollPageTo(screenId, nid); // R4.6
        }
      }}
    >
      <span className={cx("row__chevron", node.hasChildren && "has-children", expanded && "is-open")} onClick={toggle} aria-hidden>
        {node.hasChildren && <IconChevron />}
      </span>
      <span className="row__tag" title={`<${node.tag}>`}>
        <TagIcon tag={node.tag} />
      </span>
      <span className="row__name">{node.name}</span>
      {node.key && <span className="row__key" title={`data-key="${node.key}"`} aria-label="has details" />}
    </div>
  );
});

function StatusRow({ screenId, row }: { screenId: string; row: Extract<Row, { kind: "loading" | "error" }> }) {
  return (
    <div
      className={cx("row row--status", row.kind === "error" && "is-error")}
      style={{ paddingLeft: 8 + row.depth * INDENT + 20, height: ROW_H, ["--depth" as string]: row.depth }}
    >
      {row.kind === "loading" ? (
        <span className="row__loading">
          <span className="spinner spinner--small" aria-hidden="true" />
          Loading…
        </span>
      ) : (
        <>
          <span>Couldn't load</span>
          <button type="button" className="link-btn" onClick={() => retryRow(screenId, row.parent)}>
            <IconRetry />
            Retry
          </button>
        </>
      )}
    </div>
  );
}

function SearchBox({ screenId, query }: { screenId: string; query: string }) {
  return (
    <div className="layers__search">
      <IconSearch className="layers__search-icon" />
      <input
        type="search"
        placeholder="Search layers"
        value={query}
        onChange={(e) => setSearch(screenId, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            e.preventDefault();
            setSearch(screenId, "");
          }
        }}
        aria-label="Search layers"
      />
    </div>
  );
}

// ---- keyboard (R4.8) ----

function handleTreeKey(key: string, screenId: string, rows: Row[], selection: Nid[]): boolean {
  const nodeRows = rows.filter((r): r is Extract<Row, { kind: "node" }> => r.kind === "node");
  if (!nodeRows.length) return false;
  const current = selection[selection.length - 1];
  const i = nodeRows.findIndex((r) => r.nid === current);
  const select = (nid: Nid) => {
    selectOnly(screenId, nid);
    scrollPageTo(screenId, nid);
  };
  switch (key) {
    case "ArrowDown":
      select(nodeRows[i < 0 ? 0 : Math.min(nodeRows.length - 1, i + 1)].nid);
      return true;
    case "ArrowUp":
      select(nodeRows[i < 0 ? 0 : Math.max(0, i - 1)].nid);
      return true;
    case "ArrowRight": {
      if (i < 0) return true;
      const r = nodeRows[i];
      if (!r.node.hasChildren) return true;
      if (!r.expanded) expand(screenId, r.nid);
      else {
        const child = nodeRows[i + 1];
        if (child && child.parent === r.nid) select(child.nid);
      }
      return true;
    }
    case "ArrowLeft": {
      if (i < 0) return true;
      const r = nodeRows[i];
      if (r.expanded && !useStore.getState().layers[screenId]?.search) collapse(screenId, r.nid);
      else if (r.parent !== null) select(r.parent);
      return true;
    }
  }
  return false;
}

// ---- scroll: restore per preview (R4.9), hold steady on live updates (R4.10), reveal (R4.5) ----

function useScrollKeeping(ref: React.RefObject<HTMLDivElement | null>, screenId: string, rows: Row[], revealNid: Nid | null) {
  const restored = useRef(false);
  const anchor = useRef<{ nid: string; offset: number } | null>(null);

  const measureAnchor = () => {
    const list = ref.current;
    if (!list) return;
    const top = list.scrollTop;
    anchor.current = null;
    for (const el of Array.from(list.querySelectorAll<HTMLElement>(".row[data-nid]"))) {
      if (el.offsetTop + el.offsetHeight > top) {
        anchor.current = { nid: el.dataset.nid!, offset: el.offsetTop - top };
        break;
      }
    }
  };

  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    if (!restored.current) {
      if (!rows.length) return;
      restored.current = true;
      list.scrollTop = recallScroll(screenId);
    } else if (anchor.current) {
      // Keep the first visible row where it was, whatever was inserted/removed above it.
      const el = list.querySelector<HTMLElement>(`.row[data-nid="${anchor.current.nid}"]`);
      if (el) list.scrollTop = el.offsetTop - anchor.current.offset;
    }
    measureAnchor();
    rememberScroll(screenId, list.scrollTop);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const onScroll = () => measureAnchor();
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const list = ref.current;
    if (revealNid === null || !list) return;
    const el = list.querySelector<HTMLElement>(`.row[data-nid="${revealNid}"]`);
    if (!el) return; // not rendered yet; runs again when rows change
    // Scroll only the panel (never scrollIntoView: it would move other ancestors too).
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop - ROW_H;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = el.offsetTop - list.clientHeight / 2;
    const indent = parseFloat(el.style.paddingLeft) || 0;
    if (indent < list.scrollLeft || indent > list.scrollLeft + list.clientWidth - 80) list.scrollLeft = Math.max(0, indent - 40);
    measureAnchor();
    consumeReveal(screenId);
  }, [revealNid, rows]); // eslint-disable-line react-hooks/exhaustive-deps
}
