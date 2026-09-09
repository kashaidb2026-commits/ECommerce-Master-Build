import type { Product } from "@workspace/db/schema";

const SITE_URL = "https://www.kashaonline.in";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function absoluteUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  return `${SITE_URL}${value.startsWith("/") ? "" : "/"}${value}`;
}

function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildProductSeoHtml(product: Product, appHtml: string): string {
  const url = `${SITE_URL}/products/${product.id}`;
  const name = product.name || product.sku || `Ka.Sha Product ${product.id}`;
  const description = product.description?.trim() || `Shop ${name} from Ka.Sha premium golf wear and luxury sports apparel.`;
  const image = absoluteUrl(product.thumbnailUrl);
  const price = Number(product.priceInPaise ?? 0) / 100;
  const availability = product.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description,
    ...(image ? { image: [image] } : {}),
    ...(product.sku ? { sku: product.sku } : {}),
    brand: { "@type": "Brand", name: "Ka.Sha" },
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "INR",
      price: price.toFixed(2),
      availability,
    },
  };

  const meta = `
    <title>${escapeHtml(name)} | Ka.Sha</title>
    <meta name="description" content="${escapeHtml(description.slice(0, 160))}" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta property="og:type" content="product" />
    <meta property="og:title" content="${escapeHtml(name)} | Ka.Sha" />
    <meta property="og:description" content="${escapeHtml(description.slice(0, 160))}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    ${image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : ""}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(name)} | Ka.Sha" />
    <meta name="twitter:description" content="${escapeHtml(description.slice(0, 160))}" />
    ${image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : ""}
    <script type="application/ld+json">${jsonLd(productSchema)}</script>
  `;

  const crawlableContent = `
    <main id="seo-product-content">
      <h1>${escapeHtml(name)}</h1>
      <p>${escapeHtml(description)}</p>
      ${product.sku ? `<p>Style / SKU: ${escapeHtml(product.sku)}</p>` : ""}
      <p>Ka.Sha premium golf wear and luxury sports apparel.</p>
    </main>
  `;

  return appHtml
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(name)} | Ka.Sha</title>`)
    .replace(/<\/head>/i, `${meta}\n</head>`)
    .replace(/<div id="root"><\/div>/i, `<div id="root">${crawlableContent}</div>`);
}
