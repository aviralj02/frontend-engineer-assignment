// API client. Bodies are untrusted (the mock returns 5xx and truncated JSON), so every
// response is parsed and shape-checked; anything off is a thrown ApiError (R6.2).

import { API_ORIGIN } from "./config";
import { useStore } from "./store";

export interface Screen {
  id: string;
  name: string;
  url: string;
}

export interface ElementDetails {
  component: string;
  description: string;
  status: string;
  owner: string;
}

export class ApiError extends Error {
  override name = "ApiError";
}

/** 404 from /elements/:key: "no details", explicitly not an error (R5.1). */
export const NO_DETAILS = Symbol("no-details");

function url(path: string, forceFail: boolean): string {
  const { latency, failRate } = useStore.getState().dev.api;
  const u = new URL(path, API_ORIGIN);
  if (latency > 0) u.searchParams.set("latency", String(latency));
  const fail = forceFail ? 1 : failRate;
  if (fail > 0) u.searchParams.set("fail", String(fail));
  return u.toString();
}

async function getJson(path: string, signal: AbortSignal, forceFail = false): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url(path, forceFail), { signal });
  const text = await res.text();
  if (res.status === 404) return { status: 404, body: null };
  if (!res.ok) throw new ApiError(`GET ${path} failed: HTTP ${res.status}`);
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    throw new ApiError(`GET ${path} returned a malformed body`);
  }
}

const isStr = (v: unknown): v is string => typeof v === "string";

export async function fetchScreens(signal: AbortSignal, forceFail = false): Promise<Screen[]> {
  const { status, body } = await getJson("/screens", signal, forceFail);
  if (status === 404) throw new ApiError("GET /screens: not found");
  if (!Array.isArray(body) || !body.every((s) => s && isStr(s.id) && isStr(s.name) && isStr(s.url))) {
    throw new ApiError("GET /screens returned an unexpected shape");
  }
  return body.map((s: Screen) => ({ id: s.id, name: s.name, url: s.url }));
}

export async function fetchElementDetails(
  key: string,
  signal: AbortSignal,
  forceFail = false,
): Promise<ElementDetails | typeof NO_DETAILS> {
  const { status, body } = await getJson(`/elements/${encodeURIComponent(key)}`, signal, forceFail);
  if (status === 404) return NO_DETAILS;
  const b = body as Partial<ElementDetails> | null;
  if (!b || !isStr(b.component) || !isStr(b.description) || !isStr(b.status) || !isStr(b.owner)) {
    throw new ApiError(`GET /elements/${key} returned an unexpected shape`);
  }
  return { component: b.component, description: b.description, status: b.status, owner: b.owner };
}
