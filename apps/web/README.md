# Morse (web app)

The **Morse** web app — a browser CW decoder and "Beat the Bot" practice tool,
built with Vite + React + TypeScript. ML inference runs in the browser via
`onnxruntime-web`; audio generation comes from the workspace `morse-audio` package.

This app is part of the monorepo — see the [root README](../../README.md) for the
full toolchain (Turborepo, Bun, Biome, lefthook).

## Develop

From the repo root:

```sh
bun install              # once, installs all workspaces
bunx turbo dev --filter=morse-web
```

Or from this directory:

```sh
bun run dev       # Vite dev server (HMR)
bun run build     # production build to dist/ (Vite; no type-check)
bun run typecheck # tsc --noEmit type-check
bun run preview   # serve the production build locally
bun run test      # Vitest
bun run check       # Biome lint + format check
bun run check:fix   # Biome, applying fixes
bun run reuse:fix   # annotate all source files with correct SPDX headers
```

## Stack

- **Vite** + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4** + **shadcn/ui** (Radix primitives) for accessible UI
- **onnxruntime-web** for in-browser model inference
- **Vitest** for tests, **Biome** for lint/format (no ESLint)

## Licensing

This package is licensed under **AGPL-3.0-or-later** (see `LICENSE.md`).
Third-party files carry their own headers:

- `src/components/ui/` — shadcn/ui components, MIT © 2023 shadcn
- `public/ort/` — ONNX Runtime Web, MIT © Microsoft Corporation
- `public/fonts/` — DSEG7Classic, OFL-1.1 © Keshikan

SPDX compliance is enforced at commit time via `reuse lint` (lefthook pre-commit).
If a new file is flagged, run `bun run reuse:fix` to annotate the whole package,
then re-stage and commit.

## Notes

- The Vite dev server sets `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`
  headers required by the ONNX WASM runtime (see `vite.config.ts`).
- No `base` path is set, so the app serves at the site root in dev and on Pages.
