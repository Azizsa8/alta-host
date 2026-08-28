import { randomBytes, createHmac } from "node:crypto";
import { prisma } from "../../db.js";
import { recordAudit } from "../audit/service.js";
import { emitEvent } from "../events/bus.js";
import { setCredential, getCredential, type CredentialKey } from "../credentials/service.js";
import { channelSpec } from "./catalogue.js";
import { connectionFor, oauthConfigured, credentialKeysFor, MANUAL_ONLY } from "./connections.js";

type Actor = { staffId: string; name: string; propertyId: string };

function baseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? "http://localhost:8098";
}

/**
 * OAuth `state` is signed rather than stored: it carries the property and
 * channel, and the HMAC proves we issued it. A callback that arrives with
 * someone else's state cannot connect a channel to the wrong hotel — the
 * classic cross-tenant hole in a shared OAuth callback.
 */
function signState(propertyId: string, channel: string): string {
  const nonce = randomBytes(8).toString("hex");
  const payload = `${propertyId}|${channel}|${Date.now()}|${nonce}`;
  const secret = process.env.JWT_SECRET ?? "dev-secret";
  const mac = createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
  return Buffer.from(`${payload}|${mac}`).toString("base64url");
}

export function verifyState(state: string): { propertyId: string; channel: string } | null {
  try {
    const raw = Buffer.from(state, "base64url").toString("utf8");
    const [propertyId, channel, issuedAt, nonce, mac] = raw.split("|");
    if (!propertyId || !channel || !mac) return null;
    const secret = process.env.JWT_SECRET ?? "dev-secret";
    const expected = createHmac("sha256", secret)
      .update(`${propertyId}|${channel}|${issuedAt}|${nonce}`)
      .digest("hex")
      .slice(0, 32);
    if (mac !== expected) return null;
    // Ten minutes is plenty for a redirect and stops a leaked link being
    // replayed days later.
    if (Date.now() - Number(issuedAt) > 10 * 60 * 1000) return null;
    return { propertyId, channel };
  } catch {
    return null;
  }
}

export type ConnectStart =
  | { mode: "oauth"; authorizeUrl: string }
  | { mode: "token"; fields: Array<{ key: string; labelAr: string; secret: boolean; hintAr: string }>; noteAr: string }
  | { mode: "manual"; noteAr: string };

/**
 * Starts a connection. Returns what the UI should actually do — a redirect
 * when a real OAuth app exists, a credential form when it doesn't, or an
 * honest explanation when the platform has no automated surface at all.
 */
export function startConnect(channel: string, propertyId: string): ConnectStart | null {
  const spec = channelSpec(channel);
  if (!spec) return null;

  if (MANUAL_ONLY[channel]) {
    return { mode: "manual", noteAr: MANUAL_ONLY[channel] };
  }

  const conn = connectionFor(channel);
  if (!conn) {
    return { mode: "manual", noteAr: "لا توجد طريقة ربط آلية لهذه القناة بعد." };
  }

  if (conn.mode === "oauth" && oauthConfigured(conn)) {
    const clientId = process.env[conn.clientIdEnv!]!;
    const url = new URL(conn.authorizeUrl!);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", `${baseUrl()}/api/social/oauth/callback`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", (conn.scopes ?? []).join(" "));
    url.searchParams.set("state", signState(propertyId, channel));
    return { mode: "oauth", authorizeUrl: url.toString() };
  }

  // No developer app registered for this platform on this deployment: say
  // so, and offer the path that genuinely works today.
  return {
    mode: "token",
    fields: conn.fields,
    noteAr:
      conn.mode === "oauth"
        ? "لم يُسجَّل تطبيق مطوّر لهذه المنصة على هذا التثبيت بعد، فالربط يتم برمز وصول تُنشئه من لوحة المنصة."
        : "هذه المنصة لا تستخدم OAuth — الربط برمز تُنشئه من لوحتها.",
  };
}

/** Asks the platform who this token belongs to. A token that the platform
 *  rejects must never be stored as a working connection. */
async function verifyToken(channel: string, token: string, account: string): Promise<{ ok: boolean; detail: string }> {
  const conn = connectionFor(channel);
  try {
    if (conn?.provider === "meta") {
      const r = await fetch(`https://graph.facebook.com/v20.0/me?access_token=${encodeURIComponent(token)}`);
      if (!r.ok) return { ok: false, detail: `المنصة رفضت الرمز (${r.status})` };
      return { ok: true, detail: "تم التحقق من الرمز مع Meta" };
    }
    if (conn?.provider === "telegram") {
      const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      if (!r.ok) return { ok: false, detail: `تيليجرام رفض رمز البوت (${r.status})` };
      return { ok: true, detail: "تم التحقق من البوت" };
    }
    if (conn?.provider === "x") {
      const r = await fetch("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return { ok: false, detail: `X رفض الرمز (${r.status})` };
      return { ok: true, detail: "تم التحقق من الرمز مع X" };
    }
  } catch (err) {
    return { ok: false, detail: `تعذّر الوصول للمنصة: ${err instanceof Error ? err.message : "خطأ شبكة"}` };
  }
  // No verification endpoint wired for this provider yet: store it, but say
  // plainly that it was not proven rather than implying it was.
  return { ok: true, detail: "حُفظ الرمز — لم يُتحقق منه مع المنصة بعد" };
}

/** Stores a channel credential in the vault and marks the channel connected. */
export async function saveChannelCredentials(params: {
  actor: Actor;
  channel: string;
  token: string;
  account?: string;
}): Promise<{ ok: true; detail: string } | { ok: false; status: number; error: string }> {
  const spec = channelSpec(params.channel);
  if (!spec) return { ok: false, status: 404, error: "unknown channel" };

  const verdict = await verifyToken(params.channel, params.token, params.account ?? "");
  if (!verdict.ok) {
    await prisma.socialChannel.upsert({
      where: { propertyId_channel: { propertyId: params.actor.propertyId, channel: params.channel } },
      create: { propertyId: params.actor.propertyId, channel: params.channel, connectionError: verdict.detail },
      update: { connected: false, connectionError: verdict.detail },
    });
    return { ok: false, status: 422, error: verdict.detail };
  }

  const keys = credentialKeysFor(params.channel);
  await setCredential({
    propertyId: params.actor.propertyId,
    key: keys.token as CredentialKey,
    value: params.token,
    actor: { actorName: params.actor.name, actorId: params.actor.staffId },
  });
  if (params.account) {
    await setCredential({
      propertyId: params.actor.propertyId,
      key: keys.account as CredentialKey,
      value: params.account,
      actor: { actorName: params.actor.name, actorId: params.actor.staffId },
    });
  }

  await prisma.socialChannel.upsert({
    where: { propertyId_channel: { propertyId: params.actor.propertyId, channel: params.channel } },
    create: {
      propertyId: params.actor.propertyId,
      channel: params.channel,
      enabled: true,
      connected: true,
      connectedAt: new Date(),
      connectedBy: params.actor.staffId,
      accountRef: params.account ?? "",
      connectionError: "",
    },
    update: {
      enabled: true,
      connected: true,
      connectedAt: new Date(),
      connectedBy: params.actor.staffId,
      accountRef: params.account ?? "",
      connectionError: "",
    },
  });

  await recordAudit({
    actorName: params.actor.name,
    actorId: params.actor.staffId,
    propertyId: params.actor.propertyId,
    action: "social.channel_connected",
    resourceType: "SocialChannel",
    resourceId: params.channel,
    outcome: "success",
    metadata: { channel: params.channel, verified: verdict.detail },
  });
  await emitEvent(params.actor.propertyId, { type: "social.connected", channel: params.channel });
  return { ok: true, detail: verdict.detail };
}

/** Exchanges an OAuth code for a token and connects the channel. */
export async function completeOauth(params: {
  state: string;
  code: string;
}): Promise<{ ok: true; channel: string } | { ok: false; error: string }> {
  const decoded = verifyState(params.state);
  if (!decoded) return { ok: false, error: "invalid or expired state" };

  const conn = connectionFor(decoded.channel);
  if (!conn || !oauthConfigured(conn)) return { ok: false, error: "oauth not configured for this channel" };

  const body = new URLSearchParams({
    client_id: process.env[conn.clientIdEnv!]!,
    client_secret: process.env[conn.clientSecretEnv!]!,
    code: params.code,
    redirect_uri: `${baseUrl()}/api/social/oauth/callback`,
    grant_type: "authorization_code",
  });
  const res = await fetch(conn.tokenUrl!, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return { ok: false, error: `token exchange failed (${res.status})` };
  const data = (await res.json()) as { access_token?: string; refresh_token?: string };
  const token = data.refresh_token ?? data.access_token;
  if (!token) return { ok: false, error: "platform returned no token" };

  const saved = await saveChannelCredentials({
    actor: { staffId: "oauth", name: "OAuth", propertyId: decoded.propertyId },
    channel: decoded.channel,
    token,
  });
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, channel: decoded.channel };
}

/** Disconnects: the vault entry is removed and the channel stops claiming
 *  a capability it no longer has. */
export async function disconnectChannel(params: { actor: Actor; channel: string }) {
  const keys = credentialKeysFor(params.channel);
  await prisma.propertyCredential.deleteMany({
    where: { propertyId: params.actor.propertyId, key: { in: [keys.token, keys.account] } },
  });
  await prisma.socialChannel.updateMany({
    where: { propertyId: params.actor.propertyId, channel: params.channel },
    data: { connected: false, connectedAt: null, accountRef: "", autoPublish: false, connectionError: "" },
  });
  await recordAudit({
    actorName: params.actor.name,
    actorId: params.actor.staffId,
    propertyId: params.actor.propertyId,
    action: "social.channel_disconnected",
    resourceType: "SocialChannel",
    resourceId: params.channel,
    outcome: "success",
  });
  return { ok: true as const };
}

/** Used by the publisher: the agent's live token for a channel. */
export async function channelToken(propertyId: string, channel: string): Promise<string | null> {
  const keys = credentialKeysFor(channel);
  return getCredential(propertyId, keys.token as CredentialKey, `publish to ${channel}`);
}
