import { describe, expect, it } from "vitest";
import { buildProductSeoHtml } from "./productHtml";
import type { Product } from "@workspace/db/schema";

describe("buildProductSeoHtml", () => {
  it("adds product metadata and crawlable content without duplicate SEO tags", () => {
    const product = {
      id: 16,
      name: "Premium Golf Polo",
      description: "A premium performance polo for golf and sport.",
      sku: "KS1000B",
      thumbnailUrl: "/api/public/products/16.jpg",
      priceInPaise: 129900,
      available: true,
    } as Product;

    const html = buildProductSeoHtml(
      product,
      `<!doctype html><html><head>
        <title>Ka.Sha</title>
        <meta name="description" content="Homepage description" />
        <link rel="canonical" href="https://www.kashaonline.in/" />
        <meta property="og:title" content="Homepage" />
        <meta name="twitter:title" content="Homepage" />
      </head><body><div id="root"></div></body></html>`,
    );

    expect(html).toContain("<title>Premium Golf Polo | Ka.Sha</title>");
    expect(html.match(/<title>/gi)?.length).toBe(1);
    expect(html.match(/rel="canonical"/gi)?.length).toBe(1);
    expect(html).toContain('rel="canonical" href="https://www.kashaonline.in/products/16"');
    expect(html).not.toContain('content="Homepage description"');
    expect(html).not.toContain('href="https://www.kashaonline.in/"');
    expect(html).toContain('property="og:type" content="product"');
    expect(html).toContain('"@type":"Product"');
    expect(html).toContain("Style / SKU: KS1000B");
    expect(html).toContain('id="root"><main id="seo-product-content">');
  });
});
