import { useEffect, useRef, useState } from "react";
import { fetchScreens } from "../api";
import { Region, useRegion } from "../errors/Region";
import { Overlay } from "../overlay/Overlay";
import { useStore } from "../store";
import { clearSelection, panBy, setGesture, wheelZoomFactor, zoomAt } from "../store/actions";
import { Preview } from "./Preview";

// R1 board: the region that owns GET /screens and the pan/zoom surface.

export function Board() {
  const generation = useStore((s) => s.dev.boardGeneration);
  return (
    <main className="board-shell">
      <Region key={generation} region="board" screenId={null} className="region-error--board" onRetry={resetBoard}>
        <BoardContent />
      </Region>
    </main>
  );
}

function resetBoard() {
  // A board reload forgets everything per preview (R4.9 "until ... the board reloads").
  useStore.setState({ screens: null, previews: {}, layers: {}, hover: null, activeScreenId: null, selection: { screenId: null, nids: [], gone: false } });
}

function BoardContent() {
  const { fail } = useRegion();
  const screens = useStore((s) => s.screens);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    const forceFail = useStore.getState().dev.failNextScreens;
    if (forceFail) useStore.setState((s) => ({ dev: { ...s.dev, failNextScreens: false } }));
    resetBoard();
    setLoading(true);
    fetchScreens(ac.signal, forceFail)
      .then((list) => {
        if (ac.signal.aborted) return;
        useStore.setState({ screens: list });
        setLoading(false);
      })
      .catch(fail);
    return () => ac.abort();
  }, [fail]);

  if (loading || !screens) return <div className="board-status">Loading screens…</div>;
  return <Viewport />;
}

function Viewport() {
  const ref = useRef<HTMLDivElement>(null);
  const screens = useStore((s) => s.screens)!;
  const view = useStore((s) => s.view);
  const { fail } = useRegion();

  // Wheel over empty board: pan, or zoom with Ctrl/Cmd (R1.2, R1.3). Non-passive so we
  // can stop the browser's own page zoom. Wheel over a preview never reaches us; the
  // agent forwards Ctrl+wheel from there.
  useEffect(() => {
    const el = ref.current!;
    let settle = 0;
    const onWheel = (e: WheelEvent) => {
      try {
        e.preventDefault();
        setGesture(true);
        window.clearTimeout(settle);
        settle = window.setTimeout(() => setGesture(false), 150);
        const r = el.getBoundingClientRect();
        if (e.ctrlKey || e.metaKey) {
          zoomAt(e.clientX - r.left, e.clientY - r.top, wheelZoomFactor(e.deltaY, e.deltaMode));
        } else {
          const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
          const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
          const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
          panBy(-dx * unit, -dy * unit);
        }
      } catch (err) {
        fail(err);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(settle);
    };
  }, [fail]);

  // Drag on empty board pans; a click without movement clears the selection (R3.3).
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    // Controls on the board (a preview's Retry, the page-error badge) keep their clicks:
    // pointer capture would retarget the click to the board.
    if ((e.target as HTMLElement).closest("button, a, input, .page-badge, .region-error")) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    if (!d.moved) setGesture(true);
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    panBy(dx, dy);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.moved) setGesture(false);
    else if (e.button === 0) clearSelection();
  };

  return (
    <div
      ref={ref}
      className="board"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="world"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          ["--inv-zoom" as string]: String(1 / view.zoom),
        }}
      >
        {screens.map((screen, i) => (
          <Preview key={screen.id} screen={screen} index={i} />
        ))}
      </div>
      <Overlay />
    </div>
  );
}
