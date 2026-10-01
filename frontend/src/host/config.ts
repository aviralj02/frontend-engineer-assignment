export const API_ORIGIN = "http://localhost:4000";
export const PAGES_ORIGIN = "http://localhost:4001";

export const PREVIEW_W = 1280;
export const PREVIEW_H = 800;
export const GRID_COLUMNS = 4;
export const GRID_GAP_X = 160;
export const GRID_GAP_Y = 200; // room for the screen name above each preview

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

export const CONNECT_TIMEOUT_MS = 10_000; // R6.2
export const PING_INTERVAL_MS = 2_000;
export const CHILDREN_TIMEOUT_MS = 3_000; // R4.3
export const REQUEST_TIMEOUT_MS = 5_000;

/** World-space position of a preview's top-left corner. */
export function previewOrigin(index: number): { x: number; y: number } {
  const col = index % GRID_COLUMNS;
  const row = Math.floor(index / GRID_COLUMNS);
  return { x: col * (PREVIEW_W + GRID_GAP_X), y: row * (PREVIEW_H + GRID_GAP_Y) };
}
