// One PreviewConnection per iframe. Owns the session handshake, request/response with
// timeouts, and liveness. It knows nothing about selection or the tree; it hands
// messages to `handlers` and reports death via `onDead`.
//
// Lifecycle:
//   mount ──hello──▶ init(ch1) ── ready ──(page navigates)── hello(new doc) ──▶ init(ch2) ...
//   No hello within 10s, or a ping unanswered for 10s ⇒ dead (R6.2).
//   Messages carrying an old ch are dropped, so a slow reply from the previous page
//   can never touch the new session.

import {
  PROTO,
  VERSION,
  type AgentMessage,
  type Envelope,
  type HostMessage,
  type Mode,
  type Op,
  type RequestOf,
  type ResultOf,
} from "../../protocol";
import { CONNECT_TIMEOUT_MS, PAGES_ORIGIN, PING_INTERVAL_MS, REQUEST_TIMEOUT_MS } from "../config";
import { Cancelled } from "../errors/failures";

export class TimeoutError extends Error {
  override name = "TimeoutError";
}

/** The page never connected, or its script stopped answering (R6.2). */
export class ConnectionError extends Error {
  override name = "ConnectionError";
}

export interface ConnectionEvents {
  /** A new page session started (first load or navigation). */
  onSession(ch: string, hello: Extract<AgentMessage, { kind: "hello" }>, isNavigation: boolean): void;
  onMessage(msg: AgentMessage): void;
  onDead(err: Error): void;
}

interface Pending {
  resolve(v: unknown): void;
  reject(e: unknown): void;
  timer: number;
  cleanup(): void;
}

let sessionCounter = 0;

export class PreviewConnection {
  ch: string | null = null;
  private doc: string | null = null;
  private reqSeq = 0;
  private pending = new Map<number, Pending>();
  private startedAt = Date.now();
  private pingOutstandingSince: number | null = null;
  private watchdog: number;
  private dead = false;
  private lastPingAt = 0;

  constructor(
    readonly screenId: string,
    private readonly iframe: HTMLIFrameElement,
    private readonly getMode: () => Mode,
    private readonly events: ConnectionEvents,
  ) {
    this.watchdog = window.setInterval(() => {
      // R6.5: an error thrown in a timer fails this preview like any other failure.
      try {
        this.tick();
      } catch (err) {
        this.dispose();
        this.events.onDead(err instanceof Error ? err : new Error(String(err)));
      }
    }, 500);
  }

  /** Dev menu: make the next watchdog tick throw. */
  injectTimerFault() {
    this.timerFault = true;
  }
  private timerFault = false;

  get window(): Window | null {
    return this.iframe.contentWindow;
  }

  /** Called by the router for every envelope whose source is this iframe. */
  receive(msg: Envelope<AgentMessage>) {
    if (this.dead) return;
    if (msg.kind === "hello") {
      if (msg.doc === this.doc && this.ch) {
        // Same document re-sent hello before our init arrived: just re-init.
        this.send({ kind: "init", mode: this.getMode() });
        return;
      }
      const isNavigation = this.doc !== null;
      this.doc = msg.doc;
      this.ch = `${this.screenId}#${++sessionCounter}`;
      this.pingOutstandingSince = null;
      this.rejectAll(new Cancelled("page navigated"));
      this.send({ kind: "init", mode: this.getMode() });
      this.events.onSession(this.ch, msg, isNavigation);
      return;
    }
    if (!this.ch || msg.ch !== this.ch) return; // stale session
    this.pingOutstandingSince = null; // any message proves the agent is alive
    if (msg.kind === "response") {
      const p = this.pending.get(msg.id);
      if (!p) return; // cancelled or timed out already
      this.pending.delete(msg.id);
      p.cleanup();
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
      return;
    }
    this.events.onMessage(msg);
  }

  send(msg: HostMessage) {
    const win = this.window;
    if (!win || this.dead) return;
    const env: Envelope<HostMessage> = { proto: PROTO, v: VERSION, ch: this.ch, ...msg };
    win.postMessage(env, PAGES_ORIGIN);
  }

  request<O extends Op>(
    req: RequestOf<O>,
    opts: { timeout?: number; signal?: AbortSignal } = {},
  ): Promise<ResultOf<O>> {
    return new Promise((resolve, reject) => {
      if (this.dead) return reject(new Cancelled("connection closed"));
      if (!this.ch) return reject(new Cancelled("not connected"));
      if (opts.signal?.aborted) return reject(new Cancelled());
      const id = ++this.reqSeq;
      const onAbort = () => {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        p.cleanup();
        reject(new Cancelled());
      };
      const timer = window.setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        cleanup();
        reject(new TimeoutError(`"${req.op}" got no answer within ${opts.timeout ?? REQUEST_TIMEOUT_MS}ms`));
      }, opts.timeout ?? REQUEST_TIMEOUT_MS);
      const cleanup = () => {
        window.clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
      };
      opts.signal?.addEventListener("abort", onAbort);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, cleanup });
      this.send({ kind: "request", id, req: req as never });
    });
  }

  dispose() {
    this.dead = true;
    window.clearInterval(this.watchdog);
    this.rejectAll(new Cancelled("preview closed"));
  }

  private rejectAll(err: Error) {
    for (const p of this.pending.values()) {
      p.cleanup();
      p.reject(err);
    }
    this.pending.clear();
  }

  private tick() {
    if (this.timerFault) {
      this.timerFault = false;
      throw new Error("Injected error in the preview's watchdog timer");
    }
    const now = Date.now();
    if (!this.ch) {
      if (now - this.startedAt > CONNECT_TIMEOUT_MS) this.die("The preview's script did not connect within 10s");
      return;
    }
    if (this.pingOutstandingSince !== null) {
      if (now - this.pingOutstandingSince > CONNECT_TIMEOUT_MS) this.die("The preview's script stopped responding");
      return;
    }
    if (now - this.lastPingAt >= PING_INTERVAL_MS) {
      this.lastPingAt = now;
      this.pingOutstandingSince = now;
      this.send({ kind: "request", id: 0, req: { op: "ping" } });
    }
  }

  private die(message: string) {
    if (this.dead) return;
    this.dispose();
    this.events.onDead(new ConnectionError(message));
  }
}
