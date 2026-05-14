import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUTPUT_DIR = new URL(".", import.meta.url);
const CANVAS_SIZE = 1024;
const MARK_SIZE = 800;
const MARK_X = (CANVAS_SIZE - MARK_SIZE) / 2;
const MARK_Y = MARK_X;
const MARK_RADIUS = 250;
const BOT_SCALE = 18.75;
const BOT_ORIGIN = CANVAS_SIZE / 2 - 12 * BOT_SCALE;
const BOT_STROKE_WIDTH = 2 * BOT_SCALE;
const BLUE_START = [36, 116, 245];
const BLUE_END = [7, 101, 218];

const ICONSET_SIZES = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024]
];
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

fs.mkdirSync(new URL("icon.iconset/", OUTPUT_DIR), { recursive: true });
fs.mkdirSync(new URL("ico/", OUTPUT_DIR), { recursive: true });

fs.writeFileSync(new URL("icon.svg", OUTPUT_DIR), renderSvg());
fs.writeFileSync(new URL("icon.png", OUTPUT_DIR), renderPng(CANVAS_SIZE));

for (const [name, size] of ICONSET_SIZES) {
  fs.writeFileSync(new URL(`icon.iconset/${name}`, OUTPUT_DIR), renderPng(size));
}

const iconutil = spawnSync("iconutil", [
  "--convert",
  "icns",
  "--output",
  path.join(OUTPUT_DIR.pathname, "icon.icns"),
  path.join(OUTPUT_DIR.pathname, "icon.iconset")
], { stdio: "inherit" });

if (iconutil.status !== 0) {
  throw new Error("iconutil failed to generate build/icon.icns");
}

const icoImages = ICO_SIZES.map((size) => {
  const data = renderPng(size);
  fs.writeFileSync(new URL(`ico/icon-${size}.png`, OUTPUT_DIR), data);
  return { size, data };
});
fs.writeFileSync(new URL("icon.ico", OUTPUT_DIR), renderIco(icoImages));

function renderSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}" role="img" aria-label="AiHub">
  <defs>
    <linearGradient id="aihub-mark" x1="${MARK_X}" y1="${MARK_Y}" x2="${MARK_X + MARK_SIZE}" y2="${MARK_Y + MARK_SIZE}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#2474f5" />
      <stop offset="1" stop-color="#0765da" />
    </linearGradient>
  </defs>
  <rect x="${MARK_X}" y="${MARK_Y}" width="${MARK_SIZE}" height="${MARK_SIZE}" rx="${MARK_RADIUS}" fill="url(#aihub-mark)" />
  <g transform="translate(${BOT_ORIGIN} ${BOT_ORIGIN}) scale(${BOT_SCALE})" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </g>
</svg>
`;
}

function renderPng(size) {
  const scale = CANVAS_SIZE / size;
  const aa = Math.max(1, scale) * 1.15;
  const pixels = Buffer.alloc(size * size * 4);
  const lines = [
    [[12, 8], [12, 4]],
    [[12, 4], [8, 4]],
    [[2, 14], [4, 14]],
    [[20, 14], [22, 14]],
    [[15, 13], [15, 15]],
    [[9, 13], [9, 15]]
  ];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const px = (x + 0.5) * scale;
      const py = (y + 0.5) * scale;
      const markDistance = sdfRoundRect(px, py, MARK_X, MARK_Y, MARK_SIZE, MARK_SIZE, MARK_RADIUS);
      const markAlpha = 1 - smooth(-aa, aa, markDistance);

      if (markAlpha > 0) {
        const gradientPosition = clamp(((px - MARK_X) + (py - MARK_Y)) / (MARK_SIZE * 2), 0, 1);
        pixels[i] = Math.round(mix(BLUE_START[0], BLUE_END[0], gradientPosition));
        pixels[i + 1] = Math.round(mix(BLUE_START[1], BLUE_END[1], gradientPosition));
        pixels[i + 2] = Math.round(mix(BLUE_START[2], BLUE_END[2], gradientPosition));
        pixels[i + 3] = Math.round(markAlpha * 255);
      }

      let strokeAlpha = 0;
      for (const [[x1, y1], [x2, y2]] of lines) {
        strokeAlpha = Math.max(strokeAlpha, lineStrokeAlpha(px, py, x1, y1, x2, y2, aa));
      }
      const bodyDistance = sdfRoundRect(
        px,
        py,
        bot(4),
        bot(8),
        16 * BOT_SCALE,
        12 * BOT_SCALE,
        2 * BOT_SCALE
      );
      strokeAlpha = Math.max(strokeAlpha, 1 - smooth(BOT_STROKE_WIDTH / 2 - aa, BOT_STROKE_WIDTH / 2 + aa, Math.abs(bodyDistance)));
      blendWhite(pixels, i, strokeAlpha);
    }
  }

  return encodePng(size, size, pixels);
}

function renderIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;

  for (const [index, image] of images.entries()) {
    const entry = 6 + index * 16;
    header[entry] = image.size === 256 ? 0 : image.size;
    header[entry + 1] = image.size === 256 ? 0 : image.size;
    header[entry + 2] = 0;
    header[entry + 3] = 0;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  }

  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

function bot(value) {
  return BOT_ORIGIN + value * BOT_SCALE;
}

function lineStrokeAlpha(px, py, x1, y1, x2, y2, aa) {
  return 1 - smooth(
    BOT_STROKE_WIDTH / 2 - aa,
    BOT_STROKE_WIDTH / 2 + aa,
    lineDistance(px, py, bot(x1), bot(y1), bot(x2), bot(y2))
  );
}

function sdfRoundRect(px, py, x, y, width, height, radius) {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const qx = Math.abs(px - centerX) - (width / 2 - radius);
  const qy = Math.abs(py - centerY) - (height / 2 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function lineDistance(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(px - (x1 + vx * t), py - (y1 + vy * t));
}

function blendWhite(pixels, index, alpha) {
  if (alpha <= 0) {
    return;
  }
  const existingAlpha = pixels[index + 3] / 255;
  const outputAlpha = alpha + existingAlpha * (1 - alpha);
  for (let channel = 0; channel < 3; channel += 1) {
    pixels[index + channel] = Math.round((255 * alpha + pixels[index + channel] * existingAlpha * (1 - alpha)) / outputAlpha);
  }
  pixels[index + 3] = Math.round(outputAlpha * 255);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mix(start, end, position) {
  return start + (end - start) * position;
}

function smooth(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
