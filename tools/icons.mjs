// Малює іконки застосунку без сторонніх бібліотек: node tools/icons.mjs
// Темне тло, три «корінці» на полиці й трикутник відтворення.
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

function png(size) {
  const BG = [17, 21, 18], PETROL = [87, 181, 168], AMBER = [210, 162, 76], INK = [231, 234, 227];
  const u = size / 64;                       // малюємо в сітці 64×64
  const rect = (x, y, x0, y0, x1, y1) => x >= x0 * u && x < x1 * u && y >= y0 * u && y < y1 * u;
  const tri = (x, y) => {                    // трикутник (40,22) (40,40) (54,31)
    const px = x / u, py = y / u;
    return px >= 40 && py >= 22 + (px - 40) * 9 / 14 && py <= 40 - (px - 40) * 9 / 14;
  };
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      let c = BG;
      if (rect(x, y, 12, 44, 52, 47)) c = INK;            // полиця
      else if (rect(x, y, 14, 20, 20, 44)) c = PETROL;    // корінці
      else if (rect(x, y, 22, 26, 28, 44)) c = AMBER;
      else if (rect(x, y, 30, 17, 36, 44)) c = PETROL;
      else if (tri(x, y)) c = INK;
      row.set(c, 1 + x * 3);
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
