/**
 * Skiron app icon: a keyhole, lamplit, on a night-coloured tile.
 *
 * Run with `node scripts/gen-icons.mjs`.
 *
 * Constraints that shape it:
 *  - maskable safe zone: all ink must sit inside a circle of radius 0.40*size
 *    centred on the tile, because launchers may crop to that. The script
 *    prints how far the ink actually reaches.
 *  - the mark must read at 16px, so it is one silhouette with no interior
 *    detail and high contrast against the tile.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const BG = [26, 26, 32]; // --panel-ish night
const INK = [230, 207, 154]; // lamplight on brass
const SS = 4; // supersampling factor per axis

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(path, size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/** Is p inside the keyhole: a disc plus the trapezoid hanging below it? */
function inKeyhole(px, py, cx, cy, s) {
  const bowlY = cy - 0.1 * s;
  const bowlR = 0.205 * s;
  if (Math.hypot(px - cx, py - bowlY) <= bowlR) return true;
  const topY = bowlY + bowlR * 0.55;
  const botY = cy + 0.3 * s;
  if (py < topY || py > botY) return false;
  const t = (py - topY) / (botY - topY);
  const halfW = 0.062 * s + t * (0.145 * s - 0.062 * s);
  return Math.abs(px - cx) <= halfW;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.2; // corner radius of the tile
  const cx = size / 2;
  const cy = size / 2;

  let maxR = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgA = 0;
      let inkA = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;

          // rounded-square tile
          const qx = Math.max(Math.abs(px - cx) - (size / 2 - radius), 0);
          const qy = Math.max(Math.abs(py - cy) - (size / 2 - radius), 0);
          if (Math.hypot(qx, qy) <= radius) bgA++;

          if (inKeyhole(px, py, cx, cy, size)) {
            inkA++;
            const rr = Math.hypot(px - cx, py - cy);
            if (rr > maxR) maxR = rr;
          }
        }
      }
      const n = SS * SS;
      const bg = bgA / n;
      const ia = inkA / n;
      const o = (y * size + x) * 4;
      rgba[o] = Math.round(BG[0] * (1 - ia) + INK[0] * ia);
      rgba[o + 1] = Math.round(BG[1] * (1 - ia) + INK[1] * ia);
      rgba[o + 2] = Math.round(BG[2] * (1 - ia) + INK[2] * ia);
      rgba[o + 3] = Math.round(bg * 255);
    }
  }
  return { rgba, safe: maxR / size };
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  [`${ROOT}/static/favicon.png`, 64],
  [`${ROOT}/static/icon-192.png`, 192],
  [`${ROOT}/static/icon-512.png`, 512],
  [`${ROOT}/static/apple-touch-icon.png`, 180],
];
for (const [path, size] of targets) {
  const { rgba, safe } = render(size);
  writePng(path, size, rgba);
  console.log(
    `${path.split("/").pop()} ${size}x${size} ink reaches r=${(safe * 100).toFixed(1)}% (maskable limit 40%)`,
  );
}
