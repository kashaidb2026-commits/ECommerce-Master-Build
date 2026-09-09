import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, productsTable } from "@workspace/db";
import { buildProductSeoHtml } from "../seo/productHtml";

const router: IRouter = Router();

const FRONTEND_URL = (process.env.FRONTEND_URL || "https://www.kashaonline.in").replace(/\/$/, "");

async function fetchAppShell(): Promise<string> {
  const shellResponse = await fetch(`${FRONTEND_URL}/index.html`, {
    headers: { Accept: "text/html" },
    signal: AbortSignal.timeout(5000),
  });

  if (!shellResponse.ok) {
    throw new Error(`Frontend shell returned HTTP ${shellResponse.status}`);
  }

  return shellResponse.text();
}

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

    const appHtml = await fetchAppShell();
    const html = buildProductSeoHtml(product, appHtml);

    res.removeHeader("Content-Security-Policy");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Robots-Tag", "index, follow");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).send(html);
  } catch (err) {
    req.log.error({ err }, "Failed to render product SEO page");

    // Preserve the existing SPA if SEO rendering is temporarily unavailable.
    // This keeps product navigation functional instead of replacing it with a 503.
    try {
      const appHtml = await fetchAppShell();
      res.removeHeader("Content-Security-Policy");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.status(200).send(appHtml);
    } catch (fallbackErr) {
      req.log.error({ err: fallbackErr }, "Failed to return SPA fallback for product SEO page");
      res.status(503).send("Product page temporarily unavailable");
    }
  }
});

export default router;
