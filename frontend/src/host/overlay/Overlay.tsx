import type { Nid, Rect } from "../../protocol";
import { PREVIEW_H, PREVIEW_W, previewOrigin } from "../config";
import { ForwardErrors } from "../errors/ForwardErrors";
import { useStore } from "../store";
import { cx } from "../util";

// Screen-space layer over the board. Nothing here is scaled by zoom, so strokes and
// labels keep a fixed pixel size at every zoom (R3.4). Positions follow the board:
//   screen = view.xy + (previewOrigin + pageRect) * zoom
// Each preview gets a clip box the size of the preview on screen, so outlines are cut
// at its edges and anything scrolled out of the page simply isn't visible.

const LABEL_H = 18;
const LABEL_GAP = 2;

export function Overlay() {
  const screens = useStore((s) => s.screens) ?? [];
  const view = useStore((s) => s.view);
  const activeScreenId = useStore((s) => s.activeScreenId);

  return (
    <div className="overlay">
      {screens.map((screen, i) => {
        const o = previewOrigin(i);
        const box = {
          left: view.x + o.x * view.zoom,
          top: view.y + o.y * view.zoom,
          width: PREVIEW_W * view.zoom,
          height: PREVIEW_H * view.zoom,
        };
        return (
          <div key={screen.id}>
            <div className={cx("preview-title", screen.id === activeScreenId && "is-active")} style={{ left: box.left, top: box.top, width: box.width }}>
              <span className="preview-title__name">{screen.name}</span>
              <PageErrorBadge screenId={screen.id} />
            </div>
            {/* Drawing belongs to the preview: a throw here fails that preview only (R6.5). */}
            <PreviewOutlines screenId={screen.id} box={box} zoom={view.zoom} />
          </div>
        );
      })}
    </div>
  );
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function PreviewOutlines(props: { screenId: string; box: Box; zoom: number }) {
  const ch = useStore((s) => s.previews[props.screenId]?.ch ?? "none");
  return (
    <ForwardErrors key={ch} region="preview" screenId={props.screenId}>
      <Outlines {...props} />
    </ForwardErrors>
  );
}

function Outlines({ screenId, box, zoom }: { screenId: string; box: Box; zoom: number }) {
  const mode = useStore((s) => s.mode);
  const hover = useStore((s) => (s.hover?.screenId === screenId ? s.hover.nid : null));
  const selection = useStore((s) => (s.selection.screenId === screenId ? s.selection.nids : null));
  const preview = useStore((s) => s.previews[screenId]);
  if (useStore((s) => s.dev.throwIn.overlay === screenId)) throw new Error("Injected error while drawing outlines");

  // Interact mode hides outlines; the selection is kept and comes back (R1.5).
  if (mode !== "select" || !preview || (hover === null && !selection?.length)) return null;

  const items: { nid: Nid; kind: "hover" | "select" }[] = [];
  for (const nid of selection ?? []) items.push({ nid, kind: "select" });
  if (hover !== null) items.push({ nid: hover, kind: "hover" });
  const selected = new Set(selection ?? []);

  return (
    <div className="clip" style={box}>
      {items.map(({ nid, kind }) => {
        const r = preview.rects[nid];
        if (!r) return null;
        // Hovering an already selected element: its selection label is enough.
        const showLabel = kind === "select" || !selected.has(nid);
        return (
          <Outline
            key={`${kind}:${nid}`}
            kind={kind}
            rect={r}
            zoom={zoom}
            clipH={box.height}
            label={showLabel ? (preview.nodes[nid]?.name ?? "") : null}
          />
        );
      })}
    </div>
  );
}

function Outline({ kind, rect, zoom, clipH, label }: { kind: "hover" | "select"; rect: Rect; zoom: number; clipH: number; label: string | null }) {
  const left = Math.round(rect.x * zoom);
  const top = Math.round(rect.y * zoom);
  const width = Math.max(1, Math.round((rect.x + rect.w) * zoom) - left);
  const height = Math.max(1, Math.round((rect.y + rect.h) * zoom) - top);
  // Fully outside the preview: no outline, but it stays selected (R3.4).
  if (left + width < 0 || top + height < 0 || top > clipH) return null;
  // Label above; below the element when there's no room above inside the preview.
  const above = top - LABEL_H - LABEL_GAP >= 0;
  const labelTop = above ? top - LABEL_H - LABEL_GAP : top + height + LABEL_GAP;
  return (
    <>
      <div className={`outline outline--${kind}`} style={{ left, top, width, height }} />
      {label !== null && (
        <div className={`outline-label outline-label--${kind}`} style={{ left: Math.max(0, left), top: labelTop }}>
          {label}
        </div>
      )}
    </>
  );
}

function PageErrorBadge({ screenId }: { screenId: string }) {
  const errors = useStore((s) => s.previews[screenId]?.pageErrors);
  if (!errors?.length) return null;
  return (
    <span className="page-badge" tabIndex={0} aria-label={`Page error: ${errors[errors.length - 1]}`}>
      Page error{errors.length > 1 ? ` ×${errors.length}` : ""}
      <span className="page-badge__tip" role="tooltip">
        {errors.slice(-5).map((m, i) => (
          <span key={i}>{m}</span>
        ))}
      </span>
    </span>
  );
}
