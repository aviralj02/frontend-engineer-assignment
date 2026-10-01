// The in-page agent. Loaded by the one <script> tag each page is allowed (first thing
// in <head>, so its capture listeners run before the page's own and it sees early errors).
//
// It owns everything that needs the page's DOM: hit-testing, element identity, the tree,
// geometry and input blocking. The host only renders what the agent tells it.

import {
  PROTO,
  VERSION,
  isEnvelope,
  type AgentFault,
  type AgentMessage,
  type AnyRequest,
  type Envelope,
  type HostMessage,
  type LiveInfo,
  type Mode,
  type Nid,
  type NodeInfo,
  type Rect,
  type ResultOf,
  type TreeNode,
} from "../protocol";
import { inBody, isEditable, isTreeElement, nameOf, normText, treeChildren, treeParent } from "./dom";
import { Registry } from "./identity";
import { revealInPage } from "./scroll";

declare global {
  interface Window {
    __figrAgent?: true;
  }
}

// Keys forwarded to the host in Interact mode (when not typing into the page).
const INTERACT_KEYS = new Set(["v", "i", "escape"]);
// Default actions to suppress in Select mode (R1.5): no navigation, no focus, no submit.
const SWALLOW = [
  "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu",
  "submit", "dragstart", "selectstart", "touchstart", "touchend", "keyup", "keypress", "beforeinput",
];

function start() {
  if (window.parent === window || window.__figrAgent) return;
  window.__figrAgent = true;

  const doc = Math.random().toString(36).slice(2) + Date.now().toString(36);
  let ch: string | null = null;
  let hostOrigin = "*";
  let mode: Mode = "select";
  let fault: AgentFault | null = null;
  const reg = new Registry();

  function post(msg: AgentMessage) {
    if (fault === "hang") return; // a hung script says nothing at all
    const env: Envelope<AgentMessage> = { proto: PROTO, v: VERSION, ch, ...msg };
    try {
      window.parent.postMessage(env, hostOrigin);
    } catch {
      // host gone or origin changed; nothing to do from in here
    }
  }

  // ---- session ----

  const sayHello = () => post({ kind: "hello", doc, href: location.href, title: document.title });
  sayHello();
  let helloTries = 0;
  const helloTimer = window.setInterval(() => {
    if (ch || ++helloTries > 30) window.clearInterval(helloTimer);
    else sayHello();
  }, 500);

  window.addEventListener("message", (e) => {
    if (e.source !== window.parent || !isEnvelope(e.data)) return;
    const msg = e.data as unknown as Envelope<HostMessage>;
    if (msg.kind === "init") {
      ch = msg.ch;
      hostOrigin = e.origin;
      mode = msg.mode;
      window.clearInterval(helloTimer);
      return;
    }
    if (!ch || e.origin !== hostOrigin || msg.ch !== ch) return;
    if (msg.kind === "fault") {
      fault = msg.fault;
      return;
    }
    if (fault === "hang") return; // simulate a dead script (R6.2)
    try {
      onHostMessage(msg);
    } catch (err) {
      console.error("[figr-agent]", err);
    }
  });

  function onHostMessage(msg: HostMessage) {
    switch (msg.kind) {
      case "mode":
        mode = msg.mode;
        if (mode === "interact") hovered = undefined;
        else refreshHover(true);
        return;
      case "track":
        track = { hover: msg.hover, selected: msg.selected };
        lastFrame = "";
        scheduleFrame();
        return;
      case "request":
        handleRequest(msg.id, msg.req);
        return;
      case "init":
      case "fault":
        return;
    }
  }

  // ---- page errors (R6.3) ----

  window.addEventListener("error", (e) => {
    post({ kind: "pageError", message: e.message || String(e.error) });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    post({ kind: "pageError", message: r instanceof Error ? r.message : String(r) });
  });

  // ---- pointer, hit-testing (R2) ----

  let lastPoint: { x: number; y: number } | null = null;
  let hovered: Element | null | undefined; // undefined = nothing reported yet

  // elementFromPoint, never event.target: it resolves disabled controls, SVG parts and
  // whatever is actually painted on top (a sticky header covers what's beneath it).
  function hitTest(x: number, y: number): Element | null {
    const el = document.elementFromPoint(x, y);
    return el && isTreeElement(el) && inBody(el) ? el : null;
  }

  function describe(el: Element | null) {
    return el
      ? { node: reg.info(el), path: reg.path(el), rect: rectOf(el) }
      : { node: null, path: [], rect: null };
  }

  function refreshHover(force = false) {
    if (mode !== "select" || !lastPoint || !ch) return;
    const el = hitTest(lastPoint.x, lastPoint.y);
    if (!force && el === hovered) return;
    hovered = el;
    post({ kind: "pointer", ...describe(el) });
  }

  window.addEventListener(
    "pointermove",
    (e) => {
      lastPoint = { x: e.clientX, y: e.clientY };
      refreshHover();
    },
    { capture: true, passive: true },
  );
  // Scrolling moves content under a still pointer: re-hit-test.
  window.addEventListener("scroll", () => refreshHover(), { capture: true, passive: true });
  window.addEventListener(
    "pointerout",
    (e) => {
      if (e.relatedTarget) return;
      lastPoint = null;
      hovered = undefined;
      post({ kind: "leave" });
    },
    true,
  );

  // ---- input blocking + picking (R1.5, R3.1) ----

  function swallow(e: Event) {
    if (mode !== "select") return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  window.addEventListener(
    "pointerdown",
    (e) => {
      if (mode !== "select") return;
      swallow(e);
      if (e.button !== 0 || !ch) return;
      post({ kind: "pick", ...describe(hitTest(e.clientX, e.clientY)), shift: e.shiftKey });
    },
    true,
  );
  for (const type of SWALLOW) window.addEventListener(type, swallow, true);

  // Focus can still land on a control (e.g. autofocus); in Select mode give it back.
  window.addEventListener(
    "focusin",
    (e) => {
      if (mode === "select" && e.target instanceof HTMLElement && e.target !== document.body) e.target.blur();
    },
    true,
  );

  // R3.6: after a click in the preview, focus is inside this frame, so forward shortcuts.
  window.addEventListener(
    "keydown",
    (e) => {
      const key = { key: e.key, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey };
      if (mode === "select") {
        swallow(e);
        post({ kind: "key", ...key });
      } else if (!isEditable(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey && INTERACT_KEYS.has(e.key.toLowerCase())) {
        post({ kind: "key", ...key });
      }
    },
    true,
  );

  // R1.3: Ctrl/Cmd + wheel zooms the board even over a preview. Plain wheel scrolls the page.
  window.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      post({ kind: "zoom", x: e.clientX, y: e.clientY, deltaY: e.deltaY, deltaMode: e.deltaMode });
    },
    { capture: true, passive: false },
  );

  // ---- geometry + live values (R3.4, R5.1) ----

  let track: { hover: Nid | null; selected: Nid[] } = { hover: null, selected: [] };
  let raf = 0;
  let lastFrame = "";

  function rectOf(el: Element): Rect {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  function liveOf(el: Element): LiveInfo {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      name: nameOf(el),
      tag: el.localName,
      id: el.id,
      classes: Array.from(el.classList),
      width: Math.round(r.width),
      height: Math.round(r.height),
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      text: normText(el.textContent).slice(0, 120),
      color: cs.color,
      background: cs.backgroundColor,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
    };
  }

  function scheduleFrame() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  // While anything is tracked, poll each frame and post only on change. Polling catches
  // every cause of movement (scroll anywhere, layout, animation, sticky) without
  // enumerating them; it's a handful of getBoundingClientRect calls.
  function frame() {
    raf = 0;
    const nids = new Set<Nid>(track.selected);
    if (track.hover !== null) nids.add(track.hover);
    const rects: Record<Nid, Rect | null> = {};
    for (const nid of nids) {
      const el = reg.get(nid);
      rects[nid] = el ? rectOf(el) : null;
    }
    let live: Record<Nid, LiveInfo> | null = null;
    if (track.selected.length) {
      live = {};
      for (const nid of track.selected) {
        const el = reg.get(nid);
        if (el) live[nid] = liveOf(el);
      }
    }
    const serial = JSON.stringify([rects, live]);
    if (serial !== lastFrame) {
      lastFrame = serial;
      post({ kind: "frame", rects, live });
    }
    if (nids.size) scheduleFrame();
  }

  // ---- tree + identity across re-renders (R3.7, R4.3, R4.10) ----

  /** Parents whose children the host has loaded, with the last child list we sent. */
  const loaded = new Map<Nid | null, string>();

  function parentEl(parent: Nid | null): Element | null {
    return parent === null ? document.body : reg.get(parent);
  }

  function childrenOf(parent: Nid | null): NodeInfo[] | null {
    const el = parentEl(parent);
    if (!el) return null;
    const nodes = treeChildren(el).map((c) => reg.info(c));
    loaded.set(parent, JSON.stringify(nodes));
    return nodes;
  }

  const observer = new MutationObserver((records) => {
    try {
      onMutations(records);
    } catch (err) {
      console.error("[figr-agent]", err);
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "id", "data-name", "data-key"],
  });

  function onMutations(records: MutationRecord[]) {
    const gone = reg.reconcile(records);
    if (!ch) return;
    if (gone.length) post({ kind: "gone", nids: gone });

    const updates: { parent: Nid | null; nodes: NodeInfo[] }[] = [];
    for (const [parent, last] of loaded) {
      const el = parentEl(parent);
      if (!el) {
        loaded.delete(parent);
        continue;
      }
      const nodes = treeChildren(el).map((c) => reg.info(c));
      const serial = JSON.stringify(nodes);
      if (serial !== last) {
        loaded.set(parent, serial);
        updates.push({ parent, nodes });
      }
    }
    // Always notify on structural change so an open search can refresh (R4.11).
    post({ kind: "tree", updates });
    if (hovered) refreshHover();
    scheduleFrame();
  }

  // ---- requests ----

  function handleRequest(id: number, req: AnyRequest) {
    const ok = (result: unknown) => post({ kind: "response", id, ok: true, result });
    try {
      if (fault === "throwOnRequest" && req.op !== "ping") throw new Error("Injected agent fault");
      switch (req.op) {
        case "ping":
          return ok({ ok: true } satisfies ResultOf<"ping">);
        case "children": {
          const run = () => ok({ nodes: childrenOf(req.parent) } satisfies ResultOf<"children">);
          if (fault === "slowChildren") window.setTimeout(run, 5000);
          else run();
          return;
        }
        case "reveal":
          return ok(reveal(req.nid));
        case "relative":
          return ok(relative(req.nid, req.dir));
        case "search":
          return ok(search(req.query));
        case "scrollTo": {
          const el = reg.get(req.nid);
          return ok({ scrolled: el ? revealInPage(el) : false } satisfies ResultOf<"scrollTo">);
        }
      }
    } catch (err) {
      post({ kind: "response", id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  function reveal(nid: Nid): ResultOf<"reveal"> {
    const el = reg.get(nid);
    if (!el) return null;
    const chain: (Element | null)[] = [null];
    const ancestors: Element[] = [];
    for (let p = treeParent(el); p; p = treeParent(p)) ancestors.unshift(p);
    chain.push(...ancestors);
    return {
      levels: chain.map((p) => {
        const parent = p ? reg.id(p) : null;
        return { parent, nodes: childrenOf(parent) ?? [] };
      }),
    };
  }

  function relative(nid: Nid, dir: "firstChild" | "parent" | "next" | "prev"): ResultOf<"relative"> {
    const el = reg.get(nid);
    if (!el) return null;
    let target: Element | null = null;
    if (dir === "firstChild") target = treeChildren(el)[0] ?? null;
    else if (dir === "parent") target = treeParent(el);
    else {
      const siblings = treeChildren(el.parentElement ?? document.body);
      const i = siblings.indexOf(el);
      const n = siblings.length;
      target = siblings[(i + (dir === "next" ? 1 : -1) + n) % n] ?? null;
    }
    return target ? { node: reg.info(target), path: reg.path(target) } : null;
  }

  function search(query: string): ResultOf<"search"> {
    const q = query.trim().toLowerCase();
    const nodes: TreeNode[] = [];
    const matches: Nid[] = [];
    if (!q || !document.body) return { nodes, matches };
    // DFS; a node is kept if it matches or has a kept descendant.
    const visit = (el: Element, parent: Nid | null): boolean => {
      const info = reg.info(el);
      const at = nodes.length;
      nodes.push({ ...info, parent });
      const hit = info.name.toLowerCase().includes(q);
      let keep = hit;
      for (const c of treeChildren(el)) keep = visit(c, info.nid) || keep;
      if (hit) matches.push(info.nid);
      if (!keep) nodes.length = at; // drop this node and its (unkept) subtree
      return keep;
    };
    for (const c of treeChildren(document.body)) visit(c, null);
    return { nodes, matches };
  }
}

start();
