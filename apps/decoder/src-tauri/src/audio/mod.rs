// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Audio input and monitor passthrough for the decoder.
//!
//! [`AudioSource`] is the seam every sample crosses on its way into the decode
//! path; [`WavFileSource`] is the first implementation (file/clip input).
//! [`DeviceSource`] is the live sibling (cpal capture) behind the same trait.
//! [`MonitorHandle`] manages the real-time audio passthrough from an input
//! device to an output device, decoupled from the decode pipeline.

mod device;
mod file;
pub mod monitor;
mod source;

pub use device::{list_input_devices, DeviceInfo, DeviceSource};
pub use file::WavFileSource;
pub use monitor::{list_output_devices, MonitorHandle};
pub use source::{AudioError, AudioSource};
