import { useEffect, useState } from "react";
import type { Nid } from "../../protocol";
import { fetchElementDetails, NO_DETAILS, type ElementDetails } from "../api";
import { Region, useRegion } from "../errors/Region";
import { useStore } from "../store";

// R5.1 Details, its own failure region (R6.1). Keyed by element from the parent, so a
// new selection unmounts the old one: its request is aborted (a cancel, never reported)
// and only the latest selection's answer can ever render (R5.3).

export function Details({ screenId, nid }: { screenId: string; nid: Nid }) {
  const key = useStore((s) => s.previews[screenId]?.nodes[nid]?.key ?? null);
  return (
    <section className="inspector__section">
      <h3 className="inspector__heading">Details</h3>
      {key === null ? (
        <div className="inspector__note">No details</div>
      ) : (
        <Region key={key} region="details" screenId={screenId} elementKey={key} message="Couldn't load details" className="region-error--inline">
          <DetailsBody elementKey={key} />
        </Region>
      )}
    </section>
  );
}

type Loaded = { status: "loading" } | { status: "none" } | { status: "ok"; data: ElementDetails };

function DetailsBody({ elementKey }: { elementKey: string }) {
  const { fail } = useRegion();
  const [state, setState] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    const ac = new AbortController();
    const forceFail = useStore.getState().dev.failNextDetails;
    if (forceFail) useStore.setState((s) => ({ dev: { ...s.dev, failNextDetails: false } }));
    setState({ status: "loading" });
    fetchElementDetails(elementKey, ac.signal, forceFail)
      .then((res) => {
        if (ac.signal.aborted) return;
        setState(res === NO_DETAILS ? { status: "none" } : { status: "ok", data: res });
      })
      .catch((err) => {
        if (!ac.signal.aborted) fail(err);
      });
    return () => ac.abort();
  }, [elementKey, fail]);

  if (state.status === "loading") return <div className="inspector__note">Loading…</div>;
  if (state.status === "none") return <div className="inspector__note">No details for this element</div>;
  const d = state.data;
  return (
    <dl className="props">
      <div className="props__row">
        <dt>Component</dt>
        <dd>{d.component}</dd>
      </div>
      <div className="props__row">
        <dt>Description</dt>
        <dd className="is-wrap">{d.description}</dd>
      </div>
      <div className="props__row">
        <dt>Status</dt>
        <dd>
          <span className={`status status--${d.status.replace(/[^a-z-]/gi, "")}`}>{d.status}</span>
        </dd>
      </div>
      <div className="props__row">
        <dt>Owner</dt>
        <dd>{d.owner}</dd>
      </div>
    </dl>
  );
}
