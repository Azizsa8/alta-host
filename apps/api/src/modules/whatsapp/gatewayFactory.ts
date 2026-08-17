import { CloudApiGateway } from "./cloudApiGateway.js";
import { WahaGateway } from "./wahaGateway.js";
import type { WhatsAppGateway } from "./types.js";

// Selects the WhatsApp transport behind WHATSAPP_PROVIDER — defaults to
// "cloud_api" so a real pilot never accidentally sends guest messages
// through WAHA's unofficial transport. "waha" is dev/demo only; see
// wahaGateway.ts for why.
export function createWhatsAppGateway(): WhatsAppGateway {
  const provider = process.env.WHATSAPP_PROVIDER ?? "cloud_api";

  if (provider === "waha") {
    const baseUrl = process.env.WAHA_BASE_URL;
    if (baseUrl) {
      return new WahaGateway(baseUrl, process.env.WAHA_SESSION ?? "default", process.env.WAHA_API_KEY);
    }
    console.warn(
      "WHATSAPP_PROVIDER=waha but WAHA_BASE_URL is unset — falling back to CloudApiGateway. Set WAHA_BASE_URL to use the WAHA dev/demo transport."
    );
  }

  return new CloudApiGateway(process.env.WHATSAPP_CLOUD_API_TOKEN, process.env.WHATSAPP_PHONE_NUMBER_ID);
}
