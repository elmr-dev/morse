// SPDX-FileCopyrightText: 2026 John Schult, Mark Percival
//
// SPDX-License-Identifier: MIT

//! `cw-core` — mode-agnostic shared CW (Morse) primitives for the Morse suite.
//!
//! This crate carries **no native-only dependencies** (no `ort`, no audio, no
//! DSP, no `tauri`) and compiles cleanly to `wasm32-unknown-unknown`, so both
//! the native Tauri decoder and `morse-web` (later, via WASM) can consume it.
//!
//! The first primitive is the dit/dah Morse symbol table in [`symbols`].
//!
//! ## Parity
//!
//! The symbol table is a **faithful port** of the TypeScript source of truth at
//! `packages/morse-audio/src/utils/morse-code.ts` (`MORSE_CODE` + `PROSIGNS`).
//! Same characters, same patterns — do not add, drop, or "improve" entries.

pub mod symbols;

pub use symbols::*;
