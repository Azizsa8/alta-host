import { WhisperASREngine } from "./whisperEngine.js";
import type { ASREngine } from "./types.js";

export * from "./types.js";

class NoopASREngine implements ASREngine {
  async transcribe(): Promise<never> {
    throw new Error(
      "ASR_PROVIDER is unset — voice messages can't be transcribed. Set ASR_PROVIDER=whisper to enable self-hosted transcription."
    );
  }
}

let cachedEngine: ASREngine | null = null;

// Selects the ASR implementation behind ASR_PROVIDER — defaults to unset
// (voice messages are acknowledged but not processed) since Whisper
// inference has real CPU/memory cost and a multi-hundred-MB model download
// on first use; nobody should pay that cost without opting in. Cached
// across calls so the (expensive) Whisper pipeline is only ever built once.
export function createASREngine(): ASREngine {
  const provider = process.env.ASR_PROVIDER ?? "none";

  if (provider === "whisper") {
    if (!cachedEngine) {
      cachedEngine = new WhisperASREngine(process.env.ASR_MODEL ?? "Xenova/whisper-base");
    }
    return cachedEngine;
  }

  return new NoopASREngine();
}
