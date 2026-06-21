# Slice 0 — Cargo workspace (repo root) + brand plumbing + runtime declared

**Repo:** `/Users/johnschult/code/morse` (Turborepo + Bun monorepo)
**App under construction:** `apps/decoder` (Tauri 2 + React, native CW decoder)
**Read first:** `apps/decoder/CLAUDE.md` — it encodes the load-bearing architecture rules. This slice executes the "Monorepo notes" + "Assets / brand" sections. Do not violate any boundary in that file.

This is foundation only. **No features, no decode, no audio, no `cw-core` code.** The goal is a clean Cargo workspace at the repo root, a canonical `packages/brand`, the OS icon wired from the brand master, and the native ONNX runtime (`ort`) *declared* (not used) so the next slices aren't surprised. One concern per commit — see the commit plan at the end.

## Context that determines the work

- The decoder currently has a **standalone** `src-tauri/Cargo.toml` (`[package]`, no `[workspace]`), with its own `src-tauri/Cargo.lock` and `src-tauri/target/`. We are promoting Rust to a **single workspace at the repo root**, mirroring the Bun workspace's single lockfile. Members: `apps/*/src-tauri` and `packages/cw-core` (the crate doesn't exist yet — declared as a member now, created in Slice 1).
- **Runtime decision (locked): native `ort` crate.** Inference runs in the Rust backend, NOT onnxruntime-web/WASM in the webview. This slice only adds `ort` to `apps/decoder/src-tauri/Cargo.toml` deps and confirms it resolves/builds — it wires nothing. (Consequence for later slices, not this one: DSP + CTC greedy decode also become Rust. Out of scope here.)
- **`crossOriginIsolated` / COOP / COEP does NOT apply to this app.** That invariant is `morse-web`-only (threaded onnxruntime-web). The native decoder escapes it entirely — do not add COOP/COEP headers to the decoder's Vite config.
- Turbo does not orchestrate Cargo. The decoder's Turbo `build`/`dev` stay Vite-only; Cargo compiles under `tauri dev`/`tauri build`. The Cargo workspace lives *beside* Turbo, not inside it. Do not add Cargo tasks to `turbo.json`.

## Part A0 — Vite already on 8 (ALREADY DONE — verify only, do not re-upgrade)

The decoder was already upgraded to Vite `^8.0.4` + `@vitejs/plugin-react` `^6.0.1` to match `morse-web` (prior session). **Do NOT bump Vite again.** Just confirm:

1. Check `apps/decoder/package.json` already shows `vite` `^8.x` and `@vitejs/plugin-react` `^6.x`. If somehow still on 7/4, bump to `^8.0.4`/`^6.0.1` and `bun install` — but expect 8/6 already.
2. Smoke-check `bun run tauri dev` from `apps/decoder` opens a working native window (not blank/404) loading the app. Exit after confirming. No commit for this part.

## Part A — Cargo workspace at repo root

1. **Create `/Users/johnschult/code/morse/Cargo.toml`** as a virtual workspace manifest (no root `[package]`):
   ```toml
   [workspace]
   resolver = "2"
   members = [
     "apps/decoder/src-tauri",
     # "packages/cw-core",  # created in Slice 1 — uncomment when it exists
   ]

   [workspace.package]
   edition = "2021"
   ```
   Leave `packages/cw-core` commented out — adding a non-existent member makes `cargo` error. Slice 1 creates the crate and uncomments this line.

2. **Edit `apps/decoder/src-tauri/Cargo.toml`** to participate in the workspace. Keep the existing `[package]`, `[lib]`, `[build-dependencies]`, `[dependencies]`. Fix boilerplate:
   - `description = "Native desktop CW decoder (Morse suite)"`
   - `authors = ["John Schult W4GIT", "Mark Percival KC4T"]`
   - leave `name = "decoder"`, `version = "0.1.0"`, `[lib] name = "decoder_lib"` as-is.

3. **Delete the redundant member-level lock** so the workspace owns it: remove `apps/decoder/src-tauri/Cargo.lock` (a fresh root `Cargo.lock` is generated at the workspace root on first build). The per-crate `target/` is superseded by a root `target/`; ensure the root `target/` is gitignored (Part E).

4. **Verify the workspace resolves** before anything else:
   ```
   cargo metadata --format-version 1 --manifest-path Cargo.toml >/dev/null && echo OK
   ```
   Must print `OK`. If it errors, stop and report.

## Part B — `ort` declared (not wired)

Add the native ONNX runtime to the decoder's deps so Slice 3 isn't a cold start:

```toml
ort = { version = "2", default-features = false, features = ["ndarray"] }
ndarray = "0.16"
```

- Use whatever exact 2.x `cargo add ort` resolves to; don't pin a guess.
- `default-features = false` keeps binary-download behavior explicit. If `ort` needs a documented feature toggle to fetch a prebuilt runtime on macOS arm64, enable that — but add NO code.
- **Do not** `use ort::...` anywhere. No session, no model load. Done when `cargo build` at the workspace root succeeds with `ort` in the tree. If `ort` 2.x can't resolve cleanly without code, report the exact error and stop.

## Part C — `packages/brand` (canonical assets)

Per `CLAUDE.md` "Assets / brand": `packages/brand` becomes source of truth. Create it and copy assets in; `morse-web` is NOT migrated off its `public/` copies here (later change — files in two places for now is expected).

1. **Create `packages/brand/`** with a minimal `package.json`:
   ```json
   {
     "name": "@morse/brand",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "exports": { "./*": "./*" }
   }
   ```
   Asset-only — no build step, no Turbo tasks.

2. **Inventory `apps/web/public`** for brand assets (logo/wordmark SVG, CW-bars purple glyph, favicon source, any square icon master). Report the inventory, then copy the brand-identity files (NOT web chrome like `_headers`, `_redirects`, `manifest`, robots) into `packages/brand/`. If there is **no** 1024×1024 square PNG master, say so explicitly — Part D needs one and we'll decide how to source it.

3. **Add a `README.md`** stating it's canonical source of truth, that `morse-web/public` still holds duplicates pending a later migration, and that the OS icon set under `apps/decoder/src-tauri/icons/` is a generated artifact (don't hand-edit).

## Part D — OS app icon from the brand master

Only if Part C found (or you created from a high-res source) a square 1024×1024 PNG master in `packages/brand`. If not, **skip D, report, and stop** — don't fabricate an icon.

1. From `apps/decoder`: `bun tauri icon ../../packages/brand/<master>.png` (adjust path). Regenerates `src-tauri/icons/`.
2. Confirm `tauri.conf.json`'s `bundle.icon` array still points at the generated files.
3. Do not hand-edit `src-tauri/icons/`.

## Part E — gitignore + boilerplate cleanup

1. **Repo-root `.gitignore`** — ensure a Rust section ignores the workspace target:
   ```
   # Rust / Cargo
   target/
   gen/schemas/
   ```
   (If these already exist from earlier hygiene work, leave them.) The root `Cargo.lock` IS committed (workspace with binary apps).
2. **`tauri.conf.json`** — change `productName` `"decoder"` -> `"Morse Decoder"` and window `title` `"decoder"` -> `"Morse Decoder"`. Leave `identifier: radio.morse.decoder`, version, and dev URL untouched.

## Verification gate (must pass before declaring done)

0. **(Part A0 smoke check)** `bun run tauri dev` launches a working native window on the existing Vite 8 — not blank/404.
1. `cargo metadata --format-version 1 --manifest-path Cargo.toml >/dev/null && echo OK`.
2. `cargo build --manifest-path apps/decoder/src-tauri/Cargo.toml` — compiles with `ort` in the tree (first build downloads the ONNX Runtime binary; expected).
3. From `apps/decoder`: `bun run tauri dev` shows the boilerplate React app titled "Morse Decoder". Confirm it launches, then exit.
4. `bunx turbo check typecheck build --filter=morse-web` — morse-web still passes untouched (regression guard).
5. `git status` shows: new root `Cargo.toml` + `Cargo.lock`, deleted member `Cargo.lock`, new `packages/brand/**`, modified decoder `Cargo.toml` + `tauri.conf.json`, root `.gitignore` (if changed), regenerated `src-tauri/icons/**` (if Part D ran). Nothing under `apps/web/src` modified.

## Commit plan (one concern per commit — do NOT auto-commit; John reviews diffs)

1. `chore(decoder): promote Rust to a Cargo workspace at repo root`
2. `chore(decoder): declare native ort runtime (not yet wired)`
3. `feat(brand): create packages/brand as canonical asset source`
4. `chore(decoder): generate OS icon set from brand master` *(only if Part D ran)*
5. `chore(decoder): set product name + window title to "Morse Decoder"`

## Out of scope

- No `packages/cw-core` crate / symbol table / CW logic (Slice 1).
- No audio trait, capture, file input (Slice 2).
- No `ort` usage — no session, model load, decode (Slice 3).
- No COOP/COEP headers on the decoder.
- No migrating `morse-web` off its `public/` brand copies.
- No touching inference/model/DSP, `morse-web/vite.config.ts`, or `public/_headers`.
- No Cargo tasks in `turbo.json`.
