import { useEffect } from "react";
import { Board } from "./board/Board";
import { Toolbar } from "./board/Toolbar";
import { DevMenu } from "./errors/DevMenu";
import { Inspector } from "./inspector/Inspector";
import { LayersPanel } from "./layers/LayersPanel";
import { useStore } from "./store";
import { failRegion } from "./errors/failures";
import { handleShortcut } from "./store/actions";
import { isTypingTarget } from "./util";

export function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Let text fields keep their keys, except Escape.
      if (isTypingTarget(e.target) && e.key !== "Escape") return;
      // Arrow keys etc. inside the layers panel are handled there (R4.8).
      if (e.defaultPrevented) return;
      try {
        if (handleShortcut({ key: e.key, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey })) {
          e.preventDefault();
        }
      } catch (err) {
        // R6.5: a key handler error fails the region it acted on.
        const { selection } = useStore.getState();
        if (selection.screenId) failRegion("preview", selection.screenId, err);
        else failRegion("board", null, err);
      }
    };
    // R2.3: hover clears when the pointer leaves the window.
    const onLeave = () => useStore.setState({ hover: null });
    window.addEventListener("keydown", onKey);
    document.documentElement.addEventListener("mouseleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <aside className="sidebar sidebar--left">
          <LayersPanel />
        </aside>
        <Board />
        <aside className="sidebar sidebar--right">
          <Inspector />
        </aside>
      </div>
      <DevMenu />
    </div>
  );
}
