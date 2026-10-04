// DOM helpers shared by the agent's hit-testing, tree and identity code.

// Not rendered, so never hoverable and never shown as rows (documented in README → Ambiguities).
const SKIP = new Set(["script", "style", "template", "noscript", "link", "meta", "base", "title", "head"]);

/** An "Element" in the spec's sense: inside <body>, not <html>/<body>, and rendered. */
export function isTreeElement(el: Element): boolean {
  return el !== document.documentElement && el !== document.body && !SKIP.has(el.localName);
}

export function treeChildren(parent: Element): Element[] {
  const out: Element[] = [];
  for (const c of Array.from(parent.children)) if (isTreeElement(c)) out.push(c);
  return out;
}

/** Parent row in the tree, or null when the element is top-level (a child of <body>). */
export function treeParent(el: Element): Element | null {
  const p = el.parentElement;
  return !p || p === document.body || p === document.documentElement ? null : p;
}

export function inBody(el: Element): boolean {
  return el !== document.body && !!document.body && document.body.contains(el);
}

// Name rule from the README "Terms": data-name, else tag.firstClass, else tag#id, else tag.
export function nameOf(el: Element): string {
  const dataName = el.getAttribute("data-name");
  if (dataName) return dataName;
  const tag = el.localName;
  const firstClass = (el.getAttribute("class") || "").trim().split(/\s+/)[0];
  if (firstClass) return `${tag}.${firstClass}`;
  if (el.id) return `${tag}#${el.id}`;
  return tag;
}

export function normText(s: string | null): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

export function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}
