// Element identity (R3.7). The agent owns it; the host only ever sees nids.
//
// A nid is bound to one Element. When that Element leaves the DOM we try to re-bind the
// nid to a node inserted in the same mutation batch, and only when the match is provable:
//   1. data-key: exactly one connected, unbound element with the same key and tag.
//   2. otherwise: the old parent re-binds first (recursively), then among the *newly
//      inserted* children of the new parent we look for exactly one with the same
//      signature, while exactly one lost sibling had that signature.
//      Signatures, strictest first: tag+attributes+text, then the same with digits
//      masked (so "6s ago" -> "8s ago" still matches).
// Anything else (zero or several candidates) means the element is gone. We never guess,
// so a selection can disappear but never jump to a different element.

import type { NodeInfo, Nid } from "../protocol";
import { isTreeElement, nameOf, normText, treeChildren, treeParent } from "./dom";

interface Batch {
  removedFrom: Map<Element, Element>;
  removedByParent: Map<Element, Element[]>;
  added: Set<Node>;
  inAdded: Map<Node, boolean>;
  memo: Map<Element, Element | null>;
  claimed: Set<Element>;
  sigs: Map<Element, [string, string]>;
}

export class Registry {
  private next = 1;
  private nidOf = new WeakMap<Element, Nid>();
  private elOf = new Map<Nid, Element>();

  id(el: Element): Nid {
    let nid = this.nidOf.get(el);
    if (nid === undefined || this.elOf.get(nid) !== el) {
      nid = this.next++;
      this.bind(nid, el);
    }
    return nid;
  }

  /** The live element for a nid, or null if it no longer exists. */
  get(nid: Nid): Element | null {
    const el = this.elOf.get(nid);
    return el && el.isConnected ? el : null;
  }

  info(el: Element): NodeInfo {
    return {
      nid: this.id(el),
      name: nameOf(el),
      tag: el.localName,
      key: el.getAttribute("data-key"),
      hasChildren: treeChildren(el).length > 0,
    };
  }

  /** nids from the top-level ancestor down to the element itself. */
  path(el: Element): Nid[] {
    const out: Nid[] = [];
    for (let cur: Element | null = el; cur; cur = treeParent(cur)) out.push(this.id(cur));
    return out.reverse();
  }

  /** Re-bind or drop every nid whose element left the DOM. Returns the dropped nids. */
  reconcile(records: MutationRecord[]): Nid[] {
    const lost: [Nid, Element][] = [];
    for (const entry of this.elOf) if (!entry[1].isConnected) lost.push(entry);
    if (!lost.length) return [];

    const batch: Batch = {
      removedFrom: new Map(),
      removedByParent: new Map(),
      added: new Set(),
      inAdded: new Map(),
      memo: new Map(),
      claimed: new Set(),
      sigs: new Map(),
    };
    for (const r of records) {
      if (r.type !== "childList") continue;
      r.addedNodes.forEach((n) => batch.added.add(n));
      r.removedNodes.forEach((n) => {
        if (!(n instanceof Element) || !(r.target instanceof Element)) return;
        batch.removedFrom.set(n, r.target);
        const list = batch.removedByParent.get(r.target) ?? [];
        list.push(n);
        batch.removedByParent.set(r.target, list);
      });
    }

    // Shallow nodes first so parents claim their match before their children look for theirs.
    lost.sort((a, b) => depth(a[1]) - depth(b[1]));
    const gone: Nid[] = [];
    for (const [nid, el] of lost) {
      const match = this.resolve(el, batch);
      if (match && isTreeElement(match)) this.bind(nid, match);
      else {
        this.elOf.delete(nid);
        gone.push(nid);
      }
    }
    return gone;
  }

  private bind(nid: Nid, el: Element) {
    this.nidOf.set(el, nid);
    this.elOf.set(nid, el);
  }

  private isBoundElsewhere(el: Element): boolean {
    const nid = this.nidOf.get(el);
    return nid !== undefined && this.elOf.get(nid) === el;
  }

  private resolve(el: Element, b: Batch): Element | null {
    if (el.isConnected) return el;
    const cached = b.memo.get(el);
    if (cached !== undefined) return cached;
    b.memo.set(el, null); // cycle guard

    let out: Element | null = null;
    const key = el.getAttribute("data-key");
    if (key !== null) {
      const candidates = Array.from(document.querySelectorAll(`[data-key="${CSS.escape(key)}"]`)).filter(
        (c) => c.localName === el.localName && !b.claimed.has(c) && !this.isBoundElsewhere(c),
      );
      out = candidates.length === 1 ? candidates[0] : null;
    } else {
      const oldParent = el.parentElement ?? b.removedFrom.get(el) ?? null;
      const newParent = oldParent ? (oldParent.isConnected ? oldParent : this.resolve(oldParent, b)) : null;
      if (oldParent && newParent) {
        const candidates = treeChildren(newParent).filter(
          (c) => this.isNew(c, b) && !b.claimed.has(c) && !this.isBoundElsewhere(c),
        );
        const oldSiblings = oldParent.isConnected ? (b.removedByParent.get(oldParent) ?? [el]) : treeChildren(oldParent);
        for (const level of [0, 1] as const) {
          const sig = this.sig(el, b)[level];
          const olds = oldSiblings.filter((o) => this.sig(o, b)[level] === sig).length;
          const news = candidates.filter((c) => this.sig(c, b)[level] === sig);
          if (olds === 1 && news.length === 1) {
            out = news[0];
            break;
          }
          if (olds > 1 || news.length > 1) break; // ambiguous: never guess
        }
      }
    }
    if (out) b.claimed.add(out);
    b.memo.set(el, out);
    return out;
  }

  /** Only nodes inserted in this batch can be a re-render of a lost node. */
  private isNew(node: Node, b: Batch): boolean {
    const known = b.inAdded.get(node);
    if (known !== undefined) return known;
    const result = b.added.has(node) || (!!node.parentNode && this.isNew(node.parentNode, b));
    b.inAdded.set(node, result);
    return result;
  }

  private sig(el: Element, b: Batch): [string, string] {
    let s = b.sigs.get(el);
    if (!s) {
      const attrs = Array.from(el.attributes)
        .map((a) => `${a.name}=${a.value}`)
        .sort()
        .join("&");
      const exact = `${el.localName}|${attrs}|${normText(el.textContent).slice(0, 300)}`;
      s = [exact, exact.replace(/\d+/g, "#")];
      b.sigs.set(el, s);
    }
    return s;
  }
}

function depth(el: Element): number {
  let d = 0;
  for (let cur: Node | null = el; cur; cur = cur.parentNode) d++;
  return d;
}
