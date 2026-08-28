import { CHANNEL_CATALOGUE, channelSpec } from "./catalogue.js";

/**
 * How each channel is actually connected. Two honest modes:
 *
 *   oauth  — the platform has a real OAuth app. The hotel is redirected,
 *            approves, and we exchange the code for a token. This only
 *            works once THIS deployment registers a developer app with
 *            the platform and sets its client id/secret; until then the
 *            connect call says so instead of opening a broken redirect.
 *
 *   token  — no OAuth app (or the platform has no public OAuth at all):
 *            the hotel pastes a token it generated in the platform's own
 *            console. Same vault, same encryption, same audit.
 *
 * Nothing here fakes a connection. A channel is `connected` only when a
 * credential is in the vault and the platform accepted it.
 */
export interface ConnectionSpec {
  /** The provider whose OAuth app covers this channel (several share one). */
  provider: "meta" | "google" | "x" | "linkedin" | "tiktok" | "snapchat" | "pinterest" | "telegram" | "none";
  mode: "oauth" | "token";
  /** Env vars that must be present for the oauth path to be usable. */
  clientIdEnv?: string;
  clientSecretEnv?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  /** What the hotel must paste when mode is token (labels are user-facing). */
  fields: Array<{ key: "token" | "account"; labelAr: string; secret: boolean; hintAr: string }>;
}

const META: Partial<ConnectionSpec> = {
  provider: "meta",
  mode: "oauth",
  clientIdEnv: "META_APP_ID",
  clientSecretEnv: "META_APP_SECRET",
  authorizeUrl: "https://www.facebook.com/v20.0/dialog/oauth",
  tokenUrl: "https://graph.facebook.com/v20.0/oauth/access_token",
};

const TOKEN_FIELDS: ConnectionSpec["fields"] = [
  { key: "token", labelAr: "رمز الوصول", secret: true, hintAr: "من لوحة مطوّري المنصة — يُخزَّن مشفّرًا ولا يُعرض بعدها" },
  { key: "account", labelAr: "معرّف الحساب أو الصفحة", secret: false, hintAr: "المعرّف الذي تنشر باسمه" },
];

export const CONNECTIONS: Record<string, ConnectionSpec> = {
  instagram: { ...META, scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"], fields: TOKEN_FIELDS } as ConnectionSpec,
  instagram_stories: { ...META, scopes: ["instagram_basic", "instagram_content_publish"], fields: TOKEN_FIELDS } as ConnectionSpec,
  instagram_reels: { ...META, scopes: ["instagram_basic", "instagram_content_publish"], fields: TOKEN_FIELDS } as ConnectionSpec,
  facebook: { ...META, scopes: ["pages_manage_posts", "pages_read_engagement"], fields: TOKEN_FIELDS } as ConnectionSpec,
  threads: { ...META, scopes: ["threads_basic", "threads_content_publish"], fields: TOKEN_FIELDS } as ConnectionSpec,
  google_business: {
    provider: "google",
    mode: "oauth",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/business.manage"],
    fields: TOKEN_FIELDS,
  },
  google_reviews: {
    provider: "google",
    mode: "oauth",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/business.manage"],
    fields: TOKEN_FIELDS,
  },
  x: {
    provider: "x",
    mode: "oauth",
    clientIdEnv: "X_CLIENT_ID",
    clientSecretEnv: "X_CLIENT_SECRET",
    authorizeUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    fields: TOKEN_FIELDS,
  },
  linkedin: {
    provider: "linkedin",
    mode: "oauth",
    clientIdEnv: "LINKEDIN_CLIENT_ID",
    clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["w_organization_social", "r_organization_social"],
    fields: TOKEN_FIELDS,
  },
  tiktok: {
    provider: "tiktok",
    mode: "oauth",
    clientIdEnv: "TIKTOK_CLIENT_KEY",
    clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["video.publish", "user.info.basic"],
    fields: TOKEN_FIELDS,
  },
  telegram: {
    // Telegram has no OAuth: a bot token from @BotFather is the whole auth.
    provider: "telegram",
    mode: "token",
    fields: [
      { key: "token", labelAr: "رمز البوت", secret: true, hintAr: "من @BotFather في تيليجرام" },
      { key: "account", labelAr: "معرّف القناة", secret: false, hintAr: "مثال: @alta_hotel" },
    ],
  },
};

/** Channels with no automated surface at all — connecting them would be a
 *  lie, so the UI shows how they're actually operated instead. */
export const MANUAL_ONLY: Record<string, string> = {
  snapchat: "لا تتيح سناب شات نشرًا آليًا لحسابات الأعمال — نجهّز المحتوى وينشره فريقك.",
  whatsapp_status: "حالة واتساب تُنشر من الجهاز المرتبط، لا عبر واجهة برمجية.",
  youtube: "رفع الفيديو يتم من قناتك؛ نجهّز العنوان والوصف والوسوم.",
  youtube_shorts: "رفع الفيديو يتم من قناتك؛ نجهّز النص والوسوم.",
  pinterest: "نجهّز الصورة والوصف؛ النشر من حسابك.",
  tripadvisor: "ترب أدفايزر لا يتيح ردودًا آلية — نجهّز الرد وتنشره من لوحتك.",
  booking_com: "بوكينج لا يتيح ردودًا آلية عبر واجهة عامة — نجهّز الرد.",
  airbnb: "إير بي إن بي لا يتيح ردودًا آلية عبر واجهة عامة — نجهّز الرد.",
  almosafer: "لا توجد واجهة عامة — نجهّز الرد لتنشره من لوحتك.",
  newsletter: "تُرسل من مزوّد البريد لديك؛ نجهّز النشرة كاملة.",
  website_blog: "يُنشر من نظام إدارة المحتوى لديك؛ نجهّز المقال.",
};

export function connectionFor(channel: string): ConnectionSpec | null {
  return CONNECTIONS[channel] ?? null;
}

/** True only when this deployment actually registered a developer app. */
export function oauthConfigured(spec: ConnectionSpec): boolean {
  if (spec.mode !== "oauth") return false;
  return !!(spec.clientIdEnv && process.env[spec.clientIdEnv] && spec.clientSecretEnv && process.env[spec.clientSecretEnv]);
}

/** Vault keys are derived from the catalogue, so the allowed set stays
 *  closed and reviewable rather than becoming free-form. */
export function credentialKeysFor(channel: string): { token: string; account: string } {
  return { token: `social.${channel}.token`, account: `social.${channel}.account` };
}

export const SOCIAL_CREDENTIAL_KEYS = CHANNEL_CATALOGUE.flatMap((c) => {
  const k = credentialKeysFor(c.key);
  return [k.token, k.account];
});

/**
 * What the agent may actually DO on this channel once connected. Derived
 * from the platform's real capability, never from optimism: a connected
 * TikTok still cannot be published to, and saying otherwise would have the
 * agent report success for a post that never existed.
 */
export function agentCapabilities(channel: string, connected: boolean) {
  const spec = channelSpec(channel);
  const publishable = spec?.publish === "api";
  const replyable = spec?.publish === "reply";
  return {
    canDraft: true, // drafting never needs a connection
    canSchedule: true,
    canPublish: connected && publishable,
    canReply: connected && replyable,
    canReadAnalytics: connected,
    // Stated plainly so the UI can explain a disabled button instead of
    // leaving the user to guess.
    blockedReasonAr: connected
      ? publishable || replyable
        ? ""
        : (MANUAL_ONLY[channel] ?? "هذه القناة لا تتيح إجراءً آليًا.")
      : "القناة غير موصولة بعد.",
  };
}
