import type { LiveInfo } from "../../protocol";
import { Region } from "../errors/Region";
import { IconPointer } from "../icons";
import { useStore } from "../store";
import { cx } from "../util";
import { Details } from "./Details";

// R5. Live values are pushed by the agent for selected elements (every change, see the
// agent's frame loop); Details come from the API inside their own region.

export function Inspector() {
  const screenId = useStore((s) => s.selection.screenId ?? s.activeScreenId);
  return (
    <>
      <div className="panel-header">
        <span className="panel-header__title">Inspector</span>
      </div>
      <Region key={screenId ?? "none"} region="inspector" screenId={screenId} message="The inspector hit an error" className="region-error--panel">
        <InspectorBody />
      </Region>
    </>
  );
}

function InspectorBody() {
  if (useStore((s) => s.dev.throwIn.inspector)) throw new Error("Injected render error in the inspector");
  const selection = useStore((s) => s.selection);
  const live = useStore((s) => (s.selection.screenId ? s.previews[s.selection.screenId]?.live : undefined));

  if (selection.gone) {
    return (
      <div className="empty">
        <p className="empty__title">This element no longer exists</p>
        <p className="empty__hint">The page removed it. Select something else to inspect it.</p>
      </div>
    );
  }
  if (!selection.screenId || !selection.nids.length) {
    return (
      <div className="empty">
        <IconPointer className="empty__icon" />
        <p className="empty__title">Nothing selected</p>
        <p className="empty__hint">
          Click an element in any preview. <kbd>Shift</kbd> + click adds more.
        </p>
      </div>
    );
  }

  const values = selection.nids.map((nid) => live?.[nid]);
  if (selection.nids.length === 1) {
    const nid = selection.nids[0];
    return (
      <>
        <LiveSection values={values} />
        <Details key={`${selection.screenId}:${nid}`} screenId={selection.screenId} nid={nid} />
      </>
    );
  }
  return (
    <>
      <div className="inspector__title">
        {selection.nids.length} elements
      </div>
      <LiveSection values={values} />
    </>
  );
}

type Field = { label: string; get: (l: LiveInfo) => string; kind?: "swatch" | "code" | "num" | "text" };

const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: "Element",
    fields: [
      { label: "Name", get: (l) => l.name },
      { label: "Tag", get: (l) => l.tag, kind: "code" },
      { label: "ID", get: (l) => l.id || "—", kind: "code" },
      { label: "Classes", get: (l) => (l.classes.length ? l.classes.join(" ") : "—"), kind: "code" },
    ],
  },
  {
    title: "Box",
    fields: [
      { label: "Size", get: (l) => `${l.width} × ${l.height}`, kind: "num" },
      { label: "Position", get: (l) => `${l.x}, ${l.y}`, kind: "num" },
    ],
  },
  {
    title: "Content",
    fields: [{ label: "Text", get: (l) => l.text || "—", kind: "text" }],
  },
  {
    title: "Style",
    fields: [
      { label: "Color", get: (l) => l.color, kind: "swatch" },
      { label: "Background", get: (l) => l.background, kind: "swatch" },
      { label: "Font", get: (l) => l.fontFamily },
      { label: "Font size", get: (l) => l.fontSize, kind: "num" },
      { label: "Font weight", get: (l) => l.fontWeight, kind: "num" },
    ],
  },
];

const MIXED = "Mixed";

function LiveSection({ values }: { values: (LiveInfo | undefined)[] }) {
  const ready = values.every(Boolean);
  return (
    <section className="inspector__section">
      <h3 className="inspector__heading">
        Live
        <span className="live-dot" title="Read from the page and kept up to date" />
      </h3>
      {!ready ? (
        <div className="inspector__note">
          <span className="spinner spinner--small" aria-hidden="true" />
          Reading from the page…
        </div>
      ) : (
        GROUPS.map((g) => (
          <dl className="props" key={g.title} aria-label={g.title}>
            <div className="props__group">{g.title}</div>
            {g.fields.map((f) => {
              // R5.2: shared value, or "Mixed".
              const all = (values as LiveInfo[]).map(f.get);
              const value = all.every((v) => v === all[0]) ? all[0] : MIXED;
              const mixed = value === MIXED;
              const empty = value === "—";
              return (
                <div className="props__row" key={f.label}>
                  <dt>{f.label}</dt>
                  <dd className={cx(mixed ? "is-mixed" : empty ? "is-empty" : f.kind && `is-${f.kind}`)} title={value}>
                    {f.kind === "swatch" && !mixed && <span className="swatch" style={{ ["--swatch" as string]: value }} />}
                    <span className="props__value">{value}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        ))
      )}
    </section>
  );
}
