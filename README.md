# Morse

A Turborepo + Bun monorepo for Morse/CW audio generation and ML-based decoding.

## Workspaces

| Path | Name | Published | What it is |
| --- | --- | --- | --- |
| `apps/web` | `morse-web` | no | The **Morse** web app (Vite + React + TS) — the CW decoder and Beat the Bot demos |
| `packages/morse-audio` | `morse-audio` | npm | Core morse audio generation + radio effects + streaming engine (framework-agnostic) |
| `packages/react-morse-audio` | `react-morse-audio` | npm | React components and hooks built on `morse-audio` |
| `packages/typescript-config` | `typescript-config` | no | Shared `tsconfig` presets (`base`, `react-library`) |
| `packages/ml/model` | `cw-model` | no | PyTorch training + ONNX export pipeline that produces the model `morse-web` ships (Python/uv; a Turbo workspace member so its tasks are orchestrated) |
| `packages/ml/cw-dsp-research` | — | no | DSP envelope autoresearch loop (Python/uv; **not** a Turbo workspace member — its deliverable is `dsp.py`, synced by hand into `model/data/dsp.py`) |

> `archive/` is reference-only and is never built, linted, or tested.

## Prerequisites

- [Bun](https://bun.sh) `1.3.14` (pinned via `packageManager`)
- [uv](https://docs.astral.sh/uv/) — only for the `packages/ml` Python pipeline. Install it once at the system level: `brew install uv`. `uv` then manages the Python interpreter and deps itself (`uv sync` / `uv run` auto-sync from each project's `pyproject.toml`).

## Setup

```sh
bun install
```

This also installs the Git hooks (via the `prepare` script → `lefthook install`).

## Common commands

Tasks are orchestrated by Turborepo and run across every workspace, in dependency
order (`morse-audio` builds before its dependents). Run them from the repo root:

```sh
bunx turbo build      # build all packages (tsup / vite)
bunx turbo test       # run all tests (Vitest)
bunx turbo typecheck  # type-check with tsc (no emit)
bunx turbo check      # lint + format check (Biome), no writes
bunx turbo check:fix  # lint + format and apply fixes (Biome)
bunx turbo dev        # run all dev servers (persistent)
```

Scope a task to one workspace with `--filter`:

```sh
bunx turbo build --filter=morse-audio
bunx turbo test --filter=morse-web
```

Or run a single app's script directly:

```sh
cd apps/web && bun run dev      # Vite dev server
cd apps/web && bun run preview  # preview a production build
```

## ML model pipeline (`cw-model`)

The decoder `morse-web` ships — `apps/web/public/model/cw_model_full.onnx` — is
produced by the `cw-model` workspace and committed to the repo. The web build
just reads that committed file; it does **not** rebuild the model. Regenerate it
only when the checkpoint changes.

First, install the Python deps for the ML projects (needs `uv` — see Prerequisites):

```sh
bun run setup:python   # uv sync for packages/ml/model + packages/ml/cw-dsp-research
```

Then the Turbo-orchestrated tasks (run from the repo root):

```sh
bun run model:export   # export best.pt -> ONNX, then copy into apps/web/public/model
bun run model:train    # train CWNet locally (heavy; full runs go to RunPod)
```

Or invoke the tasks directly with Turbo:

```sh
bunx turbo export:onnx --filter=cw-model   # best.pt + config -> checkpoints/cw_model_full.onnx (cached)
bunx turbo sync:web    --filter=cw-model   # export + copy the ONNX into apps/web/public/model
bunx turbo generate    --filter=cw-model   # synthetic training/val WAVs
bunx turbo train       --filter=cw-model   # local training run
```

Only `export:onnx` is cached — it re-runs only when the checkpoint, config,
export script, or model code changes. `generate`/`train` are heavy,
non-deterministic, and run deliberately, so they are never cached; the committed
`checkpoints/best.pt` is the curated artifact `export:onnx` consumes.

## Linting & formatting

[Biome](https://biomejs.dev) handles both, configured at the root in `biome.json`
(only `*.ts`/`*.tsx` are checked; `archive/` is excluded). Each workspace exposes
`check` and `check:fix` scripts that Turbo drives.

## Git hooks

[lefthook](https://lefthook.dev) runs a `pre-commit` gate (`lefthook.yml`),
sequentially, stopping at the first failure:

1. `turbo check:fix` on staged `*.{ts,tsx}` (auto-fixes are re-staged into the commit)
2. `turbo typecheck`
3. `turbo test`

It's installed automatically by `bun install`. Bypass in a pinch with
`LEFTHOOK=0 git commit …`.

## Versioning

Bump the publishable packages independently (each from its own current version):

```sh
bun run bump
```

This runs [bumpp](https://github.com/antfu-collective/bumpp) once per published
package, prompting for the new version and creating the version commit + tag.

## Publishing

```sh
bun run publish:packages
```

Publishes `morse-audio` and `react-morse-audio` to npm with public access.

## Deployment

`apps/web` deploys to GitHub Pages via `.github/workflows/deploy.yml` on push to
`main`. The app builds to `apps/web/dist` and serves at the Pages root.
