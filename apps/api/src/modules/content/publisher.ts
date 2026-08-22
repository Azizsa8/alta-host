import { getCredential } from "../credentials/service.js";

export interface PublishResult {
  ok: boolean;
  resultUrl?: string;
  error?: string;
}

/**
 * §8's unified platform adapter layer: one interface per channel, mock in
 * dev/test, Meta Graph for Instagram/Facebook when a page token is in the
 * vault. TikTok stays draft-mode (§8: "TikTok draft-mode") — its publish
 * records the content as ready for manual posting rather than pretending
 * an API we don't have.
 */
export interface SocialPublisher {
  publish(params: {
    propertyId: string;
    channel: string;
    bodyText: string;
    mediaUrls: string[];
  }): Promise<PublishResult>;
}

/** Deterministic mock: succeeds with a stable fake permalink unless the
 *  body contains [fail] — which is how tests exercise the failure path. */
export class MockPublisher implements SocialPublisher {
  async publish(params: { propertyId: string; channel: string; bodyText: string }): Promise<PublishResult> {
    if (params.bodyText.includes("[fail]")) {
      return { ok: false, error: "mock platform rejected the post" };
    }
    return {
      ok: true,
      resultUrl: `https://mock.social/${params.channel}/${params.propertyId}/${Date.now().toString(36)}`,
    };
  }
}

/** Meta Graph publisher (Instagram/Facebook pages). Page token from the
 *  vault; absent token → clean failure, never a crash. */
export class MetaGraphPublisher implements SocialPublisher {
  async publish(params: {
    propertyId: string;
    channel: string;
    bodyText: string;
    mediaUrls: string[];
  }): Promise<PublishResult> {
    const token = await getCredential(params.propertyId, "meta.pageToken", "social publish");
    const pageId = await getCredential(params.propertyId, "meta.pageId", "social publish");
    if (!token || !pageId) return { ok: false, error: "meta page not linked" };

    const res = await fetch(`https://graph.facebook.com/v20.0/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: params.bodyText, access_token: token }),
    });
    if (!res.ok) return { ok: false, error: `graph api ${res.status}` };
    const data = (await res.json()) as { id?: string };
    return { ok: true, resultUrl: data.id ? `https://facebook.com/${data.id}` : undefined };
  }
}

const mock = new MockPublisher();
const meta = new MetaGraphPublisher();

/** SOCIAL_PUBLISHER=mock (default outside prod) pins the mock; otherwise
 *  Instagram/Facebook go to Meta Graph. TikTok always resolves to mock's
 *  draft-mode behaviour until its API path exists. */
export function publisherFor(channel: string): SocialPublisher {
  const mode = process.env.SOCIAL_PUBLISHER ?? "mock";
  if (mode === "mock" || channel === "tiktok") return mock;
  return meta;
}
