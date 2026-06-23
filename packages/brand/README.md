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
theme/     # consumed by every app — the shared design system (CSS)
  tokens.css        # :root (light) + .dark (dark) generic oklch vars
  theme-inline.css  # @theme inline Tailwind v4 token→utility mapping
  fonts.css         # @fontsource imports + --font-* declarations
  motion.css        # generic keyframes/animations (slide, fade)
  theme.css         # barrel — @imports the four above, in order
```

## `theme/` — shared design system

The generic identity layer (the oklch palette, Tailwind v4 token mappings,
self-hosted fonts, and generic motion), extracted from `apps/web` so both apps
read the same theme. Consume it once, after `@import "tailwindcss"` and before
your app-local layers:

```css
@import "tailwindcss";
@import "@morse/brand/theme/theme.css";
@custom-variant dark (&:is(.dark *)); /* see note */
/* ...app-local CW-domain tokens / motion / shell... */
```

Order is load-bearing: the generic tokens must resolve before any app-local
token that references them (e.g. `--tier-general: var(--primary)`).

**Two Tailwind directives stay in the app entry, not here:** `@custom-variant`
(the `dark` variant) and the `prefers-reduced-motion` `@layer base` block.
Tailwind v4 only hoists `@theme` (and plain rules) out of imported package CSS —
`@custom-variant` / `@layer` in an imported file are not registered — so each
consuming app declares those in its own entry stylesheet alongside
`@import "tailwindcss"`.

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
