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
      <div className="toolbar__brand">Figr Viewer</div>
      <div className="segmented" role="radiogroup" aria-label="Mode">
        <button
          type="button"
          role="radio"
          aria-checked={mode === "select"}
          className={cx("segmented__btn", mode === "select" && "is-on")}
          onClick={() => setMode("select")}
          title="Select (V)"
        >
          Select <kbd>V</kbd>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "interact"}
          className={cx("segmented__btn", mode === "interact" && "is-on")}
          onClick={() => setMode("interact")}
          title="Interact (I)"
        >
          Interact <kbd>I</kbd>
        </button>
      </div>
      <div className="toolbar__zoom">
        <button type="button" className="btn btn--ghost" onClick={() => zoomCentre(1 / 1.25)} aria-label="Zoom out">
          −
        </button>
        <span className="toolbar__zoom-value">{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn btn--ghost" onClick={() => zoomCentre(1.25)} aria-label="Zoom in">
          +
        </button>
      </div>
      <div className="toolbar__spacer" />
      <button
        type="button"
        className={cx("btn btn--ghost", devOpen && "is-on")}
        onClick={() => useStore.setState((s) => ({ dev: { ...s.dev, open: !s.dev.open } }))}
      >
        Dev failures
      </button>
    </header>
  );
}
