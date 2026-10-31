#!/usr/bin/env node
// Regenerates every raster/ico/icns K-code icon from the SVG masters in assets/brand.
// Run with no args to write outputs, or --check to fail if any output is stale.
// Masters: kcode-mark.svg (full tile, >= 64px), kcode-mark-small.svg (< 64px).
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import sharp from "sharp";

import { BRAND_ASSET_PATHS } from "../lib/brand-assets.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "../lib/icon-export.ts";

const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../..",
);
const check = process.argv.includes("--check");
const brandDir = NodePath.join(repoRoot, "assets/brand");
const SMALL_BELOW = 64;
const PNG_SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024];

const read = (name) => NodeFS.readFileSync(NodePath.join(brandDir, name), "utf8");
const fullSvg = read("kcode-mark.svg");
const smallSvg = read("kcode-mark-small.svg");
const transparentSvg = read("kcode-mark-transparent.svg");
const flatSvg = fullSvg
  .replace(/<rect width="1024" height="1024" rx="\d+"/, '<rect width="1024" height="1024"')
  .replace(/\s*<rect x="6"[^>]*\/>/, "");

const render = (svg, size) =>
  sharp(Buffer.from(svg), { density: Math.max(72, (size / 1024) * 72 * 4) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

const tilePng = (size) => render(size < SMALL_BELOW ? smallSvg : fullSvg, size);

/** macOS pre-Tahoe style: 824px body inset 100px with a soft native-like shadow. */
async function macPng(size = 1024) {
  const body = await render(fullSvg, 824);
  const shadow = await sharp({
    create: { width: 824, height: 824, channels: 4, background: "#000000" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="824" height="824"><rect width="824" height="824" rx="184" fill="#fff"/></svg>',
        ),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
  const blurred = await sharp(shadow)
    .extend({ top: 100, bottom: 100, left: 100, right: 100, background: "#00000000" })
    .blur(18)
    .linear([1, 1, 1, 0.45], [0, 0, 0, 0])
    .png()
    .toBuffer();
  const out = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: "#00000000" },
  })
    .composite([
      { input: blurred, left: 0, top: 12 },
      { input: body, left: 100, top: 100 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
  return size === 1024 ? out : sharp(out).resize(size, size).png().toBuffer();
}

function encodeIcns(entries) {
  const chunks = entries.map(([type, data]) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, "ascii");
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const total = 8 + chunks.reduce((n, c) => n + c.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...chunks]);
}

async function ico(sizes) {
  const images = await Promise.all(
    sizes.map(async (size) => ({ size, contents: await tilePng(size) })),
  );
  return encodePngIco(images);
}

const outputs = new Map();
const put = (relative, contents) => outputs.set(relative, contents);

// assets/brand
for (const size of PNG_SIZES) put(`assets/brand/png/${size}.png`, await tilePng(size));
put("assets/brand/png/mark-transparent-512.png", await render(transparentSvg, 512));
put("assets/brand/favicon.ico", await ico([16, 32, 48]));
put("assets/brand/icon.ico", await ico([...WINDOWS_ICON_SIZES]));
const icnsSizes = [
  ["icp4", 16],
  ["icp5", 32],
  ["ic11", 32],
  ["ic12", 64],
  ["ic07", 128],
  ["ic13", 256],
  ["ic08", 256],
  ["ic14", 512],
  ["ic09", 512],
  ["ic10", 1024],
];
put(
  "assets/brand/icon.icns",
  encodeIcns(await Promise.all(icnsSizes.map(async ([type, size]) => [type, await macPng(size)]))),
);

// Per-channel files consumed by the desktop/server/web build scripts. Every channel ships the
// same K-code artwork; only the file names (from scripts/lib/brand-assets.ts) differ.
const flat = (size) => render(flatSvg, size);
const channels = [
  {
    ios: BRAND_ASSET_PATHS.productionIosIconPng,
    mac: BRAND_ASSET_PATHS.productionMacIconPng,
    universal: BRAND_ASSET_PATHS.productionLinuxIconPng,
    windows: BRAND_ASSET_PATHS.productionWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    appleTouch: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
  },
  {
    ios: BRAND_ASSET_PATHS.nightlyIosIconPng,
    mac: BRAND_ASSET_PATHS.nightlyMacIconPng,
    universal: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
    windows: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
    appleTouch: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
  },
  {
    ios: BRAND_ASSET_PATHS.developmentIosIconPng,
    mac: BRAND_ASSET_PATHS.developmentDesktopIconPng,
    universal: BRAND_ASSET_PATHS.developmentUniversalIconPng,
    windows: BRAND_ASSET_PATHS.developmentWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    appleTouch: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
  },
];
const shared = {
  ios: await flat(1024),
  mac: await macPng(),
  universal: await render(fullSvg, 1024),
  windows: await ico([...WINDOWS_ICON_SIZES]),
  faviconIco: await ico([16, 32, 48]),
  favicon16: await tilePng(16),
  favicon32: await tilePng(32),
  appleTouch: await flat(180),
};
for (const channel of channels) {
  for (const [key, relative] of Object.entries(channel)) put(relative, shared[key]);
}

// Public copies for the web app and marketing site (favicons, apple-touch-icon, PWA icons).
for (const dir of ["apps/web/public", "apps/marketing/public"]) {
  put(`${dir}/favicon.ico`, shared.faviconIco);
  put(`${dir}/favicon-16x16.png`, shared.favicon16);
  put(`${dir}/favicon-32x32.png`, shared.favicon32);
  put(`${dir}/apple-touch-icon.png`, shared.appleTouch);
}
put("apps/web/public/icon-192.png", await flat(192));
put("apps/web/public/icon-512.png", await flat(512));
put("apps/web/public/icon-maskable-512.png", await maskable(512));
put("apps/marketing/public/kcode-mark.svg", Buffer.from(fullSvg));

/** Maskable PWA icon: full-bleed tile with the glyph inside the 80% safe zone. */
async function maskable(size) {
  const glyph = await render(transparentSvg, Math.round(size * 0.95));
  return sharp({ create: { width: size, height: size, channels: 4, background: "#05080D" } })
    .composite([{ input: glyph, gravity: "center" }])
    .png()
    .toBuffer();
}

// Marketing raster art (astro image imports + social card).
const marketingAssets = NodePath.join("apps/marketing/src/assets");
put(
  `${marketingAssets}/icon.webp`,
  await sharp(await macPng())
    .resize(512)
    .webp({ quality: 92 })
    .toBuffer(),
);
put(
  `${marketingAssets}/icon-nightly.webp`,
  await sharp(await macPng())
    .resize(512)
    .webp({ quality: 92 })
    .toBuffer(),
);
const socialSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0A1220"/><stop offset="1" stop-color="#05080D"/></linearGradient>
    <radialGradient id="glow" cx="0.85" cy="0.1" r="0.7"><stop stop-color="#1677FF" stop-opacity=".35"/><stop offset="1" stop-color="#1677FF" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#glow)"/>
  <text x="96" y="372" font-family="Inter, 'Segoe UI', system-ui, sans-serif" font-size="112" font-weight="700" letter-spacing="-3" fill="#E6F1FF">K<tspan fill="#38BDF8">-</tspan>code</text>
  <text x="100" y="440" font-family="Inter, 'Segoe UI', system-ui, sans-serif" font-size="38" fill="#8BA3C2">The open GUI for your coding agents.</text>
  <text x="100" y="560" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="26" fill="#38BDF8">kcode.agentbox.io.vn</text>
</svg>`;
const socialBase = await sharp(Buffer.from(socialSvg)).png().toBuffer();
put(
  `${marketingAssets}/social-card.webp`,
  await sharp(socialBase)
    .composite([{ input: await render(fullSvg, 150), left: 98, top: 96 }])
    .webp({ quality: 90 })
    .toBuffer(),
);

const stale = [];
for (const [relative, contents] of outputs) {
  const target = NodePath.join(repoRoot, relative);
  if (check) {
    const existing = NodeFS.existsSync(target) ? NodeFS.readFileSync(target) : null;
    const sum = (b) => NodeCrypto.createHash("sha256").update(b).digest("hex");
    if (existing === null || sum(existing) !== sum(contents)) stale.push(relative);
  } else {
    NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
    NodeFS.writeFileSync(target, contents);
  }
}
if (check) {
  if (stale.length > 0) {
    console.error(`Stale brand icons:\n${stale.map((p) => `- ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`Brand icons are up to date (${outputs.size} files).`);
} else {
  console.log(`Wrote ${outputs.size} brand icon files.`);
}
