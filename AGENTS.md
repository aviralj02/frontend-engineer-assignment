# AGENTS.md

Working rules for anyone (human or AI) building in this repo. **`BRIEF.md` is the spec** (the original assignment README). Cite requirement IDs (R3.7, R6.4, …) in commits, comments and PRs. If this file and the brief disagree, the brief wins. Record the decision under "Ambiguities" in README.md.

## What we're building

This is a design-tool viewer. The **host** (our app, served from Vite) shows 24 cross-origin iframe **previews** (`:4001`). One **agent** script is injected into every page (the only change allowed to the pages). The host never touches a page's DOM. **Every interaction goes through `postMessage`.**

## Stack and layout

- Vite + React + TypeScript (strict). Zustand for the store. No UI kit. Plain CSS modules.
- `npm run dev` starts backend, host and agent watcher with one command (`concurrently`).

```
frontend/
  src/
    protocol/      shared message types + version. Imported by host AND agent
    agent/         the in-page script, built to backend/pages/agent.js (IIFE, no deps)
    host/
      bridge/      one PreviewConnection per iframe (handshake, requests, timeouts), router, message handlers
      store/       Zustand state (index.ts) + user-intent actions (actions.ts)
      board/       grid, pan/zoom, previews, toolbar
      overlay/     hover/selection outlines + labels (screen space)
      layers/      tree panel: actions (only writer of layers state), rows (derived), panel
      inspector/   live + details
      errors/      Region boundary, failure routing/reporting, dev failure menu
  report.js        given stub. Keep the signature
backend/pages/*.html   ONLY change: one <script src="agent.js"></script>
```

The agent is served by the pages server from its own origin, so it doesn't depend on the host being up.

## Non-negotiable rules

### Host ↔ page

1. **Every message is typed** in `protocol/`: `{ v, ch, kind, id?, ... }`. `ch` is the channel/session ID. Validate `event.origin` and `event.source` on both sides. Drop anything unknown. Never throw on bad input.
2. **Handshake per page load.** The agent sends `hello`, and the host replies with `init { ch, mode }`. A new `hello` from the same iframe means **the page navigated**. Start a new session, clear that preview's selection and tree state (R3.8), and ignore every late message from the old `ch`.
3. **Requests carry an `id` and a timeout:** 3s for tree children, 10s for connect/liveness. Timed out, superseded and unmounted requests are **settled silently** (no error, no report) unless the spec calls it a failure.
4. **The agent pushes, the host renders.** The agent sends rects/tree deltas batched in one `requestAnimationFrame`. The host never polls for geometry.

### Pointer, keys, modes

5. **Hit-test with `document.elementFromPoint`**, never `event.target` (that catches disabled controls, SVG, and elements under sticky headers). `html`/`body` resolve to nothing (R2.5).
6. **In Select mode the agent swallows input** in the capture phase on `window`: pointerdown/up, click, dblclick, mousedown, submit, focusin, keydown, contextmenu. Use `preventDefault` + `stopImmediatePropagation`. In Interact mode it swallows nothing.
7. **The agent forwards** Ctrl/Cmd+wheel (with `preventDefault`, `passive:false`) and all shortcut keys to the host (R1.3, R3.6). A plain wheel is never forwarded, so it scrolls the page (R1.4).
8. **Only one hover on the whole board** lives in the host store (R2.2). Clear it on leave, blur, pan start and zoom start.

### Geometry and overlay

9. The agent reports rects in **iframe viewport coordinates**. The host maps them to screen coordinates with `previewOrigin * zoom + pan`. The overlay layer is **unscaled**, so strokes and labels are a fixed pixel size (R3.4). Clip to the preview rect. If there's no room above, put the label below.
10. The agent re-reports tracked rects on: scroll (capture, so inner scrollers count), resize, `ResizeObserver`, `MutationObserver`. It only tracks hovered + selected elements.

### Element identity (R3.7, the core of the task)

11. **The agent owns identity.** A `WeakMap<Node, nid>` assigns IDs. The host only ever holds `nid`s, never selectors or paths.
12. When a node with a tracked `nid` is removed, the agent tries to **re-bind** it to a newly inserted node by fingerprint. `data-key` is strong. Otherwise use tag + data-name/id/class + parent nid + stable text. **If there's more than one candidate or it's uncertain, the element is gone.** It must never jump to a different element. Document every uncertain case in the README's "Where this breaks".
13. Tree deltas (`added`/`removed`/`rebound`) come from the same mutation pass, so the overlay, layers and inspector never disagree.

### State

14. **One writer per slice.** The bridge writes connection/page state. User actions write selection/mode/view. Components only read and dispatch. Per-preview layer state (expanded set, scroll position) is keyed by `screenId + ch`, so it resets on navigation (R4.9).
15. Derived data (the name, visible rows, "Mixed" values) is computed in selectors, not stored.

### Failures (R6), built in from day one, not bolted on

16. Every async path goes through `request()` with an `AbortSignal` + `id`. Latest-wins is enforced by comparing the ID when the response arrives (R5.3).
17. A `<Region name screenId>` boundary wraps the board, each preview, the layers panel, each row's loader, the inspector and Details. **Errors from handlers, timers, messages and responses are routed into the owning region's `fail()`**, not only render errors (R6.5).
18. `fail()` is the **only** caller of `report()`. It de-dupes by failure instance (one report per failure, and a retry that fails is a new instance). It's a no-op if the region is unmounted (R6.6) or the cause is an abort.
19. Page errors (`error`, `unhandledrejection` in the agent) show as a "Page error" badge. They don't fail the region.
20. Treat API bodies as untrusted. Parse, then validate shape. A malformed 200 is a failure. A 404 on `/elements/:key` is **not** a failure (R5.1).

## Conventions

- Small modules and pure functions. Agent code must stay dependency-free and under ~15 KB.
- No `any` in `protocol/`. Exhaustive `switch` on `kind`.
- Comments explain *why*, and cite the requirement ID.
- Test with backend flags: `?latency=1500&fail=0.3` (the dev menu sets them for every request). Every phase is checked against pages 3, 4 and 5 (sticky/scroll, re-render, deep tree).
- Run `npm run typecheck` before calling a change done, and check the behaviour in the browser.
- Don't commit unless asked. Use conventional commit messages.

## Phases

Each phase ends with its **exit check** passing in the browser. Don't start the next phase with the current one half-done.

| # | Phase | Scope | Exit check |
|---|---|---|---|
| 0 | **Scaffold** | Vite/React/TS, Zustand, `concurrently`, agent build → `backend/pages/agent.js`, script tag in all 7 pages, `protocol/` skeleton, `Region` + `fail()`/`report` wrapper | `npm run dev` brings everything up. The agent logs `hello` in every page |
| 1 | **Bridge + agent core** | Handshake, sessions, request/response with timeouts, 10s connect timeout, navigation detection, mode switching + input swallowing, wheel/key forwarding, page-error capture | Clicking a link in Select mode does nothing. In Interact mode it navigates and the host sees a new session. V/I work after clicking inside an iframe |
| 2 | **Board** (R1) | `GET /screens` in the board region, grid 1280×800 + titles, pan (drag/wheel), zoom 25–400% around the pointer incl. over iframes, toolbar | Zoom around the pointer is stable over both empty space and previews. A `/screens` failure shows Retry |
| 3 | **Hover + selection** (R2, R3.1–3.6) | Hit-test, rect streaming, unscaled overlay, clipping, labels, shift-select rules, Escape/background clears, Enter/Shift+Enter/Tab navigation | Outlines stay attached through pan/zoom/inner scroll/resize on page 3. Disabled inputs on page 2 can be selected |
| 4 | **Identity + navigation** (R3.7–3.8, R1.5 hidden selection) | nid map, rebind by fingerprint, removal → "This element no longer exists", navigation reset | A keyed item on page 4 stays selected across ticks and never jumps. Page 6 → next resets that preview only |
| 5 | **Layers panel** (R4) | Lazy children (3s, per-row retry, no dupes on toggle), two-way hover/select sync, auto-expand path, scroll-into-view in the page only, keyboard, per-preview memory, live deltas with stable scroll, agent-side search over the full tree | Selecting level 40 on page 5 expands and scrolls to it. Page 4 updates without the list jumping |
| 6 | **Inspector** (R5) | Live computed fields pushed on change, Mixed across multiple selections, Details with latest-wins, No details / 404 states | Fast-clicking keyed elements with `latency=1500` never shows stale details |
| 7 | **Failure hardening** (R6) | Audit every async/handler path for region routing, exactly-once reports, dev failure menu (one trigger per region) | Each dev-menu trigger produces exactly one `report()` and one scoped error. Everything else keeps working |
| 8 | **Ship** | README sections (ambiguities, state, protocol, where this breaks, prior art), video outline, clean install check | A fresh clone + `npm i && npm run dev` works |
