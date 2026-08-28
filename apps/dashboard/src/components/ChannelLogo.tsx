/**
 * Brand marks for the channel catalogue, drawn inline as SVG.
 *
 * Inline rather than remote files for three reasons: the dashboard's CSP
 * blocks third-party image hosts, a logo CDN would leak which hotel is
 * looking at which channel, and an icon that fails to load leaves a
 * connect button no-one can identify. Simplified glyphs used nominatively
 * to identify each platform.
 */

const BRAND: Record<string, { bg: string; fg: string }> = {
  instagram: { bg: "linear-gradient(45deg,#F58529,#DD2A7B,#8134AF)", fg: "#fff" },
  instagram_stories: { bg: "linear-gradient(45deg,#F58529,#DD2A7B,#8134AF)", fg: "#fff" },
  instagram_reels: { bg: "linear-gradient(45deg,#F58529,#DD2A7B,#8134AF)", fg: "#fff" },
  tiktok: { bg: "#010101", fg: "#fff" },
  snapchat: { bg: "#FFFC00", fg: "#111" },
  x: { bg: "#000000", fg: "#fff" },
  facebook: { bg: "#1877F2", fg: "#fff" },
  linkedin: { bg: "#0A66C2", fg: "#fff" },
  youtube: { bg: "#FF0000", fg: "#fff" },
  youtube_shorts: { bg: "#FF0000", fg: "#fff" },
  threads: { bg: "#000000", fg: "#fff" },
  pinterest: { bg: "#E60023", fg: "#fff" },
  google_business: { bg: "#ffffff", fg: "#4285F4" },
  google_reviews: { bg: "#ffffff", fg: "#4285F4" },
  tripadvisor: { bg: "#34E0A1", fg: "#000" },
  booking_com: { bg: "#003580", fg: "#fff" },
  airbnb: { bg: "#FF5A5F", fg: "#fff" },
  almosafer: { bg: "#5E2B8C", fg: "#fff" },
  whatsapp_status: { bg: "#25D366", fg: "#fff" },
  telegram: { bg: "#26A5E4", fg: "#fff" },
  newsletter: { bg: "#334155", fg: "#fff" },
  website_blog: { bg: "#0F766E", fg: "#fff" },
};

function Glyph({ channel, color }: { channel: string; color: string }) {
  const p = { fill: color };
  switch (channel) {
    case "instagram":
    case "instagram_stories":
    case "instagram_reels":
      return (
        <g>
          <rect x="4" y="4" width="16" height="16" rx="5" fill="none" stroke={color} strokeWidth="1.9" />
          <circle cx="12" cy="12" r="3.6" fill="none" stroke={color} strokeWidth="1.9" />
          <circle cx="16.9" cy="7.1" r="1.1" {...p} />
        </g>
      );
    case "tiktok":
      return (
        <path
          {...p}
          d="M16.6 5.2c.5 1.6 1.7 2.8 3.4 3.1v2.6c-1.3 0-2.5-.4-3.5-1.1v5.4c0 2.8-2.2 5-5 5s-5-2.2-5-5 2.2-5 5-5c.3 0 .5 0 .8.1v2.7c-.3-.1-.5-.1-.8-.1-1.3 0-2.4 1.1-2.4 2.4S10.2 17.6 11.5 17.6s2.5-1 2.5-2.4V5.2h2.6z"
        />
      );
    case "snapchat":
      return (
        <path
          {...p}
          d="M12 4c2.5 0 4.3 1.9 4.3 4.4 0 .8-.1 1.5-.1 1.9.3.2.8.2 1.2 0 .5-.2 1 .1 1 .6 0 .6-.9.9-1.6 1.2-.4.2-.6.3-.5.7.3 1.1 1.7 2.6 3 2.9.3.1.5.3.4.6-.2.6-1.4.8-2.2.9-.2.4-.2 1-.7 1-.5 0-1.1-.3-2.1-.3-1.2 0-1.7 1.1-3 1.1s-1.8-1.1-3-1.1c-1 0-1.6.3-2.1.3-.5 0-.5-.6-.7-1-.8-.1-2-.3-2.2-.9-.1-.3.1-.5.4-.6 1.3-.3 2.7-1.8 3-2.9.1-.4-.1-.5-.5-.7-.7-.3-1.6-.6-1.6-1.2 0-.5.5-.8 1-.6.4.2.9.2 1.2 0 0-.4-.1-1.1-.1-1.9C7.7 5.9 9.5 4 12 4z"
        />
      );
    case "x":
    case "threads":
      return channel === "x" ? (
        <path {...p} d="M17.3 4h3l-6.6 7.5L21.5 20h-6l-4.7-6.1L5.4 20H2.3l7-8L2.1 4h6.2l4.2 5.6L17.3 4zm-1.1 14.1h1.7L8.1 5.8H6.3l9.9 12.3z" />
      ) : (
        <path {...p} d="M12.2 21c-2.6 0-4.6-.9-5.9-2.5C5.1 17 4.4 14.9 4.4 12.2s.7-4.8 1.9-6.3C7.6 4.3 9.6 3.4 12.2 3.4c1.9 0 3.5.5 4.7 1.4 1.1.9 1.9 2.1 2.3 3.6l-2 .6c-.6-2.2-2.1-3.4-4.4-3.5-1.8 0-3.2.6-4.1 1.8-.9 1.2-1.3 2.8-1.3 4.9s.4 3.7 1.3 4.9c.9 1.2 2.3 1.8 4.1 1.8 1.6 0 2.8-.4 3.6-1.1.7-.6 1.1-1.4 1.1-2.2 0-.7-.3-1.3-.9-1.8-.2 1-.7 1.8-1.4 2.3-.8.6-1.8.8-2.9.7-1.2-.1-2.1-.5-2.7-1.2-.6-.7-.9-1.5-.8-2.4.1-1 .5-1.7 1.3-2.3.8-.5 1.8-.8 3-.8.7 0 1.4.1 2 .2 0-.6-.2-1.1-.6-1.4-.4-.4-.9-.5-1.6-.5-1 0-1.8.4-2.2 1.2l-1.8-1c.9-1.4 2.2-2.1 4-2.1 1.3 0 2.4.4 3.1 1.1.8.8 1.2 1.9 1.2 3.3v.4c1.3.9 2 2.1 2 3.6 0 1.5-.6 2.8-1.9 3.8-1.2 1-2.9 1.5-4.9 1.5zm.7-8.5c-1.4 0-2.2.5-2.3 1.3 0 .4.1.7.4 1 .3.3.8.4 1.3.5.8 0 1.4-.2 1.8-.7.4-.4.6-1 .7-1.8-.6-.2-1.2-.3-1.9-.3z" />
      );
    case "facebook":
      return <path {...p} d="M13.5 21v-7.6h2.6l.4-3h-3V8.5c0-.9.2-1.5 1.5-1.5h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21h3.1z" />;
    case "linkedin":
      return (
        <g>
          <rect x="3.5" y="3.5" width="17" height="17" rx="2.4" fill="none" stroke={color} strokeWidth="1.7" />
          <path {...p} d="M7.6 10.2h1.9v7H7.6v-7zm.95-3a1.1 1.1 0 110 2.2 1.1 1.1 0 010-2.2zM11.2 10.2H13v1c.35-.6 1.1-1.15 2.15-1.15 1.7 0 2.35 1.05 2.35 2.85v4.3h-1.9v-3.9c0-1-.35-1.55-1.15-1.55-.7 0-1.25.5-1.25 1.6v3.85h-1.9v-7z" />
        </g>
      );
    case "youtube":
    case "youtube_shorts":
      return (
        <g>
          <rect x="2.5" y="6" width="19" height="12" rx="3.4" fill="none" stroke={color} strokeWidth="1.9" />
          <path {...p} d="M10.3 9.4l5 2.6-5 2.6V9.4z" />
        </g>
      );
    case "pinterest":
      return <path {...p} d="M12 3.5c-4.7 0-7.1 3.2-7.1 6 0 1.6.6 3.1 2 3.6.2.1.4 0 .5-.2l.2-.8c.1-.2 0-.3-.1-.5-.4-.5-.7-1.2-.7-2.1 0-2.7 2-5.1 5.2-5.1 2.9 0 4.5 1.7 4.5 4 0 3-1.4 5.5-3.4 5.5-1.1 0-1.9-.9-1.6-2 .3-1.3 1-2.7 1-3.6 0-.8-.5-1.5-1.4-1.5-1.1 0-2 1.2-2 2.7 0 1 .3 1.7.3 1.7l-1.4 5.7c-.4 1.6-.1 3.6 0 3.8 0 .1.2.1.2 0 .1-.1 1.4-1.7 1.8-3.3l.7-2.7c.4.7 1.4 1.3 2.5 1.3 3.3 0 5.6-3 5.6-7 0-3-2.6-5.8-6.5-5.8z" />;
    case "google_business":
    case "google_reviews":
      return (
        <path
          d="M21.4 12.2c0-.7-.06-1.3-.18-1.9H12v3.6h5.3c-.23 1.2-.92 2.2-1.97 2.9v2.4h3.2c1.87-1.7 2.95-4.2 2.95-7z"
          fill="#4285F4"
        >
          <animate attributeName="opacity" values="1;1" dur="1s" />
        </path>
      );
    case "tripadvisor":
      return (
        <g>
          <circle cx="7.8" cy="12.5" r="3.4" fill="none" stroke={color} strokeWidth="1.7" />
          <circle cx="16.2" cy="12.5" r="3.4" fill="none" stroke={color} strokeWidth="1.7" />
          <circle cx="7.8" cy="12.5" r="1.2" {...p} />
          <circle cx="16.2" cy="12.5" r="1.2" {...p} />
          <path {...p} d="M12 6.2c2.6 0 5 .8 6.8 2.1h-2.6c-1.2-.5-2.7-.8-4.2-.8s-3 .3-4.2.8H5.2C7 7 9.4 6.2 12 6.2z" />
        </g>
      );
    case "booking_com":
      return <path {...p} d="M8 5.5h4.6c2.4 0 3.9 1.2 3.9 3.1 0 1.2-.6 2.1-1.6 2.6 1.4.4 2.3 1.5 2.3 3 0 2.2-1.7 3.6-4.4 3.6H8V5.5zm2.7 4.9h1.7c1 0 1.6-.5 1.6-1.3s-.6-1.3-1.6-1.3h-1.7v2.6zm0 5.1h2c1.1 0 1.8-.6 1.8-1.5s-.7-1.4-1.8-1.4h-2v2.9z" />;
    case "airbnb":
      return <path {...p} d="M12 3.6c1 0 1.8.6 2.4 1.7 1.3 2.3 4.4 8.3 4.9 9.6.6 1.6-.2 3.4-1.9 3.9-1.4.4-2.9-.2-4-1.3l-1.4-1.4-1.4 1.4c-1.1 1.1-2.6 1.7-4 1.3-1.7-.5-2.5-2.3-1.9-3.9.5-1.3 3.6-7.3 4.9-9.6.6-1.1 1.4-1.7 2.4-1.7zm0 2.2c-.3 0-.6.3-.9.8-1.2 2.2-4.2 8-4.6 9.1-.3.8.1 1.5.8 1.7.7.2 1.5-.2 2.2-.9l1.4-1.5-1-1.6c-.7-1.1-.3-2.4.8-2.9 1-.4 2.1 0 2.6 1 .4.7.3 1.5-.1 2.1l-1 1.5 1.4 1.4c.7.7 1.5 1.1 2.2.9.7-.2 1.1-.9.8-1.7-.4-1.1-3.4-6.9-4.6-9.1-.3-.5-.6-.8-.9-.8z" />;
    case "whatsapp_status":
      return <path {...p} d="M12 3.8c-4.5 0-8.2 3.7-8.2 8.2 0 1.5.4 2.9 1.1 4.1L3.8 20.2l4.3-1.1c1.2.6 2.5 1 3.9 1 4.5 0 8.2-3.7 8.2-8.2S16.5 3.8 12 3.8zm4.7 11.5c-.2.6-1.2 1.1-1.6 1.1-.4 0-.9.2-3-.6-2.5-1-4.1-3.6-4.2-3.8-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5.2.6.8 2 .9 2.1.1.1.1.3 0 .5-.1.2-.2.3-.3.5l-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.1 1 2.1 1.3 2.4 1.4.3.1.4.1.6-.1l.8-1c.2-.2.4-.2.6-.1l1.8.9c.2.1.4.2.4.3.1.1.1.6-.1 1.2z" />;
    case "telegram":
      return <path {...p} d="M20.7 5.1L3.8 11.6c-1 .4-1 1 .1 1.3l4.2 1.3 1.6 4.9c.2.6.4.6.9.2l2.4-1.9 4.1 3c.8.4 1.3.2 1.5-.7l2.8-13c.2-1-.3-1.4-1-1.1l.3-.5zM8.9 13.8l8.7-5.5c.4-.2.8-.1.5.2l-7.4 6.7-.3 3-1.5-4.4z" />;
    case "newsletter":
      return (
        <g>
          <rect x="3" y="5.5" width="18" height="13" rx="2.2" fill="none" stroke={color} strokeWidth="1.8" />
          <path d="M3.8 7l8.2 6 8.2-6" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        </g>
      );
    default:
      return (
        <g>
          <circle cx="12" cy="12" r="8.4" fill="none" stroke={color} strokeWidth="1.8" />
          <path d="M4 12h16M12 4a13 13 0 010 16M12 4a13 13 0 000 16" fill="none" stroke={color} strokeWidth="1.5" />
        </g>
      );
  }
}

export function ChannelLogo({ channel, size = 30 }: { channel: string; size?: number }) {
  const brand = BRAND[channel] ?? { bg: "#312545", fg: "#F3EFF7" };
  const isGoogle = channel.startsWith("google");
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        background: brand.bg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        border: isGoogle ? "1px solid rgba(0,0,0,.12)" : "none",
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} role="img" focusable="false">
        <Glyph channel={channel} color={brand.fg} />
      </svg>
    </span>
  );
}
