// R4.6: bring an element into view by scrolling only this page. We don't use
// Element.scrollIntoView because it can also scroll ancestor frames, which would move the host.

export function revealInPage(el: Element): boolean {
  let moved = false;
  let r = el.getBoundingClientRect();

  // Inner scroll containers, innermost first: "nearest" alignment.
  for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const cs = getComputedStyle(node);
    const scrollY = /(auto|scroll|overlay)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight;
    const scrollX = /(auto|scroll|overlay)/.test(cs.overflowX) && node.scrollWidth > node.clientWidth;
    if (!scrollY && !scrollX) continue;
    const box = node.getBoundingClientRect();
    const top = box.top + node.clientTop;
    const left = box.left + node.clientLeft;
    const dy = scrollY ? nearest(r.top, r.bottom, top, top + node.clientHeight) : 0;
    const dx = scrollX ? nearest(r.left, r.right, left, left + node.clientWidth) : 0;
    if (dy || dx) {
      node.scrollTop += dy;
      node.scrollLeft += dx;
      moved = true;
      r = el.getBoundingClientRect();
    }
  }

  // The page itself: centre the element if it isn't fully visible.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const outY = r.top < 0 || r.bottom > vh;
  const outX = r.left < 0 || r.right > vw;
  if (outY || outX) {
    window.scrollBy(
      outX ? r.left - Math.max(0, (vw - r.width) / 2) : 0,
      outY ? r.top - Math.max(0, (vh - r.height) / 2) : 0,
    );
    moved = true;
  }
  return moved;
}

function nearest(start: number, end: number, viewStart: number, viewEnd: number): number {
  if (start >= viewStart && end <= viewEnd) return 0;
  if (end - start > viewEnd - viewStart || start < viewStart) return start - viewStart;
  return end - viewEnd;
}
