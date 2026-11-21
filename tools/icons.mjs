// Малює іконки застосунку без сторонніх бібліотек: node tools/icons.mjs
// Знак — кадр кіноплівки з кнопкою відтворення (той самий, що в шапці).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = buf => { let c = ~0; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (type, data) => {
  const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body));
  return Buffer.concat([head, body, tail]);
};

const BG = [10, 12, 11], A1 = [100, 227, 200], A2 = [61, 214, 181], HOLE = [28, 96, 82];
// усе в сітці 64×64; кадр лишає поля, щоб знак пережив «маску» Android
const inRound = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r)), cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
function pixel(x, y) {
  if (!inRound(x, y, 12, 17, 52, 47, 9)) return BG;
  // трикутник відтворення (27,25) (27,39) (39,32)
  if (x >= 27 && x <= 39 && Math.abs(y - 32) <= 7 * (39 - x) / 12) return BG;
  for (const hx of [15.5, 44.5]) for (const hy of [22, 30, 38]) if (inRound(x, y, hx, hy, hx + 4, hy + 4, 1.2)) return HOLE;
  const k = (x - 12 + y - 17) / 70;      // легкий градієнт по діагоналі
  return A1.map((c, i) => Math.round(c + (A2[i] - c) * k));
}

function png(size) {
  const ss = 3, rows = [];               // згладжування: 3×3 проби на піксель
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
        const c = pixel((x + (i + .5) / ss) * 64 / size, (y + (j + .5) / ss) * 64 / size);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      row.set(acc.map(v => Math.round(v / (ss * ss))), 1 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../icon-${size}.png`, import.meta.url), png(size));
  console.log(`icon-${size}.png`);
}
