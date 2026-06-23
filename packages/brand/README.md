# @morse/brand

Canonical source of truth for Morse suite brand assets.

## Current contents

Right now this package holds **only the decoder app-icon masters**. The rest of the brand
identity — the web/PWA icons, favicon, wordmark logo, social/OG image, and the theme CSS —
is still owned by `apps/web`, and migrates into this package as its own focused change
(see the web asset migration + theme fold sub-issues of #48). Until then, those files live
in `apps/web/public/`, not here.

```
decoder-icon.svg             # vector source — full-bleed master
decoder-icon-1024.png        # rendered full-bleed master
decoder-icon-macos.svg       # vector source — macOS squircle master
decoder-icon-macos-1024.png  # rendered macOS master (baked squircle, transparent corners)
```

## Icon masters

These are **source artwork** — hand-authored; the PNGs are rendered from their matching
`.svg`. Edit the SVGs and re-render; don't hand-edit the PNGs.

They are the inputs to Tauri's icon generator, e.g.:

```
bun tauri icon packages/brand/decoder-icon-macos-1024.png
```

which emits the decoder's OS icon set under `apps/decoder/src-tauri/icons/` — a generated
artifact, likewise not hand-edited. Tauri's generator only resizes/packs; it does **not**
add macOS padding, so the macOS `.icns` is generated from the pre-padded
`decoder-icon-macos-1024.png` (the squircle with transparent corners), while a future
full-bleed/Windows master derives from `decoder-icon-1024.png`.
