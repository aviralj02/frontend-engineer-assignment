import { useLayoutEffect, useRef, useState } from "react";
import type { Screen } from "../api";
import { connect, disconnect } from "../bridge";
import { PREVIEW_H, PREVIEW_W, PAGES_ORIGIN, previewOrigin } from "../config";
import { Region } from "../errors/Region";
import { newPreview, useStore } from "../store";

// One preview = one region (R6.1). Retry remounts the iframe and opens a new connection.

export function Preview({ screen, index }: { screen: Screen; index: number }) {
  const o = previewOrigin(index);
  const generation = useStore((s) => s.dev.previewGeneration[screen.id] ?? 0);
  return (
    <div className="preview" style={{ left: o.x, top: o.y, width: PREVIEW_W, height: PREVIEW_H }}>
      <Region region="preview" screenId={screen.id} message="Couldn't connect to this preview" className="region-error--preview">
        <PreviewFrame key={generation} screen={screen} />
      </Region>
    </div>
  );
}

function PreviewFrame({ screen }: { screen: Screen }) {
  const ref = useRef<HTMLIFrameElement>(null);
  // Dev menu: load a page with no agent once, to exercise the connect timeout.
  const [src] = useState(() =>
    useStore.getState().dev.brokenPreviews[screen.id] ? `${PAGES_ORIGIN}/missing-${screen.id}.html` : screen.url,
  );

  useLayoutEffect(() => {
    const id = screen.id;
    clearBrokenFlag(id);
    useStore.setState((s) => ({ previews: { ...s.previews, [id]: newPreview() } }));
    const conn = connect(id, ref.current!);
    return () => {
      disconnect(id, conn);
      useStore.setState((s) => {
        const { [id]: _, ...previews } = s.previews;
        const { [id]: __, ...layers } = s.layers;
        return {
          previews,
          layers,
          hover: s.hover?.screenId === id ? null : s.hover,
          selection: s.selection.screenId === id ? { screenId: null, nids: [], gone: false } : s.selection,
          activeScreenId: s.activeScreenId === id ? null : s.activeScreenId,
        };
      });
    };
  }, [screen.id]);

  return <iframe ref={ref} className="preview__frame" data-screen-id={screen.id} src={src} title={screen.name} width={PREVIEW_W} height={PREVIEW_H} />;
}

function clearBrokenFlag(screenId: string) {
  if (!useStore.getState().dev.brokenPreviews[screenId]) return;
  useStore.setState((s) => {
    const { [screenId]: _, ...rest } = s.dev.brokenPreviews;
    return { dev: { ...s.dev, brokenPreviews: rest } };
  });
}
