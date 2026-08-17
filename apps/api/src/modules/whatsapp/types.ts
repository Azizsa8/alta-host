// The one contract every outbound WhatsApp send goes through instead of
// calling a specific transport directly. CloudApiGateway (Meta's official
// WhatsApp Business Cloud API) and WahaGateway (self-hosted WAHA, dev/demo
// only — see wahaGateway.ts) both implement this same interface; swapping
// WHATSAPP_PROVIDER is the only thing that changes.

export interface WhatsAppGateway {
  send(params: { to: string; text: string; messageId: string }): Promise<void>;
}
