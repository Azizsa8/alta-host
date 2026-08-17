import type { WhatsAppGateway } from "./types.js";

/**
 * Meta's official WhatsApp Business Cloud API. This is the only transport a
 * real pilot should ever send guest-facing messages through — it's what
 * WHATSAPP_PROVIDER defaults to. In demo/local mode (no
 * WHATSAPP_CLOUD_API_TOKEN set) send() is a silent no-op; the caller already
 * persisted the message before calling it.
 */
export class CloudApiGateway implements WhatsAppGateway {
  constructor(
    private readonly token: string | undefined,
    private readonly phoneNumberId: string | undefined
  ) {}

  async send(params: { to: string; text: string; messageId: string }): Promise<void> {
    if (!this.token || !this.phoneNumberId) return; // demo mode — no credentials configured

    const url = `https://graph.facebook.com/v20.0/${this.phoneNumberId}/messages`;
    const body = JSON.stringify({
      messaging_product: "whatsapp",
      to: params.to,
      type: "text",
      text: { body: params.text },
    });

    const attempt = async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "<unreadable body>");
        throw new Error(`WhatsApp Cloud API responded ${response.status}: ${detail}`);
      }
      return response;
    };

    try {
      await attempt();
    } catch (firstErr) {
      console.error(`whatsapp send failed for message ${params.messageId} (attempt 1), retrying once`, firstErr);
      try {
        await attempt();
      } catch (secondErr) {
        // Message is already persisted regardless of delivery outcome; log
        // clearly and move on rather than crashing the request.
        console.error(`whatsapp send failed for message ${params.messageId} (attempt 2), giving up`, secondErr);
      }
    }
  }
}
