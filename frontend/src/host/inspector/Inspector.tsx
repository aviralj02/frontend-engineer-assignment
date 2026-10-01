import type { LiveInfo } from "../../protocol";
import { Region } from "../errors/Region";
import { useStore } from "../store";
import { Details } from "./Details";

// R5. Live values are pushed by the agent for selected elements (every change, see the
// agent's frame loop); Details come from the API inside their own region.

export function Inspector() {
  const screenId = useStore((s) => s.selection.screenId ?? s.activeScreenId);
  return (
    <>
      <div className="panel-header">
        <span>Inspector</span>
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

  if (selection.gone) return <div className="panel-empty">This element no longer exists</div>;
  if (!selection.screenId || !selection.nids.length) return <div className="panel-empty">Nothing selected</div>;

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
      <div className="inspector__title">{selection.nids.length} elements</div>
      <LiveSection values={values} />
    </>
  );
}

type Field = { label: string; get: (l: LiveInfo) => string; swatch?: boolean; mono?: boolean };

const FIELDS: Field[] = [
  { label: "Name", get: (l) => l.name },
  { label: "Tag", get: (l) => l.tag, mono: true },
  { label: "ID", get: (l) => l.id || "—", mono: true },
  { label: "Classes", get: (l) => (l.classes.length ? l.classes.join(" ") : "—"), mono: true },
  { label: "Size", get: (l) => `${l.width} × ${l.height}` },
  { label: "Position", get: (l) => `${l.x}, ${l.y}` },
  { label: "Text", get: (l) => l.text || "—" },
  { label: "Color", get: (l) => l.color, swatch: true },
  { label: "Background", get: (l) => l.background, swatch: true },
  { label: "Font", get: (l) => l.fontFamily },
  { label: "Font size", get: (l) => l.fontSize },
  { label: "Font weight", get: (l) => l.fontWeight },
];

const MIXED = "Mixed";

function LiveSection({ values }: { values: (LiveInfo | undefined)[] }) {
  const ready = values.every(Boolean);
  return (
    <section className="inspector__section">
      <h3 className="inspector__heading">Live</h3>
      {!ready ? (
        <div className="inspector__note">Reading from the page…</div>
      ) : (
        <dl className="props">
          {FIELDS.map((f) => {
            // R5.2: shared value, or "Mixed".
            const all = (values as LiveInfo[]).map(f.get);
            const value = all.every((v) => v === all[0]) ? all[0] : MIXED;
            return (
              <div className="props__row" key={f.label}>
                <dt>{f.label}</dt>
                <dd className={f.mono ? "is-mono" : undefined} title={value}>
                  {f.swatch && value !== MIXED && <span className="swatch" style={{ background: value }} />}
                  {value}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}

