/**
 * The channels a Saudi hotel actually operates or is asked about. Each entry
 * carries the facts that change how content is produced for it — a caption
 * that works on LinkedIn is wrong on TikTok, and a channel that cannot be
 * posted to via API must say so rather than pretend.
 *
 * `publish` is the honest capability statement:
 *   api    — we can publish directly once credentials are linked
 *   draft  — we prepare and schedule; a human posts it (no usable API)
 *   reply  — inbound/reply surface, not a posting surface
 */
export interface ChannelSpec {
  key: string;
  name: string;
  nameAr: string;
  family: "social" | "review" | "messaging" | "video" | "professional" | "listing";
  publish: "api" | "draft" | "reply";
  /** Hard limit the editor enforces so a post is never silently truncated. */
  maxChars: number;
  media: "image" | "video" | "both" | "text";
  /** Default cadence, overridable per hotel in SocialChannel.postsPerWeek. */
  defaultPostsPerWeek: number;
  toneHintAr: string;
}

export const CHANNEL_CATALOGUE: ChannelSpec[] = [
  { key: "instagram", name: "Instagram", nameAr: "إنستغرام", family: "social", publish: "api", maxChars: 2200, media: "both", defaultPostsPerWeek: 4, toneHintAr: "بصري أولًا، جملة قصيرة ودعوة واضحة" },
  { key: "instagram_stories", name: "Instagram Stories", nameAr: "قصص إنستغرام", family: "social", publish: "api", maxChars: 200, media: "both", defaultPostsPerWeek: 7, toneHintAr: "عفوي ولحظي، نص قليل جدًا" },
  { key: "instagram_reels", name: "Instagram Reels", nameAr: "ريلز إنستغرام", family: "video", publish: "api", maxChars: 2200, media: "video", defaultPostsPerWeek: 3, toneHintAr: "خطّاف في أول ثانيتين" },
  { key: "tiktok", name: "TikTok", nameAr: "تيك توك", family: "video", publish: "draft", maxChars: 2200, media: "video", defaultPostsPerWeek: 3, toneHintAr: "شبابي وسريع، بلا رسمية" },
  { key: "snapchat", name: "Snapchat", nameAr: "سناب شات", family: "social", publish: "draft", maxChars: 250, media: "both", defaultPostsPerWeek: 5, toneHintAr: "يومي وقريب، لهجة محكية" },
  { key: "x", name: "X", nameAr: "إكس", family: "social", publish: "api", maxChars: 280, media: "both", defaultPostsPerWeek: 5, toneHintAr: "مباشر ومختصر، خبر أو عرض" },
  { key: "facebook", name: "Facebook", nameAr: "فيسبوك", family: "social", publish: "api", maxChars: 5000, media: "both", defaultPostsPerWeek: 3, toneHintAr: "شرح أوفى وجمهور عائلي" },
  { key: "linkedin", name: "LinkedIn", nameAr: "لينكدإن", family: "professional", publish: "api", maxChars: 3000, media: "image", defaultPostsPerWeek: 2, toneHintAr: "مهني: قاعات الأعمال، الشراكات، التوظيف" },
  { key: "youtube", name: "YouTube", nameAr: "يوتيوب", family: "video", publish: "draft", maxChars: 5000, media: "video", defaultPostsPerWeek: 1, toneHintAr: "جولة كاملة أو قصة نزيل" },
  { key: "youtube_shorts", name: "YouTube Shorts", nameAr: "شورتس يوتيوب", family: "video", publish: "draft", maxChars: 1000, media: "video", defaultPostsPerWeek: 3, toneHintAr: "لقطة واحدة قوية" },
  { key: "threads", name: "Threads", nameAr: "ثريدز", family: "social", publish: "api", maxChars: 500, media: "both", defaultPostsPerWeek: 4, toneHintAr: "محادثة خفيفة" },
  { key: "pinterest", name: "Pinterest", nameAr: "بينترست", family: "social", publish: "draft", maxChars: 500, media: "image", defaultPostsPerWeek: 2, toneHintAr: "إلهام تصميم وديكور الغرف" },
  { key: "google_business", name: "Google Business", nameAr: "نشاطي على Google", family: "listing", publish: "api", maxChars: 1500, media: "image", defaultPostsPerWeek: 2, toneHintAr: "معلوماتي: العروض والمواعيد" },
  { key: "google_reviews", name: "Google Reviews", nameAr: "تقييمات Google", family: "review", publish: "reply", maxChars: 4000, media: "text", defaultPostsPerWeek: 0, toneHintAr: "رد مهذّب ومحدد على كل تقييم" },
  { key: "tripadvisor", name: "Tripadvisor", nameAr: "ترب أدفايزر", family: "review", publish: "reply", maxChars: 4000, media: "text", defaultPostsPerWeek: 0, toneHintAr: "رد رسمي موجّه للمسافر الدولي" },
  { key: "booking_com", name: "Booking.com", nameAr: "بوكينج", family: "review", publish: "reply", maxChars: 2000, media: "text", defaultPostsPerWeek: 0, toneHintAr: "رد يعالج نقاط التقييم بالترتيب" },
  { key: "airbnb", name: "Airbnb", nameAr: "إير بي إن بي", family: "review", publish: "reply", maxChars: 2000, media: "text", defaultPostsPerWeek: 0, toneHintAr: "ودّي وشخصي" },
  { key: "almosafer", name: "Almosafer", nameAr: "المسافر", family: "review", publish: "reply", maxChars: 2000, media: "text", defaultPostsPerWeek: 0, toneHintAr: "عربي أولًا، سوق سعودي" },
  { key: "whatsapp_status", name: "WhatsApp Status", nameAr: "حالة واتساب", family: "messaging", publish: "draft", maxChars: 700, media: "both", defaultPostsPerWeek: 3, toneHintAr: "إعلان قصير للنزلاء الحاليين" },
  { key: "telegram", name: "Telegram", nameAr: "تيليجرام", family: "messaging", publish: "api", maxChars: 4096, media: "both", defaultPostsPerWeek: 2, toneHintAr: "قناة إعلانات مباشرة" },
  { key: "newsletter", name: "Email Newsletter", nameAr: "النشرة البريدية", family: "messaging", publish: "draft", maxChars: 8000, media: "image", defaultPostsPerWeek: 1, toneHintAr: "عرض شهري مع دعوة حجز" },
  { key: "website_blog", name: "Website Blog", nameAr: "مدونة الموقع", family: "listing", publish: "draft", maxChars: 12000, media: "image", defaultPostsPerWeek: 1, toneHintAr: "مقال يخدم البحث المحلي" },
];

export const CHANNEL_KEYS = CHANNEL_CATALOGUE.map((c) => c.key);

export function channelSpec(key: string): ChannelSpec | undefined {
  return CHANNEL_CATALOGUE.find((c) => c.key === key);
}
