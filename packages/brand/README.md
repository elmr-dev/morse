# @morse/brand

Canonical source of truth for all Morse suite brand assets.

## Structure

```
masters/   # SOURCE artwork — hand-authored inputs to icon generation
  icon.svg                 # vector source of truth for the icon glyph
  icon-1024.png            # full-bleed square master (web/PWA/iOS/og)
  icon-macos-1024.png      # macOS-padded ~80% master (squircle tile, transparent margins)
icons/     # GENERATED outputs — do NOT hand-edit; fix the master & regenerate
  favicon.svg
  apple-touch-icon.png
  icon-192.png
  icon-512.png
  icon-maskable-512.png
logo/      # logo.svg — primary wordmark / logo glyph
social/    # og.png — Open Graph / social card image
```

### `masters/` vs `icons/`

`masters/` holds the **source** artwork — the hand-authored inputs. `icons/` holds the
**generated** outputs derived from those masters. Do not hand-edit anything under
`icons/`: fix the master and regenerate. The split makes that rule structural rather than
a convention to remember.

`icon.svg` is the editable source; both PNG masters are rendered from it. Edit the SVG
and re-render — don't touch the PNGs by hand.

The masters under `masters/` are what `bun tauri icon <master>.png` consumes to produce the
decoder's OS icon set under `apps/decoder/src-tauri/icons/` — itself a generated artifact,
likewise not hand-edited. Tauri's generator only resizes/packs; it does **not** add macOS
padding, so the macOS `.icns` is generated from the pre-padded `icon-macos-1024.png` while
the other platforms use the full-bleed `icon-1024.png`.

## Notes

`apps/web/public/` still holds duplicate copies of the favicon/icons/og image pending a
future migration onto this package — intentionally out of scope here.
