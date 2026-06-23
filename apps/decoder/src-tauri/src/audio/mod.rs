// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Audio input for the decoder.
//!
//! [`AudioSource`] is the seam every sample crosses on its way into the decode
//! path; [`WavFileSource`] is the first implementation (file/clip input).
//! [`DeviceSource`] is the live sibling (cpal capture) behind the same trait.

mod device;
mod file;
mod source;

pub use device::{list_input_devices, DeviceInfo, DeviceSource};
pub use file::WavFileSource;
pub use source::{AudioError, AudioSource};
