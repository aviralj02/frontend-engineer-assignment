// Failure plumbing (R6). Two rules live here:
//   - reportFailure() is the only caller of report(), and it skips cancellations (R6.4).
//   - failRegion() lets non-React code (bridge, timers, key handlers, responses) route an
//     error into the region that owns it, so every source gets the same treatment (R6.5).
//     If that region is gone, the error is dropped (R6.6).

import { report, type ReportContext, type ReportRegion } from "../../../report.js";

export type { ReportRegion };

/** A request that was cancelled or replaced because the user moved on. Never a failure. */
export class Cancelled extends Error {
  override name = "Cancelled";
  constructor(reason = "cancelled") {
    super(reason);
  }
}

export function isCancel(err: unknown): boolean {
  return err instanceof Cancelled || (err instanceof DOMException && err.name === "AbortError");
}

export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
}

type ReportListener = (err: Error, ctx: ReportContext) => void;
const reportListeners = new Set<ReportListener>();

/** Observe reports (the dev menu shows a running log, to demo "exactly once"). */
export function onReport(listener: ReportListener): () => void {
  reportListeners.add(listener);
  return () => reportListeners.delete(listener);
}

export function reportFailure(err: unknown, ctx: ReportContext): void {
  if (isCancel(err)) return;
  const error = toError(err);
  report(error, ctx);
  for (const l of reportListeners) l(error, ctx);
}

type FailFn = (err: unknown) => void;
const regions = new Map<string, FailFn>();

const keyOf = (region: ReportRegion, screenId: string | null) => `${region}:${screenId ?? "-"}`;

export function registerRegion(region: ReportRegion, screenId: string | null, fail: FailFn): () => void {
  const key = keyOf(region, screenId);
  regions.set(key, fail);
  return () => {
    if (regions.get(key) === fail) regions.delete(key);
  };
}

export function failRegion(region: ReportRegion, screenId: string | null, err: unknown): void {
  if (isCancel(err)) return;
  const fail = regions.get(keyOf(region, screenId));
  if (fail) fail(err);
  else console.warn(`[failRegion] ${keyOf(region, screenId)} is not mounted; dropped`, err);
}

/** Wrap a callback (event handler, timer, message handler) so a throw fails its region. */
export function guard<A extends unknown[]>(
  region: ReportRegion,
  screenId: string | null,
  fn: (...args: A) => void,
): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (err) {
      failRegion(region, screenId, err);
    }
  };
}
