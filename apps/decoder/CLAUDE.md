# Morse Decoder (Tauri)

Native desktop CW decoder. Tauri 2 + React frontend, Rust backend. Part of the Morse
suite (see `morse-web` for the marketing site + Beat the Bot demo).

## Why this exists / why native

Port of the decoder from `morse-web`. The web version stays as-is; this is a **parallel
native track**, not a migration. Going native buys two things the browser can't:

- **Real-audio test bench for the model.** Live off-air audio straight off the rig into
  the decoder — real noise, fading, bad fists — instead of synthetic tone or recordings.
  This is the primary justification. The model/DSP is Mark's (KC4T) side of the project.
- **Raw PCM + real device selection.** Native audio capture, our choice of input device,
  no browser audio pipeline in the path.

`morse-web` is the storefront (marketing + Beat the Bot). The apps are the serious tools.
The PWA-install layer gets retired once the apps exist; the website does not change.

## Architecture boundaries — DO NOT VIOLATE

- **CW primitives live in `packages/cw-core`, NOT in this app.** Timing, WPM/Farnsworth
  spacing, the dit/dah symbol table, and tone synthesis belong in the shared `cw-core`
  crate because the forthcoming **trainer** app (`radio.morse.trainer`) reuses all of it.
  Do not add CW timing/synthesis logic to this decoder app — put it in `cw-core` and
  consume it here. Burying it here is the one move that quietly kills the suite plan.
  - **`packages/cw-core` does not exist yet** — this decoder is its first consumer, so
    it gets created during this port. Create it at `packages/cw-core` (shared things live
    in `packages/`, matching the TS convention) and reference it as a path dependency:
    `cw-core = { path = "../../../packages/cw-core" }` in `src-tauri/Cargo.toml` (exact
    `../` depth depends on the Cargo workspace root — see Monorepo notes). Do NOT inline
    the primitives just because the crate isn't there yet.
- **Domain logic in Rust, thin shell on top.** The React side is presentation. Decode
  logic, audio handling, and integrations live in Rust so they cross the web/native line
  intact and are reusable by sibling apps.
- **Audio source is a swappable input behind a trait.** The native capture path is one
  implementation. Keep the decoder decoupled from where samples come from so other
  sources (and eventually mobile native capture) can plug in without a rewrite.

## Assets / brand

- **`packages/brand` is the source of truth** for logos, wordmark, the square icon master,
  and shared imagery. The decoder consumes from there — do not recreate or hand-copy brand
  files into this app.
- For now, **copy** the needed assets from `morse-web/public` into `packages/brand` and
  treat `packages/brand` as canonical going forward. `morse-web` still has its own copies
  in `public/` — it gets migrated off them onto `packages/brand` **later**, as its own
  focused change (updating favicon `<head>` links, manifest paths, etc.). Until then the
  files exist in two places; edit them in `packages/brand`, not in web's `public/`.
- **In-app imagery** (logo in header/about/splash) — reference from `packages/brand` like
  any frontend asset (workspace import / Vite alias).
- **OS app icon** is NOT a plain copy. Take the square master (ideally 1024×1024 PNG with
  transparency) from `packages/brand` and run it through Tauri's generator:
  `bun tauri icon packages/brand/<master>.png`, which emits the platform set
  (`.icns` / `.ico` / PNGs) into `src-tauri/icons/`, wired via `tauri.conf.json`. The
  generated set is a **build artifact derived from the master** — don't hand-maintain it,
  don't drop web favicons into `src-tauri/icons`.

## Reused from morse-web

- **QRZ sign-in / verification** carries over directly — it's TS/logic, not UI. Reuse it,
  don't rebuild it.
- React idioms, components, and styling conventions match `morse-web` (React 19 / RR7).
- **Theme: Cosmic Night** (from tweakcn — https://tweakcn.com/), a shadcn/ui token set
  (CSS variables / Tailwind). Reuse the same Cosmic Night tokens `morse-web` uses so the
  decoder reads as part of the suite. (Note: this is the app theme — unrelated to the
  Catppuccin theming used on the homelab/terminal side.)

## Identifiers & suite

- Bundle ID: `radio.morse.decoder`
- Sibling (planned): `radio.morse.trainer` — text-in/audio-out, the inverse of this app,
  shares `cw-core`.
- Shared parent namespace `radio.morse.*` mirrors the `morse.radio` domain.

## Monorepo notes

- Bun/TS workspace cohabits with a Cargo workspace (Tauri = JS frontend + Rust
  `src-tauri`). Shared crates live in `packages/` (e.g. `packages/cw-core`), apps in
  `apps/` (e.g. `apps/decoder/src-tauri`), mirroring the TS package/app split.
- Cleanest layout: **one Cargo workspace at the repo root** whose members are
  `apps/*/src-tauri` and `packages/cw-core`, sharing one `Cargo.lock` and one `target/`
  (the Rust parallel to the Bun workspace's single lockfile). Settle this before wiring
  the path dependency, since the `../` depth in `Cargo.toml` follows from where the root
  sits.
- `morse-web` consumes `cw-core` via WASM (the trainer's tone-gen wants WASM compat for
  the in-browser demo), so keep `cw-core` WASM-friendly — no native-only deps in the
  shared crate; native audio capture stays in the app, not in `cw-core`.

## Stack

- Tauri 2, React frontend. Styling via shadcn/ui with the **Cosmic Night** theme
  (tweakcn), matching `morse-web`.
- Rust toolchain via **rustup** (not brew) — needed for target management (mobile/cross
  later) and rust-analyzer/clippy components.
- macOS: requires `NSMicrophoneUsageDescription` in `src-tauri` Info.plist for mic access,
  or the app crashes on permission request.

## Out of scope (for now)

- **Mobile.** Possible with Tauri but the off-the-shelf mobile audio plugins hand back
  compressed AAC from the system-default device — worse than what we want. Real mobile
  support means writing to native capture APIs (AVAudioEngine / AudioRecord) directly.
  Desktop-first; mobile is an edge case (portable ops) parked until someone asks.
- **Replacing WSJT-X-style decode / Phase 2 of the GridTracker idea** — different project.
