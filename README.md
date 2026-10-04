# Figr Viewer: frontend engineer assignment

This is a viewer for a design-tool board: 24 live, **cross-origin** page previews. You can hover and select any element in them, browse each page's element tree, and inspect computed values and API details. Failures stay inside the region they happen in.

Brief: [doc.figr.design/frontend-engineer](https://doc.figr.design/frontend-engineer) · How it works, in plain language: [`ARCHITECTURE.md`](ARCHITECTURE.md) · Working rules: [`AGENTS.md`](AGENTS.md)

```bash
npm install
npm run dev          # API :4000, pages :4001, app http://localhost:5173 (also builds and watches the agent)
npm run typecheck
```

Open **Dev failures** in the toolbar to trigger every failure in R6 on demand. It also shows a live log of `report()` calls.

---

## The shape of it

```
┌──────────── host (localhost:5173, React) ─────────────┐      ┌──── page (localhost:4001) ────┐
│ store (Zustand)  ◀── bridge/handlers ◀── connection ◀─┼─ postMessage ─┤ agent.js (one <script>)   │
│   │                                       ▲           │      │  hit-testing, identity,       │
│   ▼                                       │           │      │  tree, geometry, input block  │
│ board · overlay · layers · inspector ── actions ──────┼─ postMessage ─▶                         │
└───────────────────────────────────────────────────────┘      └───────────────────────────────┘
```

The host never touches a page's DOM, and it can't, because the pages are on another origin. Everything that needs the DOM lives in the **agent** (`frontend/src/agent`). It's built to `backend/pages/agent.js` and loaded by the one `<script src="agent.js">` tag each page is allowed. That tag is the first thing in `<head>`, so the agent's capture listeners run before the page's own and it catches errors from the page's first script onwards. The agent is served from the page's own origin, so it doesn't depend on the host being up.

The agent **pushes** and the host **renders**. The host says what it cares about (`track`: hover + selection). The agent streams geometry and live values for exactly those elements, and only when something changed.

## How state is organised

All shared state lives in one Zustand store, `frontend/src/host/store`. Each slice has a single owner that writes it. Components only read through selectors and call actions.

| Slice | What it holds | Who writes it |
|---|---|---|
| `previews[screenId]` | session `ch`, URL, page errors, `nodes` (every NodeInfo seen this session), `rects`, `live` | `bridge/handlers` (agent messages) and `Preview` mount/unmount |
| `layers[screenId]` | per-session child lists `{status, ids, token}`, expanded set, search, pending reveal | `layers/actions` only |
| `view`, `mode`, `gesture` | board transform, Select/Interact | `store/actions` (user input) |
| `hover` | **one** hover for the whole board: `{screenId, nid, source: page \| layers, path}` | `store/actions` |
| `selection` | `{screenId, nids (in selection order), gone}` | `store/actions` |
| `activeScreenId` | the preview last clicked in Select mode | `store/actions` |
| `screens` | `GET /screens` result | the board region |
| `dev` | failure triggers | dev menu |

A few rules:
- **Derived data is never stored.** The visible row list, the nearest-visible-ancestor for hover, "Mixed" values and outline positions are all computed in render or `useMemo`.
- **Per-request state stays local.** The Details fetch lives in its component and is aborted on unmount. The layers panel's scroll position is kept in a module map keyed by session, because writing it to the store on every scroll event would re-render the panel.
- **Selection holds nids, never selectors or paths.** A nid is only meaningful inside the session (`ch`) that created it, which is why a new session wipes that preview's selection, hover and layers.

## Host ↔ page protocol

Types are in `frontend/src/protocol`, imported by both sides. Every message is `{ proto: "figr-agent", v: 1, ch, kind, … }`. Both sides check `event.source` and `event.origin` and drop anything they don't recognise.

**Session handshake**
1. The agent sends `hello {doc, href}` and repeats it every 500 ms until it gets `init` (in case it loaded before the host was listening). `doc` is random per document.
2. The host replies `init {mode}` with a new `ch` in the envelope. From then on, both sides drop any message whose `ch` isn't the current one.
3. A `hello` with a **new** `doc` from the same iframe means **the page navigated** (R3.8). The host starts a new session, clears that preview's selection, hover and layers, and rejects in-flight requests as cancelled. A repeated hello from the same `doc` just gets `init` again.

**Host → agent**: `init`, `mode`, `track {hover, selected}`, `request {id, op}`, `fault` (dev menu only).

**Agent → host**
- Events: `pointer` (the element under the pointer changed), `leave`, `pick` (click), `key` (forwarded shortcuts, R3.6), `zoom` (Ctrl/Cmd+wheel over a page, R1.3), `pageError`.
- Streams: `frame {rects, live}` for tracked elements only; `gone {nids}`; `tree {updates}` (new child lists for parents the host has loaded).
- Replies: `response {id, ok, result | error}`.

**Requests** (with timeouts): `ping`, `children` (3 s, R4.3), `reveal` (every ancestor's children in one round trip, R4.5), `relative` (Enter/Tab navigation), `search` (whole tree, R4.11), `scrollTo` (R4.6; scrolls only inside the page, never with `scrollIntoView`, which can scroll the host too).

**When one side is slow, gone or replaced**

| Situation | What happens |
|---|---|
| No `hello` within 10 s of mount (404, wrong page, dead script) | That preview fails: "Couldn't connect to this preview" + Retry. One report. |
| A `ping` (every 2 s) goes unanswered for 10 s | Same. The dev menu's "Script stops responding" makes the agent go completely silent. |
| Page navigates | New session. Old pending requests are rejected as `Cancelled`. Late replies carry the old `ch` and are dropped. |
| A request times out | It rejects with `TimeoutError`, and its owner decides whether that's a failure (a row's "Couldn't load") or not. |
| The request is superseded (collapse mid-load, new selection, new search) | Aborted with `Cancelled`: nothing shown, nothing reported. |
| Preview unmounts or retries | The connection is disposed and everything pending is cancelled. |
| The agent loads before the host listens | It keeps sending `hello` until it gets `init`. |

**Input in Select mode.** The agent swallows input in the capture phase on `window`: pointer/mouse/click/submit/key/drag events get `preventDefault` + `stopImmediatePropagation`, and anything that still gets focus is blurred. **Selection happens on `pointerdown`, not `click`**, because browsers don't fire `click` on disabled controls (R2.4). Hit-testing uses `document.elementFromPoint`, never `event.target`, so disabled inputs, SVG parts and elements under a sticky header resolve to whatever is actually painted at that point.

**Geometry.** The agent reports `getBoundingClientRect()` in iframe viewport coordinates. While anything is tracked, it polls those few rects every animation frame and posts only when they change. That covers every cause of movement (page scroll, inner scroll areas, layout, animation, resize) without listing them all. The overlay sits in **screen space**, outside the zoomed world: `screen = view + (previewOrigin + rect) × zoom`. Strokes and labels are therefore always 1 or 2 px at any zoom, and each preview gets a clip box so outlines are cut at its edges.

## Element identity across re-renders (R3.7)

The agent owns identity. Each element gets a nid through a `WeakMap<Element, nid>`, and the host only ever sees nids. When a bound element leaves the DOM, the `MutationObserver` batch that removed it is used to try to **re-bind** the nid to a node inserted in that same batch:

1. **`data-key`**: exactly one connected, unbound element with the same key and tag.
2. **Otherwise, structure**: re-bind the old parent first (recursively), then look among the *newly inserted* children of the new parent for exactly one with the same signature. At the same time, exactly one lost sibling must have had that signature. Signatures, strictest first: `tag + all attributes + text`, then the same with digits masked, so `"6s ago"` → `"8s ago"` still matches.
3. Anything else (zero candidates, or two or more) means **the element is gone**. It's removed from the selection, and if nothing is left, the inspector says "This element no longer exists".

So a selection can disappear, but it never moves to a different element, except in the cases listed under "where this breaks". Page 4 (full `innerHTML` rebuild every 2 s, new items inserted on top, keyed and unkeyed rows mixed) keeps keyed and unkeyed selections, and even a `span` inside an unkeyed `li`. Two identical unkeyed siblings being rebuilt **drop** the selection rather than guessing.

## The layers tree

- **Lazy loading.** Each parent's child list is fetched on first expand. Every load carries a `token`, and a reply is applied only if its token is still current. Child lists are *replaced*, never appended, so collapse/expand spam can't duplicate or lose rows. Collapsing a row that is still loading aborts the load (the user moved on: no error, no report). A 3 s timeout shows "Couldn't load" + Retry on that row only, with one `layers-row` report per failed attempt.
- **Deep reveal.** Selecting in the preview sends one `reveal` request that returns every ancestor's child list. The host expands them all at once (page 5's deepest element is 33 levels down), then the panel scrolls itself (never with `scrollIntoView`) to the row.
- **Live updates.** The agent remembers which parents the host has loaded and pushes a new child list when one changes. The panel keeps the first visible row at the same pixel offset across updates (manual scroll anchoring), so rows inserted above don't push what you're looking at.
- **Search.** This runs in the agent over the *whole* tree, including rows never loaded, and returns matches plus their ancestors. Search results are rendered from their own list, so the normal tree's expanded state is never touched, and clearing the search restores it exactly. While a search is open, it re-runs on DOM changes.
- **Memory.** Expanded state, child lists and scroll position are kept per preview **session**, so switching between previews restores each one exactly, and navigation or a board reload resets it (R4.9).

## Failure containment (R6)

- `<Region>` (`errors/Region.tsx`) wraps the **board**, each **preview**, the **layers** panel, the **inspector** and **Details**. Row loading is its own mini-region inside the layers actions. A region catches render errors like any error boundary, and also exposes `fail(err)` through context and through a registry keyed by `region:screenId`.
- Non-render code routes errors to the region that owns them: the bridge's message handlers are wrapped in `guard("preview", id, …)`, connection timers report through `onDead`, key handlers fail the preview they acted on, and API responses call the region's `fail`. Outlines are drawn outside the preview (in the overlay), so a small `ForwardErrors` boundary forwards drawing errors to the preview's region. **An error behaves the same wherever it's thrown** (R6.5).
- **Exactly once.** `reportFailure()` is the only caller of `report()`, and it drops cancellations. A region reports once per attempt and ignores further errors until Retry starts a new attempt, so a retry that fails again is a new report. `fail()` on an unmounted region is a no-op (R6.6), and unmounting aborts that region's requests.
- **API bodies are untrusted.** A 5xx, malformed JSON or the wrong shape throws `ApiError`. A 404 on `/elements/:key` is "No details for this element", which is not an error.
- **Page errors** (`error` / `unhandledrejection` inside a page) show as a "Page error" badge on that preview, and its tooltip shows the message. They aren't failures of our app, so they aren't reported.

## Ambiguities and decisions

- **Which elements exist.** `script`, `style`, `template`, `noscript`, `link`, `meta`, `base`, `title` and `head` are left out of hover and the tree. They're never rendered, so they have no box to outline. The agent's own `<script>` would otherwise show up in every tree.
- **Name rule order.** `data-name`, then `tag.firstClass`, then `tag#id`, then the tag, in the brief's order (class beats id).
- **Selection fires on pointerdown.** See above: `click` never fires on disabled controls.
- **Active preview.** Any Select-mode click in a preview makes it active, including a click on the page background (which also clears the selection).
- **Hovering a selected element** shows the hover stroke but only the selection's label, so there aren't two overlapping labels.
- **Escape clears the selection in either mode.** In Interact mode the page only forwards V, I and Escape, and only when you aren't typing into one of its fields.
- **Enter on an element with no children** and **Tab on an only child** do nothing visible: the first selects nothing new, and the second wraps around to itself.
- **↑/↓ in the layers panel** also scroll the page to the element, like a row click (R4.6).
- **Top-level child load failure** (children of `<body>`) fails the whole layers region, because there are no rows to show. Deeper failures are per row.
- **Search** is case-insensitive and matches the row's name only.
- **"Doesn't respond within 10 seconds"** is applied both to the initial connection and to liveness pings afterwards.
- **Page error badge** clears when that preview navigates (it's a new page).

## Where this breaks

- **Identity is proof-based, so some real survivals look like deaths:**
  - an unkeyed element whose attributes or non-numeric text change in the same render that rebuilds it is dropped;
  - two unkeyed siblings with identical tag, attributes and text being rebuilt are dropped (on purpose);
  - a node removed in one task and re-inserted in a later one is dropped;
  - duplicate `data-key`s are dropped.
- **The one case where the selection could jump:** if the page removes an unkeyed element and, *in the same mutation batch*, inserts a different one with exactly the same tag, attributes and text (ignoring digits) into the same rebuilt parent, the selection moves to the new one. From the DOM alone the two are indistinguishable. Page 4's items cycle every 120 combinations with at most 25 visible, so it doesn't happen there.
- `pointer-events: none` elements can't be hovered or clicked in the preview, because `elementFromPoint` skips them. They can still be selected from the layers panel. Shadow DOM and iframes nested inside a page aren't inspected.
- Chrome throttles animation frames in off-screen cross-origin iframes, so the outline of an off-screen preview updates when it comes back into view. You can't see it in the meantime anyway.
- No virtualization in the layers panel. Page 5 fully expanded (~1,500 rows) is fine; tens of thousands of rows would not be.
- Scroll anchoring in the panel uses the first visible row. If that exact row is removed, the view can shift by up to a row.
- A key pressed within a millisecond or two of a click in a preview can arrive before the click's `pick` message, and then acts on the previous selection.
- The agent's first `hello` is posted with target origin `*`, because it can't know the host's origin yet. It only contains the page URL and title. Everything after `init` is posted to the host's exact origin.

## What I took from existing products

- **Figma**: thin hover stroke plus a thicker selection stroke with a name tag, labels that flip below at the top edge, a constant on-screen stroke at any zoom, and the layer tree highlighting the nearest visible ancestor instead of auto-expanding on hover. It's the established mental model for this exact interaction.
- **React DevTools / Chrome DevTools**: a small agent inside the inspected page, plus a separate frontend that talks to it over messages, with element ids owned by the agent. That's the only shape that works across origins, and it keeps the page-side code small (~10 KB) and dependency-free.

## Repo map

```
frontend/src/protocol/   message types shared by host and agent
frontend/src/agent/      in-page agent → backend/pages/agent.js
  index.ts               session, input, streaming, requests
  identity.ts            nid registry + re-binding (R3.7)
  scroll.ts              scroll-only-this-page (R4.6)
frontend/src/host/
  bridge/                connection (handshake, timeouts, liveness), router, message handlers
  store/                 state + user actions
  board/ overlay/        grid, pan/zoom, outlines in screen space
  layers/ inspector/     R4, R5
  errors/                Region, failure routing, dev menu
```
