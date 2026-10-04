import { useEffect, useState } from "react";
import type { AgentFault } from "../../protocol";
import { getConnection } from "../bridge";
import { IconClose, IconFlask } from "../icons";
import { useStore, type DevState } from "../store";
import { onReport } from "./failures";

// R6.7: trigger every failure on demand. Each button drives the real code path (a real
// failing request, a real dead agent, a real throw in render / handler / timer); nothing
// here calls report() or sets an error state directly.

const set = useStore.setState;
const patchDev = (fn: (d: DevState) => Partial<DevState>) => set((s) => ({ dev: { ...s.dev, ...fn(s.dev) } }));

/** One-shot flags reset on the next tick, so Retry renders normally. */
function oneShot(fn: (d: DevState) => Partial<DevState>, reset: (d: DevState) => Partial<DevState>) {
  patchDev(fn);
  window.setTimeout(() => patchDev(reset), 50);
}

interface LogEntry {
  n: number;
  region: string;
  screenId: string | null;
  elementKey?: string;
  message: string;
}

export function DevMenu() {
  const open = useStore((s) => s.dev.open);
  const api = useStore((s) => s.dev.api);
  const target = useStore((s) => s.activeScreenId ?? s.screens?.[0]?.id ?? null);
  const targetName = useStore((s) => s.screens?.find((x) => x.id === target)?.name);
  const [faults, setFaults] = useState<Record<string, AgentFault | null>>({});
  const [log, setLog] = useState<LogEntry[]>([]);

  useEffect(() => {
    let n = 0;
    return onReport((err, ctx) => setLog((l) => [{ n: ++n, ...ctx, message: err.message }, ...l].slice(0, 30)));
  }, []);

  if (!open) return null;

  const fault = (f: AgentFault) => {
    if (!target) return;
    const next = faults[target] === f ? null : f;
    getConnection(target)?.send({ kind: "fault", fault: next });
    setFaults((x) => ({ ...x, [target]: next }));
  };
  const reloadPreview = (broken: boolean) => {
    if (!target) return;
    patchDev((d) => ({
      brokenPreviews: broken ? { ...d.brokenPreviews, [target]: true } : d.brokenPreviews,
      previewGeneration: { ...d.previewGeneration, [target]: (d.previewGeneration[target] ?? 0) + 1 },
    }));
    setFaults((x) => ({ ...x, [target]: null }));
  };

  return (
    <aside className="devmenu" aria-label="Dev failure menu">
      <div className="devmenu__head">
        <IconFlask />
        <strong>Dev failures</strong>
        <span className="devmenu__sub">Every trigger runs the real code path</span>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => patchDev((d) => ({ open: !d.open }))}>
          <IconClose />
        </button>
      </div>

      <Group title="Board">
        <Btn onClick={() => patchDev((d) => ({ failNextScreens: true, boardGeneration: d.boardGeneration + 1 }))}>Reload board with GET /screens failing</Btn>
      </Group>

      <Group title={`Preview · ${targetName ?? "—"}`}>
        <Btn onClick={() => reloadPreview(true)}>Load a page that never connects (10s)</Btn>
        <Btn on={target ? faults[target] === "hang" : false} onClick={() => fault("hang")}>
          Script stops responding (10s)
        </Btn>
        <Btn onClick={() => target && oneShot(() => ({ throwOnMessage: target }), () => ({}))}>Throw in next message handler</Btn>
        <Btn onClick={() => target && getConnection(target)?.injectTimerFault()}>Throw in watchdog timer</Btn>
        <Btn onClick={() => target && oneShot((d) => ({ throwIn: { ...d.throwIn, overlay: target } }), (d) => ({ throwIn: { ...d.throwIn, overlay: null } }))}>
          Throw while drawing outlines
        </Btn>
        <Btn onClick={() => patchDev(() => ({ throwOnKey: true }))}>Throw on next shortcut key</Btn>
      </Group>

      <Group title="Layers">
        <Btn onClick={() => oneShot((d) => ({ throwIn: { ...d.throwIn, layers: true } }), (d) => ({ throwIn: { ...d.throwIn, layers: false } }))}>
          Throw while rendering the panel
        </Btn>
        <Btn on={target ? faults[target] === "slowChildren" : false} onClick={() => fault("slowChildren")}>
          Row loads take 5s (time out at 3s)
        </Btn>
        <Btn on={target ? faults[target] === "throwOnRequest" : false} onClick={() => fault("throwOnRequest")}>
          Agent errors on every request
        </Btn>
      </Group>

      <Group title="Inspector">
        <Btn onClick={() => patchDev(() => ({ failNextDetails: true }))}>Fail the next details request</Btn>
        <Btn onClick={() => oneShot((d) => ({ throwIn: { ...d.throwIn, inspector: true } }), (d) => ({ throwIn: { ...d.throwIn, inspector: false } }))}>
          Throw while rendering the inspector
        </Btn>
      </Group>

      <Group title="API (all requests)">
        <label className="devmenu__slider">
          <span>Latency {api.latency}ms</span>
          <input type="range" min={0} max={3000} step={100} value={api.latency} onChange={(e) => patchDev((d) => ({ api: { ...d.api, latency: Number(e.target.value) } }))} />
        </label>
        <label className="devmenu__slider">
          <span>Fail rate {Math.round(api.failRate * 100)}%</span>
          <input type="range" min={0} max={1} step={0.1} value={api.failRate} onChange={(e) => patchDev((d) => ({ api: { ...d.api, failRate: Number(e.target.value) } }))} />
        </label>
      </Group>

      <Group title={`report() calls · ${log.length}`}>
        <ol className="devmenu__log">
          {log.map((e) => (
            <li key={e.n}>
              <code>
                #{e.n} {e.region}
                {e.screenId ? ` · ${e.screenId}` : ""}
                {e.elementKey ? ` · ${e.elementKey}` : ""}
              </code>
              <span>{e.message}</span>
            </li>
          ))}
        </ol>
      </Group>
    </aside>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="devmenu__group">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Btn({ on, onClick, children }: { on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`devmenu__btn${on ? " is-on" : ""}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}
