import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";
import { emitEvent } from "../events/bus.js";
import { channelSpec } from "../social/catalogue.js";

const run = promisify(execFile);

/* ── channel canvas facts ───────────────────────────────────────────────
   A 9:16 story and a 1:1 post cannot share a safe area, so the layout is
   stored per channel and the renderer works in that channel's real pixels
   instead of one generic frame. */
export const CHANNEL_CANVAS: Record<string, { w: number; h: number; label: string }> = {
  instagram: { w: 1080, h: 1080, label: "مربع 1:1" },
  instagram_stories: { w: 1080, h: 1920, label: "ستوري 9:16" },
  instagram_reels: { w: 1080, h: 1920, label: "ريلز 9:16" },
  tiktok: { w: 1080, h: 1920, label: "9:16" },
  snapchat: { w: 1080, h: 1920, label: "9:16" },
  x: { w: 1600, h: 900, label: "16:9" },
  facebook: { w: 1200, h: 630, label: "1.91:1" },
  linkedin: { w: 1200, h: 627, label: "1.91:1" },
  youtube: { w: 1920, h: 1080, label: "16:9" },
  youtube_shorts: { w: 1080, h: 1920, label: "9:16" },
  threads: { w: 1080, h: 1350, label: "4:5" },
  pinterest: { w: 1000, h: 1500, label: "2:3" },
  google_business: { w: 1200, h: 900, label: "4:3" },
  newsletter: { w: 1200, h: 600, label: "بانر" },
  website_blog: { w: 1600, h: 900, label: "16:9" },
  whatsapp_status: { w: 1080, h: 1920, label: "9:16" },
  telegram: { w: 1280, h: 720, label: "16:9" },
};

export function canvasFor(channel: string) {
  return CHANNEL_CANVAS[channel] ?? { w: 1080, h: 1080, label: "مربع 1:1" };
}

export const ANCHORS = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
] as const;
export type Anchor = (typeof ANCHORS)[number];

export interface PhotoLayout {
  anchor: Anchor;
  /** Percent of canvas width the mark occupies. */
  scalePct: number;
  /** Percent of the shorter canvas edge kept clear at the edges. */
  marginPct: number;
  opacity: number;
  /** A readability scrim behind the mark, for busy photos. */
  scrim: boolean;
}

export const DEFAULT_PHOTO_LAYOUT: PhotoLayout = {
  anchor: "bottom-right",
  scalePct: 18,
  marginPct: 5,
  opacity: 0.9,
  scrim: false,
};

export type VideoStepKind = "intro" | "shot" | "watermark" | "outro";
export interface VideoStep {
  kind: VideoStepKind;
  seconds: number;
  text?: string;
}

/** The default branding beat sheet: a title card, the footage, a closing
 *  call to action — with the mark carried across the shots between them. */
export const DEFAULT_VIDEO_SEQUENCE: VideoStep[] = [
  { kind: "intro", seconds: 1.5, text: "" },
  { kind: "shot", seconds: 3 },
  { kind: "shot", seconds: 3 },
  { kind: "watermark", seconds: 0 },
  { kind: "outro", seconds: 2, text: "احجز الآن عبر واتساب" },
];

export async function getBrandKit(propertyId: string) {
  const kit = await prisma.brandKit.findUnique({ where: { propertyId } });
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!kit) {
    return {
      propertyId,
      wordmark: property?.name ?? "",
      logoFileId: null as string | null,
      primaryColor: "#E4177E",
      secondaryColor: "#C9A227",
      inkColor: "#0E0B14",
      fontFamily: "Readex Pro",
      photoLayout: {} as Record<string, PhotoLayout>,
      videoSequence: DEFAULT_VIDEO_SEQUENCE,
      configured: false,
    };
  }
  return {
    ...kit,
    photoLayout: (kit.photoLayout as unknown as Record<string, PhotoLayout>) ?? {},
    videoSequence: ((kit.videoSequence as unknown as VideoStep[]) ?? []).length
      ? (kit.videoSequence as unknown as VideoStep[])
      : DEFAULT_VIDEO_SEQUENCE,
    configured: true,
  };
}

/** The layout for one channel, falling back to the default rather than
 *  refusing to render — a hotel that never opened the layout tab still
 *  gets a correctly branded asset. */
export async function layoutFor(propertyId: string, channel: string): Promise<PhotoLayout> {
  const kit = await getBrandKit(propertyId);
  return { ...DEFAULT_PHOTO_LAYOUT, ...(kit.photoLayout?.[channel] ?? {}) };
}

export async function saveBrandKit(params: {
  actor: { staffId: string; name: string; propertyId: string };
  patch: {
    wordmark?: string;
    logoFileId?: string | null;
    primaryColor?: string;
    secondaryColor?: string;
    inkColor?: string;
    fontFamily?: string;
    photoLayout?: Record<string, PhotoLayout>;
    videoSequence?: VideoStep[];
  };
}) {
  const kit = await prisma.brandKit.upsert({
    where: { propertyId: params.actor.propertyId },
    create: { propertyId: params.actor.propertyId, ...params.patch } as never,
    update: params.patch as never,
  });
  await recordAudit({
    actorName: params.actor.name,
    actorId: params.actor.staffId,
    propertyId: params.actor.propertyId,
    action: "branding.updated",
    resourceType: "BrandKit",
    resourceId: kit.id,
    outcome: "success",
  });
  return kit;
}

/* ── ffmpeg composition ─────────────────────────────────────────────────
   Rendering runs locally with ffmpeg rather than a hosted model: it needs
   no GPU pool, no quota and no network, so a demo never fails because a
   free tier was busy. The pan/zoom motion below is the same "Ken Burns"
   approach a hosted video model falls back to anyway. */

function anchorExpr(anchor: Anchor, marginPx: number): { x: string; y: string } {
  const [v, h] = anchor.split("-") as [string, string];
  const x = h === "left" ? `${marginPx}` : h === "right" ? `W-w-${marginPx}` : `(W-w)/2`;
  const y = v === "top" ? `${marginPx}` : v === "bottom" ? `H-h-${marginPx}` : `(H-h)/2`;
  return { x, y };
}

/** Applies the brand mark to a still, in the channel's real canvas. */
export async function renderBrandedPhoto(params: {
  photo: Buffer;
  logo: Buffer | null;
  channel: string;
  layout: PhotoLayout;
}): Promise<Buffer> {
  const canvas = canvasFor(params.channel);
  const dir = await mkdtemp(join(tmpdir(), "hostops-photo-"));
  try {
    const inPath = join(dir, "in.jpg");
    const outPath = join(dir, "out.jpg");
    await writeFile(inPath, params.photo);

    // Cover-crop to the channel canvas first: letterboxing a hotel photo
    // reads as an accident, cropping reads as a decision.
    const cover = `scale=${canvas.w}:${canvas.h}:force_original_aspect_ratio=increase,crop=${canvas.w}:${canvas.h}`;
    const marginPx = Math.round((Math.min(canvas.w, canvas.h) * params.layout.marginPct) / 100);

    if (!params.logo) {
      await run("ffmpeg", ["-y", "-i", inPath, "-vf", cover, "-q:v", "3", outPath]);
      return readFile(outPath);
    }

    const logoPath = join(dir, "logo.png");
    await writeFile(logoPath, params.logo);
    const markW = Math.round((canvas.w * params.layout.scalePct) / 100);
    const { x, y } = anchorExpr(params.layout.anchor, marginPx);

    const filter = [
      `[0:v]${cover}[bg]`,
      `[1:v]scale=${markW}:-1,format=rgba,colorchannelmixer=aa=${params.layout.opacity}[mark]`,
      `[bg][mark]overlay=${x}:${y}[out]`,
    ].join(";");

    await run("ffmpeg", [
      "-y", "-i", inPath, "-i", logoPath,
      "-filter_complex", filter, "-map", "[out]", "-q:v", "3", outPath,
    ]);
    return readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Builds a branded video: an intro card, pan/zoom shots over the supplied
 * photos carrying the mark, and an outro call to action — in the order the
 * hotel arranged, at the durations it chose.
 */
export async function renderBrandedVideo(params: {
  photos: Buffer[];
  logo: Buffer | null;
  channel: string;
  sequence: VideoStep[];
  wordmark: string;
  primaryColor: string;
  inkColor: string;
}): Promise<Buffer> {
  const canvas = canvasFor(params.channel);
  const fps = 30;
  const dir = await mkdtemp(join(tmpdir(), "hostops-video-"));
  try {
    const clips: string[] = [];
    const watermarkOn = params.sequence.some((s) => s.kind === "watermark");
    let shotIndex = 0;

    for (const [i, step] of params.sequence.entries()) {
      const out = join(dir, `clip-${i}.mp4`);
      const seconds = Math.max(0.5, Math.min(10, step.seconds || 2));

      if (step.kind === "watermark") continue; // a modifier, not a clip

      if (step.kind === "intro" || step.kind === "outro") {
        // A solid brand card. drawtext needs a font file that may not exist
        // in a slim image, so the card is colour + logo — legible without
        // depending on a font being installed.
        const colour = step.kind === "intro" ? params.inkColor : params.primaryColor;
        const args = ["-y", "-f", "lavfi", "-i", `color=c=${colour.replace("#", "0x")}:s=${canvas.w}x${canvas.h}:d=${seconds}:r=${fps}`];
        if (params.logo) {
          const logoPath = join(dir, "logo.png");
          await writeFile(logoPath, params.logo);
          const markW = Math.round(canvas.w * 0.42);
          args.push("-i", logoPath, "-filter_complex",
            `[1:v]scale=${markW}:-1,format=rgba[m];[0:v][m]overlay=(W-w)/2:(H-h)/2[out]`,
            "-map", "[out]");
        }
        args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", String(seconds), out);
        await run("ffmpeg", args, { maxBuffer: 1 << 26 });
        clips.push(out);
        continue;
      }

      // shot: pan/zoom over the next supplied photo
      const photo = params.photos[shotIndex % Math.max(1, params.photos.length)];
      if (!photo) continue;
      shotIndex++;
      const src = join(dir, `src-${i}.jpg`);
      await writeFile(src, photo);

      const frames = Math.round(seconds * fps);
      const zoom = `zoompan=z='min(zoom+0.0012,1.18)':d=${frames}:s=${canvas.w}x${canvas.h}:fps=${fps}`;
      const cover = `scale=${canvas.w * 2}:${canvas.h * 2}:force_original_aspect_ratio=increase,crop=${canvas.w * 2}:${canvas.h * 2}`;

      const args = ["-y", "-loop", "1", "-i", src];
      let filter = `[0:v]${cover},${zoom}[v]`;
      if (watermarkOn && params.logo) {
        const logoPath = join(dir, "logo.png");
        await writeFile(logoPath, params.logo);
        const markW = Math.round(canvas.w * 0.16);
        const margin = Math.round(Math.min(canvas.w, canvas.h) * 0.05);
        args.push("-i", logoPath);
        filter = `[0:v]${cover},${zoom}[bg];[1:v]scale=${markW}:-1,format=rgba,colorchannelmixer=aa=0.85[m];[bg][m]overlay=W-w-${margin}:H-h-${margin}[v]`;
      }
      args.push("-filter_complex", filter, "-map", "[v]", "-t", String(seconds),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(fps), out);
      await run("ffmpeg", args, { maxBuffer: 1 << 26 });
      clips.push(out);
    }

    if (clips.length === 0) throw new Error("no renderable steps in the sequence");

    const finalPath = join(dir, "final.mp4");
    if (clips.length === 1) {
      await run("ffmpeg", ["-y", "-i", clips[0], "-c", "copy", finalPath]);
    } else {
      const listPath = join(dir, "list.txt");
      await writeFile(listPath, clips.map((c) => `file '${c}'`).join("\n"));
      await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(fps), finalPath],
        { maxBuffer: 1 << 26 });
    }
    return readFile(finalPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Records a render attempt so the studio shows real history, not promises. */
export async function recordRender(params: {
  propertyId: string;
  channel: string;
  kind: "photo" | "video";
  sourceFileIds: string[];
  spec: object;
  createdBy?: string;
}) {
  return prisma.brandRender.create({
    data: {
      propertyId: params.propertyId,
      channel: params.channel,
      kind: params.kind,
      status: "rendering",
      sourceFileIds: params.sourceFileIds,
      spec: params.spec,
      createdBy: params.createdBy,
    },
  });
}

export async function finishRender(params: {
  id: string;
  propertyId: string;
  outputFileId?: string;
  error?: string;
  durationMs: number;
}) {
  await prisma.brandRender.update({
    where: { id: params.id },
    data: {
      status: params.error ? "failed" : "ready",
      outputFileId: params.outputFileId,
      error: params.error ?? "",
      durationMs: params.durationMs,
    },
  });
  await emitEvent(params.propertyId, {
    type: "brand.render",
    renderId: params.id,
    status: params.error ? "failed" : "ready",
  });
}
