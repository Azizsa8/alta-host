import type { WhatsAppGateway } from "./types.js";

/**
 * Self-hosted WAHA (WhatsApp HTTP API) — dev/demo transport only. WAHA
 * drives WhatsApp through an unofficial Web-protocol client, not Meta's
 * sanctioned Business API: it needs no BSP approval, which is exactly why
 * it's useful for local development and pilot pitches before a real
 * WhatsApp Business number exists, but it also carries a real risk of the
 * connected number being banned by WhatsApp at any real message volume.
 * Never point WAHA_SESSION at a number used for actual guest traffic — a
 * signed pilot uses CloudApiGateway instead (WHATSAPP_PROVIDER=cloud_api,
 * the default).
 */
export class WahaGateway implements WhatsAppGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly session: string,
    private readonly apiKey: string | undefined
  ) {}

  async send(params: { to: string; text: string; messageId: string }): Promise<void> {
    const chatId = params.to.includes("@") ? params.to : `${params.to.replace(/\D/g, "")}@c.us`;
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/sendText`;
    const body = JSON.stringify({ chatId, text: params.text, session: this.session });

    const attempt = async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { "X-Api-Key": this.apiKey } : {}),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "<unreadable body>");
        throw new Error(`WAHA responded ${response.status}: ${detail}`);
      }
      return response;
    };

    try {
      await attempt();
    } catch (firstErr) {
      console.error(`waha send failed for message ${params.messageId} (attempt 1), retrying once`, firstErr);
      try {
        await attempt();
      } catch (secondErr) {
        console.error(`waha send failed for message ${params.messageId} (attempt 2), giving up`, secondErr);
      }
    }
  }
}
