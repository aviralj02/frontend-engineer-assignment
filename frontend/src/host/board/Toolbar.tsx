import { IconFlask, IconHand, IconMinus, IconPlus, IconPointer } from "../icons";
import { useStore } from "../store";
import { setMode, zoomAt } from "../store/actions";
import { cx } from "../util";

export function Toolbar() {
  const mode = useStore((s) => s.mode);
  const zoom = useStore((s) => s.view.zoom);
  const devOpen = useStore((s) => s.dev.open);

  const zoomCentre = (factor: number) => {
    const board = document.querySelector(".board")?.getBoundingClientRect();
    if (board) zoomAt(board.width / 2, board.height / 2, factor);
  };

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <svg className="toolbar__mark" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="1" y="1" width="18" height="18" rx="5" fill="currentColor" />
          <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray="2.2 1.6" />
          <rect x="8.25" y="8.25" width="3.5" height="3.5" rx="0.75" fill="#fff" />
        </svg>
        <span>Figr Viewer</span>
      </div>

      <div className={cx("segmented", mode === "interact" && "is-second")} role="radiogroup" aria-label="Mode">
        <span className="segmented__thumb" aria-hidden="true" />
        <button
          type="button"
          role="radio"
          aria-checked={mode === "select"}
          className={cx("segmented__btn", mode === "select" && "is-on")}
          onClick={() => setMode("select")}
          title="Select elements (V)"
        >
          <IconPointer />
          Select <kbd>V</kbd>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "interact"}
          className={cx("segmented__btn", mode === "interact" && "is-on")}
          onClick={() => setMode("interact")}
          title="Use the pages (I)"
        >
          <IconHand />
          Interact <kbd>I</kbd>
        </button>
      </div>

      <div className="toolbar__spacer" />

      <div className="zoom" role="group" aria-label="Zoom">
        <button type="button" className="icon-btn" onClick={() => zoomCentre(1 / 1.25)} aria-label="Zoom out" title="Zoom out (Ctrl + wheel)">
          <IconMinus />
        </button>
        <output className="zoom__value" aria-live="polite">
          {Math.round(zoom * 100)}%
        </output>
        <button type="button" className="icon-btn" onClick={() => zoomCentre(1.25)} aria-label="Zoom in" title="Zoom in (Ctrl + wheel)">
          <IconPlus />
        </button>
      </div>

      <button
        type="button"
        className={cx("btn btn--quiet", devOpen && "is-on")}
        aria-pressed={devOpen}
        onClick={() => useStore.setState((s) => ({ dev: { ...s.dev, open: !s.dev.open } }))}
      >
        <IconFlask />
        Dev failures
      </button>
    </header>
  );
}
