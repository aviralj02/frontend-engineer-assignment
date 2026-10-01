// Routes window messages to the right PreviewConnection and keeps each agent's
// tracked set (hover + selection) in sync with the store.

import { isEnvelope, type AgentMessage, type Envelope } from "../../protocol";
import { PAGES_ORIGIN } from "../config";
import { failRegion, guard } from "../errors/failures";
import { useStore } from "../store";
import { PreviewConnection } from "./connection";
import { handleAgentMessage, startSession } from "./handlers";

const connections = new Map<string, PreviewConnection>();

export function getConnection(screenId: string): PreviewConnection | undefined {
  return connections.get(screenId);
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("message", (e) => {
    if (e.origin !== PAGES_ORIGIN || !isEnvelope(e.data)) return;
    for (const conn of connections.values()) {
      if (conn.window === e.source) {
        conn.receive(e.data as unknown as Envelope<AgentMessage>);
        return;
      }
    }
  });

  useStore.subscribe((s, prev) => {
    if (s.mode !== prev.mode) for (const c of connections.values()) c.send({ kind: "mode", mode: s.mode });
    if (s.hover !== prev.hover || s.selection !== prev.selection || s.previews !== prev.previews) syncTracking();
  });
}

export function connect(screenId: string, iframe: HTMLIFrameElement): PreviewConnection {
  listen();
  connections.get(screenId)?.dispose();
  const conn = new PreviewConnection(screenId, iframe, () => useStore.getState().mode, {
    // Every message handler runs inside the preview's region (R6.5).
    onSession: guard("preview", screenId, (ch, hello) => startSession(screenId, ch, hello.href)),
    onMessage: guard("preview", screenId, (msg) => handleAgentMessage(screenId, msg)),
    onDead: (err) => failRegion("preview", screenId, err),
  });
  connections.set(screenId, conn);
  lastTrack.delete(screenId);
  return conn;
}

export function disconnect(screenId: string, conn: PreviewConnection) {
  conn.dispose();
  if (connections.get(screenId) === conn) connections.delete(screenId);
}

const lastTrack = new Map<string, string>();

function syncTracking() {
  const { hover, selection } = useStore.getState();
  for (const [screenId, conn] of connections) {
    if (!conn.ch) continue;
    const h = hover && hover.screenId === screenId ? hover.nid : null;
    const selected = selection.screenId === screenId ? selection.nids : [];
    const key = `${conn.ch}|${h}|${selected.join(",")}`;
    if (lastTrack.get(screenId) === key) continue;
    lastTrack.set(screenId, key);
    conn.send({ kind: "track", hover: h, selected });
  }
}
