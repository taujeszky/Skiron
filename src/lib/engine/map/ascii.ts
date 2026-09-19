/**
 * Two pictures of a floor plan, both for people rather than for the game.
 *
 * `planToAscii` is what you print from a test or a scratch script when a
 * deduction looks wrong and you need to see the house. `planToSvg` is the
 * same thing at a size you can open in a browser. Neither is used by the
 * app, which draws its own SVG from `rooms` and `doors`.
 */

import type { FloorPlan } from "../types";

/**
 * Character columns per grid unit. Three keeps rooms roughly square on a
 * terminal, where a character is about a third as wide as it is tall, and
 * leaves the narrowest room (3 units) nine columns for its label.
 */
const CELL_W = 3;

export function planToAscii(plan: FloorPlan): string {
  const cols = plan.width * CELL_W + 1;
  const rows = plan.height + 1;
  const grid: string[][] = Array.from({ length: rows }, () =>
    new Array<string>(cols).fill(" "),
  );

  const put = (row: number, col: number, ch: string): void => {
    if (row < 0 || row >= rows || col < 0 || col >= cols) return;
    const cur = grid[row][col];
    const crossing =
      (ch === "-" && (cur === "|" || cur === "+")) ||
      (ch === "|" && (cur === "-" || cur === "+"));
    grid[row][col] = crossing ? "+" : ch;
  };

  // Walls first. Neighbouring rooms draw the same wall twice, which costs
  // nothing and means no room has to know who is on the other side.
  for (const room of plan.rooms) {
    const { x, y, w, h } = room.rect;
    const left = x * CELL_W;
    const right = (x + w) * CELL_W;
    for (let c = left; c <= right; c++) {
      put(y, c, "-");
      put(y + h, c, "-");
    }
    for (let r = y; r <= y + h; r++) {
      put(r, left, "|");
      put(r, right, "|");
    }
  }

  for (const room of plan.rooms) {
    const { x, y, w, h } = room.rect;
    const label = `${room.id}${room.outdoor ? "*" : ""}`;
    const row = y + Math.floor(h / 2);
    const start = x * CELL_W + Math.floor((w * CELL_W - label.length) / 2);
    for (let i = 0; i < label.length; i++) put(row, start + i, label[i]);
  }

  // Doors last, so they punch through the wall they hang on.
  for (const door of plan.doors) {
    if (door.wall === "v") {
      // `door.y` is the middle of a wall segment at least two units long, so
      // flooring it always lands strictly inside that segment.
      put(Math.floor(door.y), door.x * CELL_W, "o");
    } else {
      let col = Math.floor(door.x * CELL_W);
      // Keep off the lattice, where a corner of some other room may sit.
      if (col % CELL_W === 0) col += 1;
      put(door.y, col, "o");
    }
  }

  const picture = grid.map((row) => row.join("")).join("\n");
  const legend =
    `${plan.width}x${plan.height} units, ${plan.rooms.length} rooms, ` +
    `${plan.doors.length} doors  (o = door, * = outdoor)`;
  return `${picture}\n${legend}`;
}

/** Pixels per grid unit, and the margin around the footprint. */
const UNIT = 24;

export function planToSvg(plan: FloorPlan): string {
  const w = (plan.width + 2) * UNIT;
  const h = (plan.height + 2) * UNIT;
  const pad = UNIT;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
      `viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="#1f1d1b"/>`,
  ];

  for (const room of plan.rooms) {
    const x = pad + room.rect.x * UNIT;
    const y = pad + room.rect.y * UNIT;
    parts.push(
      `<rect x="${x}" y="${y}" width="${room.rect.w * UNIT}" ` +
        `height="${room.rect.h * UNIT}" ` +
        `fill="${room.outdoor ? "#cfdfc6" : "#f4ece0"}" ` +
        `stroke="#2b2b2b" stroke-width="3"/>`,
    );
  }

  // A door is drawn twice: once in the room colour to cut the gap out of the
  // wall, once as the threshold itself.
  for (const door of plan.doors) {
    const cx = pad + door.x * UNIT;
    const cy = pad + door.y * UNIT;
    const half = UNIT * 0.45;
    const x1 = door.wall === "v" ? cx : cx - half;
    const x2 = door.wall === "v" ? cx : cx + half;
    const y1 = door.wall === "v" ? cy - half : cy;
    const y2 = door.wall === "v" ? cy + half : cy;
    const line = `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`;
    parts.push(`<line ${line} stroke="#f4ece0" stroke-width="5"/>`);
    parts.push(`<line ${line} stroke="#b5651d" stroke-width="2"/>`);
  }

  for (const room of plan.rooms) {
    const cx = pad + (room.rect.x + room.rect.w / 2) * UNIT;
    const cy = pad + (room.rect.y + room.rect.h / 2) * UNIT;
    parts.push(
      `<text x="${cx}" y="${cy}" font-family="monospace" ` +
        `font-size="${Math.round(UNIT * 0.8)}" fill="#2b2b2b" ` +
        `text-anchor="middle" dominant-baseline="central">${room.id}</text>`,
    );
  }

  parts.push("</svg>");
  return parts.join("\n");
}
