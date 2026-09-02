import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/db.js";
import {
  canvasFor,
  layoutFor,
  saveBrandKit,
  getBrandKit,
  renderBrandedPhoto,
  renderBrandedVideo,
  DEFAULT_VIDEO_SEQUENCE,
  type PhotoLayout,
} from "../src/modules/branding/service.js";
import { can } from "../src/modules/auth/permissions.js";

const run = promisify(execFile);

/** Reads back what ffmpeg actually produced — a render that claims success
 *  but writes an unplayable file is worse than a failure. */
async function probe(bytes: Buffer, ext: string) {
  const dir = await mkdtemp(join(tmpdir(), "probe-"));
  try {
    const p = join(dir, `f.${ext}`);
    await writeFile(p, bytes);
    const { stdout } = await run("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=width,height,codec_name",
      "-show_entries", "format=duration",
      "-of", "json", p,
    ]);
    const data = JSON.parse(stdout) as {
      streams: Array<{ width: number; height: number; codec_name: string }>;
      format: { duration?: string };
    };
    return {
      width: data.streams[0]?.width,
      height: data.streams[0]?.height,
      codec: data.streams[0]?.codec_name,
      duration: Number(data.format.duration ?? 0),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function testPhoto(w = 1600, h = 1200): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "src-"));
  try {
    const p = join(dir, "p.jpg");
    await run("ffmpeg", ["-y", "-f", "lavfi", "-i", `gradients=s=${w}x${h}:d=1`, "-frames:v", "1", p]);
    const { readFile } = await import("node:fs/promises");
    return readFile(p);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The content generator's branding: identity, per-channel photo layout,
 * and the video branding sequence — rendered locally with ffmpeg so a demo
 * never depends on someone else's free GPU pool.
 */
describe("branding studio (§6-هـ content generator)", () => {
  const stamp = Date.now();
  const propertyId = `brand-${stamp}`;
  const actor = { staffId: "mkt-1", name: "Dana", propertyId };

  beforeAll(async () => {
    await prisma.property.create({ data: { id: propertyId, name: "فندق الهوية" } });
  });

  it("permissions: marketing designs and renders, reception only looks", () => {
    expect(can("marketing_manager", "branding.manage")).toBe(true);
    expect(can("marketing_manager", "branding.render")).toBe(true);
    expect(can("reception", "branding.view")).toBe(true);
    expect(can("reception", "branding.manage")).toBe(false);
    expect(can("technician", "branding.view")).toBe(false);
  });

  it("a hotel with no brand kit still gets usable defaults", async () => {
    const kit = await getBrandKit(propertyId);
    expect(kit.configured).toBe(false);
    expect(kit.wordmark).toBe("فندق الهوية"); // seeded from the property name
    expect(kit.videoSequence).toEqual(DEFAULT_VIDEO_SEQUENCE);
    // A channel never opened in the layout tab still renders correctly.
    const layout = await layoutFor(propertyId, "linkedin");
    expect(layout.anchor).toBe("bottom-right");
    expect(layout.scalePct).toBeGreaterThan(0);
  });

  it("each channel keeps its OWN layout — a story is not a square post", async () => {
    const story: PhotoLayout = { anchor: "top-left", scalePct: 26, marginPct: 9, opacity: 0.75, scrim: true };
    const square: PhotoLayout = { anchor: "bottom-right", scalePct: 14, marginPct: 4, opacity: 1, scrim: false };
    await saveBrandKit({ actor, patch: { photoLayout: { instagram_stories: story, instagram: square } } });

    expect(await layoutFor(propertyId, "instagram_stories")).toMatchObject(story);
    expect(await layoutFor(propertyId, "instagram")).toMatchObject(square);
    // and the canvases they render into genuinely differ
    expect(canvasFor("instagram_stories")).toMatchObject({ w: 1080, h: 1920 });
    expect(canvasFor("instagram")).toMatchObject({ w: 1080, h: 1080 });
    expect(canvasFor("x")).toMatchObject({ w: 1600, h: 900 });
  });

  it("renders a photo into the CHANNEL's canvas, not one generic frame", async () => {
    const photo = await testPhoto();
    const layout = await layoutFor(propertyId, "instagram_stories");

    const story = await renderBrandedPhoto({ photo, logo: null, channel: "instagram_stories", layout });
    const square = await renderBrandedPhoto({ photo, logo: null, channel: "instagram", layout });

    const s = await probe(story, "jpg");
    const q = await probe(square, "jpg");
    expect([s.width, s.height]).toEqual([1080, 1920]);
    expect([q.width, q.height]).toEqual([1080, 1080]);
  }, 60_000);

  it("composites the mark when a logo exists", async () => {
    const photo = await testPhoto();
    const logo = await testPhoto(400, 400);
    const layout = await layoutFor(propertyId, "instagram");
    const plain = await renderBrandedPhoto({ photo, logo: null, channel: "instagram", layout });
    const marked = await renderBrandedPhoto({ photo, logo, channel: "instagram", layout });
    // Same canvas, different pixels: the overlay actually landed.
    expect((await probe(marked, "jpg")).width).toBe(1080);
    expect(marked.equals(plain)).toBe(false);
  }, 60_000);

  it("the video follows the hotel's own sequence and durations", async () => {
    const photos = [await testPhoto(), await testPhoto(1400, 1000)];
    const sequence = [
      { kind: "intro" as const, seconds: 1 },
      { kind: "shot" as const, seconds: 2 },
      { kind: "watermark" as const, seconds: 0 },
      { kind: "outro" as const, seconds: 1 },
    ];
    const video = await renderBrandedVideo({
      photos,
      logo: null,
      channel: "instagram_reels",
      sequence,
      wordmark: "فندق الهوية",
      primaryColor: "#E4177E",
      inkColor: "#0E0B14",
    });
    const meta = await probe(video, "mp4");
    expect(meta.codec).toBe("h264");
    expect([meta.width, meta.height]).toEqual([1080, 1920]); // the reels canvas
    // 1 + 2 + 1 = 4s; watermark is a modifier, not a clip that adds time.
    expect(meta.duration).toBeGreaterThan(3.4);
    expect(meta.duration).toBeLessThan(4.8);
  }, 180_000);

  it("a longer sequence produces a longer video — durations are honoured", async () => {
    const photos = [await testPhoto()];
    const short = await renderBrandedVideo({
      photos, logo: null, channel: "x",
      sequence: [{ kind: "shot", seconds: 1 }],
      wordmark: "", primaryColor: "#E4177E", inkColor: "#0E0B14",
    });
    const long = await renderBrandedVideo({
      photos, logo: null, channel: "x",
      sequence: [{ kind: "shot", seconds: 1 }, { kind: "shot", seconds: 3 }],
      wordmark: "", primaryColor: "#E4177E", inkColor: "#0E0B14",
    });
    const a = await probe(short, "mp4");
    const b = await probe(long, "mp4");
    expect(b.duration).toBeGreaterThan(a.duration + 2);
    expect([b.width, b.height]).toEqual([1600, 900]); // X's canvas, not a default square
  }, 180_000);

  it("an empty sequence fails loudly instead of writing an empty file", async () => {
    await expect(
      renderBrandedVideo({
        photos: [await testPhoto()],
        logo: null,
        channel: "instagram",
        sequence: [{ kind: "watermark", seconds: 0 }], // no renderable step
        wordmark: "",
        primaryColor: "#E4177E",
        inkColor: "#0E0B14",
      })
    ).rejects.toThrow(/no renderable steps/);
  }, 60_000);

  it("brand kit edits are audited and tenant-scoped", async () => {
    await saveBrandKit({ actor, patch: { wordmark: "فندق الهوية المحدّث" } });
    const kit = await prisma.brandKit.findUniqueOrThrow({ where: { propertyId } });
    expect(kit.wordmark).toBe("فندق الهوية المحدّث");
    expect(kit.tenantId).toBe(`tnt-${propertyId}`); // DB trigger
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "branding.updated", propertyId },
    });
    expect(audit).toBeTruthy();
  });
});
