# @morse/brand

Canonical source of truth for all Morse suite brand assets.

## Contents

- `logo.svg` — primary wordmark / logo
- `favicon.svg` — favicon source
- `icon-192.png`, `icon-512.png` — PWA icons
- `icon-maskable-512.png` — maskable PWA icon
- `apple-touch-icon.png` — Apple touch icon
- `og.png` — Open Graph image

## Notes

`apps/web/public/` still holds duplicates pending a future migration that is intentionally out of scope here.

The OS icon set under `apps/decoder/src-tauri/icons/` is a generated artifact produced by `bun tauri icon <master>.png` — do not hand-edit those files.
