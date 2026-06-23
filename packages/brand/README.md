# @morse/brand

Canonical source of truth for all Morse suite brand assets.

## Structure

```
masters/   # SOURCE artwork — hand-authored inputs to icon generation
  icon-1024.png            # full-bleed square master (web/PWA/iOS/og)
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

The square master under `masters/` is also what `bun tauri icon <master>.png` consumes to
produce the decoder's OS icon set under `apps/decoder/src-tauri/icons/` — itself a
generated artifact, likewise not hand-edited.

## Notes

`apps/web/public/` still holds duplicate copies of the favicon/icons/og image pending a
future migration onto this package — intentionally out of scope here.
