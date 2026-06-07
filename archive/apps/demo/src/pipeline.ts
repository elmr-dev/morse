import {
  applyBandwidthFilter,
  FIST_PROFILES,
  type FistProfile,
  getDataURI,
  getMIMEType,
  getWavData,
  type MorseAudioConfig,
  MorseAudioGenerator,
  type SampleRate,
} from 'morse-audio';

export type DemoFistProfile = FistProfile | 'custom';

export interface DemoSettings {
  text: string;
  wpm: number;
  fwpm: number;
  frequency: number;
  sampleRate: SampleRate;
  durationSec: number;
  seed: number;

  fist: {
    enabled: boolean;
    profile: DemoFistProfile;
    jitter: number;
    dahBias: number;
    speedDriftWpmPerSec: number;
    charGapStretchFraction: number;
    charGapStretchMin: number;
    charGapStretchMax: number;
  };

  noise: {
    snrDb: number;
    qsbEnabled: boolean;
    qsbDepth: number;
    qsbRate: number;
    qrnEnabled: boolean;
    qrnRate: number;
    qrnAmplitude: number;
    powerLineEnabled: boolean;
    powerLineBaseHz: 50 | 60;
    powerLineLevel: number;
    powerLineBuzzDepth: number;
    powerLineCorona: number;
  };

  ionospheric: {
    enabled: boolean;
    depth: number;
    rate: number;
    components: number;
  };
  multipath: {
    enabled: boolean;
    paths: number;
    maxDelayMs: number;
    decay: number;
    phaseSpread: number;
  };
  doppler: { enabled: boolean; spreadHz: number; components: number };
  pitchWobble: {
    enabled: boolean;
    amplitude: number;
    rate: number;
    phase: number;
  };
  rayleigh: { enabled: boolean; bandwidth: number; depth: number };
  flutter: { enabled: boolean; rate: number; depth: number };
  chirp: { enabled: boolean; deviation: number; timeConstant: number };
  buzz: { enabled: boolean; frequency: 50 | 60; amplitude: number };
  cwQrm: {
    enabled: boolean;
    count: number;
    separationHz: number;
    powerDb: number;
    wpm: number;
    text: string;
  };
  broadband: {
    enabled: boolean;
    centerFrequency: number;
    bandwidth: number;
    powerDb: number;
  };
  agc: {
    enabled: boolean;
    attackMs: number;
    releaseMs: number;
    targetLevel: number;
    maxGain: number;
  };
  bandpass: {
    enabled: boolean;
    bandwidth: number;
    centerFrequency: number;
    lockToTone: boolean;
    stages: number;
  };
}

export interface GenerateResult {
  dataUri: string;
  duration: number;
  sampleRate: number;
  effectiveWpm: number;
  samples: Float32Array;
  metadataJson: string;
}

const generator = new MorseAudioGenerator();

function fistOptions(s: DemoSettings): MorseAudioConfig['fist'] {
  if (!s.fist.enabled) return undefined;
  if (s.fist.profile !== 'custom') return FIST_PROFILES[s.fist.profile];
  return {
    jitter: s.fist.jitter,
    dahBias: s.fist.dahBias,
    speedDriftWpmPerSec: s.fist.speedDriftWpmPerSec,
    charGapStretchFraction: s.fist.charGapStretchFraction,
    charGapStretchRange: [s.fist.charGapStretchMin, s.fist.charGapStretchMax],
  };
}

function multipathOptions(s: DemoSettings): MorseAudioConfig['multipath'] {
  if (!s.multipath.enabled) return undefined;
  const paths = Array.from({ length: s.multipath.paths }, (_, i) => {
    const n = i + 1;
    return {
      delayMs: (s.multipath.maxDelayMs / s.multipath.paths) * n,
      amplitude: s.multipath.decay ** n,
      phase: (s.multipath.phaseSpread * Math.PI * n) / s.multipath.paths,
    };
  });
  return { paths };
}

function settingsToConfig(s: DemoSettings): MorseAudioConfig {
  return {
    text: s.text,
    wpm: s.wpm,
    fwpm: s.fwpm,
    frequency: s.frequency,
    sampleRate: s.sampleRate,
    durationSec: s.durationSec,
    seed: s.seed,
    fist: fistOptions(s),
    noise: {
      snrDb: s.noise.snrDb,
      qsb: s.noise.qsbEnabled
        ? { depth: s.noise.qsbDepth, freqHz: s.noise.qsbRate }
        : undefined,
      qrn: s.noise.qrnEnabled
        ? { rate: s.noise.qrnRate, amplitudeMultiplier: s.noise.qrnAmplitude }
        : undefined,
      powerLine: s.noise.powerLineEnabled
        ? {
            baseHz: s.noise.powerLineBaseHz,
            level: s.noise.powerLineLevel,
            buzzDepth: s.noise.powerLineBuzzDepth,
            coronaLevel: s.noise.powerLineCorona,
          }
        : undefined,
    },
    ionosphericFading: s.ionospheric.enabled
      ? {
          depth: s.ionospheric.depth,
          rate: s.ionospheric.rate,
          components: s.ionospheric.components,
        }
      : undefined,
    multipath: multipathOptions(s),
    dopplerSpread: s.doppler.enabled
      ? { spreadHz: s.doppler.spreadHz, components: s.doppler.components }
      : undefined,
    pitchWobble: s.pitchWobble.enabled
      ? {
          amplitude: s.pitchWobble.amplitude,
          rate: s.pitchWobble.rate,
          phase: s.pitchWobble.phase,
        }
      : undefined,
    rayleigh: s.rayleigh.enabled
      ? { bandwidth: s.rayleigh.bandwidth, depth: s.rayleigh.depth }
      : undefined,
    flutter: s.flutter.enabled
      ? { rate: s.flutter.rate, depth: s.flutter.depth }
      : undefined,
    chirp: s.chirp.enabled
      ? { deviation: s.chirp.deviation, timeConstant: s.chirp.timeConstant }
      : undefined,
    buzz: s.buzz.enabled
      ? { frequency: s.buzz.frequency, amplitude: s.buzz.amplitude }
      : undefined,
    cwQrm: s.cwQrm.enabled
      ? Array.from({ length: s.cwQrm.count }, (_, i) => ({
          frequencySeparation:
            s.cwQrm.separationHz *
            (i % 2 === 0 ? 1 : -1) *
            (1 + Math.floor(i / 2)),
          powerDb: s.cwQrm.powerDb,
          wpm: s.cwQrm.wpm,
          text: s.cwQrm.text || undefined,
        }))
      : undefined,
    broadbandInterference: s.broadband.enabled
      ? {
          centerFrequency: s.broadband.centerFrequency,
          bandwidth: s.broadband.bandwidth,
          powerDb: s.broadband.powerDb,
        }
      : undefined,
    agc: s.agc.enabled
      ? {
          attackMs: s.agc.attackMs,
          releaseMs: s.agc.releaseMs,
          targetLevel: s.agc.targetLevel,
          maxGain: s.agc.maxGain,
        }
      : undefined,
  };
}

export function generateDemoAudio(s: DemoSettings): GenerateResult {
  const result = generator.generate(settingsToConfig(s));
  let samples = result.audio;
  if (s.bandpass.enabled) {
    samples = applyBandwidthFilter(
      samples,
      s.bandpass.lockToTone ? s.frequency : s.bandpass.centerFrequency,
      s.bandpass.bandwidth,
      result.metadata.config.sampleRate,
      s.bandpass.stages
    );
  }

  return {
    dataUri: getDataURI(
      getWavData(samples, result.metadata.config.sampleRate),
      getMIMEType()
    ),
    duration: result.metadata.actualDurationSec,
    sampleRate: result.metadata.config.sampleRate,
    effectiveWpm: result.metadata.effectiveWpm,
    samples,
    metadataJson: generator.toMetadataJson(result),
  };
}

export const DEFAULT_SETTINGS: DemoSettings = {
  text: 'CQ CQ CQ DE W1AW',
  wpm: 22,
  fwpm: 22,
  frequency: 600,
  sampleRate: 22050,
  durationSec: 8,
  seed: 704554,
  fist: {
    enabled: false,
    profile: 'average',
    jitter: FIST_PROFILES.average.jitter,
    dahBias: FIST_PROFILES.average.dahBias,
    speedDriftWpmPerSec: FIST_PROFILES.average.speedDriftWpmPerSec,
    charGapStretchFraction: FIST_PROFILES.average.charGapStretchFraction,
    charGapStretchMin: FIST_PROFILES.average.charGapStretchRange[0],
    charGapStretchMax: FIST_PROFILES.average.charGapStretchRange[1],
  },
  noise: {
    snrDb: 12,
    qsbEnabled: false,
    qsbDepth: 0.08,
    qsbRate: 0.3,
    qrnEnabled: false,
    qrnRate: 4,
    qrnAmplitude: 5,
    powerLineEnabled: false,
    powerLineBaseHz: 60,
    powerLineLevel: 12,
    powerLineBuzzDepth: 0.45,
    powerLineCorona: 0.3,
  },
  ionospheric: { enabled: false, depth: 0.5, rate: 0.8, components: 3 },
  multipath: {
    enabled: false,
    paths: 3,
    maxDelayMs: 8,
    decay: 0.55,
    phaseSpread: 1,
  },
  doppler: { enabled: false, spreadHz: 8, components: 5 },
  pitchWobble: { enabled: false, amplitude: 1.5, rate: 0.04, phase: 0 },
  rayleigh: { enabled: false, bandwidth: 0.5, depth: 0.7 },
  flutter: { enabled: false, rate: 15, depth: 0.5 },
  chirp: { enabled: false, deviation: 15, timeConstant: 10 },
  buzz: { enabled: false, frequency: 60, amplitude: 0.08 },
  cwQrm: {
    enabled: false,
    count: 1,
    separationHz: 280,
    powerDb: -6,
    wpm: 24,
    text: '',
  },
  broadband: {
    enabled: false,
    centerFrequency: 1700,
    bandwidth: 900,
    powerDb: -8,
  },
  agc: {
    enabled: false,
    attackMs: 10,
    releaseMs: 100,
    targetLevel: 0.7,
    maxGain: 10,
  },
  bandpass: {
    enabled: false,
    bandwidth: 500,
    centerFrequency: 600,
    lockToTone: true,
    stages: 4,
  },
};

export const FIST_PRESETS: Array<{ profile: DemoFistProfile; label: string }> =
  [
    { profile: 'machine', label: 'Machine' },
    { profile: 'good', label: 'Good' },
    { profile: 'average', label: 'Average' },
    { profile: 'bug', label: 'Bug' },
    { profile: 'poor', label: 'Poor' },
    { profile: 'very_poor', label: 'Very poor' },
    { profile: 'custom', label: 'Custom' },
  ];

export const BANDPASS_PRESETS = [2400, 1000, 500, 300, 250, 100];
