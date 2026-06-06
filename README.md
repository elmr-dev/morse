# Morse

This monorepo collects the Morse and CW projects under one release and demo surface.

## Projects

- `morse-audio/` contains the TypeScript audio generation libraries, React package, and browser demos.
- `cw-decode/` contains the browser CW decoder demo app from `origin/main`, including Decode and Beat the Bot.
- `ml/` contains the former `cw-ml` decoder research, DSP research loop, training code, and experiment notes. Its Git history is preserved through directory moves.

The branch-only waterfall, contest helper, and single decoder app experiments are intentionally not active in this Phase 1 cleanup. They can be reintroduced into `cw-decode` in Phase 2.

## Common Commands

```sh
pnpm install
pnpm test
pnpm run build
```

Run local demos:

```sh
pnpm run dev:morse-audio-demo
pnpm run dev:cw-decode
```

Build deployable demos:

```sh
pnpm run build:morse-audio-demo
pnpm run build:cw-decode
```

## Deployment

GitHub Pages is built by `.github/workflows/deploy.yml`.

- Morse Audio demo: `https://mdp.github.io/morse/morse-audio/demo/`
- CW Decode: `https://mdp.github.io/morse/cw-decode/decode`
- Beat the Bot: `https://mdp.github.io/morse/cw-decode/beat-the-bot`

## npm Releases

The packages published to npm are:

- `morse-audio` from `morse-audio/packages/morse-audio`
- `react-morse-audio` from `morse-audio/packages/react-morse-audio`

Use `.github/workflows/publish.yml` to bump and publish either package or both packages with npm provenance.
