import { decodeToFloat32PCM } from "./audioDecode.js";
import type { ASREngine, TranscriptionResult } from "./types.js";

// Lazily-imported and cached — @xenova/transformers pulls in a real ONNX
// runtime and downloads model weights on first use (cached under
// XENOVA_CACHE_DIR / the default OS cache dir after that), so nothing
// heavy happens until a voice message actually needs transcribing.
type Pipeline = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string }>;

/**
 * Self-hosted, open-weights Whisper ASR — no external account or API key
 * needed, unlike a hosted transcription vendor. Multilingual by default
 * (Whisper auto-detects the spoken language rather than assuming Arabic),
 * which matters since guests may message in Arabic, English, or code-switch
 * between both.
 */
export class WhisperASREngine implements ASREngine {
  private pipelinePromise: Promise<Pipeline> | null = null;

  constructor(private readonly model: string) {}

  private async getPipeline(): Promise<Pipeline> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        const { pipeline } = await import("@xenova/transformers");
        return (await pipeline("automatic-speech-recognition", this.model)) as unknown as Pipeline;
      })();
    }
    return this.pipelinePromise;
  }

  async transcribe(audio: Buffer): Promise<TranscriptionResult> {
    const pcm = await decodeToFloat32PCM(audio);
    const transcriber = await this.getPipeline();
    const result = await transcriber(pcm, { task: "transcribe" });
    return { text: result.text.trim() };
  }
}
