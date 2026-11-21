export interface VadConfig {
  speechThreshold: number;
  minSpeechMs: number;
  silenceStopMs: number;
  maxUtteranceMs: number;
  maxIdleMs: number;
}

export interface VadState {
  startedAt: number;
  speechStarted: boolean;
  speechStartAt: number | null;
  lastLoudAt: number | null;
  noiseFloor: number;
  sampleCount: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  speechThreshold: 0.014,
  minSpeechMs: 140,
  silenceStopMs: 1350,
  maxUtteranceMs: 16000,
  maxIdleMs: 14000,
};

export function computeRmsLevel(samples: ArrayLike<number>): number {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i];
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

export function createInitialVadState(nowMs = Date.now()): VadState {
  return {
    startedAt: nowMs,
    speechStarted: false,
    speechStartAt: null,
    lastLoudAt: null,
    noiseFloor: 0.005,
    sampleCount: 0,
  };
}

export function stepVadState(
  state: VadState,
  rms: number,
  nowMs: number,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): { next: VadState; action: 'continue' | 'finish_speech' | 'restart_idle' } {
  const adaptiveFloor = state.sampleCount < 3 ? 0.018 : Math.min(0.055, state.noiseFloor * 2.3);
  const threshold = Math.max(config.speechThreshold, adaptiveFloor);
  const isLoud = rms >= threshold;
  let speechStartAt = state.speechStartAt;
  let lastLoudAt = state.lastLoudAt;
  let speechStarted = state.speechStarted;
  let noiseFloor = state.noiseFloor;

  if (isLoud) {
    if (speechStartAt === null) {
      speechStartAt = nowMs;
    }
    lastLoudAt = nowMs;
    if (!speechStarted && nowMs - speechStartAt >= config.minSpeechMs) {
      speechStarted = true;
    }
  } else {
    if (!speechStarted) {
      const clampedRms = Math.min(0.035, Math.max(0.001, rms));
      noiseFloor = state.sampleCount === 0 ? clampedRms : noiseFloor * 0.85 + clampedRms * 0.15;
    }
    if (!speechStarted && speechStartAt !== null && lastLoudAt !== null && nowMs - lastLoudAt > 350) {
      speechStartAt = null;
    }
  }

  const next: VadState = {
    startedAt: state.startedAt,
    speechStarted,
    speechStartAt,
    lastLoudAt,
    noiseFloor,
    sampleCount: state.sampleCount + 1,
  };

  if (speechStarted) {
    if (nowMs - (speechStartAt ?? nowMs) >= config.maxUtteranceMs) {
      return { next, action: 'finish_speech' };
    }
    if (lastLoudAt !== null && nowMs - lastLoudAt >= config.silenceStopMs) {
      return { next, action: 'finish_speech' };
    }
    return { next, action: 'continue' };
  }

  if (nowMs - state.startedAt >= config.maxIdleMs) {
    return { next, action: 'restart_idle' };
  }

  return { next, action: 'continue' };
}

export function prepareTextForSpeech(text: string): string {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[#>\-*•]+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}
