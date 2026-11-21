/** Piece colors (our own palette) and canvas theme read from CSS tokens. */

export const PIECE_COLORS: Record<string, string> = {
  i: "#3ec7e0",
  j: "#4b6cf0",
  l: "#f29a38",
  o: "#f2cb46",
  s: "#6cc268",
  t: "#b05ad8",
  z: "#ec5a62",
  gb: "#7c8190",
  bomb: "#e0a030"
};

export interface CanvasTheme {
  boardBg: string;
  grid: string;
  border: string;
  text: string;
  muted: string;
}

export function readTheme(el: Element = document.documentElement): CanvasTheme {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    boardBg: v("--board-bg", "#0f1116"),
    grid: v("--board-grid", "#1c1f27"),
    border: v("--board-border", "#3a3f4c"),
    text: v("--fg", "#e7e9ee"),
    muted: v("--muted", "#8a90a0")
  };
}

/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb color. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
