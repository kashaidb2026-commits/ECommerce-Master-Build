import { Layout } from "@/components/layout/Layout";
import { useListProducts, getListProductsQueryKey } from "@workspace/api-client-react";
import { Link, useSearch, useLocation } from "wouter";
import { formatPrice } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { ChevronRight, ChevronDown, ChevronLeft } from "lucide-react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { type Gender, getLastGender as _getLastGender, setLastGender } from "@/lib/genderPreference";
import { getAssetUrl } from "@/lib/api";
import { SHOW_KIDS, SHOW_CUSTOMIZATION, SHOW_LOOKBOOK } from "@/lib/features";
import { useUser, useClerk } from "@clerk/react";
import { HeartButton } from "@/components/ui/HeartButton";
import { getProductColorLabel, colorLabelToSwatchHex } from "@/lib/product-color";

type ItemType = "tshirts" | "bottoms" | "dresses";
type StyleFilter = "solids" | "patterns" | "prints" | "trousers" | "shorts" | "skorts";

type SidebarChild = { label: string; style: StyleFilter };

const TSHIRT_CATEGORIES = ["t-shirt", "polo", "fabric-tshirt", "pattern", "shirts"];
const TROUSER_CATEGORIES = ["pants", "trousers"];
const SHORTS_CATEGORIES = ["shorts"];
const SKORT_CATEGORIES = ["skort", "skorts", "skirts"];
const DRESS_CATEGORIES = ["dress", "dresses", "golf dress", "golf dresses"];
const PATTERN_CATEGORIES = ["pattern"];
const PRINT_CATEGORIES = ["t-shirt", "polo", "fabric-tshirt"];
const PRINT_NAME_HINTS = ["print", "flair", "seasonal", "limited"];

const GENDER_SORT: Record<string, number> = { men: 0, unisex: 1, women: 2, kids: 3 };
function typeSort(cat: string): number {
  const c = cat.toLowerCase();
  if (TSHIRT_CATEGORIES.includes(c)) return 0;
  if ([...TROUSER_CATEGORIES, ...SHORTS_CATEGORIES, ...SKORT_CATEGORIES, ...DRESS_CATEGORIES].includes(c)) return 1;
  return 2;
}
function subTypeSort(sub: string): number {
  const s = (sub || "").toLowerCase();
  if (s === "solid") return 0;
  if (s === "pattern") return 1;
  if (s === "printed" || s === "print") return 2;
  return 3;
}

const PRODUCT_GENDER: Record<number, "men" | "women" | "unisex"> = {
  1: "men",
  2: "unisex",
  3: "men",
  4: "men",
  5: "women",
  6: "women",
  7: "men",
  8: "women",
  9: "men",
  10: "women",
  11: "men",
  18: "men",
  19: "women",
  20: "men",
  21: "women",
  22: "men",
  23: "women",
  24: "men",
};

const GENDER_TOKENS: Record<Gender, string[]> = {
  men: ["men", "men's", "mens", "male"],
  women: ["women", "women's", "womens", "female", "skort", "ladies"],
  kids: ["kid", "kids", "kid's", "junior", "youth", "child"],
};

const COLLECTION_IMAGES = Array.from({ length: 27 }, (_, i) => `/images/collection/look-${i + 1}.jpeg`);
const KIDS_FALLBACK_IMAGE = "/images/hero/slide-kids.png";

type SidebarParent = {
  label: string;
  type: ItemType;
  children: SidebarChild[];
};

type SidebarSection = {
  label: string;
  gender: Gender;
  parents: SidebarParent[];
};

const sidebar: SidebarSection[] = [
  {
    label: "Men",
    gender: "men",
    parents: [
      {
        label: "Golf T-shirts",
        type: "tshirts",
        children: [
          { label: "Solid Polo T-shirts", style: "solids" },
          { label: "Pattern Polo T-shirts", style: "patterns" },
          { label: "Print Polo T-shirts", style: "prints" },
        ],
      },
      {
        label: "Bottoms",
        type: "bottoms",
        children: [
          { label: "Trousers", style: "trousers" },
          { label: "Shorts", style: "shorts" },
        ],
      },
    ],
  },
  {
    label: "Women",
    gender: "women",
    parents: [
      {
        label: "Golf T-shirts",
        type: "tshirts",
        children: [
          { label: "Solid Polo T-shirts", style: "solids" },
          { label: "Pattern Polo T-shirts", style: "patterns" },
          { label: "Print Polo T-shirts", style: "prints" },
        ],
      },
      {
        label: "Bottoms",
        type: "bottoms",
        children: [
          { label: "Skorts", style: "skorts" },
          { label: "Trousers", style: "trousers" },
          { label: "Shorts", style: "shorts" },
        ],
      },
      {
        label: "Golf Dresses",
        type: "dresses",
        children: [],
      },
    ],
  },
  ...(SHOW_KIDS ? [{
    label: "Kids",
    gender: "kids" as const,
    parents: [
      {
        label: "Golf T-shirts",
        type: "tshirts" as const,
        children: [
          { label: "Solid Polo T-shirts", style: "solids" as const },
          { label: "Pattern Polo T-shirts", style: "patterns" as const },
          { label: "Print Polo T-shirts", style: "prints" as const },
        ],
      },
      {
        label: "Bottoms",
        type: "bottoms" as const,
        children: [
          { label: "Trousers", style: "trousers" as const },
          { label: "Shorts", style: "shorts" as const },
        ],
      },
    ],
  }] : []),
];

export default function ProductsPage() {
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(searchString);
  const genderParam = params.get("gender");
  const typeParam = params.get("type");
  const styleParam = params.get("style");

  const gender: Gender | undefined =
    genderParam === "men" || genderParam === "women" || genderParam === "kids" ? genderParam : undefined;
  const type: ItemType | undefined =
    typeParam === "tshirts" || typeParam === "bottoms" || typeParam === "dresses" ? typeParam : undefined;
  const styleFilter: StyleFilter | undefined =
    styleParam === "solids" || styleParam === "patterns" || styleParam === "prints" ||
    styleParam === "trousers" || styleParam === "shorts" || styleParam === "skorts"
      ? (styleParam as StyleFilter)
      : undefined;

  const { isSignedIn } = useUser();

  // Accordion state — track which `${gender}-${type}` keys are expanded
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Auto-expand the active parent when URL changes
  useEffect(() => {
    if (gender && type) {
      setExpanded(prev => new Set([...prev, `${gender}-${type}`]));
    }
  }, [gender, type]);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    if (gender) setLastGender(gender);
  }, [gender]);

  const { data: rawProducts, isLoading, error, refetch } = useListProducts(
    {},
    { query: { queryKey: getListProductsQueryKey({}) } }
  );

  const products = useMemo(() => {
    if (!rawProducts) return rawProducts;
    let list = rawProducts;

    // ── Gender filter (use DB field first, fall back to text search for legacy) ──
    if (gender === "men" || gender === "women") {
      list = list.filter((p) => {
        if (p.gender) return p.gender === gender || p.gender === "unisex";
        const tokens = GENDER_TOKENS[gender];
        const hay = `${p.name} ${p.description || ""}`.toLowerCase();
        return tokens.some((t) => hay.includes(t));
      });
    } else if (gender === "kids") {
      const tokens = GENDER_TOKENS.kids;
      const matched = list.filter((p) => {
        if (p.gender) return p.gender === "kids";
        const hay = `${p.name} ${p.description || ""}`.toLowerCase();
        return tokens.some((t) => hay.includes(t));
      });
      if (matched.length > 0) list = matched;
    }

    // ── Type + style filter ────────────────────────────────────────────────────
    if (type === "tshirts") {
      list = list.filter((p) => TSHIRT_CATEGORIES.includes((p.category || "").toLowerCase()));
      if (styleFilter === "patterns") {
        list = list.filter((p) => (p.subType || "").toLowerCase() === "pattern");
      } else if (styleFilter === "prints") {
        list = list.filter((p) => {
          const sub = (p.subType || "").toLowerCase();
          return sub === "printed" || sub === "print";
        });
      } else if (styleFilter === "solids") {
        list = list.filter((p) => (p.subType || "").toLowerCase() === "solid");
      }
    } else if (type === "dresses") {
      list = list.filter((p) => {
        const cat = (p.category || "").toLowerCase();
        const name = (p.name || "").toLowerCase();
        return DRESS_CATEGORIES.includes(cat) || name.includes("dress");
      });
    } else if (type === "bottoms") {
      if (styleFilter === "trousers") {
        list = list.filter((p) => TROUSER_CATEGORIES.includes((p.category || "").toLowerCase()));
      } else if (styleFilter === "shorts") {
        list = list.filter((p) => SHORTS_CATEGORIES.includes((p.category || "").toLowerCase()));
      } else if (styleFilter === "skorts") {
        list = list.filter((p) => {
          const cat = (p.category || "").toLowerCase();
          const name = (p.name || "").toLowerCase();
          return SKORT_CATEGORIES.includes(cat) || name.includes("skort");
        });
      } else {
        // All bottoms
        list = list.filter((p) => {
          const cat = (p.category || "").toLowerCase();
          return TROUSER_CATEGORIES.includes(cat) || SHORTS_CATEGORIES.includes(cat) || SKORT_CATEGORIES.includes(cat);
        });
      }

    }

    // Sort: gender (men → women → kids), then type (tshirts → bottoms), then subType
    list = [...list].sort((a, b) => {
      const gA = GENDER_SORT[(a.gender || "unisex").toLowerCase()] ?? 99;
      const gB = GENDER_SORT[(b.gender || "unisex").toLowerCase()] ?? 99;
      if (gA !== gB) return gA - gB;
      const tA = typeSort(a.category || "");
      const tB = typeSort(b.category || "");
      if (tA !== tB) return tA - tB;
      return subTypeSort(a.subType || "") - subTypeSort(b.subType || "");
    });

    return list;
  }, [rawProducts, type, gender, styleFilter]);

  const buildHref = (g?: Gender, t?: ItemType, s?: StyleFilter) => {
    const sp = new URLSearchParams();
    if (g) sp.set("gender", g);
    if (t) sp.set("type", t);
    if (s) sp.set("style", s);
    const q = sp.toString();
    return q ? `/products?${q}` : "/products";
  };

  const typeLabel = (t?: ItemType) => t === "tshirts" ? "Golf T-shirts" : t === "bottoms" ? "Bottoms" : t === "dresses" ? "Golf Dresses" : null;
  const styleLabel = (s?: StyleFilter) =>
    s === "solids" ? "Solid" : s === "patterns" ? "Pattern Design" : s === "prints" ? "Printed" :
    s === "trousers" ? "Trousers" : s === "shorts" ? "Shorts" : s === "skorts" ? "Skorts" : null;

  const breadcrumb = [
    gender ? gender.charAt(0).toUpperCase() + gender.slice(1) : "All",
    typeLabel(type),
    styleLabel(styleFilter),
  ].filter(Boolean).join(" / ");

  const heading = gender || type
    ? `${gender ? gender.charAt(0).toUpperCase() + gender.slice(1) : "All"}${type ? " · " + typeLabel(type) : ""}${styleFilter ? " · " + styleLabel(styleFilter) : ""}`
    : "The Collection";

  const fallbackImageFor = (productId: number) => {
    if (gender === "kids") return KIDS_FALLBACK_IMAGE;
    return COLLECTION_IMAGES[productId % COLLECTION_IMAGES.length];
  };

  const isBottomsEmpty = (type === "bottoms" && styleFilter === "skorts" && products?.length === 0) || (type === "dresses" && products?.length === 0);

  return (
    <Layout>
      {/* Page Header */}
      <div className="py-12 px-6" style={{ background: "#F5F2EC", borderBottom: "1px solid rgba(184,146,90,0.3)" }}>
        <div className="max-w-[1400px] mx-auto">
          <div
            className="flex items-center gap-2 text-[10px] font-medium mb-5 uppercase"
            style={{ fontFamily: "'Josefin Sans', sans-serif", letterSpacing: "0.28em", color: "rgba(0,0,0,0.5)" }}
          >
            <Link href="/" className="hover:!text-[#B8925A] transition-colors">HOME</Link>
            <ChevronRight className="w-3 h-3" />
            <Link href="/products" className="hover:!text-[#B8925A] transition-colors">SHOP</Link>
            {breadcrumb && (
              <>
                <ChevronRight className="w-3 h-3" />
                <span style={{ color: "#B8925A" }}>{breadcrumb}</span>
              </>
            )}
          </div>
          <h1
            className="text-neutral-900"
            style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "clamp(32px, 4vw, 48px)", fontWeight: 400, letterSpacing: "0.02em" }}
          >
            {heading}
          </h1>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-8">
          {/* Sidebar */}
          <aside className="lg:sticky lg:top-24 self-start">
            <nav aria-label="Shop categories" className="text-sm">
              {/* Filter heading */}
              <div
                className="py-2 text-[10px] tracking-[0.32em] uppercase font-semibold text-neutral-900/40"
                style={{ fontFamily: "'Josefin Sans', sans-serif", borderBottom: "1px solid rgba(0,0,0,0.08)", marginBottom: 2 }}
              >
                Filter
              </div>

              {/* All Products */}
              <Link
                href="/products"
                aria-current={!gender && !type ? "page" : undefined}
                className={`block py-3 text-[11px] tracking-[0.28em] uppercase font-medium ${
                  !gender && !type ? "text-[#B8925A]" : "text-neutral-900/60 hover:text-neutral-900"
                }`}
                style={{ fontFamily: "'Josefin Sans', sans-serif", borderBottom: "1px solid rgba(0,0,0,0.08)" }}
              >
                All Products
              </Link>

              {sidebar
                .filter(section => !gender || gender === section.gender)
                .map((section) => {
                const sectionActive = gender === section.gender;
                return (
                  <div key={section.gender} style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                    {/* Gender header */}
                    <Link
                      href={buildHref(section.gender, undefined)}
                      aria-current={sectionActive && !type ? "page" : undefined}
                      className={`block py-3 text-[11px] tracking-[0.28em] uppercase font-medium ${
                        sectionActive ? "text-[#B8925A]" : "text-neutral-900/80 hover:text-neutral-900"
                      }`}
                      style={{ fontFamily: "'Josefin Sans', sans-serif" }}
                    >
                      {section.label}
                    </Link>

                    {/* Parent items — only show when this gender is active */}
                    {sectionActive && <ul className="pb-2">
                      {section.parents.map((parent) => {
                        const accordionKey = `${section.gender}-${parent.type}`;
                        const isOpen = expanded.has(accordionKey);
                        const parentActive = sectionActive && type === parent.type;
                        const hasChildren = parent.children.length > 0;

                        return (
                          <li key={parent.type}>
                            {/* Parent row */}
                            <button
                              className={`w-full flex items-center justify-between py-1.5 pl-3 pr-1 text-[10px] tracking-[0.22em] uppercase border-l-2 text-left ${
                                parentActive
                                  ? "border-[#B8925A] text-[#B8925A] font-medium"
                                  : "border-transparent text-neutral-900/55 hover:text-neutral-900 hover:border-black/15"
                              }`}
                              style={{ fontFamily: "'Josefin Sans', sans-serif" }}
                              onClick={() => {
                                navigate(buildHref(section.gender, parent.type));
                                if (hasChildren) toggleExpanded(accordionKey);
                              }}
                            >
                              <span>{parent.label}</span>
                              {hasChildren && (
                                <ChevronDown
                                  className={`w-3 h-3 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                                />
                              )}
                            </button>

                            {/* Children */}
                            {hasChildren && isOpen && (
                              <ul className="pb-1">
                                {parent.children.map((child) => {
                                  const childActive = parentActive && styleFilter === child.style;
                                  return (
                                    <li key={child.style}>
                                      <Link
                                        href={buildHref(section.gender, parent.type, child.style)}
                                        aria-current={childActive ? "page" : undefined}
                                        className={`block py-1 pl-8 text-[9.5px] tracking-[0.22em] uppercase border-l-2 ${
                                          childActive
                                            ? "border-[#B8925A] text-[#B8925A] font-medium"
                                            : "border-transparent text-neutral-900/40 hover:text-neutral-900 hover:border-black/15"
                                        }`}
                                        style={{ fontFamily: "'Josefin Sans', sans-serif" }}
                                      >
                                        {child.label}
                                      </Link>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>}
                  </div>
                );
              })}
            </nav>
          </aside>

          {/* Product grid */}
          <div>
            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                {Array.from({ length: 9 }).map((_, i) => <ProductSkeleton key={i} />)}
              </div>
            ) : error ? (
              <div className="py-20 text-center text-neutral-900/45">
                <p className="mb-4">Failed to load products. Please try again.</p>
                <button
                  onClick={() => refetch()}
                  className="text-[10px] uppercase px-6 py-3 border border-neutral-300 hover:border-neutral-900 transition-colors"
                  style={{ fontFamily: "'Josefin Sans', sans-serif", letterSpacing: "0.28em" }}
                >
                  Try Again
                </button>
              </div>
            ) : isBottomsEmpty ? (
              <div
                className="p-12 md:p-16 text-center"
                style={{ background: "#FFFFFF", border: "1px solid rgba(184,146,90,0.3)", borderRadius: 8 }}
              >
                <div className="text-[9px] uppercase mb-3" style={{ fontFamily: "'Josefin Sans', sans-serif", letterSpacing: "0.4em", color: "#B8925A" }}>
                  Coming Soon
                </div>
                <h2 className="text-neutral-900 mb-4" style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "clamp(28px, 3vw, 36px)", fontWeight: 400 }}>
                  {type === "dresses" ? "Golf Dresses" : "Skorts"}
                </h2>
                <p className="max-w-md mx-auto mb-8" style={{ fontFamily: "'Josefin Sans', sans-serif", fontSize: 11, color: "rgba(0,0,0,0.5)", lineHeight: 1.8, letterSpacing: "0.06em" }}>
                  {type === "dresses"
                    ? "Elegant golf dresses crafted in our signature stretch fabric — landing in the next drop."
                    : "Tailored skorts in our signature stretch fabric — landing in the next drop."}
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <Link href={buildHref(gender, "tshirts")} className="text-[10px] uppercase px-7 py-3.5 transition-all hover:!text-neutral-900" style={{ fontFamily: "'Josefin Sans', sans-serif", letterSpacing: "0.28em", color: "rgba(0,0,0,0.6)", border: "1px solid rgba(0,0,0,0.2)" }}>
                    Browse T-shirts
                  </Link>
                </div>
              </div>
            ) : products?.length === 0 ? (
              <div className="py-20 text-center text-neutral-900/45">
                <p className="mb-4">No products found in this category yet.</p>
                <button
                  onClick={() => navigate("/products")}
                  className="text-[11px] uppercase tracking-[0.22em] underline text-[#B8925A]"
                  style={{ fontFamily: "'Josefin Sans', sans-serif" }}
                >
                  View all products
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                {products?.map((product, i) => {
                  const showFallback =
                    !product.thumbnailUrl ||
                    product.thumbnailUrl === "/images/product-tshirt.png" ||
                    gender === "kids";
                  const imgSrc = showFallback
                    ? fallbackImageFor(product.id)
                    : getAssetUrl(product.thumbnailUrl || product.modelUrl) || undefined;

                  return (
                    <motion.div
                      key={product.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, delay: Math.min(i, 8) * 0.04 }}
                    >
                      <ProductCard product={product} imgSrc={imgSrc} cardIndex={i} />
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

    </Layout>
  );
}

function getProductAltText(product: {
  name: string;
  category?: string | null;
  gender?: string | null;
  subType?: string | null;
  defaultColor?: string | null;
  sku?: string | null;
  colorLabel?: string | null;
}): string {
  const cat = (product.category || "").toLowerCase();
  const gender = (product.gender || "").toLowerCase();
  const sub = (product.subType || "").toLowerCase();
  const colorLabel = getProductColorLabel(product);
  const colorSuffix = colorLabel ? ` in ${colorLabel}` : "";
  const cleanName = product.name.replace(/\s+[—–-]\s*[A-Z]{1,3}\d+.*$/, "").trim();

  if (TROUSER_CATEGORIES.includes(cat)) {
    return gender === "women"
      ? `Ka.Sha ${cleanName}${colorSuffix} — premium stretch golf trousers for women`
      : `Ka.Sha ${cleanName}${colorSuffix} — premium stretch golf trousers for men`;
  }
  if (SKORT_CATEGORIES.some(s => cat.includes(s)) || cat.includes("skirt")) {
    return `Ka.Sha ${cleanName}${colorSuffix} — women's luxury golf skort with performance stretch fabric`;
  }
  if (DRESS_CATEGORIES.some(d => cat.includes(d)) || cat.includes("dress")) {
    return `Ka.Sha ${cleanName}${colorSuffix} — women's elegant golf dress in breathable stretch fabric`;
  }
  if (SHORTS_CATEGORIES.includes(cat)) {
    return `Ka.Sha ${cleanName}${colorSuffix} — premium golf shorts with performance stretch fabric`;
  }
  if (sub === "printed" || sub === "print") {
    return gender === "women"
      ? `Ka.Sha ${cleanName}${colorSuffix} — designer printed golf polo for women`
      : `Ka.Sha ${cleanName}${colorSuffix} — designer printed golf polo for men`;
  }
  return gender === "women"
    ? `Ka.Sha ${cleanName}${colorSuffix} — women's luxury golf polo shirt in breathable fabric`
    : `Ka.Sha ${cleanName}${colorSuffix} — men's luxury golf polo shirt in breathable fabric`;
}

interface ProductCardProps {
  product: {
    id: number;
    name: string;
    priceInPaise: number;
    available: boolean;
    thumbnailUrl?: string | null;
    additionalImages?: string | null;
    category?: string | null;
    gender?: string | null;
    subType?: string | null;
    defaultColor?: string | null;
    sku?: string | null;
    colorLabel?: string | null;
  };
  imgSrc?: string;
  /** Position in the grid — used to decide eager vs lazy loading */
  cardIndex?: number;
}

function ProductCard({ product, imgSrc, cardIndex = 0 }: ProductCardProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  // Only unlock src for images that actually need to be fetched.
  // Additional carousel images are unlocked on hover / navigation to avoid
  // flooding the network with hidden images on initial page load.
  const [unlockedIdxs, setUnlockedIdxs] = useState<ReadonlySet<number>>(() => new Set([0]));

  const unlock = (idx: number) =>
    setUnlockedIdxs(prev => prev.has(idx) ? prev : new Set([...prev, idx]));

  const allImages = useMemo(() => {
    const imgs: string[] = [];
    if (imgSrc) imgs.push(imgSrc);
    if (product.additionalImages) {
      try {
        const arr = JSON.parse(product.additionalImages) as string[];
        for (const u of arr) {
          const resolved = getAssetUrl(u) || u;
          if (resolved && !imgs.includes(resolved)) imgs.push(resolved);
        }
      } catch {
        if (typeof product.additionalImages === "string" && product.additionalImages.startsWith("http")) {
          const resolved = getAssetUrl(product.additionalImages) || product.additionalImages;
          if (!imgs.includes(resolved)) imgs.push(resolved);
        }
      }
    }
    return imgs;
  }, [imgSrc, product.additionalImages]);

  const hasMultiple = allImages.length > 1;

  // Reset to first image when mouse leaves
  useEffect(() => {
    if (!isHovered) setActiveIdx(0);
  }, [isHovered]);

  // Preload second image on hover so the carousel transition is instant
  useEffect(() => {
    if (isHovered && allImages.length > 1) unlock(1);
  }, [isHovered, allImages.length]);

  const goPrev = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const next = (activeIdx - 1 + allImages.length) % allImages.length;
    unlock(next);
    setActiveIdx(next);
  };
  const goNext = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const next = (activeIdx + 1) % allImages.length;
    unlock(next);
    setActiveIdx(next);
  };

  // First two rows (6 cards) are above the fold → load eagerly with high priority
  const aboveFold = cardIndex < 6;

  return (
    <Link href={`/products/${product.id}`} className="group block">
      <div
        className="relative overflow-hidden mb-3"
        style={{ background: "#F9F8F6", border: `1px solid ${isHovered ? "rgba(184,146,90,0.35)" : "rgba(0,0,0,0.07)"}`, aspectRatio: "1 / 1", transition: "border-color 0.3s" }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Skeleton pulse — visible until the thumbnail finishes loading */}
        {!thumbLoaded && allImages.length > 0 && (
          <div className="absolute inset-0 bg-[#EDEAE4] animate-pulse z-[1]" />
        )}

        {allImages.length > 0 ? (
          allImages.map((src, idx) => (
            <img
              key={idx}
              src={unlockedIdxs.has(idx) ? src : undefined}
              alt={getProductAltText(product)}
              loading={aboveFold && idx === 0 ? "eager" : "lazy"}
              decoding="async"
              fetchPriority={aboveFold && idx === 0 ? "high" : undefined}
              onLoad={() => { if (idx === 0) setThumbLoaded(true); }}
              className="absolute inset-0 w-full h-full object-contain object-center z-[2]"
              style={{ opacity: idx === activeIdx && (idx > 0 || thumbLoaded) ? 1 : 0, transition: "opacity 0.55s ease" }}
            />
          ))
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span style={{ color: "rgba(184,146,90,0.4)", fontFamily: "'Cormorant Garamond', serif", fontSize: 28, letterSpacing: "0.3em" }}>KS</span>
          </div>
        )}

        {hasMultiple && (
          <>
            <button
              onClick={goPrev}
              aria-label="Previous image"
              className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center bg-white/80 backdrop-blur-sm hover:bg-white z-10"
              style={{ border: "1px solid rgba(0,0,0,0.10)", opacity: 1, transition: "opacity 0.25s", boxShadow: "0 1px 4px rgba(0,0,0,0.10)" }}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={goNext}
              aria-label="Next image"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center bg-white/80 backdrop-blur-sm hover:bg-white z-10"
              style={{ border: "1px solid rgba(0,0,0,0.10)", opacity: 1, transition: "opacity 0.25s", boxShadow: "0 1px 4px rgba(0,0,0,0.10)" }}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </>
        )}

        {!product.available && (
          <div className="absolute top-2 right-2 text-white text-[8px] uppercase px-2 py-0.5 z-10" style={{ background: "#1a1a1a", fontFamily: "'Josefin Sans', sans-serif", letterSpacing: "0.2em" }}>
            Sold Out
          </div>
        )}

        {/* Heart / Save to Lookbook */}
        {SHOW_LOOKBOOK && (
          <HeartButton
            productId={product.id}
            className="absolute top-2 left-2 z-[5] w-7 h-7 flex items-center justify-center bg-white/85 backdrop-blur-sm hover:bg-white transition-colors"
            style={{ border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" } as React.CSSProperties}
          />
        )}
      </div>
      <h3 className="text-neutral-900 mb-0.5 group-hover:!text-[#B8925A] transition-colors" style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, fontWeight: 500, lineHeight: 1.3 }}>
        {product.name.replace(/\s+[—–-]\s*[A-Z]{1,3}\d+.*$/, "")}
      </h3>
      {(() => {
        const colorLabel = getProductColorLabel(product);
        const swatchHex = colorLabelToSwatchHex(colorLabel);
        return colorLabel ? (
          <p className="flex items-center gap-1.5 mb-1" style={{ fontFamily: "'Josefin Sans', sans-serif", fontSize: 9, letterSpacing: "0.18em", color: "rgba(0,0,0,0.42)", textTransform: "uppercase" }}>
            {swatchHex && (
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: swatchHex, border: "1px solid rgba(0,0,0,0.15)", flexShrink: 0 }} />
            )}
            {colorLabel}
          </p>
        ) : null;
      })()}
      <p style={{ fontFamily: "'Josefin Sans', sans-serif", fontSize: 10, letterSpacing: "0.18em", color: "#B8925A" }}>
        {formatPrice(product.priceInPaise)}&nbsp;
        <span style={{ fontSize: 8, color: "rgba(0,0,0,0.38)", letterSpacing: "0.08em", fontWeight: 400 }}>incl. GST</span>
      </p>
    </Link>
  );
}

function ProductSkeleton() {
  return (
    <div className="space-y-2.5">
      <Skeleton className="w-full rounded-none bg-black/[0.05]" style={{ aspectRatio: "1 / 1" }} />
      <Skeleton className="h-4 w-2/3 bg-black/[0.05]" />
      <Skeleton className="h-3 w-1/3 bg-black/[0.05]" />
    </div>
  );
}

export const getLastGender = _getLastGender;