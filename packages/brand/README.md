# @morse/brand

Single source of truth for Morse suite brand assets, organized by the app that consumes
them. Both `apps/web` and `apps/decoder` consume from here.

## Layout

```
decoder/   # consumed by apps/decoder — app-icon masters (source art)
  icon.svg              # full-bleed master (vector source)
  icon-1024.png         # full-bleed master (rendered)
  icon-macos.svg        # macOS squircle master (vector source)
  icon-macos-1024.png   # macOS master: baked squircle, transparent corners (rendered)
web/       # consumed by apps/web — favicon, PWA icons, wordmark, social
  favicon.svg
  apple-touch-icon.png
  icon-192.png
  icon-512.png
  icon-maskable-512.png
  logo.svg
  og.png
```

The shared theme CSS folds in later as `theme/` (extracted from `apps/web`).

## `decoder/` — icon masters

Source artwork for the decoder's app icon: the Morse-**D** glyph (purple pill *dah* +
purple/pink *dit* dots on `#0F0F1A`). The PNGs render from their matching `.svg` — edit
the SVGs and re-render; don't hand-edit the PNGs.

These feed Tauri's icon generator:

```
bun tauri icon packages/brand/decoder/icon-macos-1024.png
```

which emits the OS icon set under `apps/decoder/src-tauri/icons/` — a generated artifact,
likewise not hand-edited. Tauri only resizes/packs; it does **not** add macOS padding, so
the macOS `.icns` uses the pre-padded `icon-macos-1024.png` squircle, while a future
full-bleed / Windows icon derives from `icon-1024.png`.

## `web/` — web assets

Favicon, PWA manifest icons, wordmark, and OG image for `apps/web`. **Not yet consumed
from here** — `apps/web` still references its own copies under `apps/web/public/`. The web
migration repoints web's `index.html` / manifest / meta tags at these and removes the
duplicates. Until then, treat these as the canonical copies and edit them here.

> Note: `apps/web/public/` also has a `favicon.ico` and a `splash/` set (PWA launch
> screens) that aren't mirrored here yet; folding those in is part of the web migration.
