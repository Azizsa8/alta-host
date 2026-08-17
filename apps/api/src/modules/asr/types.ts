// The one contract voice-message handling talks to instead of calling a
// specific ASR model directly. WhisperASREngine (self-hosted, see
// whisperEngine.ts) is the only implementation today; a hosted ASR vendor
// could implement this same interface later without touching callers.

export interface TranscriptionResult {
  text: string;
  language?: string;
}

export interface ASREngine {
  transcribe(audio: Buffer): Promise<TranscriptionResult>;
}
