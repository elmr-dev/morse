<!--
SPDX-FileCopyrightText: 2026 John Schult, Mark Percival

SPDX-License-Identifier: MIT
-->

# cw-core

Canonical, mode-agnostic CW (Morse) primitives shared across the Morse suite. The crate is WASM-friendly — it compiles cleanly to `wasm32-unknown-unknown` and carries no native-only dependencies (no `ort`, audio, DSP, or `tauri`) — so both the native Tauri decoder and `morse-web` (later, via WASM) can depend on it. The first primitive is the ITU Morse symbol table (dit/dah lookup + prosigns), ported verbatim from `packages/morse-audio/src/utils/morse-code.ts`.
