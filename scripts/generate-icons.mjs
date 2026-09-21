/* Genera los íconos desde assets/icon.svg usando sharp.
   Uso: npm i -D sharp && node scripts/generate-icons.mjs */

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const SRC  = path.join(ROOT, 'assets', 'icon.svg');
const OUT  = path.join(ROOT, 'icons');

const TARGETS = [
  { size: 512, name: 'icon-512.png',         maskable: false },
  { size: 192, name: 'icon-192.png',         maskable: false },
  { size: 512, name: 'maskable-512.png',     maskable: true  },
  { size: 192, name: 'maskable-192.png',     maskable: true  },
  { size: 180, name: 'apple-touch-icon.png', maskable: false },
  { size: 32,  name: 'favicon-32.png',       maskable: false },
  { size: 16,  name: 'favicon-16.png',       maskable: false },
  { size: 256, name: 'screenshot-today.png', maskable: false },
];

const SAFE_ZONE = 0.8;

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const svg = await fs.readFile(SRC);

  for (const { size, name, maskable } of TARGETS) {
    const outPath = path.join(OUT, name);

    if (maskable) {
      const inner = Math.round(size * SAFE_ZONE);
      const pad = Math.round((size - inner) / 2);

      const innerBuf = await sharp(svg)
        .resize(inner, inner)
        .png()
        .toBuffer();

      await sharp({
        create: {
          width: size, height: size, channels: 4,
          background: { r: 79, g: 70, b: 229, alpha: 1 },  // #4f46e5
        },
      })
        .composite([{ input: innerBuf, top: pad, left: pad }])
        .png()
        .toFile(outPath);
    } else {
      await sharp(svg).resize(size, size).png().toFile(outPath);
    }

    console.log(`✓ ${name}`);
  }

  console.log('\n✅ Íconos generados en', OUT);
}

main().catch(err => { console.error(err); process.exit(1); });