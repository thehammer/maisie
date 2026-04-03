import type { GoogleAuth } from "../google/google-auth";

export interface TrackedOrder {
  id: string; // gmail message id
  retailer: string;
  description: string; // cleaned item description
  trackingNumber: string | null;
  carrier: string | null;
  status: "ordered" | "shipped" | "out_for_delivery" | "delivered";
  orderDate: string;
  estimatedDelivery: string | null;
  imageUrl: string | null;
  lastUpdated: string;
}

// Multiple smaller queries to avoid Gmail search complexity limits
const SEARCH_QUERIES = [
  // Carrier notifications
  'newer_than:30d from:(ups.com OR fedex.com OR usps.com) subject:(delivery OR tracking OR shipped)',
  // Amazon
  'newer_than:30d from:amazon.com subject:(shipped OR delivered OR "out for delivery" OR arriving)',
  // eBay — use "order" keyword but not in subject: to avoid emoji issues
  'newer_than:30d from:ebay.com (order OR shipped OR delivery OR tracking)',
  // General shipping keywords
  'newer_than:30d subject:("has shipped" OR "shipment confirmation" OR "out for delivery" OR "order update" OR "track your package")',
  // Other retailers
  'newer_than:30d from:(apple.com OR newegg.com OR bestbuy.com OR walmart.com OR target.com) subject:(shipped OR order OR delivery)',
];

// Known carrier tracking number patterns — order matters! Check USPS before FedEx
// since USPS long-digit patterns would otherwise match FedEx's generic digit regex
const TRACKING_PATTERNS: { carrier: string; patterns: RegExp[] }[] = [
  {
    carrier: "UPS",
    patterns: [/\b1Z[A-Z0-9]{16}\b/i],
  },
  {
    carrier: "Amazon",
    patterns: [/\bTBA\d{10,14}\b/i],
  },
  {
    carrier: "USPS",
    patterns: [
      /\b9[2-5]\d{20,26}\b/, // starts with 92-95, 22-28 digits
      /\b[A-Z]{2}\d{9}US\b/i, // international format
    ],
  },
  {
    carrier: "FedEx",
    patterns: [
      // Only match FedEx-length numbers when near tracking context to avoid false positives
      /(?:tracking|track|fedex)[^a-z]{0,20}(\b[0-9]{12}\b)/i,
      /(?:tracking|track|fedex)[^a-z]{0,20}(\b[0-9]{15}\b)/i,
      /(?:tracking|track|fedex)[^a-z]{0,20}(\b[0-9]{20}\b)/i,
    ],
  },
];

// Retailer detection from sender
const RETAILER_PATTERNS: [RegExp, string][] = [
  [/amazon\.com/i, "Amazon"],
  [/apple\.com/i, "Apple"],
  [/bestbuy\.com/i, "Best Buy"],
  [/walmart\.com/i, "Walmart"],
  [/target\.com/i, "Target"],
  [/ebay\.com|ebay@/i, "eBay"],
  [/newegg\.com/i, "Newegg"],
  [/homedepot\.com/i, "Home Depot"],
  [/lowes\.com/i, "Lowe's"],
  [/costco\.com/i, "Costco"],
  [/bhphoto/i, "B&H Photo"],
  [/adorama/i, "Adorama"],
  [/etsy\.com/i, "Etsy"],
  [/ups\.com/i, "UPS"],
  [/fedex\.com/i, "FedEx"],
  [/usps\.com/i, "USPS"],
  [/narvar\.com/i, "Narvar"],
  [/shop\.app|getshopapp/i, "Shop"],
];

function cleanDescription(subject: string, retailer: string): string {
  let desc = subject;
  // Strip emoji prefixes first (eBay uses 🚚 etc) so text prefixes are exposed
  desc = desc.replace(/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]+/u, "");
  // Strip common prefixes
  desc = desc.replace(/^(Shipped|Your Amazon\.com order of|Your .+ order|Order Confirmation|Shipping Confirmation|Order update|Order Status Inquiry)[:\s]*/i, "");
  // Strip " has shipped!" suffix
  desc = desc.replace(/\s*has shipped!?\s*$/i, "");
  // Strip HTML entities
  desc = desc.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  // Strip quantity prefix like '4 "How to...'
  desc = desc.replace(/^\d+\s+"/, '"');
  // Strip surrounding quotes
  desc = desc.replace(/^"(.*)"$/, "$1");
  // Strip "..." truncation
  desc = desc.replace(/\.\.\."?\s*$/, "");
  // Strip "and X more item(s)"
  desc = desc.replace(/\s*"?\s*and \d+ more items?$/i, "");
  // Strip "Newegg Marketplace Order #12345 - ..." patterns
  desc = desc.replace(/^(?:Newegg\s+)?(?:Marketplace\s+)?Order\s+#\d+\s*-\s*/i, "");
  // For carrier emails, try to extract shipper from snippet or simplify
  if (retailer === "USPS" || retailer === "FedEx" || retailer === "UPS") {
    const shipperMatch = subject.match(/from:\s*(.+?)(?:\s+Expected|\s*$)/i);
    if (shipperMatch) return `Package from ${shipperMatch[1].trim()}`;
    return `${retailer} Package`;
  }
  // Clean remaining quotes
  desc = desc.replace(/^["']|["']$/g, "");
  return desc.trim() || subject;
}

function detectRetailer(from: string, subject: string): string {
  for (const [pattern, name] of RETAILER_PATTERNS) {
    if (pattern.test(from)) return name;
  }
  // Try to extract domain from email
  const domainMatch = from.match(/@([a-z0-9.-]+)/i);
  if (domainMatch) {
    const domain = domainMatch[1].replace(/^(mail|email|notify|noreply|no-reply)\./i, "");
    const parts = domain.split(".");
    if (parts.length >= 2) {
      return parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1);
    }
  }
  return "Unknown";
}

function detectStatus(subject: string, snippet: string): TrackedOrder["status"] {
  const text = `${subject} ${snippet}`.toLowerCase();
  if (text.includes("delivered") || text.includes("was delivered")) return "delivered";
  if (text.includes("out for delivery") || text.includes("arriving today")) return "out_for_delivery";
  if (text.includes("shipped") || text.includes("shipment") || text.includes("on its way") || text.includes("in transit")) return "shipped";
  if (text.includes("order update") || text.includes("estimated delivery")) return "shipped";
  return "ordered";
}

function extractTracking(text: string): { trackingNumber: string; carrier: string } | null {
  for (const { carrier, patterns } of TRACKING_PATTERNS) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        // Use capture group if present (FedEx patterns), otherwise full match
        return { trackingNumber: match[1] || match[0], carrier };
      }
    }
  }
  return null;
}

function extractEstimatedDelivery(text: string): string | null {
  // Look for patterns like "arriving Monday, March 10" or "delivery by March 12"
  // or "estimated delivery: Mar 10 - Mar 12"
  const patterns = [
    /(?:arriv(?:ing|e|es)|deliver(?:y|ed)?|expected)\s+(?:by\s+)?(?:on\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?,?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?)/i,
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?(?:\s*-\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?)?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // For date ranges like "Mar 10 - Mar 12", use the later date
      let dateStr = match[1] || match[0];
      const rangeParts = dateStr.split(/\s*-\s*/);
      if (rangeParts.length === 2) dateStr = rangeParts[1];
      try {
        let d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          // new Date("Mar 13") defaults to year 2001 — fix to current/next year
          if (d.getFullYear() < 2020) {
            const now = new Date();
            d.setFullYear(now.getFullYear());
            // If the date is more than 30 days in the past, assume next year
            if (d.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) {
              d.setFullYear(now.getFullYear() + 1);
            }
          }
          return d.toISOString().split("T")[0];
        }
      } catch {
        return dateStr;
      }
    }
  }
  return null;
}

// Decode base64url-encoded email body parts
function decodeBody(payload: any): string {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
    }
    // Try text/html as fallback, strip tags
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = Buffer.from(part.body.data, "base64url").toString("utf-8");
        return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      }
      // Nested multipart
      if (part.parts) {
        const nested = decodeBody(part);
        if (nested) return nested;
      }
    }
  }
  return "";
}

// Extract raw HTML from email (without stripping tags)
function decodeHtml(payload: any): string {
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
      if (part.parts) {
        const nested = decodeHtml(part);
        if (nested) return nested;
      }
    }
  }
  // Single-part HTML message
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  return "";
}

// Blocklist patterns for non-product images (logos, icons, pixels, social media)
const IMAGE_BLOCKLIST = /logo|pixel|spacer|icon|smile|instagram|facebook|twitter|x-icon|badge|star-|1x1|transparent|footer|header|banner|btn|button|arrow|divider|separator|social|app.store|google.play|checkmark|calendar|usps\.com/i;

function extractProductImage(html: string, retailer: string): string | null {
  if (!html) return null;

  // Amazon: first m.media-amazon.com/images/I/ URL (product image)
  if (retailer === "Amazon") {
    const match = html.match(/https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9._+%-]+\.jpg/);
    if (match) {
      // Upsize to 200px thumbnail
      return match[0].replace(/\._[A-Z]{2}\d+_/, "._SS200_");
    }
  }

  // eBay: look for ebayimg.com product images (inside imageser URLs or direct)
  if (retailer === "eBay") {
    // Direct ebayimg product images (skip tiny icons)
    const matches = html.matchAll(/https:\/\/i\.ebayimg\.com\/images\/g\/[A-Za-z0-9~_-]+\/s-l\d+\.\w+/g);
    for (const m of matches) {
      if (!IMAGE_BLOCKLIST.test(m[0])) return m[0];
    }
    // Fallback: imageser render URLs with embedded ebayimg
    const renderMatch = html.match(/https:\/\/svcs\.ebay\.com\/imageser\/v1\/image\/render\?[^"'\s]+imgWidth=(?:300|448)[^"'\s]*/);
    if (renderMatch) return renderMatch[0].replace(/&amp;/g, "&");
  }

  // Generic: find product-like images — skip small icons and branding
  const imgTags = html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
  for (const tag of imgTags) {
    const url = tag[1];
    if (!url.startsWith("http")) continue;
    if (IMAGE_BLOCKLIST.test(url)) continue;
    // Skip tiny images (1x1, 2x2 etc)
    const sizeMatch = tag[0].match(/(?:width|height)=["']?(\d+)/i);
    if (sizeMatch && parseInt(sizeMatch[1]) < 40) continue;
    return url.replace(/&amp;/g, "&");
  }

  return null;
}

// Only mark delivered if email explicitly says so, or estimated delivery is past
// The merge step handles matching shipped emails with their delivered counterparts
function adjustStatus(status: TrackedOrder["status"], estimatedDelivery: string | null, _orderDate: string): TrackedOrder["status"] {
  if (status === "delivered") return "delivered";

  if (estimatedDelivery) {
    const deliveryDate = new Date(estimatedDelivery);
    const now = new Date();
    if (!isNaN(deliveryDate.getTime()) && deliveryDate < now) {
      return "delivered";
    }
  }

  // Keep "out for delivery" as-is if recent — merge step will upgrade if a delivered email exists
  // Only auto-upgrade if more than 2 days old (definitely delivered by then)
  if (status === "out_for_delivery") {
    const orderTime = new Date(_orderDate).getTime();
    if (!isNaN(orderTime) && Date.now() - orderTime > 2 * 24 * 60 * 60 * 1000) {
      return "delivered";
    }
  }

  return status;
}

// Extract significant words from a description for fuzzy matching
function descriptionWords(desc: string): string[] {
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

// Merge orders: if we have both a "shipped" and "Delivered" email for the same item,
// mark the shipped one as delivered and drop the duplicate delivery entry
function mergeDeliveryStatus(orders: TrackedOrder[]): TrackedOrder[] {
  const delivered = orders.filter((o) => o.status === "delivered");
  const rest = orders.filter((o) => o.status !== "delivered");

  for (const order of rest) {
    const words = descriptionWords(order.description);
    if (words.length === 0) continue;

    // Find a matching delivered email from the same retailer
    const match = delivered.find((d) => {
      if (d.retailer !== order.retailer) return false;
      const dWords = descriptionWords(d.description);
      // Check if they share significant words (at least 2, or 1 if short description)
      const shared = words.filter((w) => dWords.includes(w));
      const threshold = words.length <= 2 ? 1 : 2;
      return shared.length >= threshold;
    });

    if (match) {
      order.status = "delivered";
      // Keep the better image (shipped email usually has the product image)
      // but pull any missing data from the delivery confirmation
      if (!order.trackingNumber && match.trackingNumber) {
        order.trackingNumber = match.trackingNumber;
        order.carrier = match.carrier;
      }
    }
  }

  // Return merged rest (some now marked delivered) + any delivered entries that didn't match
  const matchedDeliveredIds = new Set<string>();
  for (const order of rest) {
    if (order.status === "delivered") {
      const words = descriptionWords(order.description);
      const match = delivered.find((d) => {
        if (matchedDeliveredIds.has(d.id)) return false;
        if (d.retailer !== order.retailer) return false;
        const dWords = descriptionWords(d.description);
        const shared = words.filter((w) => dWords.includes(w));
        const threshold = words.length <= 2 ? 1 : 2;
        return shared.length >= threshold;
      });
      if (match) matchedDeliveredIds.add(match.id);
    }
  }

  // Add unmatched delivered entries (standalone delivery notifications)
  const unmatched = delivered.filter((d) => !matchedDeliveredIds.has(d.id));
  return [...rest, ...unmatched];
}

export async function scanForOrders(auth: GoogleAuth): Promise<TrackedOrder[]> {
  // Run multiple smaller queries to avoid Gmail search complexity limits
  const allMessageIds = new Set<string>();
  for (const query of SEARCH_QUERIES) {
    try {
      const list = await auth.apiRequest(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=30&q=${encodeURIComponent(query)}`,
      );
      for (const msg of list.messages || []) {
        allMessageIds.add(msg.id);
      }
    } catch (err) {
      console.error(`[packages] Search query failed:`, err);
    }
  }

  if (allMessageIds.size === 0) return [];

  const orders: TrackedOrder[] = [];
  const seen = new Set<string>(); // dedupe by tracking number

  for (const msgId of allMessageIds) {
    try {
      // Fetch full message to extract tracking info from body
      const detail = await auth.apiRequest(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
      );

      const headers = detail.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

      const from = getHeader("From");
      const subject = getHeader("Subject");
      const date = getHeader("Date");
      const snippet = detail.snippet || "";

      // Get body text for better tracking extraction
      const bodyText = decodeBody(detail.payload);
      const htmlBody = decodeHtml(detail.payload);
      const searchText = `${subject} ${snippet} ${bodyText}`;

      const retailer = detectRetailer(from, subject);

      // Skip eBay saved search alerts (e.g., "sony ps-lx310bt: 5 NEW!")
      if (retailer === "eBay" && /:\s*\d+\s*NEW!/i.test(subject)) continue;
      // Skip generic marketing/promo emails
      if (/unsubscribe|sale|deal|coupon|promo|daily deals|save \d+%/i.test(subject)) continue;

      const rawStatus = detectStatus(subject, snippet);
      const tracking = extractTracking(searchText);
      const estimatedDelivery = extractEstimatedDelivery(searchText);
      const status = adjustStatus(rawStatus, estimatedDelivery, date);
      let description = cleanDescription(subject, retailer);
      // For carrier emails, try to extract shipper from body
      if ((retailer === "USPS" || retailer === "FedEx" || retailer === "UPS") && description.endsWith("Package")) {
        const shipperMatch = bodyText.match(/(?:shipped from|package from|shipper)[:\s]*([A-Z][A-Za-z0-9 &.'-]+)/i);
        if (shipperMatch) {
          // Take just the company name — stop at common suffixes
          let shipper = shipperMatch[1].trim();
          shipper = shipper.replace(/\s*(Expected|Estimated|Delivery|Tracking|Click|View).*$/i, "").trim();
          if (shipper.length > 2) {
            description = `Package from ${shipper}`;
          }
        }
      }

      const imageUrl = extractProductImage(htmlBody, retailer);

      // Dedupe: skip if we already have this tracking number
      const dedupeKey = tracking?.trackingNumber || `${retailer}:${subject}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      orders.push({
        id: detail.id,
        retailer,
        description,
        trackingNumber: tracking?.trackingNumber || null,
        carrier: tracking?.carrier || null,
        status,
        orderDate: date,
        estimatedDelivery,
        imageUrl,
        lastUpdated: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[packages] Error processing message ${msgId}:`, err);
    }
  }

  // Merge shipped/ordered entries with their "Delivered" counterparts
  // Amazon sends separate "shipped" and "Delivered:" emails for the same item
  const merged = mergeDeliveryStatus(orders);

  // Sort: active orders first (out_for_delivery > shipped > ordered), then by date desc
  const statusOrder = { out_for_delivery: 0, shipped: 1, ordered: 2, delivered: 3 };
  merged.sort((a, b) => {
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    return new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime();
  });

  return merged;
}

// Get only active (non-delivered) orders
export async function getActiveOrders(auth: GoogleAuth): Promise<TrackedOrder[]> {
  const all = await scanForOrders(auth);
  return all.filter((o) => o.status !== "delivered");
}
