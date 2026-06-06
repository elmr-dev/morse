# Morse

This monorepo collects the Morse and CW projects under one release and demo surface.

## Projects

- `morse-audio/` contains the TypeScript audio generation libraries, React package, and browser demos.
- `cw-decode/` contains the former `cw-ml` decoder research, training code, and Beat the Bot demo. Its Git history is preserved through the directory move.

The old standalone `cw-decode` tree was intentionally removed during the migration.

## Common Commands

```sh
pnpm install
pnpm test
pnpm run build
```

Run local demos:

```sh
pnpm run dev:morse-audio-demo
pnpm run dev:beat-the-bot
```

Build deployable demos:

```sh
pnpm run build:morse-audio-demo
pnpm run build:beat-the-bot
```

## Deployment

GitHub Pages is built by `.github/workflows/deploy.yml`.

- Morse Audio demo: `https://mdp.github.io/morse/morse-audio/demo/`
- Beat the Bot: `https://mdp.github.io/morse/cw-decode/beat-the-bot/`

## npm Releases

The packages published to npm are:

- `morse-audio` from `morse-audio/packages/morse-audio`
- `react-morse-audio` from `morse-audio/packages/react-morse-audio`

Use `.github/workflows/publish.yml` to bump and publish either package or both packages with npm provenance.
