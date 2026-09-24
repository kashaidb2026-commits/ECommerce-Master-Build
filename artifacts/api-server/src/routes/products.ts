import { Router, type IRouter } from "express";
import { eq, ne, and, or, ilike } from "drizzle-orm";
import { db, productsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/products", async (req, res): Promise<void> => {
  try {
    const { category, gender, productType, subType, q } = req.query;

    const conditions: any[] = [eq(productsTable.available, true)];

    if (category && typeof category === "string") {
      conditions.push(eq(productsTable.category, category));
    } else {
      // Exclude Q Club products from the general catalog — they are only accessible via /social-clubs
      conditions.push(ne(productsTable.category, "q_club"));
    }
    if (gender && typeof gender === "string") {
      conditions.push(eq(productsTable.gender, gender));
    }
    if (productType && typeof productType === "string") {
      conditions.push(eq(productsTable.productType, productType));
    }
    if (subType && typeof subType === "string") {
      conditions.push(eq(productsTable.subType, subType));
    }
    if (q && typeof q === "string" && q.trim()) {
      const term = q.trim();
      conditions.push(
        or(
          ilike(productsTable.name, `%${term}%`),
          ilike(productsTable.description, `%${term}%`),
          ilike(productsTable.category, `%${term}%`),
        )
      );
    }

    const products = conditions.length === 1
      ? await db.select().from(productsTable).where(conditions[0])
      : await db.select().from(productsTable).where(and(...conditions));

    res.json(products.map(formatProduct));
  } catch (err) {
    req.log.error({ err }, "Failed to list products");
    res.status(500).json({ error: "Failed to load products" });
  }
});

router.get("/products/:id", async (req, res): Promise<void> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid product ID" });
      return;
    }
    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, id));
    if (!product || !product.available) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.json(formatProduct(product));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch product");
    res.status(500).json({ error: "Failed to load product" });
  }
});

function formatProduct(p: typeof productsTable.$inferSelect) {
  return {
    ...p,
    sizes: p.sizes ?? ["S", "M", "L", "XL"],
  };
}

export default router;
