import { describe, it, expect, afterEach } from "vitest";
import { createASREngine } from "../src/modules/asr/index.js";
import { WhisperASREngine } from "../src/modules/asr/whisperEngine.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("createASREngine — provider selection", () => {
  it("defaults to a no-op engine that rejects with a clear message", async () => {
    delete process.env.ASR_PROVIDER;
    const engine = createASREngine();
    await expect(engine.transcribe(Buffer.from(""))).rejects.toThrow(/ASR_PROVIDER/);
  });

  it("returns a WhisperASREngine when ASR_PROVIDER=whisper", () => {
    process.env.ASR_PROVIDER = "whisper";
    expect(createASREngine()).toBeInstanceOf(WhisperASREngine);
  });
});
