// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Audio input for the decoder.
//!
//! [`AudioSource`] is the seam every sample crosses on its way into the decode
//! path; [`WavFileSource`] is the first implementation (file/clip input). Live
//! microphone capture is a future sibling implementation behind the same trait.

mod file;
mod source;

pub use file::WavFileSource;
pub use source::{AudioError, AudioSource};
