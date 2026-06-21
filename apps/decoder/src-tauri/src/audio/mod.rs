// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Audio input for the decoder.
//!
//! [`AudioSource`] is the seam every sample crosses on its way into the decode
//! path. Live microphone capture and file/clip input are implementations behind
//! this trait, so consumers never depend on where samples come from.

mod source;

pub use source::{AudioError, AudioSource};
