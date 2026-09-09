import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, productsTable } from "@workspace/db";
import { buildProductSeoHtml } from "../seo/productHtml";

const router: IRouter = Router();

const FRONTEND_URL = (process.env.FRONTEND_URL || "https://www.kashaonline.in").replace(/\/$/, "");

router.get("/products/:id", async (req, res): Promise<void> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = Number.parseInt(rawId, 10);
    if (!Number.isInteger(id)) {
      res.status(400).send("Invalid product ID");
      return;
    }

    const [product] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, id));

    if (!product || !product.available) {
      res.status(404).send("Product not found");
      return;
    }

    // Fetch the existing production SPA shell rather than maintaining a second
    // copy of the frontend HTML. The rewrite keeps the browser URL unchanged.
    const shellResponse = await fetch(`${FRONTEND_URL}/index.html`, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(5000),
    });

    if (!shellResponse.ok) {
      throw new Error(`Frontend shell returned HTTP ${shellResponse.status}`);
    }

    const appHtml = await shellResponse.text();
    const html = buildProductSeoHtml(product, appHtml);

    // The API server normally sends a restrictive CSP because it serves JSON.
    // This response is intentionally an HTML pass-through for the existing SPA.
    res.removeHeader("Content-Security-Policy");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Robots-Tag", "index, follow");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).send(html);
  } catch (err) {
    req.log.error({ err }, "Failed to render product SEO page");
    // Fail closed rather than serving a broken/partial HTML document. Vercel's
    // normal catch-all remains the production fallback until this route is healthy.
    res.status(503).send("Product page temporarily unavailable");
  }
});

export default router;
