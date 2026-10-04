# How the viewer inspects pages it isn't allowed to touch

This is the plain-language version of how the app works: why we need an agent inside every page, how the two sides talk with `postMessage`, and how hovering, clicking, outlines, the layers panel and the inspector all come out of that. For the precise protocol, state model and failure handling, see the [README](README.md).

## The problem

Your app runs at `localhost:5173`. The previews load pages from `localhost:4001`. Because the port differs, the browser treats them as two different websites. Its security rules (the same-origin policy) stop one site from reaching into another site's page. So our app can show the iframe, but it can't read the page's elements, measure a button, or listen to clicks inside it.

It's like looking at a room through a sealed glass window: you can see in, but you can't touch anything.

```mermaid
flowchart LR
    subgraph HOST["Our app · localhost:5173"]
        H["Board, outlines,<br/>layers panel, inspector"]
    end
    subgraph PAGE["Preview page · localhost:4001"]
        P["The page's elements"]
    end
    H -. "can see it (iframe)" .-> P
    H -- "can't touch it ✗<br/>(same-origin policy)" --x P
```

## The fix: put a helper inside the room

Each page is allowed one extra `<script>` tag, so we use it to load `agent.js`. That script runs inside the page, on the page's own origin, which means it can do everything we can't:
- read the elements;
- measure where things are;
- catch clicks before the page sees them;
- notice when the page changes.

So there are two programs:
- **The host** (our React app) draws the board, the outlines, the layers panel and the inspector, and never touches the page.
- **The agent** (inside each iframe) does all the hands-on work with the page.

```mermaid
flowchart LR
    subgraph HOST["Host · our React app"]
        direction TB
        B["Board + outlines"]
        L["Layers panel"]
        I["Inspector"]
    end
    subgraph IFRAME["Each iframe · the page's own origin"]
        direction TB
        A["agent.js<br/>(the helper)"]
        D["The page's elements"]
        A -- "reads, measures,<br/>intercepts clicks" --> D
    end
    HOST <-- "notes through the slot<br/>(postMessage)" --> A
```

There are 24 previews, so there are 24 agents, one per iframe, each talking to the same host.

## How they talk: `postMessage`

The browser gives cross-origin windows exactly one legal way to communicate: `window.postMessage`. Think of it as passing notes through a slot in the glass. Only plain data can pass through, never live objects like a DOM element.

```js
// agent → host
window.parent.postMessage({ kind: "pointer", node: {...}, rect: {...} }, hostOrigin)

// host → agent
iframe.contentWindow.postMessage({ kind: "mode", mode: "interact" }, "http://localhost:4001")
```

Each side listens with `window.addEventListener("message", ...)`, checks who the note came from, and ignores anything it doesn't recognise.

## The handshake

1. The page loads, and the agent starts up first: it's the first tag in `<head>`.
2. The agent sends **"hello, I'm here"**, and keeps repeating it until someone answers.
3. The host answers **"welcome, your session id is `scr-01#1`, and we're in Select mode"**.
4. From then on, every note carries that session id.

```mermaid
sequenceDiagram
    participant H as Host (our app)
    participant A as Agent (inside the page)
    Note over A: page loads, agent starts first
    A->>H: hello, I'm here
    A->>H: hello, I'm here (repeats until answered)
    H->>A: welcome — session scr-01#1, Select mode
    Note over H,A: every note from now on carries scr-01#1
    A->>H: [scr-01#1] pointer is over element #12
    H->>A: [scr-01#1] watch #12
```

If the page navigates (you click a link in Interact mode), the old agent dies with the old page. The new page's agent says "hello" again with a different identity. The host sees that, knows it's a new page, clears that preview's selection and layers, and ignores any late notes still marked with the old session id.

```mermaid
sequenceDiagram
    participant H as Host
    participant A1 as Old agent (page-6)
    participant A2 as New agent (page-6-next)
    Note over A1: user clicks a link in Interact mode
    A1--xH: (gone with the old page)
    A2->>H: hello, I'm here (a different page)
    Note over H: new page → clear this preview's<br/>selection and layers
    H->>A2: welcome — session scr-06#2
    Note over H: late notes marked scr-06#1 are ignored
```

## What happens when you hover

1. You move the mouse over a preview. The browser sends that movement to the **page**, not to our app.
2. The agent catches it and asks the page which element is visually on top at that point (`document.elementFromPoint`). That's why disabled buttons, SVG icons and things under the sticky header all work.
3. The agent sends a note: **"pointer is over element #12, it's called `button.primary`, its box is x 120, y 340, 124×45"**.
4. The host draws an orange 1 px rectangle at that spot **on top of** the iframe, in a transparent layer above the board.

```mermaid
sequenceDiagram
    actor U as You
    participant P as Page
    participant A as Agent
    participant H as Host
    U->>P: move the mouse over the preview
    P->>A: mouse moved to (130, 360)
    A->>P: which element is on top at (130, 360)?
    P-->>A: button.primary
    A->>H: pointer is over #12 "button.primary"<br/>box x 120, y 340, 124×45
    H->>H: draw an orange 1px box on top of the iframe
```

The outline is never inside the page. It's painted on the glass in front of it. That's why it stays a crisp 1 px at any zoom, and why it never disturbs the page itself.

```mermaid
flowchart TB
    O["Overlay layer (our app)<br/>outlines + labels, never scaled"]
    W["Board layer (our app)<br/>iframes, panned and zoomed"]
    G["The page inside each iframe<br/>(untouched)"]
    O --- W --- G
```

## Element ids instead of elements

A DOM element can't go through the slot, so the agent gives each element a **ticket number** (we call it a *nid*) and keeps the real element on its side. The host only ever stores numbers: "element #12 is selected". When the host asks about #12, the agent looks up which real element that is.

```mermaid
flowchart LR
    subgraph H["Host"]
        S["selection = [#12]"]
    end
    subgraph A["Agent"]
        T["#12 → &lt;button class=primary&gt;<br/>#13 → &lt;h1&gt;<br/>#14 → &lt;nav&gt;"]
    end
    S -- "only the number<br/>crosses the slot" --> T
```

This is also how selection survives re-renders. Page 4 throws away and rebuilds its list every 2 seconds. When the agent sees ticket #12's element disappear, it looks for the newly built element that is provably the same one: same `data-key`, or same structure and text. If exactly one matches, the ticket moves to it, so the host's "#12 is selected" stays true. If no element matches, or more than one does, it tells the host "#12 is gone" instead of guessing.

```mermaid
flowchart TD
    X["The page rebuilt its DOM.<br/>Ticket #12's element is gone."] --> K{"Did it have<br/>a data-key?"}
    K -- yes --> K1{"Exactly one new element<br/>with the same key?"}
    K -- no --> S1{"Exactly one new element<br/>with the same place, tag,<br/>attributes and text?"}
    K1 -- yes --> M["Move ticket #12 to it.<br/>Still selected."]
    K1 -- "no / several" --> G["Tell the host: #12 is gone.<br/>Never guess."]
    S1 -- yes --> M
    S1 -- "no / several" --> G
```

## What happens when you click

In **Select mode**, the agent intercepts mouse-down, click, submit and key presses *before the page sees them*, and cancels them. So links don't navigate, buttons don't fire, and inputs don't get focus. It sends a note instead: **"user clicked element #12, Shift was/wasn't held"**. The host updates the selection.

In **Interact mode**, the agent steps aside and the page behaves normally.

```mermaid
flowchart TD
    C["You click inside a preview"] --> A["The agent sees it first"]
    A --> M{"Which mode?"}
    M -- Select --> S["Cancel it: no navigation,<br/>no button action, no focus"]
    S --> N["Note to host: clicked #12,<br/>Shift held or not"]
    N --> U["Host updates the selection"]
    M -- Interact --> P["Step aside: the page<br/>handles the click normally"]
```

Keys work the same way. After you click inside a preview, the keyboard belongs to the iframe, so the agent forwards V, I, Escape, Enter and Tab to the host.

## Who actually receives the mouse?

When the pointer is over an iframe, the browser delivers every mouse event to the page inside it, not to our app. Our app only sees the pointer enter and leave the `<iframe>` element itself, with no position or element information.

That's why the agent is needed. It lives inside the page, so it receives those events too:

```ts
// frontend/src/agent/index.ts
window.addEventListener("pointermove", (e) => {
  lastPoint = { x: e.clientX, y: e.clientY };
  refreshHover();               // elementFromPoint → note to the host
}, { capture: true, passive: true });
```

The agent **only listens to hover, it doesn't block it**. The page gets the same mouse moves as normal, so its own hover behaviour still runs in Select mode: CSS `:hover` styles, `mouseover` handlers and the cursor shape. Hovering a page button still shows its hover colour, and our orange outline is drawn on top.

Clicks and keys are different:

| Event | Select mode | Interact mode |
|---|---|---|
| Mouse move / hover | The page gets it, and the agent watches it | The page gets it |
| Mouse down, click, submit, keys | **The agent cancels them before the page sees them** and sends "clicked #12" to the host | The page gets them normally |
| Wheel (plain) | The page scrolls | The page scrolls |
| Ctrl + wheel | The agent cancels it and asks the host to zoom the board | Same |

```mermaid
flowchart TD
    E["A mouse or key event<br/>over a preview"] --> B["The browser delivers it<br/>to the page, not our app"]
    B --> A["The agent's listener runs first<br/>(window, capture phase)"]
    A --> T{"What kind of event?"}
    T -- "hover / plain wheel" --> W["Agent watches only.<br/>The page reacts as normal."]
    T -- "Ctrl + wheel" --> Z["Agent cancels it and asks<br/>the host to zoom the board"]
    T -- "click / key / submit" --> M{"Which mode?"}
    M -- Select --> X["Agent cancels it.<br/>The page never knows."]
    M -- Interact --> P["The page reacts as normal"]
```

The agent can cancel clicks before the page reacts because it's the first `<script>` in `<head>`. Its listeners are attached at the outermost level (`window`, capture phase), so they run before anything the page registers. In Select mode it calls `preventDefault()` and `stopImmediatePropagation()`, and the page never finds out a click happened.

Hover is deliberately left alone. Stopping the page from reacting to hover would need an invisible layer over it, and that layer would also stop plain wheel scrolling in the preview, which the brief requires.

## Keeping the outline glued

The host tells the agent: **"watch #12 (selected) and #30 (hovered)"**. While anything is being watched, the agent re-measures those few elements on every animation frame and sends new boxes only when something moved. That covers scrolling, resizing, animation and the page changing itself.

The host then converts page coordinates to screen coordinates (preview position on the board × zoom + pan) and moves the rectangle.

```mermaid
sequenceDiagram
    participant H as Host
    participant A as Agent
    H->>A: watch #12 (selected) and #30 (hovered)
    loop every animation frame
        A->>A: measure #12 and #30
        alt something moved
            A->>H: new boxes for #12 and #30
            H->>H: page box → screen box<br/>(board position × zoom + pan)
        else nothing changed
            A->>A: send nothing
        end
    end
```

## The layers panel and inspector

These work by asking questions:
- "What are the children of element #5?" The agent replies with a list of names and ticket numbers, which is how rows load on expand.
- "Show me the path down to #40." It replies with every level at once, which is how the panel can open 30 levels deep in one go.
- "Search for 'Setting 7'." The agent searches the whole page, including parts never opened.
- For the inspector, the agent also sends live computed values (size, colours, fonts) for the selected elements.

Each question has an id and a deadline. If the answer doesn't arrive in time (3 s for a row, 10 s for "are you alive?"), the host shows an error for that part only.

```mermaid
sequenceDiagram
    participant L as Layers panel (host)
    participant A as Agent
    L->>A: question 7: children of #5?
    A-->>L: answer 7: [#21 "h2", #22 "div.stats"]
    L->>A: question 8: path down to #40?
    A-->>L: answer 8: every level from the top to #40
    L->>A: question 9: children of #22?
    Note over L: no answer within 3s
    L->>L: show "Couldn't load" + Retry on that row only
```

## In one sentence

The pages are behind glass, so we put a small helper inside each one. It does all the touching and measuring, and passes short notes through the only slot the browser allows (`postMessage`). The app reads those notes and draws everything on top of the glass.

## Where to look in the code

| Idea in this doc | Code |
|---|---|
| The notes and their shapes | `frontend/src/protocol/index.ts` |
| The helper inside the page | `frontend/src/agent/index.ts` |
| Ticket numbers and re-binding | `frontend/src/agent/identity.ts` |
| Handshake, deadlines, "are you alive?" | `frontend/src/host/bridge/connection.ts` |
| What the host does with each note | `frontend/src/host/bridge/handlers.ts` |
| Drawing on the glass | `frontend/src/host/overlay/Overlay.tsx` |
| Layers questions | `frontend/src/host/layers/actions.ts` |
