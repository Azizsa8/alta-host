import { spawn } from "node:child_process";

/**
 * Decodes an arbitrary audio buffer (WhatsApp voice notes arrive as
 * ogg/opus; WAHA/other sources may send m4a, mp3, wav, ...) into 16kHz
 * mono 32-bit float PCM — the exact input shape Whisper's feature extractor
 * expects. transformers.js's own `read_audio` helper only works in a
 * browser (needs `AudioContext`), so decoding is done via ffmpeg instead,
 * piping the buffer in and reading raw PCM back out.
 */
export function decodeToFloat32PCM(buffer: Buffer, sampleRate = 16000): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-i", "pipe:0",
      "-f", "f32le",
      "-ar", String(sampleRate),
      "-ac", "1",
      "-loglevel", "error",
      "pipe:1",
    ]);

    const chunks: Buffer[] = [];
    let stderr = "";
    ff.stdout.on("data", (chunk) => chunks.push(chunk));
    ff.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    ff.on("error", (err) => reject(new Error(`failed to spawn ffmpeg: ${err.message}`)));
    ff.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${stderr || "<no stderr>"}`));
        return;
      }
      const out = Buffer.concat(chunks);
      // ArrayBuffer#slice always returns a fresh, zero-offset buffer, so the
      // Float32Array view below is guaranteed correctly aligned regardless
      // of where Buffer.concat's result happens to sit in its own backing
      // buffer.
      const arrayBuffer = out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
      resolve(new Float32Array(arrayBuffer));
    });

    ff.stdin.on("error", (err) => {
      // EPIPE etc. — surfaced via the 'close'/'error' handlers above already;
      // an unhandled 'error' on stdin would otherwise crash the process.
      if ((err as NodeJS.ErrnoException).code !== "EPIPE") reject(err);
    });
    ff.stdin.write(buffer);
    ff.stdin.end();
  });
}
