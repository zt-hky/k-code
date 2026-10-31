# Brand icons

K-code's artwork lives in `assets/brand`:

- `kcode-mark.svg`: rounded ink tile with the ocean→lagoon "K_" (full detail, used at 64px and up)
- `kcode-mark-small.svg`: heavier K without border/cursor, used below 64px (favicons, tray)
- `kcode-mark-transparent.svg`: the glyph only
- `kcode-logo.svg` / `kcode-logo-light.svg`: mark + wordmark for dark / light backgrounds
- `palette.json`: brand colors
- `png/`, `favicon.ico`, `icon.ico`, `icon.icns`: generated renditions (the 1024px PNG is the master for the mobile app icon)

Run `vp run icons:export` from the repository root to regenerate every raster, ICO and ICNS output, including:

- the per-channel files in `assets/prod`, `assets/nightly` and `assets/dev` consumed by `scripts/lib/brand-assets.ts` (all channels ship the same K-code artwork; only the file names differ)
- the web app and marketing site favicons, apple-touch icon and PWA icons
- the marketing `icon.webp`, `icon-nightly.webp` and `social-card.webp`

Run `vp run icons:check` to verify the tracked outputs match the SVG masters without changing files.

Do not edit the generated PNG, ICO, ICNS or WEBP files directly; edit the SVG masters or `scripts/brand/generate-icons.mjs`.

## Mobile

The `app-icon.icon` Icon Composer projects and the Android artwork pipeline (`vp run icons:export:android`) still carry the upstream T3 mark. The native mobile app icons are out of scope for the rebrand; `assets/brand/png/1024.png` is ready for when they are replaced.
