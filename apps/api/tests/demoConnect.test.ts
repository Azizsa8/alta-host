import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { prisma } from "../src/db.js";
import { startConnect, demoConnect, saveChannelCredentials, disconnectChannel } from "../src/modules/social/connect.js";
import { agentCapabilities, demoConnectEnabled } from "../src/modules/social/connections.js";

/**
 * Demo-mode connection: lets a pilot or client demo walk the whole connect
 * journey without a registered developer app. The value of the feature is
 * entirely in what it REFUSES to do — so that is what these pin.
 */
describe("demo channel connect", () => {
  const stamp = Date.now();
  const propertyId = `demo-connect-${stamp}`;
  const actor = { staffId: "mgr-1", name: "Reem", propertyId };

  beforeAll(async () => {
    await prisma.property.create({ data: { id: propertyId, name: "فندق العرض" } });
  });
  afterEach(() => {
    delete process.env.SOCIAL_DEMO_CONNECT;
  });

  it("is OFF unless explicitly switched on", () => {
    expect(demoConnectEnabled()).toBe(false);
    process.env.SOCIAL_DEMO_CONNECT = "true";
    expect(demoConnectEnabled()).toBe(true);
    process.env.SOCIAL_DEMO_CONNECT = "0";
    expect(demoConnectEnabled()).toBe(false);
  });

  it("a deployment without the flag cannot connect a channel this way", async () => {
    const result = await demoConnect({ actor, channel: "instagram" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    // and nothing was written
    const row = await prisma.socialChannel.findFirst({ where: { propertyId, channel: "instagram" } });
    expect(row).toBeNull();
  });

  it("the connect start only offers the demo path when the flag is on", () => {
    const off = startConnect("instagram", propertyId);
    expect(off?.mode).toBe("token"); // no META_APP_ID in tests
    expect(off && "demo" in off ? off.demo : undefined).toBeUndefined();

    process.env.SOCIAL_DEMO_CONNECT = "true";
    const on = startConnect("instagram", propertyId);
    expect(on && "demo" in on ? on.demo?.platformAr : "").toBeTruthy();
  });

  it("connects the channel and stamps it as a demo, without touching the vault", async () => {
    process.env.SOCIAL_DEMO_CONNECT = "true";
    const result = await demoConnect({ actor, channel: "instagram", account: "@boulevard" });
    expect(result.ok).toBe(true);

    const row = await prisma.socialChannel.findFirstOrThrow({ where: { propertyId, channel: "instagram" } });
    expect(row.connected).toBe(true);
    expect(row.demoConnection).toBe(true);
    expect(row.accountRef).toBe("@boulevard");
    expect(row.tenantId).toBe(`tnt-${propertyId}`); // DB trigger still applies

    // The whole point: no credential exists, so no real platform call can
    // start succeeding because of this.
    const creds = await prisma.propertyCredential.findMany({ where: { propertyId } });
    expect(creds).toHaveLength(0);
  });

  it("the audit entry records that it was a demo, not a live link", async () => {
    process.env.SOCIAL_DEMO_CONNECT = "true";
    await demoConnect({ actor, channel: "facebook", account: "@bv" });
    const audit = await prisma.auditEvent.findFirst({
      where: { propertyId, action: "social.channel_connected", resourceId: "facebook" },
      orderBy: { seq: "desc" },
    });
    expect(audit).toBeTruthy();
    expect(JSON.parse(audit!.metadata)).toMatchObject({ mode: "demo" });
  });

  it("a demo connection says so in the agent's capabilities", () => {
    const real = agentCapabilities("instagram", true, false);
    const demo = agentCapabilities("instagram", true, true);
    expect(real.demo).toBe(false);
    expect(real.blockedReasonAr).toBe("");
    expect(demo.demo).toBe(true);
    expect(demo.blockedReasonAr).toMatch(/تجريبي/);
  });

  it("refuses channels that have no automated surface even in production", async () => {
    process.env.SOCIAL_DEMO_CONNECT = "true";
    const result = await demoConnect({ actor, channel: "snapchat" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
  });

  it("a real credential supersedes the demo stamp, and disconnect clears it", async () => {
    process.env.SOCIAL_DEMO_CONNECT = "true";
    await demoConnect({ actor, channel: "telegram", account: "@alta" });
    expect((await prisma.socialChannel.findFirstOrThrow({ where: { propertyId, channel: "telegram" } })).demoConnection).toBe(true);

    // telegram verification hits the network; a rejected token must not
    // silently leave the channel looking demo-connected either way.
    await saveChannelCredentials({ actor, channel: "telegram", token: "x".repeat(40), account: "@alta" }).catch(() => {});
    await disconnectChannel({ actor, channel: "telegram" });
    const row = await prisma.socialChannel.findFirstOrThrow({ where: { propertyId, channel: "telegram" } });
    expect(row.connected).toBe(false);
    expect(row.demoConnection).toBe(false);
  });
});
