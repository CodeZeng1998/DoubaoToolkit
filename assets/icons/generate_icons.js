/**
 * Generate chubby Doubao-style girl icon PNGs at 16/32/48/128 sizes.
 * Renders an SVG via sharp into PNGs.
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SIZES = [16, 32, 48, 128];
const OUT_DIR = __dirname;

function buildSVG(size) {
  // Coordinates are in a 128 viewBox so design stays consistent.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFB16E"/>
      <stop offset="1" stop-color="#FF7A4F"/>
    </linearGradient>
    <radialGradient id="cheekL" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FF8A96" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#FF8A96" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cheekR" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FF8A96" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#FF8A96" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="hairGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5C3A2C"/>
      <stop offset="1" stop-color="#3A2218"/>
    </linearGradient>
    <radialGradient id="faceShade" cx="0.5" cy="0.5" r="0.6">
      <stop offset="0.6" stop-color="#FFE2C4" stop-opacity="0"/>
      <stop offset="1" stop-color="#E8B98F" stop-opacity="0.55"/>
    </radialGradient>
  </defs>

  <!-- rounded background -->
  <rect x="2" y="2" width="124" height="124" rx="28" ry="28" fill="url(#bg)"/>
  <!-- glossy highlight -->
  <ellipse cx="64" cy="22" rx="56" ry="22" fill="#ffffff" opacity="0.18"/>

  <!-- twin buns -->
  <g>
    <circle cx="36" cy="34" r="14" fill="url(#hairGrad)"/>
    <circle cx="92" cy="34" r="14" fill="url(#hairGrad)"/>
    <!-- ribbons -->
    <circle cx="36" cy="22" r="5" fill="#FFA8C4"/>
    <circle cx="92" cy="22" r="5" fill="#FFA8C4"/>
    <circle cx="34" cy="20" r="1.6" fill="#ffffff" opacity="0.7"/>
    <circle cx="90" cy="20" r="1.6" fill="#ffffff" opacity="0.7"/>
  </g>

  <!-- chubby face -->
  <ellipse cx="64" cy="74" rx="42" ry="38" fill="#FFE2C4"/>
  <ellipse cx="64" cy="74" rx="42" ry="38" fill="url(#faceShade)"/>

  <!-- ears -->
  <ellipse cx="22" cy="74" rx="6" ry="9" fill="#FFD4B0"/>
  <ellipse cx="106" cy="74" rx="6" ry="9" fill="#FFD4B0"/>

  <!-- bangs / hair on top of face -->
  <path d="M22 60 Q24 38 64 36 Q104 38 106 60 Q96 50 84 52 Q74 44 64 44 Q54 44 44 52 Q32 50 22 60 Z" fill="url(#hairGrad)"/>
  <!-- side hair tufts -->
  <path d="M22 60 Q18 80 26 96 Q22 80 28 64 Z" fill="url(#hairGrad)"/>
  <path d="M106 60 Q110 80 102 96 Q106 80 100 64 Z" fill="url(#hairGrad)"/>

  <!-- blush -->
  <ellipse cx="40" cy="84" rx="10" ry="6" fill="url(#cheekL)"/>
  <ellipse cx="88" cy="84" rx="10" ry="6" fill="url(#cheekR)"/>

  <!-- eyes -->
  <g fill="#2A1A12">
    <ellipse cx="48" cy="74" rx="5.2" ry="7.4"/>
    <ellipse cx="80" cy="74" rx="5.2" ry="7.4"/>
  </g>
  <!-- eye highlights -->
  <g fill="#ffffff">
    <circle cx="50" cy="71" r="2"/>
    <circle cx="82" cy="71" r="2"/>
    <circle cx="46.5" cy="76.5" r="0.9" opacity="0.9"/>
    <circle cx="78.5" cy="76.5" r="0.9" opacity="0.9"/>
  </g>

  <!-- smile -->
  <path d="M58 92 Q64 98 70 92" stroke="#C84848" stroke-width="2.4" stroke-linecap="round" fill="none"/>
  <!-- tiny tongue/lip dot -->
  <circle cx="64" cy="95.5" r="1.2" fill="#FF8A96"/>
</svg>`;
}

async function main() {
  // Master 512px PNG for inspection
  await sharp(Buffer.from(buildSVG(512)))
    .png()
    .toFile(path.join(OUT_DIR, "icon_master.png"));
  console.log("wrote icon_master.png (512x512)");

  for (const size of SIZES) {
    const svg = buildSVG(size);
    const out = path.join(OUT_DIR, `icon${size}.png`);
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
    console.log(`wrote icon${size}.png`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
