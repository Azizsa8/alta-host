import { describe, it, expect, vi, afterEach } from "vitest";
import { createWhatsAppGateway } from "../src/modules/whatsapp/gatewayFactory.js";
import { CloudApiGateway } from "../src/modules/whatsapp/cloudApiGateway.js";
import { WahaGateway } from "../src/modules/whatsapp/wahaGateway.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("createWhatsAppGateway — provider selection", () => {
  it("defaults to CloudApiGateway when WHATSAPP_PROVIDER is unset", () => {
    delete process.env.WHATSAPP_PROVIDER;
    expect(createWhatsAppGateway()).toBeInstanceOf(CloudApiGateway);
  });

  it("returns WahaGateway when WHATSAPP_PROVIDER=waha and WAHA_BASE_URL is set", () => {
    process.env.WHATSAPP_PROVIDER = "waha";
    process.env.WAHA_BASE_URL = "http://localhost:3210";
    expect(createWhatsAppGateway()).toBeInstanceOf(WahaGateway);
  });

  it("falls back to CloudApiGateway when WHATSAPP_PROVIDER=waha but WAHA_BASE_URL is unset", () => {
    process.env.WHATSAPP_PROVIDER = "waha";
    delete process.env.WAHA_BASE_URL;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(createWhatsAppGateway()).toBeInstanceOf(CloudApiGateway);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("CloudApiGateway — demo mode", () => {
  it("no-ops without calling fetch when credentials are unconfigured", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const gateway = new CloudApiGateway(undefined, undefined);
    await gateway.send({ to: "966501112222", text: "hello", messageId: "msg-1" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to the Graph API messages endpoint when credentials are configured", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const gateway = new CloudApiGateway("test-token", "test-phone-id");
    await gateway.send({ to: "966501112222", text: "hello", messageId: "msg-1" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://graph.facebook.com/v20.0/test-phone-id/messages");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-token" });
    expect(JSON.parse(init?.body as string)).toMatchObject({ to: "966501112222", type: "text" });
  });

  it("retries once and gives up quietly on repeated failure — never throws", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("server error", { status: 500 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const gateway = new CloudApiGateway("test-token", "test-phone-id");
    await expect(gateway.send({ to: "966501112222", text: "hello", messageId: "msg-1" })).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("WahaGateway — chatId formatting", () => {
  it("suffixes a bare phone number with @c.us", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const gateway = new WahaGateway("http://localhost:3210", "default", undefined);
    await gateway.send({ to: "966501112222", text: "hello", messageId: "msg-1" });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("http://localhost:3210/api/sendText");
    expect(JSON.parse(init?.body as string)).toMatchObject({ chatId: "966501112222@c.us", session: "default" });
  });

  it("leaves an already-suffixed chat id untouched", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const gateway = new WahaGateway("http://localhost:3210", "default", "test-key");
    await gateway.send({ to: "966501112222@c.us", text: "hello", messageId: "msg-1" });

    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toMatchObject({ chatId: "966501112222@c.us" });
    expect(init?.headers).toMatchObject({ "X-Api-Key": "test-key" });
  });
});
