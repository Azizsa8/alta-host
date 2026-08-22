import { getCredential } from "../credentials/service.js";

/** One review as the platform reports it, before classification. */
export interface ExternalReview {
  externalId: string;
  stars: number;
  text: string;
  author: string;
  reviewedAt: Date;
}

/**
 * The provider boundary: everything above it (classify, draft, approve,
 * publish gating) is identical for mock and real Google. The mock exists
 * so the whole §11-6 flow is testable without waiting on GBP OAuth app
 * approval; the real provider drops in behind the same two methods.
 */
export interface ReviewProvider {
  fetchReviews(propertyId: string, accountRef: string): Promise<ExternalReview[]>;
  publishReply(propertyId: string, accountRef: string, externalId: string, reply: string): Promise<boolean>;
}

/** Deterministic mock: a fixed batch keyed by accountRef, so tests and
 *  demos get stable data. `mock:` accountRefs always use this provider. */
export class MockGoogleProvider implements ReviewProvider {
  private published = new Map<string, string>();

  async fetchReviews(_propertyId: string, accountRef: string): Promise<ExternalReview[]> {
    const seed = accountRef.replace(/^mock:/, "");
    return [
      {
        externalId: `${seed}-r1`,
        stars: 5,
        text: "فندق رائع والاستقبال محترف جداً، الغرف نظيفة والإفطار ممتاز.",
        author: "عبدالله السالم",
        reviewedAt: new Date("2026-08-18T10:00:00Z"),
      },
      {
        externalId: `${seed}-r2`,
        stars: 2,
        text: "النظافة سيئة والغرفة ما كانت جاهزة عند الوصول. خدمة بطيئة.",
        author: "منى الحربي",
        reviewedAt: new Date("2026-08-19T14:30:00Z"),
      },
      {
        externalId: `${seed}-r3`,
        stars: 1,
        text: "باب الطوارئ في الممر الثالث كان مقفلاً — خطر حقيقي على السلامة.",
        author: "خالد العتيبي",
        reviewedAt: new Date("2026-08-20T09:15:00Z"),
      },
      {
        externalId: `${seed}-r4`,
        stars: 4,
        text: "Great location and friendly staff. Breakfast could have more variety.",
        author: "James Miller",
        reviewedAt: new Date("2026-08-21T19:45:00Z"),
      },
    ];
  }

  async publishReply(_propertyId: string, _accountRef: string, externalId: string, reply: string): Promise<boolean> {
    this.published.set(externalId, reply);
    return true;
  }
}

/**
 * Real Google Business Profile provider. The OAuth refresh token lives in
 * the credential vault (§8) — never in this table, never in env for
 * per-hotel accounts. Wiring is complete; it activates the moment a hotel
 * links a non-mock account with a vault token.
 */
export class GoogleBusinessProvider implements ReviewProvider {
  private async accessToken(propertyId: string): Promise<string | null> {
    const refresh = await getCredential(propertyId, "google.oauthRefreshToken", "gbp review sync");
    if (!refresh) return null;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
        refresh_token: refresh,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  }

  async fetchReviews(propertyId: string, accountRef: string): Promise<ExternalReview[]> {
    const token = await this.accessToken(propertyId);
    if (!token) return [];
    const res = await fetch(`https://mybusiness.googleapis.com/v4/${accountRef}/reviews`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      reviews?: Array<{ reviewId: string; starRating: string; comment?: string; reviewer?: { displayName?: string }; createTime: string }>;
    };
    const STAR: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    return (data.reviews ?? []).map((r) => ({
      externalId: r.reviewId,
      stars: STAR[r.starRating] ?? 3,
      text: r.comment ?? "",
      author: r.reviewer?.displayName ?? "Google user",
      reviewedAt: new Date(r.createTime),
    }));
  }

  async publishReply(propertyId: string, accountRef: string, externalId: string, reply: string): Promise<boolean> {
    const token = await this.accessToken(propertyId);
    if (!token) return false;
    const res = await fetch(`https://mybusiness.googleapis.com/v4/${accountRef}/reviews/${externalId}/reply`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comment: reply }),
    });
    return res.ok;
  }
}

const mock = new MockGoogleProvider();
const real = new GoogleBusinessProvider();

/** mock: accountRefs (and tests) get the mock; everything else the real API. */
export function providerFor(accountRef: string): ReviewProvider {
  return accountRef.startsWith("mock:") ? mock : real;
}
