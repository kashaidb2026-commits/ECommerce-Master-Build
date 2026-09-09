/**
 * customize.tsx — KA.SHA Bespoke Studio (4-Step Wizard)
 *
 * Implements the customer wireframe with 4 sequential steps:
 *   1. Style   — base colour / print / bespoke design (locked for "pattern" products)
 *   2. Parts   — per-zone colour overrides (collar, front, back, sleeves)
 *   3. Logo    — optional logo upload + 9-point position grid + size slider
 *   4. Size    — XS → XXL + optional custom measurements
 *
 * Product-type behaviour:
 *   "fabric"  — Step 1 shows Solids + Prints tabs. Bespoke Designs picker in Patterns tab.
 *   "pattern" — Step 1 Pattern tab is pre-locked to a bespoke design.
 *   "print"   — Step 1 Prints tab only. No colour controls on step 1.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link, useLocation, useSearch } from "wouter";
import { useUser, Show } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useCart } from "@/contexts/CartContext";
import { CartDrawer } from "@/components/layout/CartDrawer";
import { useGetCart, getGetCartQueryKey } from "@workspace/api-client-react";
import { getApiUrl } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import * as fabric from "fabric";
import {
  PATTERNS, ZONE_PRESETS, ZONE_LABEL, ALL_OVER_TILE_PX, patternUrl,
  type PatternZone, type PatternDef, type ProductType,
} from "@/components/3d/patterns";
import {
  KASHA_DESIGNS, applyKashaDesign, applyKashaDesignWithPrint, clearKashaDesign, SKU_KASHA_DESIGN_MAP,
  type KashaDesignDef, type RecolorOptions, type ChannelFill,
} from "@/components/3d/kasha-designs";
import { parseSku } from "@/components/3d/sku-config";

// ── Pattern colour recolor constants ─────────────────────────────────────────
const PAT_COLOR_A_DEFAULT = "#000000";   // Channel A source (dark / black)
const PAT_COLOR_B_DEFAULT = "#F0CED2";   // Channel B source (light / pink)

const PATTERN_PRESETS: { name: string; a: string; b: string }[] = [
  { name: "Original",  a: "#000000", b: "#F0CED2" },
  { name: "Ocean",     a: "#001a33", b: "#b8eeff" },
  { name: "Ember",     a: "#2e0a0a", b: "#ffd090" },
  { name: "Forest",    a: "#0d2b0d", b: "#c8f0a0" },
  { name: "Dusk",      a: "#1a0a2e", b: "#f0c8e8" },
  { name: "Slate",     a: "#1a1a2e", b: "#d0e8ff" },
  { name: "Cinder",    a: "#1a1a1a", b: "#f0f0d8" },
  { name: "Reef",      a: "#003333", b: "#c0f0ee" },
  { name: "Bordeaux",  a: "#2a0a18", b: "#ffc8c8" },
  { name: "Copper",    a: "#2d1b00", b: "#ffd8a0" },
  { name: "Midnight",  a: "#000814", b: "#e8e0ff" },
  { name: "Moss",      a: "#1c1c00", b: "#d8f0b0" },
];
const DARK_SWATCHES  = ["#000000","#1a1a2e","#2d1b00","#0d2b0d","#1a0a2e","#2e0a0a","#1a1a1a","#003333","#1c1c00","#2a0a18","#001a33","#ffffff"];
const LIGHT_SWATCHES = ["#F0CED2","#ffffff","#d0e8ff","#b8f0c8","#fff0cc","#e8d0f8","#ffd0d0","#c0f0ee","#ffe8b0","#ffc8e8","#c8e0a0","#d8c8f8"];
const RANDOM_DARK_PAT  = ["#000000","#1a1a2e","#2d1b00","#0d2b0d","#1a0a2e","#2e0a0a","#1a1a1a","#003333","#1c1c00","#2a0a18","#001a33","#000814"];
const RANDOM_LIGHT_PAT = ["#F0CED2","#ffffff","#d0e8ff","#b8f0c8","#fff0cc","#e8d0f8","#ffd0d0","#c0f0ee","#ffe8b0","#f0f0a0","#ffc8e8","#c8e0a0","#d8c8f8","#ffd8a0"];

// ── Theme ─────────────────────────────────────────────────────────────────────
const V = {
  bg:    "#fafaf7",
  sf:    "#ffffff",
  sf2:   "#f4f3ef",
  cream3:"#ede9e1",
  bd:    "#e8e5df",
  bd2:   "#ccc9c2",
  tx:    "#1a1a18",
  mu:    "#8a8780",
  mul:   "#b8b5ae",
  ac:    "#c9a84c",
  aclt:  "#f5e9c8",
  charcoal2: "#2d2d2a",
};

// ── Colour palettes ───────────────────────────────────────────────────────────
const MAIN_PALETTE = [
  "#1a1a1a","#FFFFFF","#e8e0d8","#d4c5a9","#c9b89e","#b5cfe8",
  "#378ADD","#185FA5","#4a7c59","#97C459","#E24B4A","#D85A30",
  "#D4537E","#7F77DD","#BA7517","#888780",
];
const SIZES = ["XS","S","M","L","XL","XXL"];

// Garment part zones
const PART_ZONES: { id: Exclude<PatternZone,"all">; label: string }[] = [
  { id:"collar",      label:"Collar"       },
  { id:"front",       label:"Front"        },
  { id:"back",        label:"Back"         },
  { id:"leftSleeve",  label:"Left Sleeve"  },
  { id:"rightSleeve", label:"Right Sleeve" },
];

// Named placement positions → fabric canvas coordinates (1024×1024 UV space)
// UV positions derived from ZONE_PRESETS (1024×1024 texture space):
//   front:       { left:10, top:341, w:490, h:678 }
//   back:        { left:524, top:188, w:483, h:833 }
//   leftSleeve:  { left:210, top:4,   w:398, h:170 }
//   rightSleeve: { left:617, top:2,   w:398, h:171 }
const LOGO_POSITIONS: Record<string, { left:number; top:number }> = {
  "front-left":    { left: 147, top: 490 },  // left chest zone
  "front-right":   { left: 363, top: 490 },  // right chest zone
  "back-center":   { left: 765, top: 604 },  // centre across back
  "back-top":      { left: 765, top: 420 },  // back yoke / top of back (near collar back)
  "left-sleeve":   { left: 816, top: 120 },  // rightSleeve UV zone → appears on left sleeve (UV is horizontally mirrored)
  "right-sleeve":  { left: 409, top: 60 },  // leftSleeve UV zone → mirror of left-sleeve (1024−816=208)
  "collar-left":   { left:  80, top: 240 },  // inner collar-tip flap (left lapel), visible from front
  "collar-right":  { left: 451, top: 240 },  // inner collar-tip flap (right lapel), symmetric (519−68=451)
};
// Most UV zones are horizontally mirrored — flipX:true corrects text/logos.
// Only collar-left is NOT horizontally mirrored (after label swap, right-sleeve key now
// serves the left sleeve position and requires the same flipX=true as left-sleeve).
function placementFlipX(placement: string): boolean {
  return placement !== "collar-left" && placement !== "right-sleeve";
}
// Only collar-left UV area is vertically flipped.
function placementFlipY(placement: string): boolean {
  return placement === "collar-left" || placement === "right-sleeve";
}
// The collar UV is laid out with the collar LENGTH along the X axis, so a 0° object
// appears vertical on the physical collar. Rotate -90° to make text/logos horizontal,
// sitting neatly at the collar tip as seen from the front.
function placementAngle(placement: string): number {
  return (placement === "collar-left" || placement === "collar-right") ? -90 : 0;
}
// After -90° rotation, a text object's **width** (pre-rotation) spans horizontally in
// UV space. Rather than scaling text down, we shift the centre so the text's near edge
// stays just inside the collar zone boundary (UV x: 12–519).
// collar-left: text may extend rightward freely; clamp only the left edge.
// collar-right: text may extend leftward freely; clamp only the right edge.
const COLLAR_UV_LEFT = 12, COLLAR_UV_RIGHT = 519;
const COLLAR_MARGIN  = 4; // px clearance from zone boundary

// Max logo size (%) allowed per placement — caps the slider (logos only, not text)
const PLACEMENT_MAX_PCT: Record<string, number> = {
  "front-left":   20,
  "front-right":  20,
  "left-sleeve":  25,
  "right-sleeve": 25,
  "back-center":  40,
  "back-top":     40,
  "collar-left":  15,
  "collar-right": 15,
};

// UV reference width (px out of 1024) for scaleToWidth per placement.
// Collar uses a smaller ref so % values produce collar-appropriate pixel sizes —
// after -90° rotation the logo's pre-rotation width = its visual height on the collar.
const PLACEMENT_UV_REF: Record<string, number> = {
  "collar-left":  300,
  "collar-right": 300,
};

function logoMaxW(position: string, logoSizePct: number): number {
  const ref = PLACEMENT_UV_REF[position] ?? 1024;
  return Math.round(logoSizePct * ref / 100);
}
function clampCollarText(obj: any, position: string): void {
  if (position !== "collar-left" && position !== "collar-right") {
    obj.set({ scaleX: 1, scaleY: 1 });
    return;
  }
  obj.set({ scaleX: 1, scaleY: 1 }); // always render at natural size
  const halfW  = (obj.width ?? 0) / 2;
  const baseCx = LOGO_POSITIONS[position]?.left ?? 265;
  let   cx     = baseCx;
  if (position === "collar-left") {
    // ensure left edge (cx − halfW) ≥ COLLAR_UV_LEFT + MARGIN
    cx = Math.max(baseCx, COLLAR_UV_LEFT + COLLAR_MARGIN + halfW);
  } else {
    // ensure right edge (cx + halfW) ≤ COLLAR_UV_RIGHT − MARGIN
    cx = Math.min(baseCx, COLLAR_UV_RIGHT - COLLAR_MARGIN - halfW);
  }
  if (cx !== baseCx) obj.set({ left: cx });
}
// Which 3-D view to jump to when a placement is selected
type CameraView = "front"|"back"|"right"|"left"|"collar-center"|"collar-left"|"collar-right";
const PLACEMENT_VIEW: Record<string, CameraView> = {
  "front-left":    "front",
  "front-right":   "front",
  "back-center":   "back",
  "back-top":      "back",
  "left-sleeve":   "left",
  "right-sleeve":  "right",
  "collar-left":   "collar-left",
  "collar-right":  "collar-right",
};
const PLACEMENT_GROUPS = [
  { label:"FRONT",  items:[{key:"front-left",label:"Left"},{key:"front-right",label:"Right"},{key:"front-center",label:"Center"}] },
  { label:"BACK",   items:[{key:"back-top",label:"Top"},{key:"back-center",label:"Center"}] },
  { label:"SLEEVES",items:[{key:"left-sleeve",label:"Left"},{key:"right-sleeve",label:"Right"}] },
];

// Zones available for colour overrides (sleeves excluded — colour only on body parts)
const COLOUR_ZONES = PART_ZONES.filter(z => z.id !== "leftSleeve" && z.id !== "rightSleeve");

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve any CSS colour string (named colour, hex, rgb(), etc.) to a "#RRGGBB"
 * hex string using the browser's own colour parser.
 *
 * Handles:
 *  • #RGB / #RRGGBB / RRGGBB (no hash) — all accepted
 *  • Single-word CSS named colours: "navy", "crimson", "goldenrod", …
 *  • Multi-word attempts: "dark brown" → tries "darkbrown" as a fallback
 *
 * Returns null when the string cannot be resolved to a valid opaque colour.
 */
function cssColorToHex(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // Bare 3- or 6-char hex without the hash
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`;
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const [a,b,c] = s;
    return `#${a}${a}${b}${b}${c}${c}`;
  }

  // Use a throwaway canvas to let the browser parse any CSS colour string
  const resolve = (str: string): string | null => {
    try {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 1;
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = "#000"; // sentinel
      ctx.fillStyle = str;
      const parsed = ctx.fillStyle as string;
      // Browser returns empty string or "#000000" if input was invalid/black-sentinel;
      // we distinguish by checking both sentinel and real black
      if (parsed === "" || parsed === "rgba(0, 0, 0, 0)") return null;
      // fillStyle is normalised to #rrggbb or rgb()/rgba() by the browser
      if (/^#[0-9a-fA-F]{6}$/.test(parsed)) return parsed;
      // rgb(r, g, b) → convert
      const m = parsed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        return "#" + [m[1],m[2],m[3]].map(n=>parseInt(n).toString(16).padStart(2,"0")).join("");
      }
    } catch { /* ignore */ }
    return null;
  };

  // Direct attempt
  const direct = resolve(s);
  if (direct) return direct;

  // Multi-word fallback: collapse spaces ("dark brown" → "darkbrown")
  if (s.includes(" ")) {
    const collapsed = resolve(s.replace(/\s+/g,""));
    if (collapsed) return collapsed;
  }

  return null;
}

function hexToRgba(hex: string): [number,number,number,number] {
  const h = hex.replace("#","");
  const r = parseInt(h.substring(0,2),16)/255;
  const g = parseInt(h.substring(2,4),16)/255;
  const b = parseInt(h.substring(4,6),16)/255;
  return [isNaN(r)?1:r, isNaN(g)?1:g, isNaN(b)?1:b, 1];
}
function setFabricBg(fc: any, hex: string) {
  if (!fc) return;
  fc.backgroundColor = hex;
  fc.renderAll();
}
async function getToken(): Promise<string|null> {
  try { const c=(window as any).Clerk; return c?.session ? await c.session.getToken() : null; }
  catch { return null; }
}
async function apiFetch(path: string, opts?: RequestInit): Promise<any> {
  const token = await getToken();
  const headers: Record<string,string> = {};
  if (!(opts?.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${getApiUrl()}${path}`, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { const j = JSON.parse(text); msg = j.error || j.message || text; } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}
const raf = () => new Promise<void>(r => requestAnimationFrame(() => r()));

/**
 * Rewrite direct R2 CDN URLs through our API proxy so model-viewer can fetch
 * them without hitting the R2 CORS restriction.
 * Local /api/public/... URLs are returned unchanged.
 */
function toProxiedUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (url.includes(".r2.dev/") || url.includes("r2.cloudflarestorage.com/")) {
    const base = getApiUrl();
    return `${base}/api/r2-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

/** Crops away surrounding blank/white space and returns a clean, centered
 *  square PNG at the given output size. Runs entirely on the captured
 *  dataURL — doesn't depend on model-viewer's on-screen size, so it can't
 *  be undone by a React re-render or a ResizeObserver race the way
 *  resizing the live viewer element was. */
async function trimToSquare(dataUrl: string, outSize = 1024, paddingRatio = 0.08): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });

  const src = document.createElement("canvas");
  src.width = img.naturalWidth;
  src.height = img.naturalHeight;
  const sctx = src.getContext("2d")!;
  sctx.drawImage(img, 0, 0);

  const { data, width, height } = sctx.getImageData(0, 0, src.width, src.height);
  let minX = width, minY = height, maxX = 0, maxY = 0;
  const isBg = (r: number, g: number, b: number, a: number) => a < 10 || (r > 248 && g > 248 && b > 248);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!isBg(data[i], data[i + 1], data[i + 2], data[i + 3])) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Nothing found (fully blank capture) — bail out and return the original.
  if (maxX <= minX || maxY <= minY) return dataUrl;

  const boxW = maxX - minX, boxH = maxY - minY;
  const pad = Math.round(Math.max(boxW, boxH) * paddingRatio);
  const cropX = Math.max(0, minX - pad), cropY = Math.max(0, minY - pad);
  const cropW = Math.min(width - cropX, boxW + pad * 2);
  const cropH = Math.min(height - cropY, boxH + pad * 2);
  const side = Math.max(cropW, cropH); // square bounding box around the garment

  const out = document.createElement("canvas");
  out.width = outSize;
  out.height = outSize;
  const octx = out.getContext("2d")!;
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, outSize, outSize);
  const scale = outSize / side;
  const dx = (outSize - cropW * scale) / 2;
  const dy = (outSize - cropH * scale) / 2;
  octx.drawImage(src, cropX, cropY, cropW, cropH, dx, dy, cropW * scale, cropH * scale);

  return out.toDataURL("image/png", 1.0);
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface ProductAddOn { id: string; label: string; imageUrl?: string | null; }
interface Product {
  id: number; name: string; description: string;
  category: string;
  subType?: string | null;   // "pattern" | "printed" | "solid" | null
  sku?: string | null;
  priceInPaise: number; modelUrl: string;
  thumbnailUrl?: string|null; defaultColor?: string;
  customizationMode?: string | null; // "zone" | "whole-garment" | "collar-only" | "two-part"
  addOns?: ProductAddOn[] | null;
}
interface MatEntry { idx: number; name: string; mat: any; color: string; }

// ── Component ─────────────────────────────────────────────────────────────────
export default function CustomizePage() {
  const params = useParams();
  const id = parseInt(params.id || "0");
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const { toast } = useToast();
  const { openCart, isCartOpen, closeCart } = useCart();
  const queryClient = useQueryClient();


  // ── Quick personalisation mode (mode=quick in URL) ───────────────────────
  const searchStr = useSearch();
  const isQuickMode = new URLSearchParams(searchStr).get("mode") === "quick";
  // garmentType: set when arriving from CustomizeEntryModal (/customize?type=solid|pattern|printed)
  const garmentType = (new URLSearchParams(searchStr).get("type") ?? "") as "solid"|"pattern"|"printed"|"";
  const isTypeMode = !!garmentType && !id; // standalone type-driven studio, no specific product

  // ── Entry-modal URL params (?style=solid|print|pattern, ?design=KS100XB) ──
  // Set by CustomizeEntryModal when the user picks a product card — used to
  // pre-initialise userStyle + userChosenDesignId and skip Step 1 automatically.
  const _entryStyle = (new URLSearchParams(searchStr).get("style") ?? null) as "solid"|"print"|"pattern"|null;
  const _entryDesign = new URLSearchParams(searchStr).get("design");
  // Source of navigation: "modal" = came from CustomizeEntryModal, "product" = came from PDP
  const _fromSource = new URLSearchParams(searchStr).get("from") ?? null;

  // Return to the actual page the customer came from.
  const handleStudioBack = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    setLocation(_fromSource === "saved" ? "/profile?tab=designs" : id ? `/products/${id}` : "/products");
  }, [id, _fromSource, setLocation]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entryDesignRef = useRef(_entryDesign); // stable ref — captured once at mount

  // ── Wizard step (1–4) ────────────────────────────────────────────────────
  // Auto-advance to Step 2 when arriving via the entry modal (?style= present)
  const initialStep = isQuickMode ? 3 : (_entryStyle || _fromSource === "saved" ? 2 : 1);
  const [step, setStep] = useState(() => initialStep);

  // ── 3D model-viewer ──────────────────────────────────────────────────────
  const [webglAvailable] = useState(() => {
    try { const c=document.createElement("canvas"); return !!(window.WebGLRenderingContext&&(c.getContext("webgl")||c.getContext("experimental-webgl"))); }
    catch { return false; }
  });
  const mvRef = useRef<any>(null);
  const [mvReady, setMvReady] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  // modelDisplayed: true once load/error fires or fallback timeout hits.
  // Drives the overlay via React state (not DOM mutation) so it's reliable in production.
  const [modelDisplayed, setModelDisplayed] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [mats, setMats] = useState<MatEntry[]>([]);
  const syncTextureRef = useRef<(()=>void)|null>(null);
  const lastTextureUrlRef = useRef("");
  // Sequence counter — incremented on every syncTexture call so older in-flight
  // calls can detect they've been superseded and bail out before writing to the
  // model-viewer. This prevents the print-then-colour race where the slower
  // print sync finishes after the colour sync and stamps the old texture back.
  const syncSeqRef = useRef(0);
  const applyPrimaryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fabric canvas ────────────────────────────────────────────────────────
  const fcRef = useRef<fabric.Canvas|null>(null);
  const resizeListenerRef = useRef<(()=>void)|null>(null);
  const logoObjRef = useRef<any>(null);

  // ── Product type detection ───────────────────────────────────────────────
  // "pattern" → locked bespoke design
  // "print"   → print library only, no colour controls
  // "fabric"  → full editor (prints + colours + bespoke designs)
  const { data: product, isLoading } = useQuery<Product>({
    queryKey: ["product", id],
    queryFn:  () => apiFetch(`/api/products/${id}`),
    enabled:  !!id,
  });

  // Whole-garment products (pants/shorts/skorts) are restricted to the client's
  // spec: single colour/print for the whole piece + Yes/No add-ons only.
  // Logo placement and text/personalization are intentionally NOT offered.
  const isWholeGarment = product?.customizationMode === "whole-garment";

  const { data: siteSettingsRaw } = useQuery<Record<string, unknown>>({
    queryKey: ["site-settings"],
    queryFn:  () => apiFetch("/api/site-settings"),
    staleTime: 60_000,
  });
  const hiddenPatternIds: string[] = Array.isArray(siteSettingsRaw?.hidden_patterns)
    ? (siteSettingsRaw!.hidden_patterns as string[])
    : [];
  const visiblePatterns = PATTERNS.filter(p => !hiddenPatternIds.includes(p.id));

  // In type-mode (arriving from home with ?type=), auto-load the first product of
  // that type so the 3D model shows even before the user selects a specific product.
  const { data: allProducts } = useQuery<Product[]>({
    queryKey: ["products-list"],
    queryFn:  () => apiFetch("/api/products"),
    enabled:  isTypeMode,
  });
  const defaultTypeProduct: Product | undefined = isTypeMode
    ? (() => {
        if (!allProducts) return undefined;
        if (garmentType === "pattern") {
          // Prefer KS1002B family (has 3D model); fall back to any pattern product
          return allProducts.find(p => p.sku?.startsWith("KS1002B"))
              ?? allProducts.find(p => p.subType === "pattern");
        }
        if (garmentType === "printed") {
          // Default to KS1000BGP004; fall back to any printed product
          return allProducts.find(p => p.sku === "KS1000BGP004")
              ?? allProducts.find(p => p.subType === "printed");
        }
        // solid: prefer subType="solid", otherwise first product
        return allProducts.find(p => p.subType === "solid")
            ?? allProducts.find(p => !p.subType)
            ?? allProducts[0];
      })()
    : undefined;
  // displayProduct: the product whose modelUrl/materials drive the 3D viewer
  const displayProduct = product ?? defaultTypeProduct;

  const productType: ProductType =
    product?.subType === "pattern" ? "pattern" :
    product?.subType === "printed" ? "print"   : "fabric";

  // ── Style step state ─────────────────────────────────────────────────────
  const [styleTab, setStyleTab] = useState<"solid"|"print"|"pattern">(
    garmentType === "pattern" ? "pattern" :
    garmentType === "printed" ? "print"   :
    productType === "pattern" ? "pattern" :
    productType === "print"   ? "print"   : "solid"
  );

  // ── SKU-driven flow state ─────────────────────────────────────────────────
  // What base type is this product?
  const skuProductType: "pattern" | "print" | "solid" =
    (productType === "pattern" || garmentType === "pattern") ? "pattern" :
    (productType === "print"   || garmentType === "printed") ? "print"   : "solid";
  // For Solid products: which customisation type did the user pick?
  const [customizationType, setCustomizationType] = useState<"color"|"print"|"pattern"|null>(null);
  // For Pattern customisation: colour recolour or print overlay?
  const [patternSubMode, setPatternSubMode] = useState<"color"|"print"|null>(null);
  // For Colour customisation: full body or individual parts?
  const [colorSubMode, setColorSubMode] = useState<"full"|"parts"|null>(null);

  const [showOtherDesigns, setShowOtherDesigns] = useState(false);
  const [printGalleryLimit, setPrintGalleryLimit] = useState(9);
  // User-selected style from Step 1 (overrides SKU-derived type).
  // Seeded from ?style= URL param when arriving via CustomizeEntryModal.
  const [userStyle, setUserStyle] = useState<"solid"|"print"|"pattern"|null>(_entryStyle);
  const [userChosenDesignId, setUserChosenDesignId] = useState<string|null>(_entryDesign);
  // Effective type — user choice wins, falls back to SKU-driven type
  const effectiveSkuType: "pattern"|"print"|"solid" =
    userStyle === "pattern" ? "pattern" :
    userStyle === "print"   ? "print"   :
    userStyle === "solid"   ? "solid"   :
    skuProductType;

  // ── Responsive layout ─────────────────────────────────────────────────────
  const [screenW, setScreenW] = useState(() => typeof window !== "undefined" ? window.innerWidth : 1280);
  const isXs = screenW < 480;
  const isSm = screenW < 640;
  const isMd = screenW < 768;
  const isDesktop = screenW >= 768;

  const [primaryColor, setPrimaryColor] = useState("#ffffff");
  const [sleeveLength, setSleeveLength] = useState<"half"|"full">("half");

  // Print library
  const [activePrintId, setActivePrintId] = useState<string|null>(null);
  const [allOverPrintId, setAllOverPrintId] = useState<string|null>(null);
  const baseBgRef = useRef("#ffffff");
  // Raw (uncoloured) print tile stored so applyPrimary can recompose it with a
  // new background colour without re-fetching the image from the network.
  const allOverPrintSourceRef = useRef<HTMLCanvasElement|null>(null);
  const [zonePrintIds, setZonePrintIds] = useState<Record<Exclude<PatternZone,"all">,string|null>>({
    front:null, back:null, collar:null, leftSleeve:null, rightSleeve:null,
  });
  const [printMode, setPrintMode] = useState<"fullBody"|"parts">("fullBody");

  // KA.SHA Bespoke Design state
  const [activeKashaDesign, setActiveKashaDesign] = useState<KashaDesignDef|null>(null);
  const kdRequestIdRef = useRef(0);
  const autoAppliedRef = useRef(false);
  // Prevents the full canvas+model restore from running more than once per session
  const restoredRef = useRef(false);

  // ── Parts step state ─────────────────────────────────────────────────────
  const [activePartZone, setActivePartZone] = useState<Exclude<PatternZone,"all">>("collar");
  const [zoneColors, setZoneColors] = useState<Record<Exclude<PatternZone,"all">,string>>({
    collar:"", front:"", back:"", leftSleeve:"", rightSleeve:"",
  });

  // ── Logo step state ──────────────────────────────────────────────────────
  const [logoPosition, setLogoPosition] = useState("front-left");
  const [logoSize, setLogoSize] = useState(15);
  const [logoPreview, setLogoPreview] = useState<string|null>(null);
  const [logoPlaced, setLogoPlaced] = useState(false);

  // ── Text step state ───────────────────────────────────────────────────────
  const textObjRef = useRef<any>(null);
  const [textInput, setTextInput] = useState("");
  const [textPosition, setTextPosition] = useState("front-left");
  const [textPlaced, setTextPlaced] = useState(false);
  const [textFontSize, setTextFontSize] = useState(40);
  const [textColor, setTextColor] = useState("#1a1a18");
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [textUnderline, setTextUnderline] = useState(false);
  const [textAlign, setTextAlign] = useState<"left"|"center"|"right"|"justify">("left");
  const [textFont, setTextFont] = useState("Tinos");

  // ── Size step state ──────────────────────────────────────────────────────
  const [size, setSize] = useState("M");
  const [customMeasurements, setCustomMeasurements] = useState({ chest:"", waist:"", hip:"", shoulder:"", length:"", sleeve:"" });
  const [designName, setDesignName] = useState("");
  const [qty, setQty] = useState(1);
  const [showMobileSaveSheet, setShowMobileSaveSheet] = useState(false);

  // ── Studio UI state ───────────────────────────────────────────────────────
  const [activeTool, setActiveTool] = useState<"products"|"colors"|"prints"|"patterns"|"text"|"image"|"order"|null>("products");
  const [cameraView, setCameraView] = useState<CameraView>("front");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [colorTarget, setColorTarget] = useState<"all"|"front"|"back"|"leftSleeve"|"rightSleeve">("all");
  const [samplerActive, setSamplerActive] = useState(false);
  const [samplerPreview, setSamplerPreview] = useState<string|null>(null);
  // Eyedropper for the "Choose Colour" modal (Full Body / zone modals) — samples the
  // flat design canvas, same as the sidebar sampler, so it isn't affected by 3D lighting.
  const [modalSamplerActive, setModalSamplerActive] = useState(false);
  const [modalSamplerPreview, setModalSamplerPreview] = useState<string|null>(null);
  // ── Pattern colour channels ───────────────────────────────────────────────
  const [patColorA, setPatColorA] = useState(PAT_COLOR_A_DEFAULT);   // Channel A — dark tones
  const [patColorB, setPatColorB] = useState(PAT_COLOR_B_DEFAULT);   // Channel B — light tones
  const [patRecoloring, setPatRecoloring] = useState(false);         // spinner while recoloring
  // Draft text + error state for the Channel A/B text inputs in the pattern panel
  const [draftColorA, setDraftColorA] = useState(PAT_COLOR_A_DEFAULT);
  const [draftColorB, setDraftColorB] = useState(PAT_COLOR_B_DEFAULT);
  const [errColorA,   setErrColorA]   = useState(false);
  const [errColorB,   setErrColorB]   = useState(false);
  // SKU color tokens that could not be resolved (shown as error banners in the colour panel)
  const [skuColorErrors, setSkuColorErrors] = useState<string[]>([]);
  // ── Sizing matrix + modal state ───────────────────────────────────────────
  const [sizeMode, setSizeMode] = useState<"standard"|"custom">("standard");
  const [sizeQty, setSizeQty] = useState<Record<string,number>>({S:0,M:0,L:0,XL:0,XXL:0});
  const [colorModalFor, setColorModalFor] = useState<"all"|"base"|"pattern"|"base-body"|"collar"|"leftSleeve"|"rightSleeve"|null>(null);
  const [pendingColorPick, setPendingColorPick] = useState<string|null>(null);
  const [printModalFor, setPrintModalFor] = useState<"all"|"base-body"|"collar"|"accent"|null>(null);
  const [pendingPrintKey, setPendingPrintKey] = useState<string|null>(null);
  const [bgRemoving, setBgRemoving] = useState(false);
  // ── Whole-garment add-ons (Yes/No toggles, e.g. Tee Holder, Side Pocket w/ Zipper, Velcro) ──
  const [selectedAddOns, setSelectedAddOns] = useState<Record<string, boolean>>({});
  const [modelPaused, setModelPaused] = useState(false);
  const historyStack = useRef<string[]>([]);
  const historyIdx = useRef(-1);
  // Track the customization ID used in this browser session to avoid creating duplicates
  const sessionCustomizationIdRef = useRef<number | null>(null);
  // Ref to the left step-panel scroll container (used for auto-scroll on mobile)
  const stepPanelRef = useRef<HTMLDivElement>(null);
  const [stepPanelCanScroll, setStepPanelCanScroll] = useState(false);

  // ── Cart data (needed to open CartDrawer from within the studio) ─────────
  const { data: cart } = useGetCart({
    query: { enabled: !!user, queryKey: getGetCartQueryKey() }
  });

  // ── Design name ──────────────────────────────────────────────────────────
  const { data: existing } = useQuery<any>({
    queryKey: ["customization", id],
    queryFn:  () => apiFetch(`/api/customizations/product/${id}/latest`).catch(() => null),
    enabled:  !!id && !!user,
    retry:    false,
    staleTime: 30_000,
  });

  // ── Load model-viewer script ─────────────────────────────────────────────
  // ── Step-panel auto-scroll + overflow indicator ───────────────────────────
  // On mobile the step panel is a scroll container. Whenever the user advances
  // to a new step we snap it back to the top so instructions are always visible.
  useEffect(() => {
    const el = stepPanelRef.current;
    if (!el || !isMd) return;
    el.scrollTo({ top: 0, behavior: "smooth" });
  }, [step, isMd]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track whether the step panel has overflow to show the gradient hint.
  useEffect(() => {
    const el = stepPanelRef.current;
    if (!el) return;
    const check = () => setStepPanelCanScroll(el.scrollHeight > el.clientHeight + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener("scroll", check);
    return () => { ro.disconnect(); el.removeEventListener("scroll", check); };
  }, [step]); // re-check after each step transition renders new content

  useEffect(() => {
    if (!webglAvailable) { setModelDisplayed(true); return; }
    if (document.querySelector('script[data-mv-loader]')) { setMvReady(true); return; }
    const s = document.createElement("script");
    s.type = "module"; s.setAttribute("data-mv-loader","1");
    s.src = "https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js";
    s.onload  = () => setMvReady(true);
    // If CDN is unreachable, surface the fallback immediately instead of hanging
    s.onerror = () => { setMvReady(false); setModelDisplayed(true); };
    document.head.appendChild(s);
  }, [webglAvailable]);

  // ── Fabric canvas init ───────────────────────────────────────────────────
  const canvasElRef = useCallback((el: HTMLCanvasElement|null) => {
    if (!el) {
      if (resizeListenerRef.current) { window.removeEventListener("resize", resizeListenerRef.current); resizeListenerRef.current=null; }
      if (fcRef.current) { try { const r: any=fcRef.current.dispose(); if(r?.catch) r.catch(()=>{}); } catch {} fcRef.current=null; }
      return;
    }
    if (fcRef.current) return;
    // Chrome textBaseline patch
    try {
      const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype,"textBaseline");
      if (d?.set) Object.defineProperty(CanvasRenderingContext2D.prototype,"textBaseline",{
        configurable:true, set(v) { d.set!.call(this,v==="alphabetical"?"alphabetic":v); }, get() { return d.get!.call(this); },
      });
    } catch {}
    const fc = new fabric.Canvas(el, { width:1024, height:1024, preserveObjectStacking:true, backgroundColor:"#ffffff" });
    fcRef.current = fc;
    setCanvasReady(true);
    const scaleCanvas = () => {
      const host=document.getElementById("fc-scale-host");
      const wrapper=document.getElementById("fc-wrapper");
      if (!host||!wrapper) return;
      host.style.transform=`scale(${(wrapper.clientWidth||1024)/1024})`;
    };
    resizeListenerRef.current = scaleCanvas;
    window.addEventListener("resize", scaleCanvas);
    setTimeout(scaleCanvas, 100);
    // Debounce texture sync on canvas events — object:modified fires on every
    // drag pixel, which would kick off a full GPU texture upload per frame.
    // 120 ms gives smooth visual feedback without hammering the GPU.
    let syncTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedSync = () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => { syncTextureRef.current?.(); }, 120);
    };
    fc.on("object:modified", debouncedSync);
    fc.on("object:added",    debouncedSync);
    fc.on("object:removed",  debouncedSync);
  }, []);

  // ── Texture sync ─────────────────────────────────────────────────────────
  const syncTexture = useCallback(async () => {
    const mv: any=mvRef.current; const fc: any=fcRef.current;
    if (!mv||!fc||!mats.length) { console.warn("[ST] early-exit mv=",!!mv,"fc=",!!fc,"mats=",mats.length); return; }
    const mySeq = ++syncSeqRef.current;
    console.log("[ST] start seq=",mySeq,"bg=",fc.backgroundColor);
    try {
      if (typeof fc.discardActiveObject === "function") fc.discardActiveObject();
      fc.renderAll(); await raf(); if (mySeq!==syncSeqRef.current) { console.log("[ST] abort1 seq=",mySeq); return; }
      fc.renderAll(); await raf(); if (mySeq!==syncSeqRef.current) { console.log("[ST] abort2 seq=",mySeq); return; }
      const rawEl: HTMLCanvasElement|undefined = typeof fc.getElement==="function" ? fc.getElement() : undefined;
      const dataUrl = rawEl ? rawEl.toDataURL("image/png",1.0) : fc.toDataURL({format:"png",quality:1.0,multiplier:1});
      console.log("[ST] dataUrl len=",dataUrl?.length,"seq=",mySeq);
      if (!dataUrl||dataUrl.length<100) { console.warn("[ST] dataUrl too short"); return; }
      if (mySeq!==syncSeqRef.current) { console.log("[ST] abort3 seq=",mySeq); return; }
      lastTextureUrlRef.current = dataUrl;
      const tex = await mv.createTexture(dataUrl);
      if (mySeq!==syncSeqRef.current) { console.log("[ST] abort4 seq=",mySeq); return; }
      console.log("[ST] applying texture seq=",mySeq,"mats=",mats.length);
      for (const entry of mats) {
        const pbr=entry?.mat?.pbrMetallicRoughness; if(!pbr) { console.warn("[ST] no pbr for mat"); continue; }
        const slot=pbr.baseColorTexture;
        console.log("[ST] slot=",slot,"setTexture=",typeof slot?.setTexture);
        try {
          if (slot && typeof slot.setTexture === "function") {
            // Clear the slot first (null → tex) so model-viewer always sets
            // material.needsUpdate = true even when transitioning between two
            // non-null textures (e.g. print → solid colour).  Without the null
            // step, model-viewer's internal previousThreeTexture check may skip
            // the needsUpdate flag and the GPU texture is never re-uploaded.
            try { slot.setTexture(null); } catch {}
            slot.setTexture(tex);
            console.log("[ST] setTexture OK for mat",entry.idx);
          } else {
            console.warn("[ST] slot missing setTexture for mat",entry.idx,"slot=",slot);
          }
          try{pbr.setBaseColorFactor([1,1,1,1]);}catch{}
        } catch (e2) {
          console.error("[ST] setTexture threw for mat",entry.idx,":",e2);
          try { if(slot&&typeof (slot as any).texture!=="undefined"){(slot as any).texture=tex;try{pbr.setBaseColorFactor([1,1,1,1]);}catch{};} }catch{}
        }
      }
      // NOTE: No break — every material gets the canvas texture so that all
      // visible parts of the garment (body, collar, sleeves — each a separate
      // glTF material) are updated in one pass.
      // Nudge model-viewer to re-render after material mutations (LitElement lifecycle).
      try { (mv as any).requestUpdate?.(); } catch {}
      // updateFraming() forces a full Three.js scene re-render via the Lit
      // update cycle — acts as a belt-and-suspenders render trigger when
      // requestUpdate() alone isn't enough to flush the new texture.
      try { (mv as any).updateFraming?.(); } catch {}
    } catch (e) { console.error("[customize] syncTexture failed:",e); }
  }, [mats]);

  useEffect(() => { syncTextureRef.current = syncTexture; }, [syncTexture]);
  useEffect(() => { if (mats.length) syncTexture(); }, [mats, syncTexture]);

  // ── model-viewer load ────────────────────────────────────────────────────
  useEffect(() => {
    // No model URL or WebGL unavailable → nothing to load, show fallback immediately
    if (!displayProduct?.modelUrl || !webglAvailable) { setModelDisplayed(true); return; }
    if (!mvReady) return;

    const mv = mvRef.current;
    if (!mv) {
      // model-viewer element not yet in DOM; wait for next render
      const t = setTimeout(() => setModelDisplayed(true), 15000);
      return () => clearTimeout(t);
    }

    const reveal = () => { setModelDisplayed(true); };

    const onLoad = async () => {
      // Set initial camera orbit imperatively so React's JSX never needs to own
      // this attribute (and thus can never reset it mid-snapshot on re-render).
      mv.cameraOrbit = "0deg 75deg 2.5m";
      const model = mv.model;
      if (model?.materials?.length) {
        const entries: MatEntry[] = model.materials.map((m:any,i:number)=>({idx:i,name:m.name||`Part ${i+1}`,mat:m,color:"#ffffff"}));
        setMats(entries);
        requestAnimationFrame(()=>syncTextureRef.current?.());
      }
      setModelLoaded(true);
      reveal();
    };

    const onError = () => { setModelLoaded(true); reveal(); };

    // Guard: model-viewer fires load synchronously on cached models
    if ((mv as any).loaded) { onLoad(); return; }

    // Safety net: hide spinner after 15 s regardless
    const fallback = setTimeout(() => { reveal(); setModelLoaded(true); }, 15000);

    mv.addEventListener("load", onLoad);
    mv.addEventListener("error", onError);
    return () => {
      mv.removeEventListener("load", onLoad);
      mv.removeEventListener("error", onError);
      clearTimeout(fallback);
    };
  }, [mvReady, displayProduct?.modelUrl, webglAvailable]);

  // Sync userStyle when the URL param changes (e.g. navigating from pattern → solid via modal)
  useEffect(() => { setUserStyle(_entryStyle); }, [_entryStyle]);

  // When viewing a saved design (?from=saved), fully restore the canvas and 3D model
  // to the state that was saved. This effect runs once canvasReady and existing data
  // are both available. Auto-apply effects are suppressed in saved mode (see guards
  // below) so they don't overwrite the restored design.
  useEffect(() => {
    if (_fromSource !== "saved" || !existing?.canvasData || !canvasReady) return;
    if (restoredRef.current) return;
    restoredRef.current = true;

    const fc = fcRef.current;
    if (!fc) return;

    (async () => {
      try {
        const cd = JSON.parse(existing.canvasData as string);

        // ── 1. React UI state ───────────────────────────────────────────
        if (cd.customizationType) {
          const t: string = cd.customizationType;
          setCustomizationType(t as "color"|"print"|"pattern");
          if (t === "color")        setUserStyle("solid");
          else if (t === "print")   setUserStyle("print");
          else if (t === "pattern") setUserStyle("pattern");
        }
        if (cd.primaryColor)    setPrimaryColor(cd.primaryColor);
        if (cd.activePrintId)   setActivePrintId(cd.activePrintId);
        if (cd.allOverPrintId)  setAllOverPrintId(cd.allOverPrintId);
        if (cd.zoneColors)      setZoneColors(cd.zoneColors);
        if (cd.patColorA)       setPatColorA(cd.patColorA);
        if (cd.patColorB)       setPatColorB(cd.patColorB);
        if (cd.sleeveLength)    setSleeveLength(cd.sleeveLength as "half"|"full");

        // ── 2. Fabric canvas background color (solid layer) ─────────────
        const bg: string = cd.primaryColor ?? "#ffffff";
        baseBgRef.current = bg;
        setFabricBg(fc, bg);

        // ── 3. Restore canvas objects (logos, text, zone prints, design shapes)
        if (cd.canvasJSON) {
          try {
            const cj = typeof cd.canvasJSON === "string"
              ? JSON.parse(cd.canvasJSON)
              : cd.canvasJSON;
            await (fc as any).loadFromJSON(cj);
            fc.renderAll();
          } catch { /* malformed canvasJSON — canvas keeps objects from step 2 */ }
        }

        // ── 3b. Restore React UI state from tagged canvas objects ────────
        // logo
        const logoObj = fc.getObjects().find((o: any) => o?.data?.kashaLogo) as fabric.FabricImage | undefined;
        if (logoObj) {
          logoObjRef.current = logoObj;
          setLogoPlaced(true);
          const src = (logoObj as any).getSrc?.() ?? (logoObj as any)._element?.src ?? null;
          if (src) setLogoPreview(src);
        }
        // text
        const textObj = fc.getObjects().find((o: any) => o?.data?.tag === "user-text");
        if (textObj) {
          textObjRef.current = textObj as any;
          setTextPlaced(true);
          const txt = (textObj as any).text ?? "";
          if (txt) setTextInput(txt);
          const fill = (textObj as any).fill;
          if (fill && typeof fill === "string") setTextColor(fill);
          const fs = (textObj as any).fontSize;
          if (fs) setTextFontSize(fs);
          const ff = (textObj as any).fontFamily;
          if (ff) setTextFont(ff);
          const fw = (textObj as any).fontWeight;
          setTextBold(fw === "700" || fw === 700 || fw === "bold");
          setTextItalic((textObj as any).fontStyle === "italic");
          setTextUnderline(!!(textObj as any).underline);
        }

        // ── 4. Re-apply all-over print background ───────────────────────
        // fabric.Pattern doesn't survive JSON serialisation (the offscreen
        // canvas source becomes stale), so we rebuild it from the stored ID.
        if (cd.allOverPrintId) {
          const p = PATTERNS.find((pat: any) => pat.id === cd.allOverPrintId);
          if (p) {
            // applyAllOverPrint sets the pattern as canvas.backgroundColor and
            // calls syncTexture() — model update is handled there.
            await applyAllOverPrint(p);
            return; // model already updated by applyAllOverPrint → done
          }
        }

        // ── 5. KA.SHA bespoke design ────────────────────────────────────
        // Objects are already in canvasJSON (step 3). Just sync React state
        // so the correct design is highlighted in the UI.
        if (cd.kdDesignId) {
          const design = KASHA_DESIGNS.find((d: any) => d.id === cd.kdDesignId);
          if (design) setActiveKashaDesign(design);
        }

        // ── 6. Push restored canvas state to the 3D model ───────────────
        // syncTexture() is a no-op when mats are not loaded yet — but the
        // [mats, syncTexture] effect fires automatically once the model-viewer
        // materials arrive, so the restored canvas state will be applied then.
        syncTexture();
      } catch { /* ignore malformed canvasData */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_fromSource, existing, canvasReady]);

  // Update styleTab when productType resolves (after data fetch)
  useEffect(() => {
    if (productType==="pattern") setStyleTab("pattern");
    else if (productType==="print") setStyleTab("print");
  }, [productType]);

  // Clear any applied KA.SHA pattern design when user is in solid or print mode
  useEffect(() => {
    if (effectiveSkuType === "solid" || effectiveSkuType === "print") {
      const fc = fcRef.current;
      if (!fc) return;
      const patternObjs = fc.getObjects().filter((o: any) => o?.data?.kashaDesign || o?.data?.kashaZonePrint);
      if (patternObjs.length > 0) {
        patternObjs.forEach((o: any) => fc.remove(o));
        setActiveKashaDesign(null);
        fc.renderAll();
        syncTexture();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSkuType]);

  // All users start at Step 1 to choose their style (no auto-advance)

  // Responsive layout listener
  useEffect(() => {
    const handler = () => setScreenW(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // ── KA.SHA Bespoke Design handler ────────────────────────────────────────
  // colorOverride: optional colors to apply in the same call; avoids stale-closure
  // issues when calling from effects where activeKashaDesign state hasn't updated yet.
  const handleSelectKashaDesign = useCallback(async (design: KashaDesignDef, colorOverride?: {colorA:string;colorB:string;fillA?:ChannelFill;fillB?:ChannelFill}) => {
    const fc=fcRef.current; if(!fc) return;
    const myReq=++kdRequestIdRef.current;
    setActiveKashaDesign(design);
    // When a print is active it acts as the base colour — keep it; design renders on top
    try{mats[0]?.mat?.pbrMetallicRoughness?.setBaseColorFactor?.([1,1,1,1]);}catch{}
    const recolor: RecolorOptions = colorOverride
      ? { colorA: colorOverride.colorA, colorB: colorOverride.colorB, fillA: colorOverride.fillA, fillB: colorOverride.fillB }
      : { colorA: patColorA, colorB: patColorB };
    if (colorOverride) { setPatColorA(colorOverride.colorA); setPatColorB(colorOverride.colorB); }
    await applyKashaDesign(fc, design, recolor);
    if (myReq!==kdRequestIdRef.current) return;
    syncTexture();
    toast({title:`${design.id} applied`, description:design.label});
  }, [mats, patColorA, patColorB, syncTexture, toast]);

  // ── Pattern colour recolor ────────────────────────────────────────────────
  const applyPatternColors = useCallback(async (cA: string, cB: string) => {
    if (!activeKashaDesign) return;
    const fc=fcRef.current; if(!fc) return;
    setPatColorA(cA); setPatColorB(cB);
    // Keep text-input drafts in sync whenever colours change via swatch/picker/preset
    setDraftColorA(cA); setErrColorA(false);
    setDraftColorB(cB); setErrColorB(false);
    setPatRecoloring(true);
    try {
      const recolor: RecolorOptions = { colorA: cA, colorB: cB };
      await applyKashaDesign(fc, activeKashaDesign, recolor);
      syncTexture();
    } finally { setPatRecoloring(false); }
  }, [activeKashaDesign, syncTexture]);

  // ── Pattern Design print — applies a tiled print into the same channel-B
  //    pixel areas that applyPatternColors recolours ─────────────────────────
  const applyPatternDesignPrint = useCallback(async (p: PatternDef) => {
    if (!activeKashaDesign) return;
    const fc = fcRef.current; if (!fc) return;
    setPatRecoloring(true);
    try {
      await applyKashaDesignWithPrint(fc, activeKashaDesign, patColorA, toProxiedUrl(patternUrl(p.file)));
      syncTextureRef.current?.();
    } finally { setPatRecoloring(false); }
  }, [activeKashaDesign, patColorA, syncTexture]);

  // ── Logo background removal (canvas-based white-threshold) ──────────────
  const removeBackground = useCallback(async () => {
    if (!logoPreview) return;
    setBgRemoving(true);
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((res,rej)=>{ img.onload=()=>res(); img.onerror=()=>rej(new Error("img")); img.src=toProxiedUrl(logoPreview!); });
      const c=document.createElement("canvas"); c.width=img.naturalWidth||img.width; c.height=img.naturalHeight||img.height;
      const ctx=c.getContext("2d")!; ctx.drawImage(img,0,0);
      const d=ctx.getImageData(0,0,c.width,c.height); const p=d.data;
      for (let i=0;i<p.length;i+=4) { if(p[i]>220&&p[i+1]>220&&p[i+2]>220) p[i+3]=0; }
      ctx.putImageData(d,0,0);
      const newUrl=c.toDataURL("image/png");
      setLogoPreview(newUrl);
      const fc=fcRef.current;
      if (fc) {
        const ni=await fabric.FabricImage.fromURL(newUrl,{crossOrigin:"anonymous"});
        const pos=LOGO_POSITIONS[logoPosition]||{left:512,top:512};
        const maxW=logoMaxW(logoPosition,logoSize);
        if(ni.width&&ni.width>maxW) ni.scaleToWidth(maxW);
        ni.set({left:pos.left,top:pos.top,originX:"center",originY:"center",flipX:placementFlipX(logoPosition),flipY:placementFlipY(logoPosition),angle:placementAngle(logoPosition),hasControls:false,hasBorders:false,selectable:false,evented:false});
        // Remove old logo by ref AND by tag (mirrors handleLogoUpload)
        if (logoObjRef.current) fc.remove(logoObjRef.current);
        fc.getObjects().filter((o:any)=>o?.data?.kashaLogo).forEach((o:any)=>fc.remove(o));
        (ni as any).data={kashaLogo:true};
        fc.add(ni); logoObjRef.current=ni;
        setLogoPlaced(true);
        fc.renderAll(); syncTexture();
      }
      toast({title:"Background removed ✓"});
    } catch { toast({title:"Could not remove background",variant:"destructive"}); }
    finally { setBgRemoving(false); }
  }, [logoPreview, logoPosition, logoSize, syncTexture, toast]);

  // ── Primary colour (fabric/solid) ────────────────────────────────────────
  //
  // opts.recompose = true  →  "Base Body → Colour" with an active print:
  //   keep the print visible but bake the new colour as its background fill.
  //   This is the "updateMaterial(color, print)" approach — colour fills the
  //   canvas background, print image is drawn on top, then syncTexture uploads
  //   the composited result.  allOverPrintId is NOT cleared so the print gallery
  //   selection stays highlighted and the print source is preserved for further
  //   colour tweaks without re-fetching the image.
  //
  // default (opts unset)  →  solid colour replaces the print entirely.
  //   Called by every "Full Body → Colour" path (legacy swatches, flat-UI colour
  //   modal with colorModalFor="all", KA.SHA design base, history restore etc.).
  const applyPrimary = (hex: string, opts?: {recompose?: boolean}) => {
    setPrimaryColor(hex);
    const fc=fcRef.current;
    baseBgRef.current=hex;

    // ── recompose path: keep print, change its background colour ──────────────
    const src=allOverPrintSourceRef.current;
    if (opts?.recompose && allOverPrintId && src && fc) {
      // Build a new composed tile: solid colour fill + print image on top.
      // Reuses the cached raw print canvas — no network round-trip needed.
      const composed=document.createElement("canvas");
      composed.width=ALL_OVER_TILE_PX; composed.height=ALL_OVER_TILE_PX;
      const cCtx=composed.getContext("2d");
      if (cCtx) {
        cCtx.fillStyle=hex;
        cCtx.fillRect(0,0,ALL_OVER_TILE_PX,ALL_OVER_TILE_PX);
        cCtx.drawImage(src,0,0);
      }
      (fc as any).backgroundColor=new fabric.Pattern({source:composed,repeat:"repeat"});
      fc.renderAll();
      // Reset all materials to white so the uploaded texture drives all colours
      // (including zone-specific rects for collar/sleeves) without tinting them.
      // The new body colour is already baked into the canvas background tile.
      const mv=mvRef.current as any;
      if (mats.length && mv) {
        for (const entry of mats) {
          try { entry.mat?.pbrMetallicRoughness?.setBaseColorFactor?.([1,1,1,1]); } catch {}
        }
        try { mv.requestUpdate?.(); } catch {}
      }
      // Upload the recomposed texture (same reliable path as clearAllOverPrint/Reset)
      syncTexture();
      if (applyPrimaryTimeoutRef.current) clearTimeout(applyPrimaryTimeoutRef.current);
      applyPrimaryTimeoutRef.current=setTimeout(()=>{
        applyPrimaryTimeoutRef.current=null;
        if (fcRef.current) syncTextureRef.current?.();
      },200);
      return;
    }

    // ── default path: solid colour (clears any active print) ─────────────────
    if (allOverPrintId) setAllOverPrintId(null);
    setFabricBg(fc,hex);

    const mv=mvRef.current as any;
    const capturedMats=mats; // stable snapshot for the async closure below

    // Determine up-front whether a full canvas bake is required.
    // • allOverPrintId set  → a print texture is on the GPU; we must replace it.
    // • canvas objects exist → logos / zone-colour rects must be baked together.
    // When either is true we skip the 4×4 Step B entirely to avoid a race where
    // Step B (plain solid, no overlays) would overwrite Step C's correctly-baked
    // composite texture.
    const hasOverlays=!!(fc && fc.getObjects().length>0);
    const needsFullBake = hasOverlays || !!allOverPrintId;

    if (capturedMats.length && mv) {
      const r=parseInt(hex.slice(1,3)||"ff",16)/255;
      const g=parseInt(hex.slice(3,5)||"ff",16)/255;
      const b=parseInt(hex.slice(5,7)||"ff",16)/255;

      // ── Step A: instant visual hint via baseColorFactor ────────────────────
      // Use sRGB values directly (not gamma-converted linear) so the hint colour
      // matches the picker exactly. Step B/C replaces this with the actual sRGB
      // texture, at which point baseColorFactor is reset to [1,1,1,1].
      for (const entry of capturedMats) {
        try { entry.mat?.pbrMetallicRoughness?.setBaseColorFactor?.([r,g,b,1]); } catch {}
      }
      try { mv.requestUpdate?.(); } catch {}

      // ── Step B: fast 4×4 solid-colour texture (clean case only) ────────────
      if (!needsFullBake) {
        (async () => {
          try {
            const sc=document.createElement("canvas");
            sc.width=4; sc.height=4;
            const ctx=sc.getContext("2d"); if(!ctx) return;
            ctx.fillStyle=hex; ctx.fillRect(0,0,4,4);
            const url=sc.toDataURL("image/png");
            const tex=await mv.createTexture(url);
            if (baseBgRef.current!==hex) return;
            for (const entry of capturedMats) {
              try {
                const pbr=entry.mat?.pbrMetallicRoughness; if(!pbr) continue;
                const slot=pbr.baseColorTexture;
                if (slot && typeof slot.setTexture==="function") {
                  try { slot.setTexture(null); } catch {}
                  slot.setTexture(tex);
                }
                pbr.setBaseColorFactor?.([1,1,1,1]);
              } catch {}
            }
            try { mv.requestUpdate?.(); } catch {}
            try { mv.updateFraming?.(); } catch {}
          } catch(e) {
            console.warn("[applyPrimary] solid texture failed:",e);
          }
        })();
      }
    }

    // ── Step C: full canvas bake via syncTexture ──────────────────────────────
    if (needsFullBake) {
      syncTexture();
      if (applyPrimaryTimeoutRef.current) clearTimeout(applyPrimaryTimeoutRef.current);
      applyPrimaryTimeoutRef.current=setTimeout(()=>{
        applyPrimaryTimeoutRef.current=null;
        const currentFc=fcRef.current;
        if (currentFc && currentFc.backgroundColor===hex) syncTextureRef.current?.();
      },200);
    }
  };

  // ── Per-zone colour ──────────────────────────────────────────────────────
  const applyZoneColor = useCallback((zone: Exclude<PatternZone,"all">, hex: string) => {
    const fc=fcRef.current; if(!fc) return;
    kdRequestIdRef.current++;
    const existing=fc.getObjects().filter((o:any)=>o?.data?.kashaZoneColor===zone);
    if (existing.length) fc.remove(...existing);
    if (!hex) { setZoneColors(prev=>({...prev,[zone]:""})); fc.renderAll(); syncTexture(); return; }
    const preset=ZONE_PRESETS[zone];
    const rect=new fabric.Rect({left:preset.left,top:preset.top,width:preset.w,height:preset.h,fill:hex,selectable:false,evented:false,originX:"left",originY:"top"});
    (rect as any).data={kashaZoneColor:zone};
    fc.add(rect);
    (fc as any).sendObjectToBack?.(rect);
    const kdBase=fc.getObjects().find((o:any)=>o?.data?.tag==="__kashaKdBg__");
    if (kdBase) (fc as any).sendObjectToBack?.(kdBase);
    fc.renderAll();
    setZoneColors(prev=>({...prev,[zone]:hex}));
    syncTexture();
  }, [syncTexture]);

  // ── Print library ────────────────────────────────────────────────────────
  const loadHTMLImage=(url:string)=>new Promise<HTMLImageElement>((res,rej)=>{const img=new Image();img.crossOrigin="anonymous";img.onload=()=>res(img);img.onerror=rej;img.src=toProxiedUrl(url);});

  const applyAllOverPrint = useCallback(async (p: PatternDef) => {
    const fc=fcRef.current; if(!fc) return;
    kdRequestIdRef.current++;
    const hasDesign = !!activeKashaDesign;
    try {
      const img=await loadHTMLImage(patternUrl(p.file));
      // Raw tile — draw only the print image, no background fill yet.
      // Stored in allOverPrintSourceRef so applyPrimary can recompose it
      // cheaply (no re-fetch) whenever the base colour changes.
      const off=document.createElement("canvas");off.width=ALL_OVER_TILE_PX;off.height=ALL_OVER_TILE_PX;
      const rawCtx=off.getContext("2d");
      if(rawCtx){rawCtx.imageSmoothingEnabled=true;rawCtx.imageSmoothingQuality="high";rawCtx.drawImage(img,0,0,ALL_OVER_TILE_PX,ALL_OVER_TILE_PX);}
      allOverPrintSourceRef.current=off;

      // Composed tile: base colour fill FIRST, print drawn ON TOP.
      // This implements the "updateMaterial(color, print)" contract so that
      // the current garment colour is always baked into the pattern texture
      // and visible through any transparent areas of the print.
      const composed=document.createElement("canvas");composed.width=ALL_OVER_TILE_PX;composed.height=ALL_OVER_TILE_PX;
      const cCtx=composed.getContext("2d");
      if(cCtx){
        cCtx.fillStyle=baseBgRef.current||"#1a1a1a";
        cCtx.fillRect(0,0,ALL_OVER_TILE_PX,ALL_OVER_TILE_PX);
        cCtx.drawImage(off,0,0);
      }
      if (!hasDesign) { /* no design active — print takes full canvas */ }
      const pattern=new fabric.Pattern({source:composed,repeat:"repeat"});
      (fc as any).backgroundColor=pattern;
      fc.renderAll();
      setAllOverPrintId(p.id); setActivePrintId(p.id);
      for (const entry of mats) { try{entry.mat?.pbrMetallicRoughness?.setBaseColorFactor?.([1,1,1,1]);}catch{} }
      try { (mvRef.current as any)?.requestUpdate?.(); } catch {}
      syncTextureRef.current?.();
      toast({
        title: hasDesign ? "Print applied as base texture" : "Print applied",
        description: hasDesign ? `${p.label} — pattern design remains on top.` : `${p.label} mapped across the whole garment.`,
      });
    } catch { toast({title:"Could not load print",variant:"destructive"}); }
  }, [activeKashaDesign, mats, syncTexture, toast]);

  const clearAllOverPrint = useCallback(()=>{
    const fc=fcRef.current; if(!fc) return;
    allOverPrintSourceRef.current=null; // discard cached print tile
    setFabricBg(fc,baseBgRef.current||"#1a1a1a");
    fc.renderAll(); setAllOverPrintId(null); syncTexture();
  }, [syncTexture]);

  // ── Zone (part-by-part) print placement ───────────────────────────────────
  const applyZonePrint = useCallback(async (zone: Exclude<PatternZone,"all">, p: PatternDef) => {
    const fc=fcRef.current; if(!fc) return;
    const preset=ZONE_PRESETS[zone];
    // Use a consistent tile size — canvas clips overflow, so edges are never squished
    const tileSize=128;
    try {
      const img=await loadHTMLImage(patternUrl(p.file));
      const off=document.createElement("canvas");
      off.width=preset.w; off.height=preset.h;
      const ctx=off.getContext("2d"); if(!ctx) return;
      ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality="high";
      // 9-arg drawImage: always scale source to tileSize×tileSize at each position.
      // The offscreen canvas (preset.w × preset.h) clips any overflow automatically.
      for (let row=0; row*tileSize<preset.h; row++) {
        for (let col=0; col*tileSize<preset.w; col++) {
          ctx.drawImage(img, 0, 0, img.width, img.height, col*tileSize, row*tileSize, tileSize, tileSize);
        }
      }
      // Remove any existing print for this zone
      fc.getObjects().filter((o:any)=>o?.data?.kashaZonePrint===zone).forEach((o:any)=>fc.remove(o));
      const fimg=await fabric.FabricImage.fromURL(off.toDataURL());
      fimg.set({ left:preset.left, top:preset.top, selectable:false, evented:false, originX:"left", originY:"top" });
      (fimg as any).data={kashaZonePrint:zone};
      fc.add(fimg);
      setZonePrintIds(prev=>({...prev,[zone]:p.id}));
      fc.renderAll(); syncTexture();
      toast({title:`Print applied to ${ZONE_LABEL[zone]}`});
    } catch { toast({title:"Could not apply print",variant:"destructive"}); }
  }, [syncTexture, toast]);

  // ── SKU-based auto-apply ──────────────────────────────────────────────────
  // When a product page links to the customiser (via ?id=), parse the product
  // SKU and immediately apply the correct design so the 3D model matches the
  // product the customer selected — no manual selection needed.

  // PATTERN auto-apply: apply zone textures + colorway derived from SKU suffix.
  // Gated on mats.length > 0 so syncTexture can actually push to the model;
  // the effect re-fires automatically when mats loads (via handleSelectKashaDesign dep).
  useEffect(() => {
    if (_fromSource === "saved") return; // restore effect handles saved designs
    if (!canvasReady || productType !== "pattern" || autoAppliedRef.current) return;
    // Respect user's explicit style choice — don't force a pattern when the user
    // picked "solid" or "print" via the CustomizeEntryModal (?style= param).
    if (userStyle === "solid" || userStyle === "print") return;
    if (!product || !mats.length) return; // wait for model materials to be ready
    autoAppliedRef.current = true;

    // Parse the product's own SKU for colors (may have suffix like KS1002B-BB)
    const productSkuResult = parseSku(product.sku ?? "");

    // The ?design= param may be a bare design ID ("KS1002B") or a full SKU
    // ("KS1002B-BB") when arriving from the PersonalizeModal with a specific colorway.
    const rawDesignParam = entryDesignRef.current; // e.g. "KS1002B-BB" or "KS1002B"
    const entrySkuResult = parseSku(rawDesignParam ?? "");

    // If the product SKU resolves to a pure all-over print (e.g. KS1003B-PRT-001)
    // and the entry param doesn't override to a pattern, let the print auto-apply
    // effect handle it. Applying zone artwork here would overwrite the print.
    if (
      productSkuResult.type === "print" &&
      entrySkuResult.type !== "pattern" &&
      entrySkuResult.type !== "pattern+print"
    ) {
      autoAppliedRef.current = true;
      return;
    }

    // Resolve the design ID and the best available colorway:
    // Priority: 1) full-SKU entry param  2) product SKU  3) defaults
    let designId: string;
    let colorOverride: {colorA:string;colorB:string;fillA?:ChannelFill;fillB?:ChannelFill} | undefined;

    if (entrySkuResult.type === "pattern" || entrySkuResult.type === "pattern+print") {
      // Full SKU passed in URL — use its design + colors
      designId = entrySkuResult.designId;
      colorOverride = { colorA: entrySkuResult.colorA, colorB: entrySkuResult.colorB };
    } else if (rawDesignParam) {
      // Bare design ID passed (e.g. "KS1002B") — use product SKU colors as fallback
      designId = rawDesignParam;
      if (productSkuResult.type === "pattern" || productSkuResult.type === "pattern+print") {
        colorOverride = { colorA: productSkuResult.colorA, colorB: productSkuResult.colorB };
      }
    } else if (productSkuResult.type === "pattern" || productSkuResult.type === "pattern+print") {
      // No entry param — derive everything from product SKU
      designId = productSkuResult.designId;
      colorOverride = { colorA: productSkuResult.colorA, colorB: productSkuResult.colorB };
    } else {
      // Fallback: legacy SKU_KASHA_DESIGN_MAP lookup
      designId = SKU_KASHA_DESIGN_MAP[product.sku ?? ""] ?? "KS1001B";
    }

    // ── Resolve print fills from zoneFills (new PAT-BLK,PRT-006 format) ──────
    // zoneFills[0] = colorB slot (base/light), zoneFills[1] = colorA slot (dark/accent).
    // When a slot is kind:"print", resolve the pattern URL and attach as fillA/fillB.
    const activePatternSku =
      entrySkuResult.type === "pattern" ? entrySkuResult :
      productSkuResult.type === "pattern" ? productSkuResult : null;

    if (activePatternSku && colorOverride) {
      const [fillBSpec, fillASpec] = activePatternSku.zoneFills ?? [];
      // Surface any unresolved tokens as visible errors in the colour panel
      const unresolved = (activePatternSku.zoneFills ?? [])
        .filter(f => f.kind === "unresolved")
        .map(f => (f as { kind: "unresolved"; token: string }).token);
      if (unresolved.length > 0) setSkuColorErrors(unresolved);
      // Only resolve fills for recognised kinds
      if (fillASpec?.kind === "print") {
        const patt = PATTERNS.find((p: PatternDef) => p.id === fillASpec.patternId);
        if (patt) colorOverride.fillA = { kind: "print", printUrl: toProxiedUrl(patternUrl(patt.file)) };
      }
      if (fillBSpec?.kind === "print") {
        const patt = PATTERNS.find((p: PatternDef) => p.id === fillBSpec.patternId);
        if (patt) colorOverride.fillB = { kind: "print", printUrl: toProxiedUrl(patternUrl(patt.file)) };
      }
    }

    const design = KASHA_DESIGNS.find(d => d.id === designId) ?? KASHA_DESIGNS[0];

    // When fillB is a print, apply it as the canvas background first so transparent
    // Channel-B zone pixels show the body print beneath them.
    // When fillB is a solid color, set it as the body background as before.
    if (colorOverride?.fillB?.kind === "print") {
      // Find the body print pattern and apply it as background
      const activeBSpec = activePatternSku?.zoneFills?.[0];
      const bodyPrint = activeBSpec?.kind === "print"
        ? PATTERNS.find((p: PatternDef) => p.id === activeBSpec.patternId)
        : null;
      if (bodyPrint) {
        // applyAllOverPrint sets background, then design zones (with transparent B) go on top
        applyAllOverPrint(bodyPrint).then(() => {
          handleSelectKashaDesign(design, colorOverride);
        });
        return;
      }
    } else if (colorOverride) {
      // Apply colorB as the body/primary garment colour *before* zone textures are placed
      // on top, so any UV area not covered by a zone still shows the correct body colour.
      baseBgRef.current = colorOverride.colorB;
      const fc = fcRef.current;
      if (fc) setFabricBg(fc, colorOverride.colorB);
      setPrimaryColor(colorOverride.colorB);
    }

    // Determine whether a body print should be applied under the pattern design.
    // This handles SKUs like KS1001B-GP006-Grey: body = GP006 print, design on top.
    const resolvedSku = entrySkuResult.type === "pattern+print" ? entrySkuResult
      : productSkuResult.type === "pattern+print" ? productSkuResult : null;

    if (resolvedSku) {
      // Apply the body print first, then layer the pattern design on top of it.
      const bodyPrint = PATTERNS.find((p: PatternDef) => p.id === resolvedSku.patternId);
      if (bodyPrint) {
        applyAllOverPrint(bodyPrint).then(() => {
          handleSelectKashaDesign(design, colorOverride);
        });
        return;
      }
    }

    // Pass colorOverride directly so colors are applied atomically with the design,
    // and syncTexture fires with mats already populated (guaranteed by guard above).
    handleSelectKashaDesign(design, colorOverride);
  }, [canvasReady, productType, handleSelectKashaDesign, product, mats, applyAllOverPrint]);

  // PRINT auto-apply: select the correct print from the library based on SKU.
  // We only need canvasReady here — NOT mats.length. The print is applied to the
  // Fabric canvas immediately; the existing `useEffect([mats])` further down will
  // call syncTexture() once model materials arrive, pushing the texture to the model.
  const autoAppliedPrintRef = useRef(false);
  useEffect(() => {
    if (_fromSource === "saved") return; // restore effect handles saved designs
    if (autoAppliedPrintRef.current) return;
    if (!canvasReady) return;

    let targetPatternId: string | null = null;

    if (product?.sku) {
      // Product loaded — resolve print ID from SKU
      const skuResult = parseSku(product.sku);
      if (skuResult.type === "print") {
        targetPatternId = skuResult.patternId;
      }
    } else if (isTypeMode && garmentType === "printed") {
      // Generic "printed" mode — default to blue-floral as before
      targetPatternId = "blue-floral";
    }

    if (!targetPatternId) return;
    const pattern = PATTERNS.find(p => p.id === targetPatternId);
    if (!pattern) return;
    autoAppliedPrintRef.current = true;
    applyAllOverPrint(pattern);
  }, [product, isTypeMode, garmentType, canvasReady, applyAllOverPrint]);

  // SOLID auto-apply: apply the correct base color from SKU when arriving on a solid product.
  // Priority: 1) ?design= URL param hex  2) product.sku hex  3) product.defaultColor
  // The fallback hex "#f5f5f5" means the color code wasn't in the map, so we don't use it.
  const autoAppliedSolidRef = useRef(false);
  useEffect(() => {
    if (_fromSource === "saved") return; // restore effect handles saved designs
    if (autoAppliedSolidRef.current) return;
    if (!canvasReady) return;

    const FALLBACK_WHITE = "#f5f5f5";

    // Don't apply a solid background over "printed" subType products — the print
    // auto-apply effect owns the canvas background for those.  Applying a solid
    // colour here would flash the canvas white/default before the print renders.
    if (product?.subType === "printed") {
      autoAppliedSolidRef.current = true;
      return;
    }
    // Also bail when the product SKU itself decodes as a pure print so bottom-wear
    // print SKUs (e.g. KL1002F-PRT-010) don't get a solid background applied.
    if (product?.sku) {
      const _quickCheck = parseSku(product.sku);
      if (_quickCheck.type === "print") {
        autoAppliedSolidRef.current = true;
        return;
      }
    }

    // 1) Try the entry design param (e.g. KS1000BROYELBLUE passed from the modal)
    const entryResult = parseSku(entryDesignRef.current ?? "");
    if (entryResult.type === "solid" && entryResult.hex !== FALLBACK_WHITE) {
      autoAppliedSolidRef.current = true;
      applyPrimary(entryResult.hex);
      return;
    }

    // 2) Try the product's own SKU
    if (product?.sku) {
      const skuResult = parseSku(product.sku);
      if (skuResult.type === "solid" && skuResult.hex !== FALLBACK_WHITE) {
        autoAppliedSolidRef.current = true;
        applyPrimary(skuResult.hex);
        return;
      }
    }

    // 3) Fall back to the product's defaultColor field (set in admin panel)
    if (product?.defaultColor) {
      autoAppliedSolidRef.current = true;
      applyPrimary(product.defaultColor);
    }
  // applyPrimary is stable (defined with plain function, not useCallback), so we omit it
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, canvasReady]);

  const clearZonePrint = useCallback((zone: Exclude<PatternZone,"all">)=>{
    const fc=fcRef.current; if(!fc) return;
    fc.getObjects().filter((o:any)=>o?.data?.kashaZonePrint===zone).forEach((o:any)=>fc.remove(o));
    setZonePrintIds(prev=>({...prev,[zone]:null}));
    fc.renderAll(); syncTexture();
  }, [syncTexture]);

  const clearAllZonePrints = useCallback(()=>{
    const fc=fcRef.current; if(!fc) return;
    fc.getObjects().filter((o:any)=>o?.data?.kashaZonePrint).forEach((o:any)=>fc.remove(o));
    setZonePrintIds({front:null,back:null,collar:null,leftSleeve:null,rightSleeve:null});
    fc.renderAll(); syncTexture();
  }, [syncTexture]);

  // ── Logo ─────────────────────────────────────────────────────────────────
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file=e.target.files?.[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=async(ev)=>{
      const src=ev.target?.result as string;
      setLogoPreview(src);
      const img=await fabric.FabricImage.fromURL(src);
      const pos=LOGO_POSITIONS[logoPosition]||{left:512,top:512};
      const maxW=logoMaxW(logoPosition,logoSize);
      if (img.width&&img.width>maxW) img.scaleToWidth(maxW);
      img.set({left:pos.left,top:pos.top,originX:"center",originY:"center",flipX:placementFlipX(logoPosition),flipY:placementFlipY(logoPosition),angle:placementAngle(logoPosition),hasControls:false,hasBorders:false,selectable:false,evented:false});
      const fc=fcRef.current; if(!fc) return;
      if (logoObjRef.current) fc.remove(logoObjRef.current);
      // Sweep any previously tagged logo objects (stale refs)
      fc.getObjects().filter((o:any)=>o?.data?.kashaLogo).forEach((o:any)=>fc.remove(o));
      (img as any).data={kashaLogo:true};
      fc.add(img); logoObjRef.current=img;
      setLogoPlaced(true);
      fc.renderAll(); syncTexture();
    };
    reader.readAsDataURL(file);
    e.target.value="";
  };

  const repositionLogo = () => {
    const o=logoObjRef.current; if(!o) return;
    const pos=LOGO_POSITIONS[logoPosition]||{left:512,top:512};
    const maxW=logoMaxW(logoPosition,logoSize);
    o.scaleToWidth(maxW);
    o.set({left:pos.left,top:pos.top,originX:"center",originY:"center",flipX:placementFlipX(logoPosition),flipY:placementFlipY(logoPosition),angle:placementAngle(logoPosition)});
    o.setCoords();
    fcRef.current?.renderAll(); syncTexture();
  };

  const removeLogo=()=>{
    const fc=fcRef.current;
    if(fc){
      // Remove via tracked ref (fast path)
      if(logoObjRef.current) fc.remove(logoObjRef.current);
      // Sweep by kashaLogo tag — catches cases where the ref was stale
      // (e.g. user deleted via Fabric corner control before clicking Remove)
      fc.getObjects().filter((o:any)=>o?.data?.kashaLogo).forEach((o:any)=>fc.remove(o));
      fc.renderAll(); syncTexture();
    }
    logoObjRef.current=null;
    setLogoPreview(null);
    setLogoPlaced(false);
  };

  // ── Text handlers ─────────────────────────────────────────────────────────
  const applyText = () => {
    const fc=fcRef.current; if(!fc||!textInput.trim()) return;
    const pos=LOGO_POSITIONS[textPosition]||{left:512,top:512};
    if (textObjRef.current) fc.remove(textObjRef.current);
    const isCollar=textPosition==="collar-left"||textPosition==="collar-right";
    const effectiveFontSize=isCollar?Math.min(textFontSize,14):textFontSize;
    const txt=new (fabric as any).IText(textInput.trim(),{
      left:pos.left, top:pos.top,
      originX:"center", originY:"center",
      fontSize:effectiveFontSize,
      fill:textColor,
      fontFamily:textFont,
      fontWeight:textBold?"700":"400",
      fontStyle:textItalic?"italic":"normal",
      underline:textUnderline,
      textAlign:textAlign,
      flipX:placementFlipX(textPosition),flipY:placementFlipY(textPosition),angle:placementAngle(textPosition),
      selectable:true, evented:true,
      data:{tag:"user-text"},
    });
    clampCollarText(txt, textPosition);
    fc.add(txt); fc.setActiveObject(txt);
    textObjRef.current=txt;
    setTextPlaced(true);
    fc.renderAll(); syncTexture();
  };

  const repositionText = () => {
    const o=textObjRef.current; if(!o) return;
    const pos=LOGO_POSITIONS[textPosition]||{left:512,top:512};
    o.set({left:pos.left, top:pos.top, originX:"center", originY:"center", flipX:placementFlipX(textPosition),flipY:placementFlipY(textPosition),angle:placementAngle(textPosition), fontSize:textFontSize, fill:textColor, fontFamily:textFont, fontWeight:textBold?"700":"400", fontStyle:textItalic?"italic":"normal",
      // Reset scale first so clampCollarText works from a clean base
      scaleX:1, scaleY:1,
    });
    clampCollarText(o, textPosition);
    o.setCoords();
    fcRef.current?.renderAll(); syncTexture();
  };

  const removeText = () => {
    const fc=fcRef.current; if(!fc) return;
    if(textObjRef.current){fc.remove(textObjRef.current);textObjRef.current=null;setTextPlaced(false);}
    fc.renderAll(); syncTexture();
  };

  // ── Snapshot ─────────────────────────────────────────────────────────────
  const snapshotModel = useCallback(async (): Promise<string> => {
    const mv: any=mvRef.current; const fc=fcRef.current;
    try{await syncTexture();}catch{}
    await new Promise(r=>requestAnimationFrame(()=>r(null)));
    if (mv&&typeof mv.toDataURL==="function"){try{return mv.toDataURL("image/png",1.0);}catch{}}
    if (fc) return fc.toDataURL({format:"png",quality:0.95,multiplier:1});
    throw new Error("Nothing to snapshot");
  }, [syncTexture]);

  /** Capture front, back and side snapshots.
   *
   * Returns four images:
   *   preview → 3-D model-viewer front render.  Used as the cart/checkout
   *             thumbnail so customers see a recognisable shirt, not a texture.
   *   front   → high-res flat Fabric.js canvas (4× ≈ 4096 px).  Print-ready:
   *             sharp text, crisp logos, no 3-D artefacts.
   *   back    → 3-D model-viewer back render (reference).
   *   side    → 3-D model-viewer side render (reference).
   */
  const snapshotViews = useCallback(async (): Promise<{front:string;back:string;side:string}> => {

    const mv: any = mvRef.current;

    const fc = fcRef.current;

    try { await syncTexture(); } catch {}

    // Auto-rotate overrides camera-orbit on every frame — must be fully

    // disabled before we start setting orbits, or each capture just lands

    // wherever the spin happens to be.

    const wasAutoRotating = !!mv?.hasAttribute?.("auto-rotate");

    const origDecay = mv ? ((mv as any).interpolationDecay ?? 40) : 40;

    if (mv) {

      mv.removeAttribute("auto-rotate");

      mv.removeAttribute("auto-rotate-delay");

      // Freeze camera interpolation so cameraOrbit changes snap instantly
      // rather than smoothly animating — without this, 350ms is not enough
      // for the camera to travel from wherever auto-rotate stopped to the
      // target orbit, producing a rotated/angled capture instead of a clean
      // front/back/side view.

      (mv as any).interpolationDecay = Infinity;

      // Let one frame pass so the viewer actually stops before we set orbits.

      await new Promise(r => requestAnimationFrame(() => r(null)));

    }

    const captureAngle = async (orbit: string, label: string): Promise<string> => {

      if (mv && typeof mv.toDataURL === "function") {

        mv.cameraOrbit = orbit;

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));

        await new Promise(r => setTimeout(r, 350));

        try {
          const raw = mv.toDataURL("image/png", 1.0);
          return await trimToSquare(raw);
        } catch (e) {
          console.warn(`[snapshot:${label}] capture/trim failed`, e);
        }

      }

      if (fc) return fc.toDataURL({ format: "png", quality: 0.95, multiplier: 1 });

      return "";

    };

    try {

      const front = await captureAngle("0deg 75deg 2.5m",   "front");

      const back  = await captureAngle("180deg 75deg 2.5m", "back");

      const side  = await captureAngle("90deg 75deg 2.5m",  "side");

      return { front, back, side };

    } finally {

      if (mv) {

        (mv as any).interpolationDecay = origDecay;

        mv.cameraOrbit = "0deg 75deg 2.5m";

        // Only restore auto-rotate if it was actually on before we touched it.

        if (wasAutoRotating) {

          mv.setAttribute("auto-rotate", "");

          mv.setAttribute("rotation-per-second", "8deg");

        }

      }

    }

  }, [syncTexture]);

  // ── Save / Cart mutations ────────────────────────────────────────────────
  const buildPayload=async()=>{
    const fc=fcRef.current; if(!fc) throw new Error("Canvas not ready");
    const views = await snapshotViews();
    const effectiveQty = Object.values(sizeQty).reduce((a,b)=>a+b,0) || qty;
    const effectiveSize = Object.entries(sizeQty).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1])[0]?.[0] || size;
    const activePrint = activePrintId ? PATTERNS.find((p: any) => p.id === activePrintId) : null;
    const designSpec = {
      baseColor: primaryColor,
      zoneColors: Object.fromEntries(Object.entries(zoneColors).filter(([,v]) => !!v)),
      kashaDesignId: activeKashaDesign?.id ?? null,
      kashaDesignLabel: activeKashaDesign?.label ?? null,
      printId: activePrintId ?? null,
      printLabel: activePrint?.label ?? null,
      printCustomerLabel: (activePrint as any)?.customerLabel ?? null,
      patColorA: activeKashaDesign ? patColorA : null,
      patColorB: activeKashaDesign ? patColorB : null,
      hasLogo: logoPlaced,
      // Include data-URL logos too so admins can download the original uploaded file.
      logoUrl: logoPlaced && logoPreview ? logoPreview : null,
      logoPosition: logoPlaced ? logoPosition : null,
      logoSize: logoPlaced ? logoSize : null,
      textContent: textPlaced ? textInput : null,
      fontFamily: textPlaced ? textFont : null,
      fontSize: textPlaced ? textFontSize : null,
      textColor: textPlaced ? textColor : null,
      textBold: textPlaced ? textBold : null,
      textItalic: textPlaced ? textItalic : null,
      sleeveLength,
      addOns: (product?.addOns ?? [])
        .filter(a => selectedAddOns[a.id])
        .map(a => ({ id: a.id, label: a.label })),
    };
    // Customization charge — calculated here so BOTH the save and cart paths
    // store the same value. ₹20 base + ₹1 per sq-inch of logo/text area.
    const logoW = logoSize * 0.376;
    const logoAreaSqIn = logoPlaced && logoPreview ? Math.ceil(logoW * logoW * 0.75) : 0;
    const textH = textFontSize * (22 / 1024);
    const textW = Math.max(1, textInput.length) * textFontSize * 0.55 * (22 / 1024);
    const textAreaSqIn = textPlaced ? Math.ceil(textH * textW) : 0;
    const hasLogoOrText = !!(logoPreview || textPlaced);
    const customizationCharge = hasLogoOrText ? (20 + logoAreaSqIn + textAreaSqIn) : 0;

    return {
      productId:id, name:designName||`${product?.name} Custom`,
      color:primaryColor, size:effectiveSize,
      partsEnabled:{qty:effectiveQty,zoneColors,primaryColor,kdDesignId:activeKashaDesign?.id||"",activePrintId,sleeveLength},
      canvasData:JSON.stringify({canvasJSON:JSON.stringify((fc as any).toJSON(["data"])),textureUrl:lastTextureUrlRef.current,primaryColor,kdDesignId:activeKashaDesign?.id||"",zoneColors,activePrintId,allOverPrintId,sleeveLength,productSku:product?.sku||"",skuProductType,customizationType:customizationType||(skuProductType==="print"?"print":skuProductType==="pattern"?"pattern":"color"),patternSubMode:patternSubMode||"",colorSubMode:colorSubMode||"",patColorA,patColorB}),
      previewImageUrl: views.front, // 3-D front render — used as cart/checkout/order thumbnail
      frontImageUrl:   views.front, // 3-D front render — print-ready for production
      backImageUrl:    views.back,
      sideImageUrl:    views.side,
      designSpec,
      customizationCharge,
    };
  };
  const saveMut=useMutation({
    mutationFn:async()=>{
      const payload=await buildPayload();
      const existingId=sessionCustomizationIdRef.current??existing?.id??null;
      if(existingId){
        return apiFetch(`/api/customizations/${existingId}`,{method:"PUT",body:JSON.stringify(payload)});
      }
      const created=await apiFetch("/api/customizations",{method:"POST",body:JSON.stringify(payload)});
      if(created?.id) sessionCustomizationIdRef.current=created.id;
      return created;
    },
    onSuccess:()=>{toast({title:"Design Saved ✓",description:(<span>Design saved. <Link href="/profile?tab=designs" style={{textDecoration:"underline",fontWeight:600}}>View Bespoke Designs →</Link></span>)});queryClient.invalidateQueries({queryKey:["customization",id]});},
    onError:(e:any)=>toast({title:"Error",description:e.message,variant:"destructive"}),
  });
  const [cartAdded, setCartAdded] = useState(false);
  const cartMut=useMutation({
    mutationFn:async()=>{
      // buildPayload now computes and includes customizationCharge so both save
      // and cart paths always store the correct fee.
      const payload=await buildPayload();
      const totalQty=Object.values(sizeQty).reduce((a,b)=>a+b,0);
      const hasCustomMeasurements=Object.values(customMeasurements).some(v=>v.trim()!=="");
      // When the customer used custom measurements (no standard size selected),
      // qty defaults to 1 and size is "Custom Fit".
      const effectiveQty=totalQty>0 ? totalQty : (hasCustomMeasurements ? 1 : qty);
      const effectiveSize=hasCustomMeasurements && totalQty===0
        ? "Custom Fit"
        : (Object.entries(sizeQty).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1])[0]?.[0]||size);
      // Build the measurements payload — only include filled-in fields.
      const measurementsPayload=hasCustomMeasurements
        ? Object.fromEntries(Object.entries(customMeasurements).filter(([,v])=>v.trim()!==""))
        : undefined;
      // Always create a FRESH customization record for each cart addition — never
      // reuse an existing ID. This ensures every cart item has its own independent,
      // immutable thumbnail snapshot and is never overwritten by later changes.
      let customizationId: number|null = null;
      try {
        const cust=await apiFetch("/api/customizations",{method:"POST",body:JSON.stringify(payload)});
        customizationId=cust.id??null;
      } catch { /* non-blocking — cart add will still proceed */ }
      return apiFetch("/api/cart/items",{method:"POST",body:JSON.stringify({
        productId:id,
        customizationId,
        quantity:effectiveQty,
        size:effectiveSize,
        ...(measurementsPayload ? {measurements:measurementsPayload} : {}),
      })});
    },
    onSuccess:()=>{
      setCartAdded(true);
      queryClient.invalidateQueries({queryKey:getGetCartQueryKey()});
      toast({title:"Added to Cart ✓",description:"Your custom design has been added to your cart."});
      openCart();
    },
    onError:(e:any)=>toast({title:"Could not add to cart",description:e.message,variant:"destructive"}),
  });

  const handleAddToCart=()=>{
    if(!user){setLocation("/sign-in?redirect_url="+encodeURIComponent(window.location.pathname+window.location.search));return;}
    const totalQty=Object.values(sizeQty).reduce((a,b)=>a+b,0);
    const hasCustomMeasurements=Object.values(customMeasurements).some(v=>v.trim()!=="");
    if(totalQty===0&&!hasCustomMeasurements){
      toast({title:"Select a size",description:"Please choose at least one size and quantity before adding to cart, or fill in your custom measurements.",variant:"destructive"});
      setStep(4);
      return;
    }
    cartMut.mutate();
  };

  const handleSave=()=>{
    if(!user){setLocation("/sign-in?redirect_url="+encodeURIComponent(window.location.pathname+window.location.search));return;}
    saveMut.mutate();
  };

  // ── Style helpers ────────────────────────────────────────────────────────
  // Section label — small-caps with gold bottom border
  const sb: React.CSSProperties = {
    fontSize:"10px", letterSpacing:".12em", textTransform:"uppercase",
    color:V.mu, fontWeight:600, marginBottom:"8px",
    paddingBottom:"6px", borderBottom:`1px solid rgba(26,26,24,0.07)`,
    fontFamily:"'Jost', sans-serif",
  };
  // Stronger section heading for typeMode blocks
  const sbT: React.CSSProperties = {
    fontSize:"13px", letterSpacing:".07em", textTransform:"uppercase",
    color: V.tx, fontWeight:700, marginBottom:"10px",
    paddingBottom:"7px", borderBottom:`1.5px solid rgba(201,168,76,0.22)`,
    fontFamily:"'Jost', sans-serif",
  };

  const swatch=(hex:string, selected:boolean, onClick:()=>void, title?:string, size?:number)=>{
    const sz=size??30;
    return (
    <button key={hex} onClick={onClick} title={title||hex} style={{
      width:sz,height:sz,borderRadius:"50%",cursor:"pointer",padding:0,flexShrink:0,
      background:hex==="transparent"?"none":hex,
      border:selected?`2.5px solid ${V.ac}`:`1.5px solid rgba(26,26,24,0.12)`,
      outline:selected?`3px solid rgba(201,168,76,0.25)`:undefined,
      outlineOffset:selected?"1px":undefined,
      transition:"all 0.25s cubic-bezier(0.16,1,0.3,1)",
      boxShadow:selected?`0 0 0 1px ${V.ac}`:`inset 0 0 0 1px rgba(0,0,0,.08)`,
    }}/>
  );};

  // ── History helpers ───────────────────────────────────────────────────────
  const saveHistory = useCallback(() => {
    const fc = fcRef.current; if (!fc) return;
    const json = JSON.stringify((fc as any).toJSON(["data"]));
    historyStack.current = historyStack.current.slice(0, historyIdx.current + 1);
    historyStack.current.push(json);
    historyIdx.current = historyStack.current.length - 1;
    setCanUndo(historyIdx.current > 0);
    setCanRedo(false);
  }, []);

  const undoCanvas = useCallback(async () => {
    const fc = fcRef.current; if (!fc || historyIdx.current <= 0) return;
    historyIdx.current--;
    const json = historyStack.current[historyIdx.current];
    if (!json) return;
    await (fc as any).loadFromJSON(JSON.parse(json));
    fc.renderAll(); syncTexture();
    setCanUndo(historyIdx.current > 0);
    setCanRedo(true);
  }, [syncTexture]);

  const redoCanvas = useCallback(async () => {
    const fc = fcRef.current;
    if (!fc || historyIdx.current >= historyStack.current.length - 1) return;
    historyIdx.current++;
    const json = historyStack.current[historyIdx.current];
    if (!json) return;
    await (fc as any).loadFromJSON(JSON.parse(json));
    fc.renderAll(); syncTexture();
    setCanUndo(true);
    setCanRedo(historyIdx.current < historyStack.current.length - 1);
  }, [syncTexture]);

  // Camera view effect
  useEffect(() => {
    const mv: any = mvRef.current; if (!mv) return;
    const orbits: Record<CameraView, string> = {
      front:          "0deg 75deg 2.5m",
      back:           "180deg 75deg 2.5m",
      right:          "90deg 75deg 2.5m",
      left:           "-90deg 75deg 2.5m",
      "collar-center": "0deg 52deg 1.9m",
      "collar-left":   "-40deg 58deg 1.9m",
      "collar-right":  "40deg 58deg 1.9m",
    };
    mv.cameraOrbit = orbits[cameraView] ?? "0deg 75deg 2.5m";
  }, [cameraView, modelLoaded]);

  // Imperatively stop auto-rotate when entering step 3 (logo/text)
  useEffect(() => {
    const mv: any = mvRef.current; if (!mv || !modelLoaded) return;
    if (step === 3) {
      mv.removeAttribute("auto-rotate");
      mv.removeAttribute("auto-rotate-delay");
    }
  }, [step, modelLoaded]);

  // ── Tool definitions ──────────────────────────────────────────────────────
  const TOOLS = [
    { id: "products",  icon: "👕", label: "Products"  },
    { id: "colors",    icon: "🎨", label: "Colors"    },
    { id: "prints",    icon: "◈",  label: "Prints"    },
    { id: "patterns",  icon: "✦",  label: "Patterns"  },
    { id: "text",      icon: "Aa", label: "Text"      },
    { id: "image",     icon: "🖼",  label: "Logo"      },
    { id: "order",     icon: "🛒", label: "Order"     },
  ] as const;

  const CAMERA_VIEWS = [
    { id: "front", label: "Front" },
    { id: "back",  label: "Back"  },
    { id: "right", label: "Right" },
    { id: "left",  label: "Left"  },
  ] as const;

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading && !isTypeMode) return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:V.bg,gap:16}}>
      <div style={{
        width:40,height:40,borderRadius:"50%",
        border:`2px solid ${V.bd}`,
        borderTopColor:V.ac,
        animation:"spin .9s linear infinite",
      }}/>
      <p style={{fontFamily:"'Jost',sans-serif",fontSize:11,color:V.mu,letterSpacing:".1em",textTransform:"uppercase"}}>Loading Studio…</p>
    </div>
  );
  if (!product && !isTypeMode) return null;


  const totalQty = Object.values(sizeQty).reduce((a,b)=>a+b,0);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:V.bg,color:V.tx,fontFamily:"'Jost', sans-serif",overflow:"hidden"}}>

      {/* ── TOP ACTION BAR ─────────────────────────────────────────────── */}
      <header style={{
        display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:isXs ? "0 12px" : "0 20px",height:isXs ? 48 : 56,flexShrink:0,zIndex:50,
        background:"rgba(250,250,247,0.97)",
        backdropFilter:"blur(20px)",
        WebkitBackdropFilter:"blur(20px)",
        borderBottom:`1px solid rgba(201,168,76,0.15)`,
        boxShadow:"0 2px 20px rgba(26,26,24,0.05)",
      }}>
        {/* Left: back + logo */}
        <div style={{display:"flex",alignItems:"center",gap:isXs ? 8 : 14,minWidth:180}}>
          <button type="button" onClick={handleStudioBack} style={{
            color:V.mu,fontSize:11,textDecoration:"none",
            display:"flex",alignItems:"center",gap:5,
            padding:isXs ? "5px 8px" : "5px 12px",borderRadius:40,
            border:`1px solid rgba(201,168,76,0.25)`,
            transition:"all 0.25s",fontWeight:500,letterSpacing:".05em",
            fontFamily:"'Jost',sans-serif",background:"transparent",cursor:"pointer",
          }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=V.ac;e.currentTarget.style.background=V.aclt;}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(201,168,76,0.25)";e.currentTarget.style.background="transparent";}}>
            <span style={{fontSize:isXs ? 16 : 13,lineHeight:1}}>←</span>
            <span>Back</span>
          </button>
          <div style={{width:1,height:18,background:`rgba(26,26,24,0.1)`}}/>
          <Link href="/" style={{display:"inline-flex",alignItems:"center"}}>
            <img
              src="https://pub-15ec2d2670b445b79fe9a23aa5c7f2f0.r2.dev/Kasha-logo-01.jpeg"
              alt="KA.SHA — Home"
              style={{height:isXs ? 22 : 28,width:"auto",objectFit:"contain"}}
            />
          </Link>
        </div>

        {/* Center: studio name — hidden on very small screens to avoid overlap */}
        <div style={{display:"flex",alignItems:"center",gap:6}} className="studio-title-center">
          <span style={{
            fontFamily:"'Jost',sans-serif",fontSize:15,letterSpacing:".14em",
            textTransform:"uppercase",color:V.mu,fontWeight:500,
          }}>
            {isTypeMode
              ? (garmentType === "solid" ? "Solid Studio"
                 : garmentType === "pattern" ? "Pattern Studio"
                 : "Print Studio")
              : isQuickMode ? "Quick Personalisation" : "Bespoke Design Studio"}
          </span>
        </div>

        {/* Right: design name + save + order */}
        <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0,justifyContent:"flex-end",flex:"0 0 auto"}}>
          <input
            value={designName}
            onChange={e=>setDesignName(e.target.value)}
            placeholder="Name your design…"
            className="design-name-input"
            style={{
              padding:"6px 12px",
              background:V.sf2,border:`1.5px solid ${V.bd}`,
              borderRadius:40,color:V.tx,fontSize:11,
              outline:"none",width:130,
              fontFamily:"'Jost',sans-serif",letterSpacing:".02em",
              transition:"border-color 0.2s",
            }}
            onFocus={e=>e.target.style.borderColor=V.ac}
            onBlur={e=>e.target.style.borderColor=V.bd}
          />
          {!isTypeMode && (
            <Show when="signed-in">
              <button
                onClick={isMd ? ()=>setShowMobileSaveSheet(true) : handleSave}
                disabled={saveMut.isPending}
                style={{
                  padding:"7px 16px",borderRadius:40,
                  border:`1px solid rgba(201,168,76,0.35)`,
                  background:"transparent",cursor:"pointer",
                  fontFamily:"'Jost',sans-serif",fontSize:11,fontWeight:500,
                  letterSpacing:".06em",textTransform:"uppercase",
                  color:V.tx,transition:"all 0.25s",
                  opacity:saveMut.isPending?.6:1,
                  whiteSpace:"nowrap",
                }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=V.ac;e.currentTarget.style.background=V.aclt;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(201,168,76,0.35)";e.currentTarget.style.background="transparent";}}>
                {saveMut.isPending?"Saving…":"Save"}
              </button>
            </Show>
          )}
          {isTypeMode && (
            <Link href="/products" style={{
              padding:"8px 20px",borderRadius:40,
              border:`1px solid ${V.ac}`,background:"transparent",
              fontFamily:"'Jost',sans-serif",fontSize:11,fontWeight:500,
              letterSpacing:".06em",textTransform:"uppercase",
              color:V.tx,textDecoration:"none",
              transition:"all 0.25s",display:"flex",alignItems:"center",gap:6,
            }}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=V.aclt;}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="transparent";}}>
              Browse →
            </Link>
          )}
        </div>
      </header>

      {/* ── PROGRESS TRACKER BAR ─────────────────────────────────────────── */}
      <div style={{
        display:"flex",alignItems:"center",height:isXs ? 44 : 56,flexShrink:0,
        padding:isXs ? "0 10px" : "0 24px",gap:0,
        background:"#fff",
        borderBottom:`1.5px solid rgba(201,168,76,0.22)`,
        boxShadow:"0 2px 10px rgba(26,26,24,0.07)",
      }}>
        {([
          {n:1,label:"Style"},
          {n:2,label:"Design"},
          {n:3,label:"Logo & Text"},
          {n:4,label:"Sizing"},
        ] as const).filter(s => !(_fromSource==="saved" && s.n===1) && !(isWholeGarment && s.n===3)).map((s,i)=>{
          const active=step===s.n; const done=step>s.n;
          // Style step is locked when the user arrived with a pre-selected style
          // (e.g. from a product page). Clicking it does nothing to prevent
          // accidentally switching styles and breaking the current design.
          const locked = s.n===1 && _entryStyle!==null;
          return (
            <React.Fragment key={s.n}>
              {i>0&&<div style={{flex:1,height:2,borderRadius:2,background:done?V.ac:"rgba(26,26,24,0.14)",transition:"background .3s",margin:"0 4px"}}/>}
              <div onClick={locked?undefined:()=>setStep(s.n)} style={{
                display:"flex",alignItems:"center",gap:7,
                cursor:locked?"default":"pointer",
                padding:"5px 10px",borderRadius:99,
                background:active?V.aclt:"transparent",
                transition:"all .25s cubic-bezier(.16,1,.3,1)",
                opacity:locked?0.5:1,
              }}>
                <div style={{
                  width:isXs ? 20 : 24,height:isXs ? 20 : 24,borderRadius:"50%",flexShrink:0,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:10,fontWeight:700,
                  background:active?V.ac:done?V.ac:"#e8e4dc",
                  color:active?"#fff":done?"#fff":"#888",
                  border:`2px solid ${active||done?V.ac:"#d4cfc6"}`,
                  transition:"all .3s",
                  boxShadow:active?`0 0 0 3px ${V.aclt}`:"none",
                }}>{done?"✓":s.n}</div>
                {!isXs && (<span style={{
                  fontSize:10,fontFamily:"'Jost',sans-serif",letterSpacing:".07em",
                  textTransform:"uppercase",fontWeight:active?700:400,
                  color:active?V.tx:done?V.ac:"#999",
                  transition:"all .3s",
                }}>{s.label}</span>)}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* ── WORKSPACE ──────────────────────────────────────────────────────── */}
      <div style={{display:"flex",flex:1,overflow:"hidden",flexDirection:isMd?"column":"row"}}>

        {/* ── LEFT STEP PANEL ──────────────────────────────────────────────── */}
        <div ref={stepPanelRef} className="step-panel" style={{
          width:isMd?"100%":"40%",
          minWidth:isMd?undefined:340,
          maxWidth:isMd?undefined:560,
          height:isDesktop?"100%":undefined,
          flex:isMd?"1 1 0":"0 0 40%",
          minHeight:isMd?0:undefined,
          order:isMd?2:1,
          display:"flex",flexDirection:"column",
          borderRight:isDesktop?`1px solid rgba(26,26,24,0.07)`:undefined,
          borderTop:isMd?`1px solid rgba(201,168,76,0.15)`:undefined,
          background:V.sf,
          overflowY:"auto",
          overflowX:"hidden",
          WebkitOverflowScrolling:"touch",
          scrollbarWidth:"thin",
          scrollbarColor:`${V.cream3} transparent`,
        }}>
          {/* Panel heading */}
          <div style={{
            padding:isXs ? "10px 12px 8px" : isMd ? "12px 16px 10px" : "20px 24px 16px",flexShrink:0,
            borderBottom:`1px solid rgba(26,26,24,0.07)`,
            background:V.sf,position:"sticky",top:0,zIndex:5,
          }}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:600,color:V.tx,letterSpacing:".02em"}}>
                  {step===1&&"Choose Your Style"}
                  {step===2&&effectiveSkuType==="print"&&"Choose Your Print"}
                  {step===2&&effectiveSkuType==="pattern"&&"Customise Your Design"}
                  {step===2&&effectiveSkuType==="solid"&&"Colour & Print Options"}
                  {step===3&&"Logo & Text"}
                  {step===4&&"Sizing & Quantity"}
                </div>
                <div style={{fontSize:9,color:V.mu,letterSpacing:".1em",textTransform:"uppercase",fontFamily:"'Jost',sans-serif",marginTop:3}}>
                  {step===1&&"Start your design — choose a customisation type"}
                  {step===2&&effectiveSkuType==="print"&&"Choose prints per garment section"}
                  {step===2&&effectiveSkuType==="pattern"&&"Customise body colour and pattern design"}
                  {step===2&&effectiveSkuType==="solid"&&"Apply colours and prints to each section"}
                  {step===3&&"Upload a logo or add custom text"}
                  {step===4&&"Set sizes & quantities for your order"}
                </div>
              </div>
              {/* Clear design button */}
              <button
                onClick={()=>{
                  const fc=fcRef.current;
                  if(step===2){
                    if(effectiveSkuType==="pattern"){
                      applyPatternColors(PAT_COLOR_A_DEFAULT,PAT_COLOR_B_DEFAULT);
                    } else if(effectiveSkuType==="solid"){
                      applyPrimary(product?.defaultColor??"#ffffff");
                    }
                    clearAllOverPrint(); clearAllZonePrints(); saveHistory();
                  } else if(step===3){
                    if(fc){
                      // Explicitly remove tracked objects first (covers all Fabric text types)
                      if(textObjRef.current){fc.remove(textObjRef.current);textObjRef.current=null;}
                      if(logoObjRef.current){fc.remove(logoObjRef.current);logoObjRef.current=null;}
                      // Sweep any stray image/text objects not caught by the refs.
                      // Protect zone prints (kashaZonePrint) and KD design layers (data.tag = "__kashaKdBg__").
                      // Note: zone color Rects have type "rect" so they are naturally excluded.
                      fc.getObjects()
                        .filter((o:any)=>!o?.data?.kashaZonePrint&&!o?.data?.tag&&(o.type==="image"||o.type==="textbox"||o.type==="i-text"||o.type==="text"))
                        .forEach((o:any)=>fc.remove(o));
                      fc.renderAll(); syncTexture();
                    }
                    setLogoPreview(null); setLogoPlaced(false);
                    setTextInput(""); setTextPlaced(false);
                  } else if(step===4){
                    setSizeQty({S:0,M:0,L:0,XL:0,XXL:0});
                    setCustomMeasurements({chest:"",waist:"",hip:"",shoulder:"",length:"",sleeve:""});
                  }
                }}
                style={{
                  flexShrink:0,marginTop:3,
                  padding:"8px 16px",borderRadius:8,
                  border:"1.5px solid rgba(196,92,92,0.35)",
                  background:"transparent",cursor:"pointer",
                  fontFamily:"'Jost',sans-serif",fontSize:11,
                  fontWeight:600,letterSpacing:".08em",
                  textTransform:"uppercase" as const,
                  color:"#c45c5c",transition:"all .2s",
                  whiteSpace:"nowrap" as const,
                }}
                onMouseEnter={e=>{e.currentTarget.style.background="rgba(196,92,92,0.08)";e.currentTarget.style.borderColor="rgba(196,92,92,0.55)";}}
                onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.borderColor="rgba(196,92,92,0.3)";}}
              >{isXs ? "↺" : "↺ Reset"}</button>
            </div>
          </div>

          <div style={{padding:isXs ? "12px 14px" : isMd ? "14px 16px" : "20px 24px",display:"flex",flexDirection:"column",gap:18,overflowX:"hidden",boxSizing:"border-box" as const,minWidth:0}}>

            {/* ══════════════════ STEP 1: CHOOSE STYLE ══════════════════════ */}
            {step===1&&(
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                <div style={{fontSize:12,color:V.mu,fontFamily:"'Jost',sans-serif",lineHeight:1.75}}>
                  Select a product style to get started — you'll customise colours, prints, and add your logo in the steps ahead.
                </div>

                {/* Solid + Print */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {([
                    {id:"solid" as const, label:"Solid", thumb:"https://pub-15ec2d2670b445b79fe9a23aa5c7f2f0.r2.dev/thumbnails/Solid-t-shirt (1).png"},
                    {id:"print" as const, label:"Print",  thumb:"https://pub-15ec2d2670b445b79fe9a23aa5c7f2f0.r2.dev/thumbnails/KS1000BGP001-01.png"},
                  ]).map(s=>{
                    const sel=userStyle===s.id||(userStyle===null&&(skuProductType as string)===s.id);
                    return(
                      <div key={s.id} onClick={()=>{
                        setUserStyle(s.id);
                        setStyleTab(s.id==="print"?"print":"solid");
                        setCustomizationType(s.id==="print"?"print":null);
                        if(s.id==="print") setPrintMode("fullBody");
                        setPatternSubMode(null); setColorSubMode(null);
                        setStep(2);
                      }} style={{
                        cursor:"pointer",borderRadius:12,overflow:"hidden",
                        border:`2px solid ${sel?V.ac:V.bd}`,transition:"all .2s",
                        boxShadow:sel?`0 2px 12px rgba(201,168,76,.25)`:"none",
                      }}>
                        <div style={{
                          width:"100%",aspectRatio:"3/4",background:V.sf2,
                          display:"flex",alignItems:"center",justifyContent:"center",
                          padding:"8px 6px",boxSizing:"border-box" as const,overflow:"hidden",
                        }}>
                          <img src={s.thumb} alt={s.label} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",display:"block"}}
                            onError={e=>{(e.currentTarget as HTMLImageElement).style.opacity="0.2";}}/>
                        </div>
                        <div style={{padding:"8px 10px",background:sel?V.aclt:V.sf2}}>
                          <div style={{fontSize:10,fontFamily:"'Jost',sans-serif",fontWeight:sel?700:500,color:sel?V.ac:V.tx,letterSpacing:".06em",textTransform:"uppercase"}}>{s.label}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* KA.SHA Signature Patterns */}
                <div style={{...sb}}>KA.SHA Signature Patterns</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                  {KASHA_DESIGNS.map(d=>{
                    const sel=userStyle==="pattern"&&userChosenDesignId===d.id;
                    return(
                      <div key={d.id} onClick={()=>{
                        setUserStyle("pattern");
                        setUserChosenDesignId(d.id);
                        setStyleTab("pattern");
                        setCustomizationType("pattern");
                        setPatternSubMode("color");
                        handleSelectKashaDesign(d);
                        setStep(2);
                      }} style={{
                        cursor:"pointer",borderRadius:12,overflow:"hidden",
                        border:`2px solid ${sel?V.ac:V.bd}`,transition:"all .2s",
                        boxShadow:sel?`0 2px 12px rgba(201,168,76,.3)`:"none",
                      }}>
                        {d.thumbnail
                          ?<img src={d.thumbnail} alt={d.label} loading="eager" style={{width:"100%",aspectRatio:"1",objectFit:"cover",objectPosition:"top",display:"block"}}/>
                          :<div style={{width:"100%",aspectRatio:"1",background:V.sf2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:V.mu}}>◈</div>
                        }
                        <div style={{padding:"6px 8px",background:sel?V.aclt:V.sf2}}>
                          <div style={{fontSize:9,fontFamily:"'Jost',sans-serif",fontWeight:sel?700:500,color:sel?V.ac:V.tx,letterSpacing:".04em",textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.label}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ══════════════════ STEP 2: DESIGN ═════════════════════════════ */}
            {step===2&&(()=>{

              // ── NEW FLAT DESIGN UI (user picked a style in Step 1) ──────────
              if (userStyle !== null) {
                const isPatternMode = effectiveSkuType === "pattern";
                const isPrintMode   = effectiveSkuType === "print";

                const TargetRow = ({title,desc,showColour,colourFor,showPrint,printFor}:{
                  title:string; desc?:string;
                  showColour?:boolean; colourFor?:"all"|"base"|"pattern"|"base-body"|"collar";
                  showPrint?:boolean; printFor?:"all"|"base-body"|"collar"|"accent";
                }) => (
                  <div style={{padding:"14px 16px",borderRadius:12,border:`1.5px solid ${V.ac}`,background:V.sf2,display:"flex",flexDirection:"column",gap:10}}>
                    <div>
                      <div style={{fontFamily:"'Jost',sans-serif",fontSize:15,fontWeight:700,color:V.tx,letterSpacing:".04em",textTransform:"uppercase" as const}}>{title}</div>
                      {desc&&<div style={{fontSize:10,color:V.mu,marginTop:3,fontFamily:"'Jost',sans-serif",lineHeight:1.5}}>{desc}</div>}
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      {showColour&&(
                        <button onClick={()=>setColorModalFor(colourFor||"all")} style={{
                          flex:1,padding:"10px 0",borderRadius:8,
                          border:`1.5px solid ${V.ac}`,
                          background:V.aclt,cursor:"pointer",
                          fontFamily:"'Jost',sans-serif",fontSize:11,fontWeight:700,
                          letterSpacing:".06em",textTransform:"uppercase" as const,color:V.tx,transition:"all .2s",
                        }}
                        onMouseEnter={e=>{e.currentTarget.style.background=V.ac;}}
                        onMouseLeave={e=>{e.currentTarget.style.background=V.aclt;}}>
                          ● Colour
                        </button>
                      )}
                      {showPrint&&(
                        <button onClick={()=>setPrintModalFor(printFor||"all")} style={{
                          flex:1,padding:"10px 0",borderRadius:8,
                          border:`1.5px solid ${V.tx}`,
                          background:V.tx,cursor:"pointer",
                          fontFamily:"'Jost',sans-serif",fontSize:11,fontWeight:700,
                          letterSpacing:".06em",textTransform:"uppercase" as const,color:"#fff",transition:"all .2s",
                        }}
                        onMouseEnter={e=>{e.currentTarget.style.background=V.ac;e.currentTarget.style.borderColor=V.ac;e.currentTarget.style.color=V.tx;}}
                        onMouseLeave={e=>{e.currentTarget.style.background=V.tx;e.currentTarget.style.borderColor=V.tx;e.currentTarget.style.color="#fff";}}>
                          ❋ Print
                        </button>
                      )}
                    </div>
                  </div>
                );

                return (
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>

                    {/* Active style indicator + Change button */}
                    <div style={{display:"flex",alignItems:"center",gap:8,padding:"9px 14px",borderRadius:10,background:"rgba(201,168,76,0.07)",border:"1px solid rgba(201,168,76,0.18)"}}>
                      <span style={{fontSize:9,color:V.mu,letterSpacing:".1em",textTransform:"uppercase" as const,fontFamily:"'Jost',sans-serif"}}>Style:</span>
                      <span style={{fontSize:11,fontFamily:"'Jost',sans-serif",fontWeight:600,color:V.tx}}>
                        {isPatternMode?(KASHA_DESIGNS.find(d=>d.id===userChosenDesignId)?.label||"Pattern"):isPrintMode?"Print":"Solid"}
                      </span>
                      {/* Change Style button hidden per client request */}
                    </div>

                    {isPatternMode&&(
                      <>
                        <TargetRow title="Base Body" desc="Background body colour and all-over print" showColour colourFor="all" showPrint printFor="all"/>
                        <TargetRow title="Pattern Design" desc="Recolour accent panels, trims, collar and sleeves" showColour colourFor="base" showPrint printFor="accent"/>
                        {activeKashaDesign&&(
                          <div style={{padding:"10px 14px",borderRadius:10,background:V.sf2,border:`1px solid ${V.bd}`,display:"flex",gap:10,alignItems:"center"}}>
                            {(product?.thumbnailUrl||activeKashaDesign.thumbnail)&&<img src={product?.thumbnailUrl||activeKashaDesign.thumbnail||undefined} alt="" style={{width:36,height:36,objectFit:"cover",objectPosition:"top",borderRadius:6,border:`1px solid ${V.bd}`,flexShrink:0}}/>}
                            <div style={{flex:1}}>
                              <div style={{fontSize:9,color:V.mu,letterSpacing:".08em",textTransform:"uppercase" as const,fontFamily:"'Jost',sans-serif"}}>Active design</div>
                              <div style={{fontSize:11,fontFamily:"'Jost',sans-serif",fontWeight:600,color:V.tx,marginTop:2}}>{activeKashaDesign.label}</div>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {(isPrintMode||(!isPatternMode&&!isPrintMode))&&(
                      <div style={{display:"flex",gap:8,padding:"9px 12px",borderRadius:8,background:"rgba(201,168,76,0.06)",border:"1px solid rgba(201,168,76,0.22)"}}>
                        <span style={{fontSize:14,flexShrink:0,marginTop:1}}>⚠️</span>
                        <p style={{margin:0,fontFamily:"'Jost',sans-serif",fontSize:10,lineHeight:1.6,color:V.tx,letterSpacing:".02em"}}>
                          <strong>Tip:</strong> If you've applied a <strong>Print</strong> and want to change the <strong>Base Body</strong> or <strong>Collar Color</strong>, click <strong>↺ Reset</strong> first — then select your color and reapply the print if needed.
                        </p>
                      </div>
                    )}

                    {isPrintMode&&!isWholeGarment&&(
                      <>
                        <TargetRow title="Full Body" desc="Apply a premium print to the entire garment" showPrint printFor="all"/>
                        <TargetRow title="Base Body" desc="Colour or print the body, excluding the collar" showColour colourFor="base-body" showPrint printFor="base-body"/>
                        <TargetRow title="Collar" desc="Collar accent colour or print" showColour colourFor="collar" showPrint printFor="collar"/>
                      </>
                    )}

                    {isPrintMode&&isWholeGarment&&(
                      <TargetRow title="Full Garment" desc="Apply a premium print to the entire garment" showPrint printFor="all"/>
                    )}

                    {!isPatternMode&&!isPrintMode&&!isWholeGarment&&(
                      <>
                        <TargetRow title="Full Body" desc="Colour or print the entire garment" showColour colourFor="all" showPrint printFor="all"/>
                        <TargetRow title="Base Body" desc="Body colour, excluding the collar" showColour colourFor="base-body" showPrint printFor="base-body"/>
                        <TargetRow title="Collar" desc="Collar accent colour or print" showColour colourFor="collar" showPrint printFor="collar"/>
                      </>
                    )}

                    {!isPatternMode&&!isPrintMode&&isWholeGarment&&(
                      <TargetRow title="Full Garment" desc="Colour or print the entire garment — a single colour or print applies to the whole piece" showColour colourFor="all" showPrint printFor="all"/>
                    )}

                    {isWholeGarment&&product?.addOns&&product.addOns.length>0&&(
                      <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
                        <div style={{fontFamily:"'Jost',sans-serif",fontSize:11,fontWeight:700,color:V.tx,letterSpacing:".08em",textTransform:"uppercase" as const}}>Add-Ons</div>
                        {product.addOns.map(a=>{
                          const isYes=!!selectedAddOns[a.id];
                          return (
                            <div key={a.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:10,border:`1.5px solid ${isYes?V.ac:V.bd}`,background:isYes?V.aclt:V.sf2}}>
                              {a.imageUrl&&<img src={a.imageUrl} alt={a.label} style={{width:40,height:40,objectFit:"cover",borderRadius:6,border:`1px solid ${V.bd}`,flexShrink:0}}/>}
                              <div style={{flex:1,fontFamily:"'Jost',sans-serif",fontSize:12,fontWeight:600,color:V.tx}}>{a.label}</div>
                              <div style={{display:"flex",gap:4}}>
                                {(["Yes","No"] as const).map(opt=>{
                                  const isSel=opt==="Yes"?isYes:!isYes;
                                  return (
                                    <button key={opt} onClick={()=>setSelectedAddOns(s=>({...s,[a.id]:opt==="Yes"}))} style={{
                                      padding:"6px 14px",borderRadius:99,fontSize:10,fontWeight:700,cursor:"pointer",
                                      fontFamily:"'Jost',sans-serif",letterSpacing:".06em",textTransform:"uppercase" as const,
                                      border:isSel?`1.5px solid ${V.ac}`:`1px solid ${V.bd}`,
                                      background:isSel?V.ac:"transparent",
                                      color:isSel?V.tx:V.mu,transition:"all .2s",
                                    }}>{opt}</button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                  </div>
                );
              }

              // ── LEGACY: direct product-page access (no style chosen in Step 1) ──
              // Determine what "mode" we are actually rendering
              const effectiveCustType = customizationType ?? (skuProductType==="print"?"print":skuProductType==="pattern"?"pattern":null);
              const isPatternMode = skuProductType==="pattern" || effectiveCustType==="pattern";
              const isPrintMode   = skuProductType==="print"   || effectiveCustType==="print";
              const isColorMode   = skuProductType==="solid"   && effectiveCustType==="color";

              // Back button helper
              const BackBtn = ({label,onClick:oc}:{label:string,onClick:()=>void})=>(
                <button onClick={oc} style={{
                  display:"flex",alignItems:"center",gap:6,marginBottom:4,
                  background:"none",border:"none",cursor:"pointer",padding:0,
                  fontFamily:"'Jost',sans-serif",fontSize:10,color:V.mu,letterSpacing:".06em",textTransform:"uppercase",
                }}>
                  ← {label}
                </button>
              );

              // Print gallery (shared between print-product and pattern→print sub-mode)
              // Click any thumbnail → immediately apply all-over
              const PrintGallery = ()=>{
                const gp=visiblePatterns.filter(p=>p.label.startsWith("GP"));
                const gpVisible=gp.slice(0,printGalleryLimit);
                const hasMore=printGalleryLimit<gp.length;
                return(
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    <div style={{...sb}}>Choose your print</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                      {gpVisible.map(p=>{
                        const active=allOverPrintId===p.id;
                        return(
                          <div key={p.id} onClick={()=>{applyAllOverPrint(p);saveHistory();}} style={{
                            borderRadius:10,overflow:"hidden",cursor:"pointer",
                            border:`2px solid ${active?V.ac:V.bd}`,transition:"all .2s",
                            boxShadow:active?`0 2px 12px rgba(201,168,76,.3)`:"none",
                            background:"rgba(0,0,0,0.06)",
                          }}>
                            <img src={patternUrl(p.file)} alt={p.label} loading="lazy" decoding="async" fetchPriority="low"
                              style={{width:"100%",aspectRatio:"1",objectFit:"cover",display:"block"}}
                              onError={e=>{(e.currentTarget as HTMLImageElement).style.display="none";}}/>
                            <div style={{padding:"5px 8px",background:active?V.aclt:V.sf2}}>
                              <div style={{fontSize:9,fontFamily:"'Jost',sans-serif",letterSpacing:".06em",textTransform:"uppercase",color:active?V.ac:V.mu,fontWeight:active?700:400,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.label}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {hasMore&&(
                      <button onClick={()=>setPrintGalleryLimit(l=>l+12)} style={{
                        padding:"8px 0",borderRadius:99,border:`1px solid ${V.bd}`,
                        background:"transparent",color:V.mu,fontSize:10,fontWeight:500,
                        cursor:"pointer",fontFamily:"'Jost',sans-serif",letterSpacing:".04em",
                      }}>Load more ({gp.length-printGalleryLimit} remaining)</button>
                    )}
                    {allOverPrintId&&(
                      <button onClick={()=>{clearAllOverPrint();clearAllZonePrints();saveHistory();}} style={{
                        padding:"7px 0",borderRadius:99,border:`1px solid rgba(196,92,92,.35)`,
                        background:"transparent",color:"#c45c5c",fontSize:10,fontWeight:500,
                        cursor:"pointer",fontFamily:"'Jost',sans-serif",letterSpacing:".04em",
                      }}>✕ Remove print</button>
                    )}
                  </div>
                );
              };

              // KA.SHA design gallery + recolour (shared)
              // Renders a design card with thumbnail
              const DesignCard = ({d}:{d:typeof KASHA_DESIGNS[number]})=>{
                const sel=activeKashaDesign?.id===d.id;
                const thumb=d.thumbnail||(d.zones?.front||undefined);
                return (
                  <div onClick={()=>handleSelectKashaDesign(d)} style={{
                    borderRadius:10,overflow:"hidden",cursor:"pointer",
                    border:`2px solid ${sel?V.ac:V.bd}`,transition:"all .2s",
                    boxShadow:sel?`0 2px 12px rgba(201,168,76,.3)`:"none",
                  }}>
                    {thumb
                      ? <img src={thumb} alt={d.label} loading="eager" decoding="async"
                          style={{width:"100%",aspectRatio:"1",objectFit:"cover",objectPosition:"top",display:"block"}}/>
                      : <div style={{width:"100%",aspectRatio:"1",background:V.sf2,display:"flex",alignItems:"center",justifyContent:"center",color:V.mu,fontSize:24}}>◈</div>
                    }
                    <div style={{padding:"6px 10px",background:sel?V.aclt:V.sf2}}>
                      <div style={{fontSize:10,fontFamily:"'Jost',sans-serif",fontWeight:600,color:sel?V.ac:V.tx}}>{d.label}</div>
                    </div>
                  </div>
                );
              };

              const PatternGallery = ()=>(
                <div style={{display:"flex",flexDirection:"column",gap:14}}>

                  {/* ── 1. RECOLOUR FIRST ───────────────────────────────── */}
                  {activeKashaDesign&&(
                    <div style={{display:"flex",flexDirection:"column",gap:10,padding:"14px",borderRadius:12,background:V.sf2,border:`1px solid ${V.bd}`}}>
                      <div style={{...sbT}}>Recolour your pattern design</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <div>
                          <div style={{fontSize:9,color:V.mu,letterSpacing:".06em",fontFamily:"'Jost',sans-serif",marginBottom:4}}>DARK TONES</div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>{DARK_SWATCHES.map(h=>swatch(h,patColorA===h,()=>setPatColorA(h)))}</div>
                        </div>
                        <div>
                          <div style={{fontSize:9,color:V.mu,letterSpacing:".06em",fontFamily:"'Jost',sans-serif",marginBottom:4}}>LIGHT TONES</div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>{LIGHT_SWATCHES.map(h=>swatch(h,patColorB===h,()=>setPatColorB(h)))}</div>
                        </div>
                      </div>
                      <button onClick={()=>applyPatternColors(patColorA,patColorB)} disabled={patRecoloring} style={{padding:"9px 16px",borderRadius:8,border:"none",cursor:"pointer",background:V.ac,color:V.tx,fontFamily:"'Jost',sans-serif",fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",opacity:patRecoloring?.6:1,transition:"all .2s"}}>{patRecoloring?"Applying…":"✦ Apply Colours"}</button>
                      <div style={{height:1,background:V.bd,margin:"2px 0"}}/>
                      <div style={{fontSize:9,color:V.mu,letterSpacing:".06em",fontFamily:"'Jost',sans-serif"}}>BODY COLOUR</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {MAIN_PALETTE.map(h=>swatch(h,primaryColor===h,()=>applyPrimary(h)))}
                      </div>
                      <button onClick={()=>setColorModalFor("base")} style={{padding:"7px 14px",borderRadius:8,border:`1px solid ${V.ac}`,background:"transparent",cursor:"pointer",fontFamily:"'Jost',sans-serif",fontSize:9,fontWeight:600,letterSpacing:".07em",textTransform:"uppercase",color:V.ac,transition:"all .2s"}}
                        onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=V.aclt;}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="transparent";}}>⊕ Advanced Body Colour</button>
                      <button onClick={()=>{const fc=fcRef.current;if(fc){clearKashaDesign(fc);syncTexture();}setActiveKashaDesign(null);}} style={{padding:"7px 16px",borderRadius:8,border:`1px solid ${V.bd}`,cursor:"pointer",background:"transparent",color:V.mu,fontFamily:"'Jost',sans-serif",fontSize:10}}>✕ Remove design</button>
                    </div>
                  )}

                  {/* ── 2. SIGNATURE DESIGNS ────────────────────────────── */}
                  {skuProductType==="pattern" ? (
                    /* Pattern SKU product: locked to assigned design; toggle reveals others */
                    <>
                      {!showOtherDesigns ? (
                        <button onClick={()=>setShowOtherDesigns(true)} style={{
                          padding:"10px 16px",borderRadius:10,cursor:"pointer",
                          border:`1.5px solid rgba(201,168,76,0.4)`,background:"transparent",
                          fontFamily:"'Jost',sans-serif",fontSize:10,fontWeight:600,
                          letterSpacing:".07em",textTransform:"uppercase",color:V.ac,
                          transition:"all .2s",textAlign:"left",
                        }}
                        onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=V.aclt;}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="transparent";}}>
                          ◈ Choose other KA.SHA signature designs
                        </button>
                      ):(
                        <div style={{display:"flex",flexDirection:"column",gap:10}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                            <div style={{...sb}}>KA.SHA signature designs</div>
                            <button onClick={()=>setShowOtherDesigns(false)} style={{padding:"3px 10px",borderRadius:6,border:`1px solid ${V.bd}`,background:"transparent",cursor:"pointer",fontSize:10,color:V.mu,fontFamily:"'Jost',sans-serif"}}>✕ Close</button>
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,maxHeight:280,overflowY:"auto",paddingRight:4}}>
                            {KASHA_DESIGNS.filter(d=>d.id!==activeKashaDesign?.id).map(d=><DesignCard key={d.id} d={d}/>)}
                          </div>
                        </div>
                      )}
                    </>
                  ):(
                    /* Studio / solid → pattern: always show full gallery */
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      <div style={{...sb}}>KA.SHA signature designs</div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
                        {KASHA_DESIGNS.map(d=><DesignCard key={d.id} d={d}/>)}
                      </div>
                    </div>
                  )}
                </div>
              );

              return (
                <div style={{display:"flex",flexDirection:"column",gap:18}}>

                  {/* ── PRINT product or print customisation type ─────────── */}
                  {isPrintMode&&!isPatternMode&&(
                    <PrintGallery/>
                  )}

                  {/* ── PATTERN product or pattern customisation type ──────── */}
                  {isPatternMode&&(
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>

                      {/* Sub-mode chooser */}
                      {patternSubMode===null&&(
                        <>
                          <div style={{fontSize:12,color:V.mu,fontFamily:"'Jost',sans-serif",lineHeight:1.6}}>
                            How would you like to customise the pattern?
                          </div>
                          {([
                            {id:"color" as const, icon:"◼", label:"Colour Customisation", desc:"Recolour the pattern using our curated palette"},
                            {id:"print" as const, icon:"❋", label:"Print Overlay",        desc:"Apply a premium print across the pattern panels"},
                          ]).map(c=>{
                            return (
                              <div key={c.id} onClick={()=>{
                                setPatternSubMode(c.id);
                                if(c.id==="print"){setStyleTab("print");setPrintMode("fullBody");}
                                else{setStyleTab("pattern");}
                              }} style={{
                                display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:12,cursor:"pointer",
                                border:`1.5px solid ${V.bd}`,background:"transparent",transition:"all .25s cubic-bezier(.16,1,.3,1)",
                              }}
                              onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor="rgba(201,168,76,0.5)";(e.currentTarget as HTMLElement).style.background=V.sf2;}}
                              onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=V.bd;(e.currentTarget as HTMLElement).style.background="transparent";}}>
                                <div style={{width:40,height:40,borderRadius:9,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,background:V.sf2,border:`1px solid ${V.bd}`,color:V.mu}}>{c.icon}</div>
                                <div style={{flex:1}}>
                                  <div style={{fontFamily:"'Jost',sans-serif",fontSize:13,fontWeight:600,color:V.tx}}>{c.label}</div>
                                  <div style={{fontSize:10,color:V.mul,marginTop:2,fontFamily:"'Jost',sans-serif"}}>{c.desc}</div>
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}

                      {/* Pattern → colour recolour */}
                      {patternSubMode==="color"&&(
                        <>
                          <BackBtn label="Back to options" onClick={()=>setPatternSubMode(null)}/>
                          <PatternGallery/>
                        </>
                      )}

                      {/* Pattern → print overlay */}
                      {patternSubMode==="print"&&(
                        <>
                          <BackBtn label="Back to options" onClick={()=>setPatternSubMode(null)}/>
                          <PrintGallery/>
                        </>
                      )}
                    </div>
                  )}

                  {/* ── SOLID product → colour customisation ──────────────── */}
                  {isColorMode&&(
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>

                      {/* Sub-mode chooser: full body or parts */}
                      {colorSubMode===null&&(
                        <>
                          <div style={{fontSize:12,color:V.mu,fontFamily:"'Jost',sans-serif",lineHeight:1.6}}>
                            Apply colour to the full garment or customise individual zones?
                          </div>
                          {([
                            {id:"full" as const, icon:"◼", label:"Full Body Colour", desc:"One colour applied evenly across the whole garment"},
                            {id:"parts" as const, icon:"◩", label:"Parts Colour",   desc:"Choose different colours for collar, sleeves & body"},
                          ]).map(c=>{
                            return (
                              <div key={c.id} onClick={()=>setColorSubMode(c.id)} style={{
                                display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:12,cursor:"pointer",
                                border:`1.5px solid ${V.bd}`,background:"transparent",transition:"all .25s cubic-bezier(.16,1,.3,1)",
                              }}
                              onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor="rgba(201,168,76,0.5)";(e.currentTarget as HTMLElement).style.background=V.sf2;}}
                              onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=V.bd;(e.currentTarget as HTMLElement).style.background="transparent";}}>
                                <div style={{width:40,height:40,borderRadius:9,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,background:V.sf2,border:`1px solid ${V.bd}`,color:V.mu}}>{c.icon}</div>
                                <div style={{flex:1}}>
                                  <div style={{fontFamily:"'Jost',sans-serif",fontSize:13,fontWeight:600,color:V.tx}}>{c.label}</div>
                                  <div style={{fontSize:10,color:V.mul,marginTop:2,fontFamily:"'Jost',sans-serif"}}>{c.desc}</div>
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}

                      {/* Full body colour */}
                      {colorSubMode==="full"&&(
                        <>
                          <BackBtn label="Back to colour options" onClick={()=>setColorSubMode(null)}/>
                          <div style={{display:"flex",flexDirection:"column",gap:12}}>
                            <div style={{...sb}}>Body colour</div>
                            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                              {MAIN_PALETTE.map(h=>swatch(h,primaryColor===h,()=>applyPrimary(h)))}
                            </div>
                            <button onClick={()=>setColorModalFor("base")} style={{marginTop:4,padding:"9px 16px",borderRadius:8,border:`1px solid ${V.ac}`,background:"transparent",cursor:"pointer",fontFamily:"'Jost',sans-serif",fontSize:10,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:V.ac,transition:"all .2s"}}
                              onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=V.aclt;}}
                              onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="transparent";}}>
                              ⊕ Advanced Colour Picker
                            </button>
                          </div>
                        </>
                      )}

                      {/* Parts colour */}
                      {colorSubMode==="parts"&&(
                        <>
                          <BackBtn label="Back to colour options" onClick={()=>setColorSubMode(null)}/>
                          <div style={{display:"flex",flexDirection:"column",gap:12}}>
                            <div style={{...sb}}>Base colour</div>
                            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                              {MAIN_PALETTE.map(h=>swatch(h,primaryColor===h,()=>applyPrimary(h)))}
                            </div>
                            <div style={{...sb,marginTop:8}}>Zone colours</div>
                            <div style={{display:"flex",flexDirection:"column",gap:8}}>
                              {(["collar","leftSleeve","rightSleeve"] as const).filter(z=>zoneColors[z]!==undefined).map(z=>{
                                const label=z==="collar"?"Collar":z==="leftSleeve"?"Left Sleeve":"Right Sleeve";
                                return (
                                  <div key={z} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:10,background:V.sf2,border:`1px solid ${V.bd}`}}>
                                    <div style={{width:22,height:22,borderRadius:"50%",background:zoneColors[z as keyof typeof zoneColors]||primaryColor,border:`1.5px solid ${V.bd}`,flexShrink:0}}/>
                                    <span style={{flex:1,fontSize:11,fontFamily:"'Jost',sans-serif",color:V.tx,letterSpacing:".04em"}}>{label}</span>
                                    <button onClick={()=>setColorModalFor(z as "collar"|"leftSleeve"|"rightSleeve")} style={{fontSize:9,padding:"4px 10px",borderRadius:6,border:`1px solid ${V.ac}`,background:"transparent",cursor:"pointer",fontFamily:"'Jost',sans-serif",color:V.ac,letterSpacing:".06em",textTransform:"uppercase"}}>Change</button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      )}

                    </div>
                  )}

                  {/* Fallback: no customisation type selected yet (solid products before step 1) */}
                  {!isPrintMode&&!isPatternMode&&!isColorMode&&(
                    <div style={{padding:"16px",borderRadius:12,background:V.sf2,border:`1px solid ${V.bd}`,fontFamily:"'Jost',sans-serif",fontSize:12,color:V.mu,lineHeight:1.6}}>
                      Please go back to Step 1 and choose a customisation type to get started.
                    </div>
                  )}

                </div>
              );
            })()}

            {/* ══════════════════ STEP 3: LOGO & TEXT ══════════════════════ */}
            {/* Disabled entirely for whole-garment products (pants/shorts/skorts) per client spec. */}
            {step===3&&!isWholeGarment&&(
              <div style={{display:"flex",flexDirection:"column",gap:18}}>

                {/* Logo section */}
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <div style={{...sbT}}>Upload Logo</div>
                  {!logoPreview?(
                    <label style={{
                      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                      gap:8,height:120,borderRadius:12,cursor:"pointer",
                      border:`1.5px dashed ${V.ac}`,background:V.aclt,
                      transition:"all .2s",
                    }}>
                      <input type="file" accept="image/*" style={{display:"none"}}
                        onChange={handleLogoUpload}/>
                      <span style={{fontSize:24,color:V.ac}}>⊕</span>
                      <span style={{fontSize:10,fontFamily:"'Jost',sans-serif",color:V.ac,letterSpacing:".08em",textTransform:"uppercase"}}>Drop or click to upload</span>
                      <span style={{fontSize:9,color:V.mul,fontFamily:"'Jost',sans-serif"}}>PNG, JPG, SVG</span>
                    </label>
                  ):(
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      <div style={{position:"relative",borderRadius:12,overflow:"hidden",border:`1px solid ${V.bd}`}}>
                        <img src={logoPreview} alt="Logo preview" style={{width:"100%",height:120,objectFit:"contain",background:V.sf2,display:"block"}}/>
                        <button onClick={()=>{removeLogo();}} style={{
                          position:"absolute",top:6,right:6,width:22,height:22,borderRadius:6,
                          border:`1px solid ${V.bd}`,background:"rgba(250,250,247,0.9)",cursor:"pointer",
                          display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:V.mu,
                        }}>×</button>
                      </div>
                      <button onClick={removeBackground} disabled={bgRemoving} style={{
                        padding:"8px 16px",borderRadius:8,border:`1px solid ${V.ac}`,
                        background:"transparent",cursor:"pointer",color:V.ac,
                        fontFamily:"'Jost',sans-serif",fontSize:10,fontWeight:600,letterSpacing:".07em",textTransform:"uppercase",
                        opacity:bgRemoving?.6:1,transition:"all .2s",
                      }}>{bgRemoving?"Removing…":"✦ Remove Background"}</button>
                      <div style={{fontFamily:"'Jost',sans-serif",fontSize:10,color:V.mu,lineHeight:1.5,paddingLeft:2}}>
                        Removes the white or light background from your logo so only the artwork shows on the garment. Works best on logos with a plain white background.
                      </div>
                    </div>
                  )}

                  {logoPreview&&(
                    <div style={{display:"flex",flexDirection:"column",gap:10,padding:"14px",borderRadius:12,background:V.sf2,border:`1px solid ${V.bd}`}}>
                      <div>
                        {(()=>{const lMax=PLACEMENT_MAX_PCT[logoPosition]??20;const lVal=Math.min(logoSize,lMax);const lPct=Math.round((lVal-5)/Math.max(1,lMax-5)*100);return(<>
                        <div style={{...sb}}>Size — <span style={{color:V.ac}}>{(lVal*0.376).toFixed(1)}&Prime; × {logoObjRef.current?((lVal*0.376)*(logoObjRef.current.height/logoObjRef.current.width)).toFixed(1):(lVal*0.376).toFixed(1)}&Prime;</span> <span style={{color:V.mu,fontWeight:400}}>({lVal}%)</span></div>
                        <input type="range" min={5} max={lMax} value={lVal} onChange={e=>{const v=+e.target.value;setLogoSize(v);if(logoObjRef.current){const pos=LOGO_POSITIONS[logoPosition]||{left:512,top:512};logoObjRef.current.scaleToWidth(logoMaxW(logoPosition,v));logoObjRef.current.set({left:pos.left,top:pos.top,originX:"center",originY:"center",angle:placementAngle(logoPosition)});logoObjRef.current.setCoords();fcRef.current?.renderAll();syncTexture();}}}
                          style={{width:"100%",accentColor:V.tx,cursor:"pointer",height:4,borderRadius:2,
                            background:`linear-gradient(to right,${V.tx} 0%,${V.tx} ${lPct}%,#c4bfb8 ${lPct}%,#c4bfb8 100%)`}}/>
                        </>);})()}
                      </div>
                    </div>
                  )}

                  {/* Logo placement — mobile only (desktop uses right panel) */}
                  {logoPreview&&isMd&&(()=>{
                    const CHIPS=[
                      {key:"front-left",   label:"Chest Left",   cx:39,cy:40},
                      {key:"front-right",  label:"Chest Right",  cx:21,cy:40},
                      {key:"left-sleeve",  label:"Right Sleeve", cx:7, cy:23},
                      {key:"right-sleeve", label:"Left Sleeve",  cx:53,cy:23},
                      {key:"back-top",     label:"Back Top",     cx:30,cy:24,back:true},
                      {key:"back-center",  label:"Centre Back",  cx:30,cy:52,back:true},
                      {key:"collar-left",  label:"Collar Right", cx:24,cy:14},
                      {key:"collar-right", label:"Collar Left",  cx:36,cy:14},
                    ] as {key:string;label:string;cx:number;cy:number;back?:boolean}[];
                    return(
                      <div style={{display:"flex",flexDirection:"column",gap:8,padding:"12px 0 0"}}>
                        <div style={{...sb}}>Logo Placement</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5}}>
                          {CHIPS.map(c=>{
                            const isA=logoPosition===c.key;
                            const svg=`<svg viewBox="0 0 60 68" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 4L10 12L4 32L14 34L14 64H46L46 34L56 32L50 12L38 4L34 6C32 8 28 8 26 6Z" fill="#e8e4dc" stroke="#1a1a18" stroke-width="1.5"/>${c.back?`<text x="30" y="54" text-anchor="middle" font-size="6" fill="#999" font-family="sans-serif">back</text>`:""}<circle cx="${c.cx}" cy="${c.cy}" r="3.5" fill="${isA?"#c9a84c":"#aaa"}"/></svg>`;
                            return(
                              <div key={c.key} onClick={()=>{setLogoPosition(c.key as any);setLogoSize(s=>Math.min(s,PLACEMENT_MAX_PCT[c.key]??20));setCameraView(PLACEMENT_VIEW[c.key]??"front");setModelPaused(true);const mv_=mvRef.current as any;if(mv_){mv_.removeAttribute("auto-rotate");mv_.removeAttribute("auto-rotate-delay");}if(logoObjRef.current){const pos=LOGO_POSITIONS[c.key]||{left:512,top:512};logoObjRef.current.set({left:pos.left,top:pos.top,originX:"center",originY:"center",flipX:placementFlipX(c.key),flipY:placementFlipY(c.key),angle:placementAngle(c.key)});logoObjRef.current.setCoords();fcRef.current?.renderAll();syncTexture();}}} style={{
                                display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"pointer",
                                padding:"6px 2px",borderRadius:9,transition:"all .18s",
                                border:`1.5px solid ${isA?V.ac:V.bd}`,background:isA?V.aclt:"transparent",
                              }}>
                                <div style={{width:32,height:36}} dangerouslySetInnerHTML={{__html:svg}}/>
                                <span style={{fontSize:8,textTransform:"uppercase",letterSpacing:".03em",fontFamily:"'Jost',sans-serif",color:isA?V.tx:"#4a4a48",fontWeight:isA?700:500,textAlign:"center",lineHeight:1.2}}>{c.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Text section */}
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <div style={{...sbT}}>Add Text</div>
                  <textarea value={textInput} onChange={e=>setTextInput(e.target.value)} placeholder="Enter your text…"
                    rows={2} style={{
                      width:"100%",padding:"10px 12px",borderRadius:10,
                      border:`1px solid ${V.bd}`,background:V.sf2,
                      fontFamily:"'Jost',sans-serif",fontSize:12,color:V.tx,resize:"vertical",
                      outline:"none",boxSizing:"border-box",
                    }}/>
                  <div style={{display:"flex",gap:8}}>
                    <div style={{flex:1}}>
                      <div style={{...sb}}>Colour</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"}}>
                        {MAIN_PALETTE.slice(0,8).map(h=>swatch(h,textColor===h,()=>{setTextColor(h);if(textObjRef.current){textObjRef.current.set({fill:h});fcRef.current?.renderAll();syncTexture();}},undefined,38))}
                        <label title="Custom colour" style={{
                          width:38,height:38,borderRadius:"50%",cursor:"pointer",
                          display:"flex",alignItems:"center",justifyContent:"center",
                          border:`1.5px dashed ${V.ac}`,background:V.aclt,flexShrink:0,
                          fontSize:13,color:V.ac,overflow:"hidden",position:"relative",
                        }}>
                          <span style={{pointerEvents:"none",lineHeight:1}}>+</span>
                          <input type="color" value={textColor} onChange={e=>{const v=e.target.value;setTextColor(v);if(textObjRef.current){textObjRef.current.set({fill:v});fcRef.current?.renderAll();syncTexture();}}}
                            style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",width:"100%",height:"100%"}}/>
                        </label>
                        <div style={{width:22,height:22,borderRadius:"50%",background:textColor,border:`1.5px solid ${V.bd}`,flexShrink:0}}/>
                      </div>
                    </div>
                    <div>
                      <div style={{...sb}}>Size</div>
                      <input type="range" min={14} max={80} value={textFontSize}
                        onChange={e=>{const v=+e.target.value;setTextFontSize(v);if(textObjRef.current){const pos=LOGO_POSITIONS[textPosition]||{left:512,top:512};textObjRef.current.set({fontSize:v,left:pos.left,top:pos.top,originX:"center",originY:"center",flipX:placementFlipX(textPosition),flipY:placementFlipY(textPosition),angle:placementAngle(textPosition),scaleX:1,scaleY:1});clampCollarText(textObjRef.current,textPosition);textObjRef.current.setCoords();fcRef.current?.renderAll();syncTexture();}}}
                        style={{width:80,accentColor:V.tx,cursor:"pointer",height:4,borderRadius:2,
                          background:`linear-gradient(to right,${V.tx} 0%,${V.tx} ${Math.round((textFontSize-14)/66*100)}%,#c4bfb8 ${Math.round((textFontSize-14)/66*100)}%,#c4bfb8 100%)`}}/>
                      <div style={{fontSize:9,color:V.mu,textAlign:"center",fontFamily:"'Jost',sans-serif"}}>{textFontSize}px</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {[
                      {f:"Tinos",            label:"Tinos"},
                      {f:"Playfair Display", label:"Playfair"},
                      {f:"Jost",             label:"Jost"},
                      {f:"Cormorant Garamond",label:"Cormorant"},
                      {f:"Impact",           label:"Impact"},
                      {f:"Anton",            label:"Anton"},
                      {f:"Bebas Neue",       label:"Bebas"},
                      {f:"Oswald",           label:"Oswald"},
                    ].map(({f,label})=>(
                      <button key={f} onClick={()=>{setTextFont(f);if(textObjRef.current){textObjRef.current.set({fontFamily:f});fcRef.current?.renderAll();syncTexture();}}} style={{
                        padding:"5px 10px",borderRadius:6,fontSize:10,fontFamily:f,
                        border:`1.5px solid ${textFont===f?V.ac:V.bd}`,
                        background:textFont===f?V.aclt:"transparent",
                        cursor:"pointer",color:textFont===f?V.tx:V.mu,transition:"all .2s",
                      }}>{label}</button>
                    ))}
                  </div>
                  {/* Text placement — mobile only (desktop uses right panel) */}
                  {isMd&&(()=>{
                    const CHIPS=[
                      {key:"front-left",   label:"Chest Left",   cx:39,cy:40},
                      {key:"front-right",  label:"Chest Right",  cx:21,cy:40},
                      {key:"left-sleeve",  label:"Right Sleeve", cx:7, cy:23},
                      {key:"right-sleeve", label:"Left Sleeve",  cx:53,cy:23},
                      {key:"back-top",     label:"Back Top",     cx:30,cy:24,back:true},
                      {key:"back-center",  label:"Centre Back",  cx:30,cy:52,back:true},
                      {key:"collar-left",  label:"Collar Right", cx:24,cy:14},
                      {key:"collar-right", label:"Collar Left",  cx:36,cy:14},
                    ] as {key:string;label:string;cx:number;cy:number;back?:boolean}[];
                    return(
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        <div style={{...sb}}>Text Placement</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5}}>
                          {CHIPS.map(c=>{
                            const isA=textPosition===c.key;
                            const svg=`<svg viewBox="0 0 60 68" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 4L10 12L4 32L14 34L14 64H46L46 34L56 32L50 12L38 4L34 6C32 8 28 8 26 6Z" fill="#e8e4dc" stroke="#1a1a18" stroke-width="1.5"/>${c.back?`<text x="30" y="54" text-anchor="middle" font-size="6" fill="#999" font-family="sans-serif">back</text>`:""}<circle cx="${c.cx}" cy="${c.cy}" r="3.5" fill="${isA?"#c9a84c":"#aaa"}"/></svg>`;
                            return(
                              <div key={c.key} onClick={()=>{const isCollar=c.key==="collar-left"||c.key==="collar-right";setTextPosition(c.key as any);if(isCollar)setTextFontSize(v=>Math.min(v,14));setCameraView(PLACEMENT_VIEW[c.key]??"front");setModelPaused(true);const mv_=mvRef.current as any;if(mv_){mv_.removeAttribute("auto-rotate");mv_.removeAttribute("auto-rotate-delay");}if(textObjRef.current){const pos=LOGO_POSITIONS[c.key]||{left:512,top:512};const fs=isCollar?Math.min(textFontSize,14):textFontSize;textObjRef.current.set({left:pos.left,top:pos.top,originX:"center",originY:"center",flipX:placementFlipX(c.key),flipY:placementFlipY(c.key),angle:placementAngle(c.key),fontSize:fs,scaleX:1,scaleY:1});clampCollarText(textObjRef.current,c.key);textObjRef.current.setCoords();fcRef.current?.renderAll();syncTexture();}}} style={{
                                display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"pointer",
                                padding:"6px 2px",borderRadius:9,transition:"all .18s",
                                border:`1.5px solid ${isA?V.ac:V.bd}`,background:isA?V.aclt:"transparent",
                              }}>
                                <div style={{width:32,height:36}} dangerouslySetInnerHTML={{__html:svg}}/>
                                <span style={{fontSize:8,textTransform:"uppercase",letterSpacing:".03em",fontFamily:"'Jost',sans-serif",color:isA?V.tx:"#4a4a48",fontWeight:isA?700:500,textAlign:"center",lineHeight:1.2}}>{c.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  <button onClick={()=>{
                    if(!textInput.trim())return;
                    applyText();
                  }} style={{
                    padding:"10px 16px",borderRadius:8,border:"none",background:V.ac,cursor:"pointer",
                    fontFamily:"'Jost',sans-serif",fontSize:10,fontWeight:700,letterSpacing:".08em",
                    textTransform:"uppercase",color:V.tx,transition:"all .2s",whiteSpace:"nowrap",
                  }}
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=V.ac;(e.currentTarget as HTMLElement).style.opacity="0.85";}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=V.ac;(e.currentTarget as HTMLElement).style.opacity="1";}}>
                    ✦ Place Text on Garment
                  </button>
                </div>


              {/* Customisation charge — mobile only; desktop shows this in the right panel */}
              {isMd&&(()=>{
                const _lw=logoSize*0.376;
                const _la=logoPreview?Math.ceil(_lw*_lw*0.75):0;
                const _th=textFontSize*(22/1024);
                const _tw=Math.max(1,textInput.length)*textFontSize*0.55*(22/1024);
                const _ta=textPlaced?Math.ceil(_th*_tw):0;
                const _tot=(!!(logoPreview||textPlaced))?(20+_la+_ta):0;
                if(!_tot)return null;
                return(
                  <div style={{padding:"10px 12px",borderRadius:10,background:V.sf2,border:`1px solid ${V.bd}`,marginTop:4}}>
                    <div style={{fontFamily:"'Jost',sans-serif",fontSize:9,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:V.mu,marginBottom:8}}>Customisation Charge</div>
                    <div style={{display:"flex",justifyContent:"space-between",fontFamily:"'Jost',sans-serif",fontSize:11,color:V.tx,marginBottom:4}}><span>Base fee</span><span style={{color:V.ac,fontWeight:600}}>₹20</span></div>
                    {logoPreview&&<div style={{display:"flex",justifyContent:"space-between",fontFamily:"'Jost',sans-serif",fontSize:11,color:V.tx,marginBottom:4}}><span>Logo ({_la} sq in)</span><span style={{color:V.ac,fontWeight:600}}>₹{_la}</span></div>}
                    {textPlaced&&<div style={{display:"flex",justifyContent:"space-between",fontFamily:"'Jost',sans-serif",fontSize:11,color:V.tx,marginBottom:4}}><span>Name / Text ({_ta} sq in)</span><span style={{color:V.ac,fontWeight:600}}>₹{_ta}</span></div>}
                    <div style={{borderTop:`1px solid ${V.bd}`,marginTop:6,paddingTop:6,display:"flex",justifyContent:"space-between",fontFamily:"'Jost',sans-serif",fontSize:12,fontWeight:700,color:V.tx}}><span>Total</span><span style={{color:V.ac}}>₹{_tot}</span></div>
                    <div style={{fontFamily:"'Jost',sans-serif",fontSize:9,color:V.mu,marginTop:5,fontStyle:"italic"}}>₹20 base + ₹1 per sq inch · name &amp; logo only · prints &amp; colours free</div>
                  </div>
                );
              })()}

            </div>
            )}

            {/* ══════════════════ STEP 4: SIZING ════════════════════════════ */}
            {step===4&&(
              <div style={{display:"flex",flexDirection:"column",gap:16}}>

                {/* Design name */}
                <div>
                  <div style={{...sb}}>Design name</div>
                  <input value={designName} onChange={e=>setDesignName(e.target.value)}
                    placeholder={`${product?.name||"Custom"} Design`}
                    style={{
                      width:"100%",padding:"9px 12px",borderRadius:8,
                      border:`1px solid ${V.bd}`,background:V.sf2,
                      fontFamily:"'Jost',sans-serif",fontSize:12,color:V.tx,
                      outline:"none",boxSizing:"border-box",
                    }}/>
                </div>

                {/* Size × Qty table */}
                <div>
                  <div style={{...sb}}>Size &amp; quantity</div>
                  <div style={{borderRadius:10,overflow:"hidden",border:`1px solid ${V.bd}`}}>
                    <div style={{display:"grid",gridTemplateColumns:isXs ? "1fr 1fr" : "1fr 1fr 1fr",background:V.sf2,padding:"8px 12px",borderBottom:`1px solid ${V.bd}`}}>
                      <span style={{fontSize:9,fontFamily:"'Jost',sans-serif",letterSpacing:".08em",textTransform:"uppercase",color:V.mu}}>Size</span>
                      <span style={{fontSize:9,fontFamily:"'Jost',sans-serif",letterSpacing:".08em",textTransform:"uppercase",color:V.mu,textAlign:"center"}}>Qty</span>
                      <span style={{fontSize:9,fontFamily:"'Jost',sans-serif",letterSpacing:".08em",textTransform:"uppercase",color:V.mu,textAlign:"right",display:isXs ? "none" : undefined}}>Chest (in)</span>
                    </div>
                    {([
                      {s:"S",chest:"36–37"},
                      {s:"M",chest:"38–39"},
                      {s:"L",chest:"40–41"},
                      {s:"XL",chest:"42–43"},
                      {s:"XXL",chest:"44–46"},
                    ]).map(({s,chest})=>(
                      <div key={s} style={{
                        display:"grid",gridTemplateColumns:isXs ? "1fr 1fr" : "1fr 1fr 1fr",
                        alignItems:"center",padding:"8px 12px",
                        borderBottom:`1px solid rgba(26,26,24,0.05)`,
                        background:sizeQty[s]>0?V.aclt:"transparent",
                        transition:"background .2s",
                      }}>
                        <span style={{fontFamily:"'Jost',sans-serif",fontSize:12,fontWeight:700,color:sizeQty[s]>0?V.ac:V.tx,letterSpacing:".06em"}}>{s}</span>
                        <div style={{display:"flex",alignItems:"center",gap:4,justifyContent:"center"}}>
                          <button onClick={()=>setSizeQty(q=>({...q,[s]:Math.max(0,q[s]-1)}))} style={{
                            width:22,height:22,borderRadius:6,border:`1px solid ${V.bd}`,
                            background:"transparent",cursor:"pointer",fontSize:14,color:V.mu,lineHeight:1,
                          }}>−</button>
                          <span style={{width:24,textAlign:"center",fontFamily:"'Jost',sans-serif",fontSize:12,fontWeight:600,color:V.tx}}>{sizeQty[s]||0}</span>
                          <button onClick={()=>setSizeQty(q=>({...q,[s]:q[s]+1}))} style={{
                            width:22,height:22,borderRadius:6,border:`1px solid ${V.bd}`,
                            background:"transparent",cursor:"pointer",fontSize:14,color:V.mu,lineHeight:1,
                          }}>+</button>
                        </div>
                        <span style={{fontSize:10,color:V.mu,fontFamily:"'Jost',sans-serif",textAlign:"right",display:isXs ? "none" : undefined}}>{chest}</span>
                      </div>
                    ))}
                    {totalQty>4&&(
                      <div style={{padding:"10px 14px",background:"rgba(201,168,76,0.08)",borderTop:`1px solid rgba(201,168,76,0.25)`}}>
                        <div style={{fontFamily:"'Jost',sans-serif",fontSize:10,color:"#b87a14",letterSpacing:".04em",lineHeight:1.5}}>
                          Orders above 4 pieces qualify for our <a href="/contact?subject=bulk" style={{color:"#c9a84c",fontWeight:700,textDecoration:"underline"}}>Bulk Enquiry</a> for better pricing and dedicated support.
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Price summary removed per client request */}

                {/* Custom measurements */}
                <div>
                  <div style={{...sb,marginBottom:6}}>Custom Measurements <span style={{fontSize:9,fontWeight:400,color:V.mu,marginLeft:4}}>(optional, in inches)</span></div>
                  <div style={{padding:"10px 14px",background:"rgba(201,168,76,0.07)",border:"1px solid rgba(201,168,76,0.2)",borderRadius:8,marginBottom:12}}>
                    <div style={{fontFamily:"'Jost',sans-serif",fontSize:10,fontWeight:700,color:"#8b6914",letterSpacing:".06em",textTransform:"uppercase",lineHeight:1.6}}>
                      IMPORTANT: ALL SIZES BELOW ARE BODY MEASUREMENTS, NOT GARMENT MEASUREMENTS. PLEASE SPECIFY WHETHER YOUR INPUTS ARE BODY OR GARMENT MEASUREMENTS.
                    </div>
                  </div>
                  <div style={{fontSize:10,color:V.mu,fontFamily:"'Jost',sans-serif",marginBottom:10,lineHeight:1.5}}>
                    Leave blank to use standard sizing above. Fill in for a tailored fit.
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    {(()=>{
                      const SIZE_CLASH: Record<string,{s:string;lo:number;hi:number}[]> = {
                        chest:    [{s:"S",lo:36,hi:37},{s:"M",lo:38,hi:39},{s:"L",lo:40,hi:41},{s:"XL",lo:42,hi:43},{s:"XXL",lo:44,hi:46}],
                        shoulder: [{s:"S",lo:16,hi:17},{s:"M",lo:17,hi:18},{s:"L",lo:18,hi:19},{s:"XL",lo:19,hi:20},{s:"XXL",lo:20,hi:21}],
                        length:   [{s:"S",lo:27,hi:28},{s:"M",lo:28,hi:29},{s:"L",lo:29,hi:30},{s:"XL",lo:30,hi:31},{s:"XXL",lo:31,hi:32}],
                        sleeve:   [{s:"S",lo:8, hi:9}, {s:"M",lo:9, hi:10},{s:"L",lo:10,hi:11},{s:"XL",lo:11,hi:12},{s:"XXL",lo:12,hi:13}],
                        waist:    [{s:"S",lo:30,hi:31},{s:"M",lo:32,hi:33},{s:"L",lo:34,hi:35},{s:"XL",lo:36,hi:37},{s:"XXL",lo:38,hi:40}],
                        hip:      [{s:"S",lo:34,hi:35},{s:"M",lo:36,hi:37},{s:"L",lo:38,hi:39},{s:"XL",lo:40,hi:41},{s:"XXL",lo:42,hi:44}],
                      };
                      return ([
                        {key:"chest",   label:"Chest"},
                        {key:"waist",   label:"Waist"},
                        {key:"hip",     label:"Hip"},
                        {key:"shoulder",label:"Shoulder Width"},
                        {key:"length",  label:"Garment Length"},
                        {key:"sleeve",  label:"Sleeve Length"},
                      ] as {key:string;label:string}[]).map(({key,label})=>(
                        <div key={key}>
                          <div style={{fontSize:9,fontFamily:"'Jost',sans-serif",letterSpacing:".07em",textTransform:"uppercase",color:V.mu,marginBottom:4}}>{label}</div>
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            placeholder="—"
                            value={customMeasurements[key as keyof typeof customMeasurements] ?? ""}
                            style={{
                              width:"100%",padding:"8px 10px",borderRadius:8,
                              border:`1px solid ${V.bd}`,background:V.sf2,
                              fontFamily:"'Jost',sans-serif",fontSize:12,color:V.tx,
                              outline:"none",boxSizing:"border-box" as const,
                            }}
                            onFocus={e=>e.target.style.borderColor=V.ac}
                            onBlur={e=>{
                              e.target.style.borderColor=V.bd;
                              const v=parseFloat(e.target.value);
                              const ranges=SIZE_CLASH[key];
                              if(!isNaN(v)&&ranges){
                                const match=ranges.find(sz=>v>=sz.lo&&v<=sz.hi);
                                const warn=e.target.nextElementSibling as HTMLElement|null;
                                if(warn){
                                  if(match){
                                    warn.textContent=`${v}" matches our standard ${match.s} size (${match.lo}–${match.hi}"). Consider selecting ${match.s} above instead.`;
                                    warn.style.display="block";
                                  } else {
                                    warn.style.display="none";
                                  }
                                }
                              }
                            }}
                            onChange={e=>{
                              setCustomMeasurements(prev=>({...prev,[key]:e.target.value}));
                              const warn=e.target.nextElementSibling as HTMLElement|null;
                              if(warn){warn.style.display="none";}
                            }}
                          />
                          <div style={{display:"none",marginTop:4,fontSize:9,color:"#b87a14",fontFamily:"'Jost',sans-serif",lineHeight:1.4,padding:"5px 8px",background:"rgba(201,168,76,0.08)",borderRadius:6}}/>
                        </div>
                      ));
                    })()}
                  </div>
                  <div style={{marginTop:8,fontSize:9,color:V.mu,fontFamily:"'Jost',sans-serif",fontStyle:"italic"}}>
                    Our team will contact you to confirm measurements before production.
                  </div>
                </div>

                {/* Price summary hidden per client request */}

                {/* WhatsApp bulk order callout */}
                <a href={`https://wa.me/919999999999?text=${encodeURIComponent(`Hi KA.SHA! I'd like to place a bulk order for ${totalQty||"multiple"} custom golf t-shirts.`)}`}
                  target="_blank" rel="noopener noreferrer" style={{
                    display:"flex",alignItems:"center",gap:12,
                    padding:"14px 18px",borderRadius:12,textDecoration:"none",
                    background:"linear-gradient(135deg,#25D366 0%,#128C7E 100%)",
                    boxShadow:"0 4px 16px rgba(37,211,102,0.25)",
                    transition:"all .25s",
                  }}
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.transform="translateY(-1px)";(e.currentTarget as HTMLElement).style.boxShadow="0 6px 20px rgba(37,211,102,0.35)";}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.transform="translateY(0)";(e.currentTarget as HTMLElement).style.boxShadow="0 4px 16px rgba(37,211,102,0.25)";}}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                  <div>
                    <div style={{fontFamily:"'Jost',sans-serif",fontSize:12,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"#fff"}}>Bulk / Team Order?</div>
                    <div style={{fontFamily:"'Jost',sans-serif",fontSize:10,color:"rgba(255,255,255,0.85)",marginTop:2}}>Chat with us on WhatsApp for 5+ pcs</div>
                  </div>
                </a>

              </div>
            )}

          </div>
          {/* Gradient overflow hint — only rendered on mobile, sticks to bottom of
              the scroll container so users know more content awaits below */}
          {isMd&&stepPanelCanScroll&&(
            <div className="step-panel-gradient" aria-hidden="true"/>
          )}

          {/* ── BOTTOM NAV FOOTER ──────────────────────────────────────────── */}
          <div style={{
            position:"sticky",bottom:0,
            padding:isXs ? "10px 12px" : "12px 20px",
            paddingBottom:isXs ? "max(10px, env(safe-area-inset-bottom))" : undefined,
            background:"rgba(250,250,247,0.97)",
            borderTop:`1px solid rgba(201,168,76,0.18)`,
            backdropFilter:"blur(12px)",
            display:"flex",alignItems:"center",gap:isXs ? 6 : 8,
            zIndex:20,flexShrink:0,
            boxShadow:"0 -4px 20px rgba(26,26,24,0.07)",
          }}>
            {/* Back */}
            <button
              onClick={()=>setStep(s=>{const prev=s-1; return Math.max(initialStep, isWholeGarment&&prev===3?2:prev);})}
              disabled={step===initialStep}
              style={{
                flex:1,padding:"11px 0",borderRadius:99,minHeight:44,
                border:`1.5px solid ${step===initialStep?"rgba(26,26,24,0.12)":V.bd}`,
                background:"transparent",
                color:step===initialStep?V.mu:V.tx,
                fontSize:11,fontWeight:900,cursor:step===initialStep?"default":"pointer",
                fontFamily:"'Jost',sans-serif",letterSpacing:".06em",
                transition:"all 0.25s",
              }}
              onMouseEnter={e=>{if(step>initialStep){e.currentTarget.style.borderColor=V.ac;e.currentTarget.style.color=V.ac;}}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=step===initialStep?"rgba(26,26,24,0.12)":V.bd;e.currentTarget.style.color=step===initialStep?V.mu:V.tx;}}>
              {isXs ? "←" : "← Previous Step"}
            </button>

            {/* Continue / Add to Cart */}
            {step<4 ? (
              <>
                <button
                  onClick={()=>setStep(s=>{const next=s+1; return Math.min(4, isWholeGarment&&next===3?4:next);})}
                  style={{
                    flex:2,padding:"11px 0",borderRadius:99,minHeight:44,
                    border:"none",background:V.tx,color:"#fff",
                    fontSize:11,fontWeight:600,cursor:"pointer",
                    fontFamily:"'Jost',sans-serif",letterSpacing:".07em",textTransform:"uppercase",
                    transition:"all 0.25s",
                  }}
                  onMouseEnter={e=>{e.currentTarget.style.background=V.ac;e.currentTarget.style.color=V.tx;}}
                  onMouseLeave={e=>{e.currentTarget.style.background=V.tx;e.currentTarget.style.color="#fff";}}>
                  {step===1?(isXs?"Design →":"Continue to Design →"):step===2?(isWholeGarment?(isXs?"Sizing →":"Continue to Sizing →"):(isXs?"Logo →":"Continue to Logo & Text →")):(isXs?"Sizing →":"Continue to Sizing →")}
                </button>
                {!isTypeMode&&(
                  <button
                    onClick={()=>setStep(4)}
                    style={{
                      flex:isXs ? "0 0 44px" : 1,padding:"11px 0",borderRadius:99,minHeight:44,
                      border:`1.5px solid ${V.ac}`,background:V.aclt,color:V.tx,
                      fontSize:10,fontWeight:600,cursor:"pointer",
                      fontFamily:"'Jost',sans-serif",letterSpacing:".06em",textTransform:"uppercase",
                      transition:"all 0.25s",
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.background=V.ac;}}
                    onMouseLeave={e=>{e.currentTarget.style.background=V.aclt;}}>
                    {isXs ? "🛒" : "🛒 Add to Cart"}
                  </button>
                )}
              </>
            ) : isTypeMode ? (
              <a href="/products" style={{
                flex:2,padding:"11px 0",borderRadius:99,textDecoration:"none",
                background:V.tx,color:"#fff",textAlign:"center",
                fontSize:11,fontWeight:600,cursor:"pointer",
                fontFamily:"'Jost',sans-serif",letterSpacing:".07em",textTransform:"uppercase",
                transition:"all 0.25s",display:"block",
              }}>
                Browse →
              </a>
            ) : (
              <>
                <button
                  onClick={handleAddToCart}
                  disabled={cartMut.isPending}
                  style={{
                    flex:2,padding:"11px 0",borderRadius:99,minHeight:44,
                    border:"none",background:V.ac,color:V.tx,
                    fontSize:11,fontWeight:600,cursor:"pointer",
                    fontFamily:"'Jost',sans-serif",letterSpacing:".07em",textTransform:"uppercase",
                    opacity:cartMut.isPending?.6:1,transition:"all 0.25s",
                  }}
                  onMouseEnter={e=>{if(!cartMut.isPending){e.currentTarget.style.background=V.tx;e.currentTarget.style.color="#fff";}}}
                  onMouseLeave={e=>{e.currentTarget.style.background=V.ac;e.currentTarget.style.color=V.tx;}}>
                  {cartMut.isPending?"Adding…":"🛒 Add to Cart"}
                </button>
                {cartAdded&&!isTypeMode&&(
                  <button
                    onClick={()=>setLocation("/cart")}
                    style={{
                      flex:1,padding:"11px 0",borderRadius:99,
                      border:`1.5px solid ${V.ac}`,background:V.aclt,color:V.tx,
                      fontSize:10,fontWeight:600,cursor:"pointer",
                      fontFamily:"'Jost',sans-serif",letterSpacing:".06em",textTransform:"uppercase",
                      transition:"all 0.25s",
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.background=V.ac;}}
                    onMouseLeave={e=>{e.currentTarget.style.background=V.aclt;}}>
                    🛒 View Cart
                  </button>
                )}
              </>
            )}
          </div>

        </div>

        {/* ── OLD_PANELS_REMOVED ── */}
        {(false as unknown as null) && activeTool && TOOLS.filter(t => !isQuickMode || (t.id !== "prints" && t.id !== "patterns")).map(t => {
            const isA = activeTool === t.id;
            return (
              <button key={t.id}
                onClick={() => setActiveTool(isA ? null : (t.id as any))}
                style={{
                  width:54,padding:"10px 0 8px",
                  display:"flex",flexDirection:"column",alignItems:"center",gap:4,
                  borderRadius:12,border:"none",cursor:"pointer",
                  background:isA ? V.aclt : "transparent",
                  boxShadow:isA ? `0 2px 14px rgba(201,168,76,0.18), inset 0 0 0 1.5px ${V.ac}` : "none",
                  transition:"all 0.25s cubic-bezier(0.16,1,0.3,1)",
                  color:isA?V.tx:V.mu,
                }}
                onMouseEnter={e=>{if(!isA){e.currentTarget.style.background=V.sf2;e.currentTarget.style.color=V.tx;}}}
                onMouseLeave={e=>{if(!isA){e.currentTarget.style.background="transparent";e.currentTarget.style.color=V.mu;}}}>
                <span style={{fontSize:20,lineHeight:1}}>{t.icon}</span>
                <span style={{
                  fontSize:9,letterSpacing:".06em",textTransform:"uppercase",
                  fontFamily:"'Jost',sans-serif",fontWeight:isA?700:500,
                  lineHeight:1,
                }}>{t.label}</span>
              </button>
            );
          })}

        {/* ── TOOL PANEL (dead-coded) ───────────────────────────────────── */}
        {false && activeTool && (
          <div style={{
            width:300,flexShrink:0,
            borderRight:`1px solid rgba(26,26,24,0.07)`,
            overflowY:"auto",
            background:V.sf,
            display:"flex",flexDirection:"column",
            scrollbarWidth:"thin",
            scrollbarColor:`${V.cream3} transparent`,
            boxShadow:"4px 0 24px rgba(26,26,24,0.06)",
          }}>
            {/* Panel header */}
            <div style={{
              padding:"18px 20px 14px",
              borderBottom:`1px solid rgba(26,26,24,0.07)`,
              flexShrink:0,
              background:V.sf,
              position:"sticky",top:0,zIndex:5,
            }}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{
                    fontFamily:"'Cormorant Garamond',serif",
                    fontSize:18,fontWeight:600,color:V.tx,letterSpacing:".02em",
                  }}>
                    {TOOLS.find(t=>t.id===activeTool)?.label}
                  </div>
                  <div style={{fontSize:9,color:V.mu,letterSpacing:".1em",textTransform:"uppercase",fontFamily:"'Jost',sans-serif",marginTop:2}}>
                    {activeTool==="products"  && "Select your garment"}
                    {activeTool==="colors"    && "Base & zone colours"}
                    {activeTool==="prints"    && "Apply prints to garment"}
                    {activeTool==="patterns"  && "KA.SHA signature designs"}
                    {activeTool==="text"      && "Add custom text"}
                    {activeTool==="image"     && "Upload & place logo"}
                    {activeTool==="order"     && "Size, quantity & checkout"}
                  </div>
                </div>
                <button onClick={()=>setActiveTool(null)} style={{
                  width:28,height:28,borderRadius:8,border:`1px solid ${V.bd}`,
                  background:"transparent",cursor:"pointer",color:V.mu,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:14,transition:"all 0.2s",flexShrink:0,
                }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=V.ac;e.currentTarget.style.color=V.tx;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=V.bd;e.currentTarget.style.color=V.mu;}}>
                  ×
                </button>
              </div>
            </div>

            {/* Panel body */}
            <div style={{padding:"20px",flex:1,display:"flex",flexDirection:"column",gap:20}}>

              {/* ── PRODUCTS panel ─────────────────────────────────────── */}
              {activeTool==="products"&&(
                <div style={{display:"flex",flexDirection:"column",gap:16}}>
                  {product && (
                    <div style={{
                      background:V.sf2,border:`1px solid ${V.bd}`,
                      borderRadius:12,overflow:"hidden",
                    }}>
                      {product?.thumbnailUrl && (
                        <img src={product?.thumbnailUrl||undefined} alt={product?.name||""}
                          style={{width:"100%",height:160,objectFit:"cover",display:"block"}}/>
                      )}
                      <div style={{padding:"14px"}}>
                        <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,fontWeight:600,color:V.tx,letterSpacing:".02em",marginBottom:4}}>
                          {product?.name?.replace(/\s*\[gt:GT\d+\]\s*$/,"")}
                        </div>
                        <div style={{fontSize:15,color:V.ac,fontFamily:"'Jost',sans-serif",fontWeight:600,letterSpacing:".04em"}}>
                          {formatPrice(product?.priceInPaise||0)}
                        </div>
                        {product?.description && (
                          <div style={{fontSize:11,color:V.mu,lineHeight:1.65,marginTop:8,fontFamily:"'Jost',sans-serif"}}>
                            {product?.description?.slice(0,120)}{(product?.description?.length||0)>120?"…":""}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {isTypeMode && (
                    <div>
                      <div style={{...sb,marginBottom:10}}>Garment type</div>
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {([
                          {id:"solid",   label:"Solid Colour",    desc:"Clean base colour + custom parts"},
                          {id:"pattern", label:"KA.SHA Pattern",  desc:"Signature bespoke designs"},
                          {id:"printed", label:"All-Over Print",  desc:"Full garment print library"},
                        ] as const).map(g=>(
                          <div key={g.id} style={{
                            padding:"12px 14px",borderRadius:10,
                            border:`1.5px solid ${garmentType===g.id?V.ac:V.bd}`,
                            background:garmentType===g.id?V.aclt:"transparent",
                            cursor:"default",transition:"all 0.2s",
                          }}>
                            <div style={{fontSize:12,fontWeight:600,color:garmentType===g.id?V.tx:V.mu,fontFamily:"'Jost',sans-serif",letterSpacing:".04em"}}>{g.label}</div>
                            <div style={{fontSize:10,color:V.mul,marginTop:2,fontFamily:"'Jost',sans-serif"}}>{g.desc}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── COLORS panel ──────────────────────────────────────── */}
              {activeTool==="colors"&&(
                <div style={{display:"flex",flexDirection:"column",gap:16}}>
                  {/* When a KA.SHA pattern design is active, only base colour is relevant.
                      Zone-part selectors are hidden — the design controls per-zone colouring. */}
                  {activeKashaDesign&&(
                    <div style={{background:"rgba(201,168,76,0.07)",border:"1px solid rgba(201,168,76,0.18)",borderRadius:10,padding:"9px 12px",fontSize:11,color:V.mu,fontStyle:"italic",fontFamily:"'Jost',sans-serif",lineHeight:1.6}}>
                      Pattern design active — set the base colour below. Zone parts are controlled by the design.
                    </div>
                  )}
                  {/* Zone thumbnail selector — hide per-zone selectors when pattern is active */}
                  {(()=>{
                    const allZones:[string,string,string,string][]=[
                      ["all","Base Colour",
                        `<svg viewBox="0 0 60 68" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 4L10 12L4 32L14 34L14 64H46L46 34L56 32L50 12L38 4L34 6C32 8 28 8 26 6Z" fill="__COL__" stroke="#1a1a18" stroke-width="1.5"/></svg>`,
                        primaryColor],
                      ["front","Front",
                        `<svg viewBox="0 0 60 68" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 4L10 12L4 32L14 34L14 64H46L46 34L56 32L50 12L38 4L34 6C32 8 28 8 26 6Z" fill="#e8e4dc" stroke="#1a1a18" stroke-width="1.5"/><rect x="19" y="30" width="22" height="32" rx="1" fill="__COL__" opacity="0.9"/></svg>`,
                        zoneColors["front"]||primaryColor],
                      ["back","Back",
                        `<svg viewBox="0 0 60 68" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 4L10 12L4 32L14 34L14 64H46L46 34L56 32L50 12L38 4L34 6C32 8 28 8 26 6Z" fill="#e8e4dc" stroke="#1a1a18" stroke-width="1.5"/><rect x="19" y="30" width="22" height="32" rx="1" fill="__COL__" opacity="0.9"/><text x="30" y="50" text-anchor="middle" font-size="7" fill="#fff" font-family="sans-serif">BACK</text></svg>`,
                        zoneColors["back"]||primaryColor],
                      ["leftSleeve","L. Sleeve",
                        `<svg viewBox="0 0 60 68" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 4L10 12L4 32L14 34L14 64H46L46 34L56 32L50 12L38 4L34 6C32 8 28 8 26 6Z" fill="#e8e4dc" stroke="#1a1a18" stroke-width="1.5"/><path d="M10 12L4 32L14 34L18 14Z" fill="__COL__" opacity="0.9"/></svg>`,
                        zoneColors["leftSleeve"]||primaryColor],
                      ["rightSleeve","R. Sleeve",
                        `<svg viewBox="0 0 60 68" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 4L10 12L4 32L14 34L14 64H46L46 34L56 32L50 12L38 4L34 6C32 8 28 8 26 6Z" fill="#e8e4dc" stroke="#1a1a18" stroke-width="1.5"/><path d="M50 12L56 32L46 34L42 14Z" fill="__COL__" opacity="0.9"/></svg>`,
                        zoneColors["rightSleeve"]||primaryColor],
                    ];
                    // When a KA.SHA pattern is active, hide per-zone selectors
                    const zones = activeKashaDesign ? allZones.slice(0,1) : allZones;
                    const cols = activeKashaDesign ? 1 : 5;
                    return(
                      <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:6}}>
                        {zones.map(([id,label,svgTpl,col])=>{
                          const isA=colorTarget===id||(activeKashaDesign&&id==="all");
                          const svg=svgTpl.replace(/__COL__/g,col);
                          return(
                            <div key={id} onClick={()=>setColorTarget(id as any)} style={{
                              display:"flex",flexDirection:"column",alignItems:"center",gap:4,cursor:"pointer",
                              padding:"8px 4px",borderRadius:10,transition:"all .2s",
                              border:`1.5px solid ${isA?V.ac:V.bd}`,
                              background:isA?V.aclt:"transparent",
                            }}>
                              <div style={{width:40,height:46}} dangerouslySetInnerHTML={{__html:svg}}/>
                              <span style={{fontSize:8,textTransform:"uppercase",letterSpacing:".06em",fontFamily:"'Jost',sans-serif",color:isA?V.tx:V.mu,fontWeight:isA?700:400,textAlign:"center",lineHeight:1.2}}>{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {/* Colour picker for selected target */}
                  <div style={{background:V.sf2,border:`1px solid ${V.bd}`,borderRadius:10,padding:12}}>
                    <div style={{fontSize:10,color:"#4a4a42",marginBottom:10,letterSpacing:".07em",textTransform:"uppercase",fontWeight:600,fontFamily:"'Jost',sans-serif"}}>
                      {activeKashaDesign ? "Base Colour" : colorTarget==="all" ? "Colour — All Parts" : `Colour — ${["front","back","leftSleeve","rightSleeve"].includes(colorTarget)?{front:"Front",back:"Back",leftSleeve:"Left Sleeve",rightSleeve:"Right Sleeve"}[colorTarget as string]:"Part"}`}
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:4}}>
                      {(activeKashaDesign||colorTarget==="all")
                        ? MAIN_PALETTE.map(hex=>swatch(hex,primaryColor===hex,()=>applyPrimary(hex)))
                        : MAIN_PALETTE.map(hex=>swatch(hex,zoneColors[colorTarget as Exclude<typeof colorTarget,"all">]===hex,()=>applyZoneColor(colorTarget as Exclude<typeof colorTarget,"all">,hex)))}
                    </div>
                    {/* Hex text input — exact value entry */}
                    {(()=>{
                      const currentHex=(activeKashaDesign||colorTarget==="all")
                        ?primaryColor
                        :zoneColors[colorTarget as Exclude<typeof colorTarget,"all">]||primaryColor;
                      return (
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                          <span style={{width:22,height:22,borderRadius:4,background:currentHex,border:"1.5px solid rgba(26,26,24,0.18)",flexShrink:0,display:"inline-block"}}/>
                          <input
                            type="text"
                            value={currentHex.toUpperCase()}
                            maxLength={7}
                            spellCheck={false}
                            onChange={e=>{
                              const v=e.target.value.trim();
                              const hex=cssColorToHex(v);
                              if(!hex) return;
                              if(activeKashaDesign||colorTarget==="all") applyPrimary(hex);
                              else applyZoneColor(colorTarget as Exclude<typeof colorTarget,"all">,hex);
                            }}
                            style={{
                              fontFamily:"'Jost',monospace",fontSize:12,fontWeight:600,letterSpacing:".08em",
                              border:`1px solid ${V.bd}`,borderRadius:6,padding:"4px 8px",
                              width:"90px",background:V.sf2,color:V.tx,outline:"none",
                              textTransform:"uppercase",
                            }}
                          />
                          <button
                            title="Copy hex"
                            onClick={()=>navigator.clipboard?.writeText(currentHex.toUpperCase())}
                            style={{background:"none",border:"none",cursor:"pointer",padding:2,color:V.mu,fontSize:13,lineHeight:1}}
                          >⎘</button>
                        </div>
                      );
                    })()}
                    <div style={{display:"flex",gap:6,marginBottom:6,flexWrap:"wrap"}}>
                      {/* Browser colour picker */}
                      <label title="Pick a custom colour" aria-label="Pick a custom colour" style={{
                        display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer",
                        padding:"7px 12px",borderRadius:8,
                        border:`1.5px solid ${V.ac}`,background:V.aclt,
                        position:"relative",overflow:"hidden",
                        fontFamily:"'Jost',sans-serif",fontSize:10,fontWeight:600,
                        color:V.tx,letterSpacing:".05em",flex:"1 1 auto",justifyContent:"center",
                      }}>
                        <span>🎨 Colour Picker</span>
                        {(activeKashaDesign||colorTarget==="all")
                          ?<input type="color" value={(activeKashaDesign||colorTarget==="all")?primaryColor:zoneColors[colorTarget as Exclude<typeof colorTarget,"all">]||primaryColor} onChange={e=>applyPrimary(e.target.value)} style={{position:"absolute",inset:0,opacity:0,cursor:"pointer"}}/>
                          :<input type="color" value={zoneColors[colorTarget as Exclude<typeof colorTarget,"all">]||primaryColor} onChange={e=>applyZoneColor(colorTarget as Exclude<typeof colorTarget,"all">,e.target.value)} style={{position:"absolute",inset:0,opacity:0,cursor:"pointer"}}/>}
                      </label>
                      {/* Eyedropper — reads exact pixel from the flat, unlit design canvas.
                          Note: the native browser EyeDropper (e.g. from the OS colour-picker
                          dialog) samples the actual lit 3D render, so colours placed on the
                          garment (logos, prints) will look darker/duller there than their true
                          value. This tool avoids that by sampling the flat source artwork
                          directly — use it (not the OS picker) to match a placed design's colour. */}
                      <button
                        title="Eyedropper — sample the exact colour from your uploaded design, unaffected by 3D lighting"
                        onClick={async ()=>{
                          const fc=fcRef.current; if(!fc) return;
                          fc.renderAll();
                          const rawEl: HTMLCanvasElement|null = typeof (fc as any).getElement==="function"?(fc as any).getElement():null;
                          if(!rawEl) return;
                          const dataUrl=rawEl.toDataURL("image/png");
                          const EyeDropperCtor=(window as any).EyeDropper;
                          if(typeof EyeDropperCtor==="function"){
                            setSamplerPreview(dataUrl);
                            setSamplerActive(true);
                            try{
                              await new Promise(r=>setTimeout(r,50));
                              const result=await new EyeDropperCtor().open();
                              const sampledHex=String(result.sRGBHex);
                              if(activeKashaDesign||colorTarget==="all") applyPrimary(sampledHex);
                              else applyZoneColor(colorTarget as Exclude<typeof colorTarget,"all">,sampledHex);
                            }catch{
                              // Cancelled — leave the click-to-sample overlay open as a fallback.
                              return;
                            }
                            setSamplerActive(false);
                            return;
                          }
                          setSamplerPreview(dataUrl);
                          setSamplerActive(true);
                        }}
                        style={{
                          display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer",
                          padding:"7px 12px",borderRadius:8,
                          border:`1.5px solid ${V.bd}`,background:V.sf2,
                          fontFamily:"'Jost',sans-serif",fontSize:10,fontWeight:600,
                          color:V.tx,letterSpacing:".05em",flex:"1 1 auto",justifyContent:"center",
                        }}
                      >💧 Eyedropper (Exact Colour)</button>
                    </div>
                    {/* Canvas sampler overlay */}
                    {samplerActive&&samplerPreview&&(
                      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:9999,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}} onClick={()=>setSamplerActive(false)}>
                        <div style={{fontFamily:"'Jost',sans-serif",fontSize:12,color:"#fff",letterSpacing:".06em",textTransform:"uppercase",fontWeight:600}}>
                          Click anywhere on the design to sample that colour
                        </div>
                        <div style={{position:"relative",cursor:"crosshair"}} onClick={e=>{
                          e.stopPropagation();
                          const rect=(e.currentTarget as HTMLElement).getBoundingClientRect();
                          const xRatio=(e.clientX-rect.left)/rect.width;
                          const yRatio=(e.clientY-rect.top)/rect.height;
                          const fc=fcRef.current as any;
                          if(!fc) return;
                          const rawEl: HTMLCanvasElement|null = typeof fc.getElement==="function"?fc.getElement():null;
                          if(!rawEl) return;
                          const ctx=rawEl.getContext("2d"); if(!ctx) return;
                          const px=Math.round(xRatio*rawEl.width);
                          const py=Math.round(yRatio*rawEl.height);
                          const d=ctx.getImageData(px,py,1,1).data;
                          const toHex=(n:number)=>n.toString(16).padStart(2,"0");
                          const sampledHex=`#${toHex(d[0])}${toHex(d[1])}${toHex(d[2])}`;
                          if(activeKashaDesign||colorTarget==="all") applyPrimary(sampledHex);
                          else applyZoneColor(colorTarget as Exclude<typeof colorTarget,"all">,sampledHex);
                          setSamplerActive(false);
                        }}>
                          <img src={samplerPreview ?? undefined} alt="Design canvas" style={{display:"block",maxWidth:"min(80vw,400px)",maxHeight:"min(80vh,400px)",imageRendering:"pixelated",border:"2px solid rgba(255,255,255,0.3)",borderRadius:4}}/>
                        </div>
                        <div style={{fontFamily:"'Jost',sans-serif",fontSize:10,color:"rgba(255,255,255,0.5)",letterSpacing:".04em"}}>Click outside to cancel</div>
                      </div>
                    )}
                    {!activeKashaDesign&&colorTarget!=="all"&&zoneColors[colorTarget as Exclude<typeof colorTarget,"all">]&&(
                      <button onClick={()=>applyZoneColor(colorTarget as Exclude<typeof colorTarget,"all">,"")} style={{fontSize:10,color:"#c45c5c",background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"'Jost',sans-serif",letterSpacing:".04em"}}>✕ Reset this zone</button>
                    )}
                  </div>
                  {/* Reset All Zones — only shown when no pattern design is active */}
                  {!activeKashaDesign&&(
                    <button onClick={()=>{PART_ZONES.forEach(z=>applyZoneColor(z.id,""));setColorTarget("all");}} style={{
                      width:"100%",padding:"9px 0",borderRadius:99,
                      border:`1px solid rgba(196,92,92,.35)`,background:"transparent",
                      color:"#c45c5c",fontSize:10,fontWeight:600,cursor:"pointer",
                      fontFamily:"'Jost',sans-serif",letterSpacing:".08em",textTransform:"uppercase",transition:"all 0.2s",
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(196,92,92,.07)";e.currentTarget.style.borderColor="rgba(196,92,92,.6)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.borderColor="rgba(196,92,92,.35)";}}>
                      ↺ Reset All Zones
                    </button>
                  )}
                </div>
              )}

              {/* ── PRINTS panel ──────────────────────────────────────── */}
              {activeTool==="prints"&&(
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  {productType==="print"&&(
                    <div style={{background:"rgba(201,168,76,0.07)",border:`1px solid rgba(201,168,76,0.18)`,borderRadius:10,padding:"10px 12px",fontSize:11,color:V.mu,fontStyle:"italic",fontFamily:"'Jost',sans-serif",lineHeight:1.6}}>
                      Pre-printed garment — select a print to change the design.
                    </div>
                  )}
                  <div style={{fontSize:9,color:V.mu,fontFamily:"'Jost',sans-serif",letterSpacing:".04em",marginBottom:4,fontStyle:"italic"}}>Single-click to preview · Double-click to apply</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5}}>
                    {visiblePatterns.slice(0,printGalleryLimit).map(p=>{
                      const sel=activePrintId===p.id;
                      const allApplied=allOverPrintId===p.id;
                      const inZone=Object.values(zonePrintIds).includes(p.id);
                      return(
                        <button key={p.id} onClick={()=>setActivePrintId(p.id)} onDoubleClick={()=>{applyAllOverPrint(p);saveHistory();}} title={`Single-click to select · Double-click to apply\n${p.label}`}
                          style={{
                            position:"relative",padding:0,aspectRatio:"1/1",
                            borderRadius:8,overflow:"hidden",cursor:"pointer",
                            border:sel?`2px solid ${V.ac}`:`1.5px solid transparent`,
                            outline:sel?`2px solid rgba(201,168,76,0.25)`:undefined,
                            outlineOffset:sel?"1px":undefined,
                            transition:"all 0.2s",
                            background:"rgba(0,0,0,0.06)",
                            boxShadow:sel?`0 0 0 1px ${V.ac},0 2px 8px rgba(201,168,76,0.2)`:"none",
                          }}>
                          <img src={patternUrl(p.file)} alt={p.label} loading="lazy" decoding="async" fetchPriority="low"
                            style={{width:"100%",height:"100%",objectFit:"cover",display:"block",pointerEvents:"none"}}/>
                          {allApplied&&<span style={{position:"absolute",top:2,right:2,fontSize:6,fontWeight:800,background:V.ac,color:V.tx,padding:"1px 4px",borderRadius:3}}>ALL</span>}
                          {!allApplied&&inZone&&<span style={{position:"absolute",top:2,right:2,fontSize:6,fontWeight:800,background:V.ac,color:V.tx,padding:"1px 4px",borderRadius:3}}>ZONE</span>}
                        </button>
                      );
                    })}
                  </div>
                  {printGalleryLimit<visiblePatterns.length&&(
                    <button onClick={()=>setPrintGalleryLimit(l=>l+12)} style={{
                      padding:"7px 0",borderRadius:8,border:`1px solid ${V.bd}`,
                      background:"transparent",color:V.mu,fontSize:10,fontWeight:500,
                      cursor:"pointer",fontFamily:"'Jost',sans-serif",letterSpacing:".04em",
                    }}>Load more ({visiblePatterns.length-printGalleryLimit} remaining)</button>
                  )}
                  {activePrintId&&(()=>{
                    const p=PATTERNS.find(x=>x.id===activePrintId); if(!p) return null;
                    return(
                      <div style={{background:V.sf2,border:`1px solid ${V.bd}`,borderRadius:10,padding:12,display:"flex",flexDirection:"column",gap:10}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <div style={{width:36,height:36,borderRadius:7,background:`url(${patternUrl(p!.file)}) center/cover`,border:`1px solid ${V.bd}`,flexShrink:0}}/>
                          <div style={{fontSize:13,fontWeight:600,color:V.tx,fontFamily:"'Cormorant Garamond',serif",letterSpacing:".02em"}}>{p!.customerLabel||p!.label}</div>
                        </div>
                        {/* When a KA.SHA pattern design is active, print acts as base texture.
                            Hide By Part toggle — full body only applies beneath the design. */}
                        {activeKashaDesign&&(
                          <div style={{background:"rgba(201,168,76,0.07)",border:"1px solid rgba(201,168,76,0.18)",borderRadius:8,padding:"8px 10px",fontSize:10,color:V.mu,fontStyle:"italic",fontFamily:"'Jost',sans-serif",lineHeight:1.55}}>
                            Pattern design active — print is applied as the base texture beneath the design.
                          </div>
                        )}
                        {productType!=="print"&&!activeKashaDesign&&(
                          <div style={{display:"flex",gap:4}}>
                            {(["fullBody","parts"] as const).map(m=>(
                              <button key={m} onClick={()=>setPrintMode(m)} style={{
                                flex:1,padding:"6px 0",fontSize:10,fontWeight:600,cursor:"pointer",
                                borderRadius:99,fontFamily:"'Jost',sans-serif",letterSpacing:".06em",textTransform:"uppercase",
                                border:printMode===m?`1.5px solid ${V.ac}`:`1px solid ${V.bd}`,
                                background:printMode===m?V.aclt:"transparent",
                                color:printMode===m?V.tx:V.mu,transition:"all .2s",
                              }}>{m==="fullBody"?"Full Body":"By Part"}</button>
                            ))}
                          </div>
                        )}
                        {(productType==="print"||activeKashaDesign||printMode==="fullBody")&&(
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            <button onClick={()=>{applyAllOverPrint(p!);saveHistory();}} style={{
                              padding:"9px 0",borderRadius:99,border:"none",
                              background:allOverPrintId===p!.id?V.tx:V.ac,
                              color:allOverPrintId===p!.id?"#fff":V.tx,
                              fontSize:11,fontWeight:600,cursor:"pointer",
                              fontFamily:"'Jost',sans-serif",letterSpacing:".06em",textTransform:"uppercase",transition:"all 0.2s",
                            }}>
                              {allOverPrintId===p!.id
                                ? (productType==="print"?"✓ Selected": activeKashaDesign?"✓ Applied as Base":"✓ Applied")
                                : (productType==="print"?"Select Print": activeKashaDesign?"Apply as Base Texture":"Apply All-Over")}
                            </button>
                            {allOverPrintId&&productType!=="print"&&!activeKashaDesign&&(
                              <button onClick={()=>{clearAllOverPrint();saveHistory();}} style={{
                                padding:"7px 0",borderRadius:99,
                                border:`1px solid rgba(196,92,92,.35)`,background:"transparent",
                                color:"#c45c5c",fontSize:10,fontWeight:500,cursor:"pointer",
                                fontFamily:"'Jost',sans-serif",letterSpacing:".04em",
                              }}>✕ Remove print</button>
                            )}
                          </div>
                        )}
                        {productType!=="print"&&!activeKashaDesign&&printMode==="parts"&&(()=>{
                          const zones: {id:Exclude<typeof activePartZone,"collar">;label:string}[]=[];
                          const pzones: {id:Exclude<PatternZone,"all">;label:string}[]=[
                            {id:"front",label:"Front"},{id:"back",label:"Back"},
                            {id:"collar",label:"Collar"},{id:"leftSleeve",label:"L.Sleeve"},{id:"rightSleeve",label:"R.Sleeve"},
                          ];
                          return(
                            <div style={{display:"flex",flexDirection:"column",gap:8}}>
                              <div style={{fontSize:10,color:V.mu,marginBottom:2,fontStyle:"italic",fontFamily:"'Jost',sans-serif"}}>Click part to apply / remove:</div>
                              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                                {pzones.map(z=>{
                                  const applied=zonePrintIds[z.id]===p!.id;
                                  const otherPrint=zonePrintIds[z.id]&&zonePrintIds[z.id]!==p!.id;
                                  return(
                                    <button key={z.id}
                                      onClick={()=>{applied?clearZonePrint(z.id):applyZonePrint(z.id,p!);saveHistory();}}
                                      style={{
                                        padding:"5px 10px",fontSize:10,fontWeight:applied?600:400,cursor:"pointer",
                                        borderRadius:99,fontFamily:"'Jost',sans-serif",letterSpacing:".05em",
                                        border:applied?`1.5px solid ${V.ac}`:otherPrint?`1px solid ${V.ac}`:`1px solid ${V.bd}`,
                                        background:applied?V.aclt:otherPrint?"rgba(201,168,76,0.07)":"transparent",
                                        color:applied?V.tx:otherPrint?V.ac:V.mu,transition:"all .2s",
                                      }}>
                                      {applied?"✓ ":""}{z.label}
                                    </button>
                                  );
                                })}
                              </div>
                              {Object.values(zonePrintIds).some(Boolean)&&(
                                <button onClick={()=>{clearAllZonePrints();saveHistory();}} style={{
                                  padding:"7px 0",borderRadius:99,
                                  border:`1px solid rgba(196,92,92,.35)`,background:"transparent",
                                  color:"#c45c5c",fontSize:10,fontWeight:500,cursor:"pointer",
                                  fontFamily:"'Jost',sans-serif",letterSpacing:".04em",
                                }}>✕ Clear all zone prints</button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── PATTERNS panel ────────────────────────────────────── */}
              {activeTool==="patterns"&&(
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  <div style={{background:`rgba(201,168,76,0.07)`,border:`1px solid rgba(201,168,76,0.2)`,borderRadius:10,padding:"10px 12px"}}>
                    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:14,fontWeight:600,color:V.ac,letterSpacing:".02em",marginBottom:2}}>KA.SHA Bespoke Designs</div>
                    <div style={{fontSize:11,color:V.mu,lineHeight:1.6,fontFamily:"'Jost',sans-serif"}}>Premium zone-mapped designs crafted for the course</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
                    {KASHA_DESIGNS.map(d=>{
                      const isA=activeKashaDesign?.id===d.id;
                      const zones=Object.keys(d.zones).length;
                      return(
                        <button key={d.id} onClick={()=>handleSelectKashaDesign(d)} title={d.label}
                          style={{
                            padding:"10px 8px",borderRadius:10,
                            border:isA?`2px solid ${V.ac}`:`1.5px solid ${V.bd}`,
                            background:isA?V.aclt:V.sf2,
                            cursor:"pointer",display:"flex",flexDirection:"column",
                            alignItems:"center",gap:6,fontFamily:"'Jost',sans-serif",
                            transition:"all 0.3s cubic-bezier(0.16,1,0.3,1)",
                            position:"relative",
                            boxShadow:isA?`0 4px 20px rgba(201,168,76,0.2)`:"0 1px 4px rgba(26,26,24,0.05)",
                          }}
                          onMouseEnter={e=>{if(!isA){e.currentTarget.style.borderColor="rgba(201,168,76,0.5)";e.currentTarget.style.transform="translateY(-2px)";}}}
                          onMouseLeave={e=>{if(!isA){e.currentTarget.style.borderColor=V.bd;e.currentTarget.style.transform="none";}}}>
                          {isA&&<div style={{position:"absolute",top:7,right:7,width:16,height:16,borderRadius:"50%",background:V.ac,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:V.tx,fontWeight:800}}>✓</div>}
                          <div style={{width:"100%",height:72,borderRadius:6,overflow:"hidden",background:V.sf,border:`1px solid ${V.bd}`,flexShrink:0}}>
                            {(d.thumbnail||d.zones.front)&&<img src={d.thumbnail||d.zones.front} alt={d.label} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"top",display:"block"}}/>}
                          </div>
                          <span style={{fontSize:10,color:isA?V.tx:V.mu,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase"}}>{d.id}</span>
                          <span style={{fontSize:11,color:V.mul,textAlign:"center",lineHeight:1.4,fontStyle:"italic",fontFamily:"'Cormorant Garamond',serif"}}>{zones} zone{zones!==1?"s":""}</span>
                        </button>
                      );
                    })}
                  </div>
                  {activeKashaDesign&&(
                    <div style={{background:V.sf2,border:`1px solid ${V.bd}`,borderRadius:10,padding:"10px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:600,color:V.tx,fontFamily:"'Jost',sans-serif",letterSpacing:".04em"}}>{activeKashaDesign!.id}</div>
                        <div style={{fontSize:12,color:V.mu,fontStyle:"italic",fontFamily:"'Cormorant Garamond',serif"}}>{activeKashaDesign!.label}</div>
                      </div>
                      <button onClick={()=>{const fc=fcRef.current;if(fc){clearKashaDesign(fc);syncTexture();}setActiveKashaDesign(null);saveHistory();}}
                        style={{fontSize:9,color:V.mu,background:"transparent",border:`1px solid ${V.bd}`,borderRadius:99,padding:"4px 10px",cursor:"pointer",fontFamily:"'Jost',sans-serif",letterSpacing:".05em",flexShrink:0,transition:"all 0.2s"}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=V.ac;e.currentTarget.style.color=V.tx;}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor=V.bd;e.currentTarget.style.color=V.mu;}}>
                        Clear
                      </button>
                    </div>
                  )}

                  {/* ── Pattern Colours — only shown when a design is active ── */}
                  {activeKashaDesign&&(
                    <div style={{display:"flex",flexDirection:"column",gap:12,background:V.sf2,border:`1px solid ${V.bd}`,borderRadius:12,padding:"12px 12px 14px"}}>
                      {/* Header */}
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <div>
                          <div style={{fontSize:10,fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",color:V.tx,fontFamily:"'Jost',sans-serif"}}>Pattern Colours</div>
                          <div style={{fontSize:10,color:V.mu,fontFamily:"'Jost',sans-serif",marginTop:1}}>Recolor the design's two colour channels</div>
                        </div>
                        {patRecoloring&&<div style={{width:14,height:14,borderRadius:"50%",border:`2px solid ${V.bd}`,borderTopColor:V.ac,animation:"spin .8s linear infinite",flexShrink:0}}/>}
                      </div>

                      {/* SKU colour-resolution errors */}
                      {skuColorErrors.length>0&&(
                        <div style={{display:"flex",flexDirection:"column",gap:4,padding:"8px 10px",background:"rgba(196,92,92,.08)",border:"1px solid rgba(196,92,92,.3)",borderRadius:8}}>
                          <div style={{fontSize:9,fontWeight:700,letterSpacing:".10em",textTransform:"uppercase",color:"#c45c5c",fontFamily:"'Jost',sans-serif"}}>Colour not recognised</div>
                          {skuColorErrors.map(tok=>(
                            <div key={tok} style={{fontSize:10,color:"#c45c5c",fontFamily:"'Jost',sans-serif"}}>
                              <span style={{fontFamily:"monospace",fontWeight:700}}>{tok}</span>
                              {" "}— not a valid hex or colour name. Use a 6-digit hex (e.g. <span style={{fontFamily:"monospace"}}>3D1C02</span>) or a CSS colour name.
                            </div>
                          ))}
                          <button
                            onClick={()=>setSkuColorErrors([])}
                            style={{alignSelf:"flex-start",marginTop:2,fontSize:9,color:"#c45c5c",background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"'Jost',sans-serif",textDecoration:"underline"}}
                          >Dismiss</button>
                        </div>
                      )}

                      {/* Channel A — Dark tones */}
                      <div>
                        <div style={{fontSize:9,fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",color:"#555540",fontFamily:"'Jost',sans-serif",marginBottom:6}}>Channel A — Dark tones</div>
                        {/* Editable colour entry */}
                        <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:V.bg,borderRadius:8,border:`1px solid ${errColorA?"#c45c5c":V.bd}`,marginBottom:8,transition:"border-color .2s"}}>
                          <div style={{width:28,height:28,borderRadius:6,background:patColorA,border:`1px solid ${V.bd2}`,flexShrink:0,transition:"background .2s"}}/>
                          <div style={{flex:1}}>
                            <div style={{fontSize:9,color:V.mu,fontFamily:"'Jost',sans-serif",fontWeight:600,letterSpacing:".06em",textTransform:"uppercase",marginBottom:2}}>Color A</div>
                            <input
                              type="text"
                              value={draftColorA}
                              onChange={e=>{ setDraftColorA(e.target.value); setErrColorA(false); }}
                              onBlur={e=>{
                                const hex=cssColorToHex(e.target.value.trim());
                                if(hex){ setErrColorA(false); applyPatternColors(hex,patColorB); saveHistory(); }
                                else setErrColorA(true);
                              }}
                              onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); const hex=cssColorToHex((e.target as HTMLInputElement).value.trim()); if(hex){setErrColorA(false);applyPatternColors(hex,patColorB);saveHistory();}else setErrColorA(true); } }}
                              placeholder="hex or colour name"
                              spellCheck={false}
                              style={{
                                width:"100%",background:"transparent",border:"none",outline:"none",
                                fontFamily:"'Jost',monospace",fontSize:11,fontWeight:600,
                                letterSpacing:".07em",color:errColorA?"#c45c5c":V.tx,
                                textTransform:"uppercase",padding:0,
                              }}
                            />
                          </div>
                          {errColorA&&<div style={{fontSize:9,color:"#c45c5c",fontFamily:"'Jost',sans-serif",whiteSpace:"nowrap"}}>Unknown colour</div>}
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:5,alignItems:"center"}}>
                          {DARK_SWATCHES.map(hex=>(
                            <div key={hex} onClick={()=>{applyPatternColors(hex, patColorB);saveHistory();}} style={{
                              width:22,height:22,borderRadius:"50%",cursor:"pointer",flexShrink:0,
                              background:hex,
                              border:patColorA===hex?`2.5px solid ${V.ac}`:`1.5px solid ${hex==="#ffffff"?V.bd2:"transparent"}`,
                              boxShadow:patColorA===hex?`0 0 0 2px rgba(201,168,76,0.25)`:"none",
                              transform:patColorA===hex?"scale(1.15)":"scale(1)",
                              transition:"all .18s",
                            }} title={hex}/>
                          ))}
                          <label title="Custom dark colour" style={{width:22,height:22,borderRadius:"50%",cursor:"pointer",overflow:"hidden",position:"relative",border:`1.5px dashed ${V.bd2}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:V.mu,flexShrink:0}}>
                            +<input type="color" value={patColorA} onChange={e=>applyPatternColors(e.target.value, patColorB)} style={{position:"absolute",inset:0,opacity:0,cursor:"pointer"}}/>
                          </label>
                        </div>
                      </div>

                      {/* Channel B — Light tones */}
                      <div>
                        <div style={{fontSize:9,fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",color:"#555540",fontFamily:"'Jost',sans-serif",marginBottom:6}}>Channel B — Light tones</div>
                        {/* Editable colour entry */}
                        <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:V.bg,borderRadius:8,border:`1px solid ${errColorB?"#c45c5c":V.bd}`,marginBottom:8,transition:"border-color .2s"}}>
                          <div style={{width:28,height:28,borderRadius:6,background:patColorB,border:`1px solid ${V.bd2}`,flexShrink:0,transition:"background .2s"}}/>
                          <div style={{flex:1}}>
                            <div style={{fontSize:9,color:V.mu,fontFamily:"'Jost',sans-serif",fontWeight:600,letterSpacing:".06em",textTransform:"uppercase",marginBottom:2}}>Color B</div>
                            <input
                              type="text"
                              value={draftColorB}
                              onChange={e=>{ setDraftColorB(e.target.value); setErrColorB(false); }}
                              onBlur={e=>{
                                const hex=cssColorToHex(e.target.value.trim());
                                if(hex){ setErrColorB(false); applyPatternColors(patColorA,hex); saveHistory(); }
                                else setErrColorB(true);
                              }}
                              onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); const hex=cssColorToHex((e.target as HTMLInputElement).value.trim()); if(hex){setErrColorB(false);applyPatternColors(patColorA,hex);saveHistory();}else setErrColorB(true); } }}
                              placeholder="hex or colour name"
                              spellCheck={false}
                              style={{
                                width:"100%",background:"transparent",border:"none",outline:"none",
                                fontFamily:"'Jost',monospace",fontSize:11,fontWeight:600,
                                letterSpacing:".07em",color:errColorB?"#c45c5c":V.tx,
                                textTransform:"uppercase",padding:0,
                              }}
                            />
                          </div>
                          {errColorB&&<div style={{fontSize:9,color:"#c45c5c",fontFamily:"'Jost',sans-serif",whiteSpace:"nowrap"}}>Unknown colour</div>}
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:5,alignItems:"center"}}>
                          {LIGHT_SWATCHES.map(hex=>(
                            <div key={hex} onClick={()=>{applyPatternColors(patColorA, hex);saveHistory();}} style={{
                              width:22,height:22,borderRadius:"50%",cursor:"pointer",flexShrink:0,
                              background:hex,
                              border:patColorB===hex?`2.5px solid ${V.ac}`:`1.5px solid ${hex==="#ffffff"?V.bd2:"transparent"}`,
                              boxShadow:patColorB===hex?`0 0 0 2px rgba(201,168,76,0.25)`:"none",
                              transform:patColorB===hex?"scale(1.15)":"scale(1)",
                              transition:"all .18s",
                            }} title={hex}/>
                          ))}
                          <label title="Custom light colour" style={{width:22,height:22,borderRadius:"50%",cursor:"pointer",overflow:"hidden",position:"relative",border:`1.5px dashed ${V.bd2}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:V.mu,flexShrink:0}}>
                            +<input type="color" value={patColorB} onChange={e=>applyPatternColors(patColorA, e.target.value)} style={{position:"absolute",inset:0,opacity:0,cursor:"pointer"}}/>
                          </label>
                        </div>
                      </div>

                      {/* Mix preview */}
                      <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:V.bg,borderRadius:8,border:`1px solid ${V.bd}`}}>
                        <div style={{fontSize:9,color:V.mu,letterSpacing:".08em",textTransform:"uppercase",fontFamily:"'Jost',sans-serif",flexShrink:0}}>Mix</div>
                        <div style={{width:18,height:18,borderRadius:4,background:patColorA,border:`1px solid ${V.bd2}`,flexShrink:0}}/>
                        <div style={{fontSize:10,color:V.mu}}>+</div>
                        <div style={{width:18,height:18,borderRadius:4,background:patColorB,border:`1px solid ${V.bd2}`,flexShrink:0}}/>
                        <div style={{fontSize:9,color:V.mu,flex:1,textAlign:"center",letterSpacing:".04em",fontFamily:"'Jost',sans-serif"}}>→</div>
                        <div style={{width:48,height:18,borderRadius:4,border:`1px solid ${V.bd2}`,flexShrink:0,background:`linear-gradient(90deg,${patColorA},${patColorB})`}}/>
                      </div>

                      {/* Quick Presets */}
                      <div>
                        <div style={{fontSize:9,fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",color:"#555540",fontFamily:"'Jost',sans-serif",marginBottom:7}}>Quick Presets</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5}}>
                          {PATTERN_PRESETS.map(p=>{
                            const isA=p.a===patColorA&&p.b===patColorB;
                            return(
                              <div key={p.name} onClick={()=>{applyPatternColors(p.a,p.b);saveHistory();}} title={`${p.name}: A=${p.a} B=${p.b}`} style={{
                                borderRadius:7,overflow:"hidden",cursor:"pointer",
                                border:`1.5px solid ${isA?V.ac:V.bd}`,
                                boxShadow:isA?`0 0 0 1.5px rgba(201,168,76,0.25)`:"none",
                                transition:"all .18s",
                              }}
                              onMouseEnter={e=>{if(!isA)e.currentTarget.style.borderColor="rgba(201,168,76,0.5)";}}
                              onMouseLeave={e=>{if(!isA)e.currentTarget.style.borderColor=V.bd;}}>
                                <div style={{display:"flex",height:22}}>
                                  <div style={{flex:1,background:p.a}}/>
                                  <div style={{flex:1,background:p.b}}/>
                                </div>
                                <div style={{fontSize:8,color:isA?V.tx:"#888",textAlign:"center",padding:"3px 2px",background:V.bg,fontFamily:"'Jost',sans-serif",letterSpacing:".04em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Randomize / Swap / Reset row */}
                      <div style={{display:"flex",gap:5}}>
                        <button onClick={()=>{
                          const a=RANDOM_DARK_PAT[Math.floor(Math.random()*RANDOM_DARK_PAT.length)];
                          const b=RANDOM_LIGHT_PAT[Math.floor(Math.random()*RANDOM_LIGHT_PAT.length)];
                          applyPatternColors(a,b);saveHistory();
                        }} style={{flex:1,padding:"6px 0",fontSize:9,fontWeight:600,cursor:"pointer",borderRadius:99,fontFamily:"'Jost',sans-serif",letterSpacing:".06em",textTransform:"uppercase",border:`1px solid ${V.bd}`,background:"transparent",color:V.mu,transition:"all .2s"}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=V.ac;e.currentTarget.style.color=V.tx;}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor=V.bd;e.currentTarget.style.color=V.mu;}}>
                          🎲 Random
                        </button>
                        <button onClick={()=>{applyPatternColors(patColorB,patColorA);saveHistory();}} style={{flex:1,padding:"6px 0",fontSize:9,fontWeight:600,cursor:"pointer",borderRadius:99,fontFamily:"'Jost',sans-serif",letterSpacing:".06em",textTransform:"uppercase",border:`1px solid ${V.bd}`,background:"transparent",color:V.mu,transition:"all .2s"}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=V.ac;e.currentTarget.style.color=V.tx;}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor=V.bd;e.currentTarget.style.color=V.mu;}}>
                          ⇄ Swap A↔B
                        </button>
                        <button onClick={()=>{applyPatternColors(PAT_COLOR_A_DEFAULT,PAT_COLOR_B_DEFAULT);saveHistory();}} style={{flex:1,padding:"6px 0",fontSize:9,fontWeight:600,cursor:"pointer",borderRadius:99,fontFamily:"'Jost',sans-serif",letterSpacing:".06em",textTransform:"uppercase",border:`1px solid rgba(196,92,92,.3)`,background:"transparent",color:"#c45c5c",transition:"all .2s"}}
                        onMouseEnter={e=>{e.currentTarget.style.background="rgba(196,92,92,.07)";}}
                        onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                          ↺ Reset
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── TEXT panel ────────────────────────────────────────── */}
              {activeTool==="text"&&(
                <div style={{display:"flex",flexDirection:"column",gap:0}}>
                  {/* Title */}
                  <div style={{textAlign:"center",letterSpacing:".18em",fontSize:11,fontWeight:600,color:V.tx,fontFamily:"'Jost',sans-serif",textTransform:"uppercase",padding:"4px 0 18px"}}>Add Text</div>

                  {/* TEXT input */}
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:V.mu,fontFamily:"'Jost',sans-serif",marginBottom:6}}>Text</div>
                    <input
                      value={textInput}
                      onChange={e=>{setTextInput(e.target.value);if(textObjRef.current){textObjRef.current.set({text:e.target.value});fcRef.current?.renderAll();syncTexture();}}}
                      placeholder="Your text here"
                      style={{width:"100%",padding:"10px 14px",boxSizing:"border-box",background:"#fff",border:`1.5px solid ${V.bd}`,borderRadius:8,color:V.tx,fontSize:13,fontFamily:"'Jost',sans-serif",outline:"none",transition:"border-color 0.2s"}}
                      onFocus={e=>e.target.style.borderColor=V.ac}
                      onBlur={e=>e.target.style.borderColor=V.bd}
                    />
                  </div>

                  {/* Placement thumbnails — shown FIRST so mobile users see it without scrolling */}
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:V.mu,fontFamily:"'Jost',sans-serif",marginBottom:8}}>Placement</div>
                    {(()=>{
                      const cards=[
                        {key:"front-left",   label:"Chest Left",   cx:39,cy:40},
                        {key:"front-right",  label:"Chest Right",  cx:21,cy:40},
                        {key:"left-sleeve",  label:"Right Sleeve", cx:7, cy:23},
                        {key:"right-sleeve", label:"Left Sleeve",  cx:53,cy:23},
                        {key:"back-top",     label:"Back Top",     cx:30,cy:24,back:true},
                        {key:"back-center",  label:"Centre Back",  cx:30,cy:52,back:true},
                        {key:"collar-left",  label:"Collar Right", cx:24,cy:14},
                        {key:"collar-right", label:"Collar Left",  cx:36,cy:14},
                      ] as {key:string;label:string;cx:number;cy:number;back?:boolean}[];
                      return(
                        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5}}>
                          {cards.map(c=>{
                            const isA=textPosition===c.key;
                            const svg=`<svg viewBox="0 0 60 68" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 4L10 12L4 32L14 34L14 64H46L46 34L56 32L50 12L38 4L34 6C32 8 28 8 26 6Z" fill="#e8e4dc" stroke="#1a1a18" stroke-width="1.5"/>${c.back?`<text x="30" y="54" text-anchor="middle" font-size="6" fill="#999" font-family="sans-serif">back</text>`:""}<circle cx="${c.cx}" cy="${c.cy}" r="3.5" fill="${isA?"#c9a84c":"#aaa"}"/></svg>`;
                            return(
                              <div key={c.key} onClick={()=>{const isCollar=c.key==="collar-left"||c.key==="collar-right";setTextPosition(c.key);if(isCollar)setTextFontSize(v=>Math.min(v,14));setCameraView(PLACEMENT_VIEW[c.key]||"front");setModelPaused(true);const mv_=mvRef.current as any;if(mv_){mv_.removeAttribute("auto-rotate");mv_.removeAttribute("auto-rotate-delay");}if(textObjRef.current){const pos=LOGO_POSITIONS[c.key]||{left:512,top:512};const fs=isCollar?Math.min(textFontSize,14):textFontSize;textObjRef.current.set({left:pos.left,top:pos.top,originX:"center",originY:"center",flipX:placementFlipX(c.key),flipY:placementFlipY(c.key),angle:placementAngle(c.key),fontSize:fs,scaleX:1,scaleY:1});clampCollarText(textObjRef.current,c.key);textObjRef.current.setCoords();fcRef.current?.renderAll();syncTexture();}}} style={{
                                display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"pointer",
                                padding:"6px 2px",borderRadius:9,transition:"all .18s",
                                border:`1.5px solid ${isA?V.ac:V.bd}`,background:isA?V.aclt:"transparent",
                              }}>
                                <div style={{width:32,height:36}} dangerouslySetInnerHTML={{__html:svg}}/>
                                <span style={{fontSize:8,textTransform:"uppercase",letterSpacing:".03em",fontFamily:"'Jost',sans-serif",color:isA?V.tx:"#4a4a48",fontWeight:isA?700:500,textAlign:"center",lineHeight:1.2}}>{c.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* FONT SIZE + COLOR row */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                    <div>
                      <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:V.mu,fontFamily:"'Jost',sans-serif",marginBottom:6}}>Font Size</div>
                      <div style={{position:"relative"}}>
                        <select value={textFontSize} onChange={e=>{const v=+e.target.value;setTextFontSize(v);if(textObjRef.current){const pos=LOGO_POSITIONS[textPosition]||{left:512,top:512};textObjRef.current.set({fontSize:v,left:pos.left,top:pos.top,originX:"center",originY:"center",flipX:placementFlipX(textPosition),flipY:placementFlipY(textPosition),angle:placementAngle(textPosition),scaleX:1,scaleY:1});clampCollarText(textObjRef.current,textPosition);textObjRef.current.setCoords();fcRef.current?.renderAll();syncTexture();}}} style={{width:"100%",padding:"9px 28px 9px 12px",border:`1.5px solid ${V.bd}`,borderRadius:8,background:"#fff",color:V.tx,fontSize:13,fontFamily:"'Jost',sans-serif",appearance:"none",WebkitAppearance:"none",cursor:"pointer",outline:"none"}}>
                          {[16,20,24,28,32,36,40,48,56,64,72,80,96].map(s=><option key={s} value={s}>{s}</option>)}
                        </select>
                        <span style={{position:"absolute",right:9,top:"50%",transform:"translateY(-50%)",pointerEvents:"none",fontSize:10,color:V.mu}}>▾</span>
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:V.mu,fontFamily:"'Jost',sans-serif",marginBottom:6}}>Color</div>
                      <label style={{display:"flex",alignItems:"center",justifyContent:"center",width:"100%",height:56,borderRadius:8,border:`1.5px solid ${V.bd}`,background:"#fff",cursor:"pointer",overflow:"hidden",position:"relative"}}>
                        <div style={{width:40,height:40,borderRadius:6,background:textColor,border:"1.5px solid rgba(0,0,0,.12)"}}/>
                        <input type="color" value={textColor} onChange={e=>{const v=e.target.value;setTextColor(v);if(textObjRef.current){textObjRef.current.set({fill:v});fcRef.current?.renderAll();syncTexture();}}} style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",width:"100%",height:"100%"}}/>
                      </label>
                      <div style={{fontSize:8,color:V.mu,letterSpacing:".05em",fontFamily:"'Jost',sans-serif",marginTop:4,textAlign:"center"}}>Pick your colour from the colour picker</div>
                    </div>
                  </div>

                  {/* FONT STYLE: B U I */}
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:V.mu,fontFamily:"'Jost',sans-serif",marginBottom:6}}>Font Style</div>
                    <div style={{display:"flex",gap:8}}>
                      {([
                        {label:"B",title:"Bold",active:textBold,style:{fontWeight:700},action:()=>{const n=!textBold;setTextBold(n);if(textObjRef.current){textObjRef.current.set({fontWeight:n?"700":"400"});fcRef.current?.renderAll();syncTexture();}}},
                        {label:"U",title:"Underline",active:textUnderline,style:{textDecoration:"underline"},action:()=>{const n=!textUnderline;setTextUnderline(n);if(textObjRef.current){textObjRef.current.set({underline:n});fcRef.current?.renderAll();syncTexture();}}},
                        {label:"I",title:"Italic",active:textItalic,style:{fontStyle:"italic"},action:()=>{const n=!textItalic;setTextItalic(n);if(textObjRef.current){textObjRef.current.set({fontStyle:n?"italic":"normal"});fcRef.current?.renderAll();syncTexture();}}},
                      ] as {label:string;title:string;active:boolean;style:React.CSSProperties;action:()=>void}[]).map(btn=>(
                        <button key={btn.label} title={btn.title} onClick={btn.action} style={{
                          width:44,height:38,borderRadius:8,fontSize:14,cursor:"pointer",fontFamily:"'Jost',sans-serif",
                          border:`1.5px solid ${btn.active?V.ac:V.bd}`,background:btn.active?V.aclt:"#fff",
                          color:btn.active?V.tx:V.mu,transition:"all 0.18s",...btn.style,
                        }}>{btn.label}</button>
                      ))}
                    </div>
                  </div>

                  {/* FONT dropdown */}
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:V.mu,fontFamily:"'Jost',sans-serif",marginBottom:6}}>Font</div>
                    <div style={{position:"relative"}}>
                      <select value={textFont} onChange={e=>{const v=e.target.value;setTextFont(v);if(textObjRef.current){textObjRef.current.set({fontFamily:v});fcRef.current?.renderAll();syncTexture();}}} style={{width:"100%",padding:"9px 28px 9px 12px",border:`1.5px solid ${V.bd}`,borderRadius:8,background:"#fff",color:V.tx,fontSize:13,fontFamily:textFont+",sans-serif",appearance:"none",WebkitAppearance:"none",cursor:"pointer",outline:"none"}}>
                        {["Tinos","DM Sans","Jost","Georgia","Playfair Display","Cormorant Garamond","Montserrat","Raleway","Oswald","Dancing Script"].map(f=><option key={f} value={f} style={{fontFamily:f}}>{f}</option>)}
                      </select>
                      <span style={{position:"absolute",right:9,top:"50%",transform:"translateY(-50%)",pointerEvents:"none",fontSize:10,color:V.mu}}>▾</span>
                    </div>
                  </div>

                  {/* TEXT ALIGNMENT */}
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:V.mu,fontFamily:"'Jost',sans-serif",marginBottom:6}}>Text Alignment</div>
                    <div style={{display:"flex",gap:6}}>
                      {([
                        {id:"left",   svg:"M3 6h14M3 10h10M3 14h12M3 18h8"},
                        {id:"center", svg:"M3 6h14M6 10h8M5 14h10M7 18h6"},
                        {id:"right",  svg:"M7 6h10M11 10h6M9 14h8M13 18h4"},
                        {id:"justify",svg:"M3 6h14M3 10h14M3 14h14M3 18h14"},
                      ] as {id:string;svg:string}[]).map(a=>{
                        const isA=textAlign===a.id;
                        return(
                          <button key={a.id} title={a.id} onClick={()=>{setTextAlign(a.id as any);if(textObjRef.current){textObjRef.current.set({textAlign:a.id});fcRef.current?.renderAll();syncTexture();}}} style={{
                            flex:1,height:38,borderRadius:8,border:`1.5px solid ${isA?V.ac:V.bd}`,background:isA?V.aclt:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.18s",
                          }}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke={isA?V.ac:V.mu} strokeWidth="1.6" strokeLinecap="round">
                              {a.svg.split("M").filter(Boolean).map((d,i)=><path key={i} d={"M"+d}/>)}
                            </svg>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* TEXT EFFECT */}
                  <div style={{marginBottom:18}}>
                    <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:V.mu,fontFamily:"'Jost',sans-serif",marginBottom:6}}>Text Effect <span style={{color:V.mu,fontWeight:400,letterSpacing:".06em",fontSize:8,textTransform:"none"}}>( Straight )</span></div>
                    <div style={{display:"flex",gap:6}}>
                      {["Straight","Arch","Wave"].map(fx=>(
                        <button key={fx} style={{
                          flex:1,padding:"8px 0",borderRadius:8,fontSize:9,letterSpacing:".06em",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Jost',sans-serif",
                          border:`1.5px solid ${fx==="Straight"?V.ac:V.bd}`,background:fx==="Straight"?V.aclt:"#fff",
                          color:fx==="Straight"?V.tx:V.mu,transition:"all 0.18s",
                        }}>{fx}</button>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={()=>{applyText();saveHistory();}} disabled={!textInput.trim()} style={{
                      flex:2,padding:"10px 0",borderRadius:99,border:"none",
                      background:textInput.trim()?V.tx:"#ccc",color:"#fff",fontSize:11,fontWeight:600,
                      cursor:textInput.trim()?"pointer":"default",fontFamily:"'Jost',sans-serif",letterSpacing:".07em",textTransform:"uppercase",transition:"all 0.2s",
                    }}
                    onMouseEnter={e=>{if(textInput.trim()){e.currentTarget.style.background=V.ac;e.currentTarget.style.color=V.tx;}}}
                    onMouseLeave={e=>{e.currentTarget.style.background=textInput.trim()?V.tx:"#ccc";e.currentTarget.style.color="#fff";}}>
                      {textObjRef.current?"Replace":"Add Text"}
                    </button>
                    {textObjRef.current&&(<button onClick={repositionText} style={{flex:1,padding:"10px 0",borderRadius:99,border:`1px solid ${V.bd}`,background:"transparent",color:V.mu,fontSize:10,fontWeight:500,cursor:"pointer",fontFamily:"'Jost',sans-serif",letterSpacing:".06em",textTransform:"uppercase",transition:"all 0.2s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=V.ac;e.currentTarget.style.color=V.tx;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=V.bd;e.currentTarget.style.color=V.mu;}}>Move</button>)}
                    {textObjRef.current&&(<button onClick={()=>{removeText();saveHistory();}} style={{padding:"10px 12px",borderRadius:99,border:`1px solid rgba(196,92,92,.35)`,background:"transparent",color:"#c45c5c",fontSize:10,fontWeight:500,cursor:"pointer",fontFamily:"'Jost',sans-serif",letterSpacing:".05em",transition:"all 0.2s"}}>✕</button>)}
                  </div>
                </div>
              )}

              {/* ── IMAGE / LOGO panel ────────────────────────────────── */}
              {activeTool==="image"&&(
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  {/* Upload */}
                  <div>
                    <div style={sb}>Upload logo</div>
                    <label style={{
                      display:"flex",flexDirection:"column",alignItems:"center",gap:8,
                      padding:"20px",border:`2px dashed ${V.bd}`,borderRadius:12,
                      cursor:"pointer",transition:"all 0.2s",
                      background:V.sf2,
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=V.ac;e.currentTarget.style.background=V.aclt;}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=V.bd;e.currentTarget.style.background=V.sf2;}}>
                      <span style={{fontSize:28,lineHeight:1}}>🖼</span>
                      <span style={{fontSize:11,color:V.mu,fontFamily:"'Jost',sans-serif",letterSpacing:".04em",textAlign:"center"}}>Click to upload<br/><span style={{fontSize:10,opacity:.7}}>PNG, JPG, SVG</span></span>
                      <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{handleLogoUpload(e);saveHistory();}}/>
                    </label>
                    {logoPreview&&(
                      <div style={{marginTop:10}}>
                        <div style={{width:"100%",aspectRatio:"2",background:V.sf2,border:`1px solid ${V.bd}`,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",marginBottom:6}}>
                          <img src={logoPreview||undefined} alt="Logo" style={{maxWidth:"80%",maxHeight:"80%",objectFit:"contain"}}/>
                        </div>
                        <button onClick={()=>{removeLogo();saveHistory();}} style={{fontSize:10,color:"#c45c5c",background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"'Jost',sans-serif",letterSpacing:".04em"}}>✕ Remove logo</button>
                      </div>
                    )}
                  </div>
                  {/* Placement thumbnails */}
                  <div>
                    <div style={{fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:V.mu,fontFamily:"'Jost',sans-serif",marginBottom:8,...sb}}>Placement</div>
                    {(()=>{
                      const cards=[
                        {key:"front-left",   label:"Chest Left",   cx:39,cy:40},
                        {key:"front-right",  label:"Chest Right",  cx:21,cy:40},
                        {key:"left-sleeve",  label:"Right Sleeve", cx:7, cy:23},
                        {key:"right-sleeve", label:"Left Sleeve",  cx:53,cy:23},
                        {key:"back-top",     label:"Back Top",     cx:30,cy:24,back:true},
                        {key:"back-center",  label:"Centre Back",  cx:30,cy:52,back:true},
                        {key:"collar-left",  label:"Collar Right", cx:24,cy:14},
                        {key:"collar-right", label:"Collar Left",  cx:36,cy:14},
                      ] as {key:string;label:string;cx:number;cy:number;back?:boolean}[];
                      return(
                        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5}}>
                          {cards.map(c=>{
                            const isA=logoPosition===c.key;
                            const svg=`<svg viewBox="0 0 60 68" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 4L10 12L4 32L14 34L14 64H46L46 34L56 32L50 12L38 4L34 6C32 8 28 8 26 6Z" fill="#e8e4dc" stroke="#1a1a18" stroke-width="1.5"/>${c.back?`<text x="30" y="54" text-anchor="middle" font-size="6" fill="#999" font-family="sans-serif">back</text>`:""}<circle cx="${c.cx}" cy="${c.cy}" r="3.5" fill="${isA?"#c9a84c":"#aaa"}"/></svg>`;
                            return(
                              <div key={c.key} onClick={()=>{setLogoPosition(c.key);setLogoSize(s=>Math.min(s,PLACEMENT_MAX_PCT[c.key]??20));setCameraView(PLACEMENT_VIEW[c.key]||"front");setModelPaused(true);const mv_=mvRef.current as any;if(mv_){mv_.removeAttribute("auto-rotate");mv_.removeAttribute("auto-rotate-delay");}if(logoObjRef.current){const pos=LOGO_POSITIONS[c.key]||{left:512,top:512};logoObjRef.current.set({left:pos.left,top:pos.top,originX:"center",originY:"center",flipX:placementFlipX(c.key),flipY:placementFlipY(c.key),angle:placementAngle(c.key)});logoObjRef.current.setCoords();fcRef.current?.renderAll();syncTexture();}}} style={{
                                display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"pointer",
                                padding:"8px 4px",borderRadius:9,transition:"all .18s",
                                border:`1.5px solid ${isA?V.ac:V.bd}`,background:isA?V.aclt:"transparent",
                              }}>
                                <div style={{width:40,height:45}} dangerouslySetInnerHTML={{__html:svg}}/>
                                <span style={{fontSize:11,textTransform:"uppercase",letterSpacing:".04em",fontFamily:"'Jost',sans-serif",color:isA?V.tx:"#4a4a48",fontWeight:isA?700:500,textAlign:"center",lineHeight:1.25}}>{c.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                  {/* Size */}
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={sb}>Logo size</div>
                      <span style={{fontSize:11,color:V.tx,fontWeight:600,fontFamily:"'Jost',sans-serif"}}>{logoSize}%</span>
                    </div>
                    <input type="range" min={5} max={PLACEMENT_MAX_PCT[logoPosition]??20} step={1} value={Math.min(logoSize,PLACEMENT_MAX_PCT[logoPosition]??20)}
                      onChange={e=>{const v=+e.target.value;setLogoSize(v);if(logoObjRef.current){const pos=LOGO_POSITIONS[logoPosition]||{left:512,top:512};logoObjRef.current.scaleToWidth(logoMaxW(logoPosition,v));logoObjRef.current.set({left:pos.left,top:pos.top,originX:"center",originY:"center",angle:placementAngle(logoPosition)});logoObjRef.current.setCoords();fcRef.current?.renderAll();syncTexture();}}}
                      style={{width:"100%",height:4,background:V.bd2,borderRadius:2,outline:"none",WebkitAppearance:"none",appearance:"none",accentColor:V.ac}}/>
                  </div>
                </div>
              )}

              {/* ── ORDER panel ───────────────────────────────────────── */}
              {activeTool==="order"&&(
                <div style={{display:"flex",flexDirection:"column",gap:16}}>
                  {/* Size */}
                  <div>
                    <div style={sb}>Choose your size</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {SIZES.map(s=>(
                        <button key={s} onClick={()=>setSize(s)} style={{
                          width:46,height:46,
                          border:`1.5px solid ${size===s?V.ac:V.bd}`,
                          borderRadius:10,fontSize:12,cursor:"pointer",
                          background:size===s?V.ac:"transparent",
                          color:size===s?V.tx:V.mu,
                          fontFamily:"'Jost',sans-serif",fontWeight:600,
                          letterSpacing:".04em",transition:"all 0.2s",
                          boxShadow:size===s?`0 2px 10px rgba(201,168,76,0.25)`:"none",
                        }}>{s}</button>
                      ))}
                    </div>
                  </div>
                  {/* Custom measurements */}
                  <details>
                    <summary style={{
                      fontSize:10,color:V.mu,cursor:"pointer",marginBottom:6,
                      fontFamily:"'Jost',sans-serif",letterSpacing:".06em",textTransform:"uppercase",fontWeight:500,
                    }}>Custom measurements (optional)</summary>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10}}>
                      {(["chest","waist","hip","shoulder","length","sleeve"] as const).map(key=>(
                        <div key={key}>
                          <label style={{fontSize:9,color:V.mu,display:"block",marginBottom:4,textTransform:"capitalize",letterSpacing:".08em",fontWeight:500}}>{key}</label>
                          <input value={customMeasurements[key]} onChange={e=>setCustomMeasurements(p=>({...p,[key]:e.target.value}))}
                            placeholder={'e.g. 38"'}
                            style={{
                              width:"100%",padding:"7px 10px",
                              background:V.sf2,border:`1.5px solid ${V.bd}`,borderRadius:8,
                              color:V.tx,fontSize:11,fontFamily:"'Jost',sans-serif",
                              outline:"none",boxSizing:"border-box",transition:"border-color 0.2s",
                            }}
                            onFocus={e=>e.target.style.borderColor=V.ac}
                            onBlur={e=>e.target.style.borderColor=V.bd}/>
                        </div>
                      ))}
                    </div>
                  </details>
                  {/* Quantity */}
                  <div>
                    <div style={sb}>Quantity</div>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <button onClick={()=>setQty(q=>Math.max(1,q-1))} style={{
                        width:32,height:32,background:"transparent",
                        border:`1.5px solid ${V.bd}`,borderRadius:8,
                        color:V.tx,fontSize:16,cursor:"pointer",
                        display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s",
                      }}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor=V.ac;}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor=V.bd;}}>−</button>
                      <span style={{fontSize:16,fontWeight:600,minWidth:28,textAlign:"center",fontFamily:"'Jost',sans-serif"}}>{qty}</span>
                      <button onClick={()=>setQty(q=>q+1)} style={{
                        width:32,height:32,background:"transparent",
                        border:`1.5px solid ${V.bd}`,borderRadius:8,
                        color:V.tx,fontSize:16,cursor:"pointer",
                        display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s",
                      }}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor=V.ac;}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor=V.bd;}}>+</button>
                    </div>
                  </div>
                  {/* Design summary */}
                  <div style={{
                    background:V.sf2,border:`1px solid ${V.bd}`,borderRadius:12,
                    padding:"14px 14px 10px",
                  }}>
                    <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:15,fontWeight:500,color:V.tx,letterSpacing:".02em",marginBottom:10}}>Your Design</div>
                    {[
                      ["Garment", isTypeMode ? `${garmentType.charAt(0).toUpperCase()+garmentType.slice(1)} T-Shirt` : product!.name.replace(/\s*\[gt:GT\d+\]\s*$/,"")],
                      ["Style",   activeKashaDesign?`${activeKashaDesign!.id} — ${activeKashaDesign!.label}`:activePrintId?PATTERNS.find(p=>p.id===activePrintId)?.customerLabel||PATTERNS.find(p=>p.id===activePrintId)?.label||"—":primaryColor],
                      ["Size",    size],
                      ["Qty",     String(qty)],
                      ...(!isTypeMode ? [["Price", formatPrice(product!.priceInPaise)]] : []),
                    ].map(([label,val])=>(
                      <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`1px solid rgba(26,26,24,0.06)`}}>
                        <span style={{fontSize:9,color:V.mu,fontFamily:"'Jost',sans-serif",letterSpacing:".1em",textTransform:"uppercase",fontWeight:500}}>{label}</span>
                        <span style={{fontSize:11,color:V.tx,fontWeight:500,maxWidth:160,textAlign:"right",wordBreak:"break-all",fontFamily:"'Jost',sans-serif"}}>{val}</span>
                      </div>
                    ))}
                  </div>
                  {/* Design name — mobile only (header input is hidden <420px) */}
                  <div className="mobile-design-name-row" style={{display:"none"}}>
                    <input
                      value={designName}
                      onChange={e=>setDesignName(e.target.value)}
                      placeholder="Name your design…"
                      style={{
                        width:"100%",padding:"10px 14px",boxSizing:"border-box",
                        background:"#fff",border:`1.5px solid ${V.bd}`,borderRadius:99,
                        color:V.tx,fontSize:12,fontFamily:"'Jost',sans-serif",
                        letterSpacing:".02em",outline:"none",
                      }}
                      onFocus={e=>e.target.style.borderColor=V.ac}
                      onBlur={e=>e.target.style.borderColor=V.bd}
                    />
                  </div>
                  {/* CTA */}
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {isTypeMode ? (
                      <Link href="/products" style={{
                        padding:"12px 0",borderRadius:99,
                        border:`1.5px solid ${V.ac}`,background:V.aclt,color:V.tx,
                        fontSize:12,fontWeight:600,cursor:"pointer",
                        fontFamily:"'Jost',sans-serif",letterSpacing:".08em",textTransform:"uppercase",
                        textDecoration:"none",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",
                        transition:"all 0.3s",
                      }}
                      onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=V.ac;}}
                      onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=V.aclt;}}>
                        Browse Products →
                      </Link>
                    ) : (
                      <button onClick={handleAddToCart} disabled={cartMut.isPending} style={{
                        padding:"12px 0",borderRadius:99,border:"none",
                        background:V.tx,color:"white",
                        fontSize:12,fontWeight:600,cursor:"pointer",
                        fontFamily:"'Jost',sans-serif",letterSpacing:".08em",textTransform:"uppercase",
                        opacity:cartMut.isPending?.6:1,transition:"all 0.3s",
                      }}
                      onMouseEnter={e=>{if(!cartMut.isPending){e.currentTarget.style.background=V.ac;e.currentTarget.style.color=V.tx;}}}
                      onMouseLeave={e=>{e.currentTarget.style.background=V.tx;e.currentTarget.style.color="white";}}>
                        {cartMut.isPending?"Adding…":"✦ Add to Cart"}
                      </button>
                    )}
                    {cartAdded&&!isTypeMode&&(
                      <button onClick={()=>setLocation("/cart")} style={{
                        padding:"11px 0",borderRadius:99,
                        border:`1.5px solid ${V.ac}`,background:V.aclt,color:V.tx,
                        fontSize:12,fontWeight:600,cursor:"pointer",
                        fontFamily:"'Jost',sans-serif",letterSpacing:".08em",textTransform:"uppercase",
                        transition:"all 0.3s",
                      }}
                      onMouseEnter={e=>{e.currentTarget.style.background=V.ac;}}
                      onMouseLeave={e=>{e.currentTarget.style.background=V.aclt;}}>
                        🛒 View Cart
                      </button>
                    )}
                    {!isTypeMode && (
                      <Show when="signed-in">
                        <button onClick={handleSave} disabled={saveMut.isPending} style={{
                          padding:"10px 0",borderRadius:99,
                          border:`1.5px solid rgba(201,168,76,0.4)`,background:"transparent",
                          color:V.tx,fontSize:11,fontWeight:500,cursor:"pointer",
                          fontFamily:"'Jost',sans-serif",letterSpacing:".08em",textTransform:"uppercase",
                          opacity:saveMut.isPending?.6:1,transition:"all 0.3s",
                        }}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=V.ac;e.currentTarget.style.background=V.aclt;}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(201,168,76,0.4)";e.currentTarget.style.background="transparent";}}>
                          {saveMut.isPending?"Saving…":"✦ Save Design"}
                        </button>
                      </Show>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

        {/* ── CENTER: 3D CANVAS ─────────────────────────────────────────────── */}
        <div className="viewer-wrap" style={{
          flex:isDesktop ? 1 : isXs ? "0 0 40vh" : "0 0 44vh",
          order:isMd?1:2,
          position:"relative",
          background:"radial-gradient(ellipse at 55% 40%, #c8c2b6 0%, #b8b1a4 60%, #a8a196 100%)",
          display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",
          minWidth:0,
        }}>
          {/* Loading overlay */}
          {!modelDisplayed&&webglAvailable&&displayProduct?.modelUrl&&(
            <div style={{
              position:"absolute",inset:0,
              background:"rgba(250,250,247,0.92)",backdropFilter:"blur(8px)",
              display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,zIndex:10,
            }}>
              <div style={{
                width:40,height:40,
                border:`2px solid ${V.bd}`,borderTopColor:V.ac,
                borderRadius:"50%",animation:"spin .9s linear infinite",
              }}/>
              <p style={{fontSize:11,color:V.mu,letterSpacing:".12em",textTransform:"uppercase",fontFamily:"'Jost',sans-serif"}}>Loading preview…</p>
            </div>
          )}

          {mvReady&&displayProduct?.modelUrl&&webglAvailable&&(
            <model-viewer ref={mvRef} src={toProxiedUrl(displayProduct.modelUrl)}
              camera-controls {...(step===3||modelPaused?{}:{"auto-rotate":true,"rotation-per-second":"8deg"})}
              shadow-intensity="1" environment-image="neutral" exposure="1.0" tone-mapping="commerce"
              min-camera-orbit="auto auto 1.5m" max-camera-orbit="auto auto 5m"
              interaction-prompt="none" {...{"loading":"eager"}}
              style={{width:"100%",height:"100%","--poster-color":"transparent",opacity:modelDisplayed?1:0,transition:"opacity .4s"} as any}/>
          )}

          {(!displayProduct?.modelUrl||!webglAvailable)&&(
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16,color:V.mu,padding:24,maxWidth:320,textAlign:"center"}}>
              {displayProduct?.thumbnailUrl
                ? <img src={displayProduct.thumbnailUrl} alt={displayProduct.name} style={{maxHeight:380,objectFit:"contain",borderRadius:14,boxShadow:"0 12px 48px rgba(26,26,24,0.12)",opacity:.95}}/>
                : <div style={{fontSize:64,opacity:.12}}>👕</div>}
              <p style={{fontSize:14,lineHeight:1.7,fontStyle:"italic",fontFamily:"'Cormorant Garamond',serif"}}>
                {isTypeMode
                  ? "Design your garment — browse products to select one for your cart."
                  : !webglAvailable?"3D preview requires WebGL. Your design is still applied correctly.":"No 3D model uploaded for this product."}
              </p>
            </div>
          )}

          {/* Product badge */}
          {/* Product badge — desktop bottom-left, mobile top-left */}
          {isDesktop&&(
            <div style={{
              position:"absolute",bottom:20,left:20,
              background:"rgba(250,250,247,0.94)",
              border:`1px solid rgba(201,168,76,0.2)`,
              borderRadius:10,padding:"8px 14px",
              backdropFilter:"blur(12px)",
              boxShadow:"0 2px 16px rgba(26,26,24,0.08)",
            }}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:13,fontWeight:600,color:V.tx,letterSpacing:".02em"}}>
                {isTypeMode ? `${garmentType.charAt(0).toUpperCase()+garmentType.slice(1)} T-Shirt` : product!.name.replace(/\s*\[gt:GT\d+\]\s*$/,"")}
              </div>
              {!isTypeMode && <div style={{fontSize:11,color:V.ac,fontFamily:"'Jost',sans-serif",letterSpacing:".04em",marginTop:1}}>{formatPrice(product!.priceInPaise)}</div>}
            </div>
          )}

          {/* Pause / Resume 3D rotation toggle */}
          {mvReady&&displayProduct?.modelUrl&&webglAvailable&&(
            <button
              title={modelPaused?"Resume rotation":"Pause rotation"}
              onClick={()=>{
                const mv=mvRef.current as any; if(!mv) return;
                if(modelPaused){ mv.setAttribute("auto-rotate-delay","0"); mv.setAttribute("auto-rotate",""); mv.setAttribute("rotation-per-second","8deg"); }
                else { mv.removeAttribute("auto-rotate"); mv.removeAttribute("auto-rotate-delay"); }
                setModelPaused(p=>!p);
              }}
              style={{
                position:"absolute",top:14,right:14,zIndex:10,
                width:52,height:52,borderRadius:"50%",
                background:"rgba(250,250,247,0.95)",backdropFilter:"blur(12px)",
                border:"2px solid rgba(201,168,76,0.45)",
                display:"flex",alignItems:"center",justifyContent:"center",
                cursor:"pointer",fontSize:20,color:V.tx,
                boxShadow:"0 4px 20px rgba(26,26,24,0.18), 0 1px 4px rgba(201,168,76,0.20)",
                transition:"all .2s",
              }}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=V.ac;e.currentTarget.style.background="rgba(250,250,247,1)";e.currentTarget.style.boxShadow="0 6px 24px rgba(201,168,76,0.28), 0 2px 6px rgba(26,26,24,0.12)";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(201,168,76,0.45)";e.currentTarget.style.background="rgba(250,250,247,0.95)";e.currentTarget.style.boxShadow="0 4px 20px rgba(26,26,24,0.18), 0 1px 4px rgba(201,168,76,0.20)";}}
            >{modelPaused?"▶":"⏸"}</button>
          )}

          {/* Active design badge — desktop bottom-right, hidden on mobile */}
          {(activeKashaDesign||activePrintId)&&isDesktop&&(
            <div style={{
              position:"absolute",bottom:20,right:20,
              background:"rgba(250,250,247,0.94)",
              border:`1px solid rgba(201,168,76,0.25)`,
              borderRadius:10,padding:"6px 12px",
              backdropFilter:"blur(12px)",
              boxShadow:"0 2px 16px rgba(26,26,24,0.08)",
            }}>
              <div style={{fontSize:8,color:V.mu,letterSpacing:".12em",textTransform:"uppercase",fontFamily:"'Jost',sans-serif",marginBottom:1}}>Active Design</div>
              <div style={{fontSize:11,fontWeight:600,color:V.ac,fontFamily:"'Jost',sans-serif",letterSpacing:".04em"}}>
                {activeKashaDesign?`${activeKashaDesign.id} · ${activeKashaDesign.label}`:(PATTERNS.find(p=>p.id===activePrintId)?.customerLabel||PATTERNS.find(p=>p.id===activePrintId)?.label)}
              </div>
            </div>
          )}

          {/* Drag hint — desktop only */}
          {isDesktop&&(
            <div style={{
              position:"absolute",top:16,left:"50%",transform:"translateX(-50%)",
              fontFamily:"'Cormorant Garamond', serif",
              fontSize:11,letterSpacing:".16em",
              color:"rgba(26,26,24,0.22)",textTransform:"uppercase",
              pointerEvents:"none",whiteSpace:"nowrap",
            }}>
              Drag to rotate · Scroll to zoom
            </div>
          )}

        </div>

        {/* ── RIGHT PANEL: Placement chips (step 3 desktop only) ─────────── */}
        {step===3&&isDesktop&&!isWholeGarment&&(
          <div className="placement-right-panel" style={{
            width:200,flexShrink:0,overflowY:"auto",
            background:V.bg,
            borderLeft:`1px solid rgba(26,26,24,0.07)`,
            display:"flex",flexDirection:"column",
            order:3,
          }}>
            <div style={{padding:"20px 14px",display:"flex",flexDirection:"column",gap:18}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:15,fontWeight:600,color:V.tx,letterSpacing:".02em"}}>Placement</div>
              {/* ── Customisation charge: ₹20 base (once) + ₹1/sq inch for logo & text ── */}
              {(()=>{
                // Body / collar prints and all-over garment prints carry no extra charge
                const logoW = logoSize * 0.376;
                const logoAreaSqIn = logoPreview ? Math.ceil(logoW * logoW * 0.75) : 0;
                const textH = textFontSize * (22/1024);
                const textW = Math.max(1, textInput.length) * textFontSize * 0.55 * (22/1024);
                const textAreaSqIn = textPlaced ? Math.ceil(textH * textW) : 0;
                const hasLogoOrText = !!(logoPreview || textPlaced);
                const total = hasLogoOrText ? (20 + logoAreaSqIn + textAreaSqIn) : 0;
                if (!total) return null;
                return(
                  <div style={{padding:"10px 12px",borderRadius:10,background:V.sf2,border:`1px solid ${V.bd}`}}>
                    <div style={{fontFamily:"'Jost',sans-serif",fontSize:9,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:V.mu,marginBottom:8}}>Customisation Charge</div>
                    <div style={{display:"flex",justifyContent:"space-between",fontFamily:"'Jost',sans-serif",fontSize:11,color:V.tx,marginBottom:4}}><span>Base fee</span><span style={{color:V.ac,fontWeight:600}}>₹20</span></div>
                    {logoPreview&&<div style={{display:"flex",justifyContent:"space-between",fontFamily:"'Jost',sans-serif",fontSize:11,color:V.tx,marginBottom:4}}><span>Logo ({logoAreaSqIn} sq in)</span><span style={{color:V.ac,fontWeight:600}}>₹{logoAreaSqIn}</span></div>}
                    {textPlaced&&<div style={{display:"flex",justifyContent:"space-between",fontFamily:"'Jost',sans-serif",fontSize:11,color:V.tx,marginBottom:4}}><span>Name / Text ({textAreaSqIn} sq in)</span><span style={{color:V.ac,fontWeight:600}}>₹{textAreaSqIn}</span></div>}
                    <div style={{borderTop:`1px solid ${V.bd}`,marginTop:6,paddingTop:6,display:"flex",justifyContent:"space-between",fontFamily:"'Jost',sans-serif",fontSize:12,fontWeight:700,color:V.tx}}><span>Total</span><span style={{color:V.ac}}>₹{total}</span></div>
                    <div style={{fontFamily:"'Jost',sans-serif",fontSize:9,color:V.mu,marginTop:5,fontStyle:"italic"}}>₹20 base + ₹1 per sq inch · name &amp; logo only · prints &amp; colours free</div>
                  </div>
                );
              })()}
              {(()=>{
                const CHIPS=[
                  {key:"front-left",   label:"Chest Left",   cx:39,cy:40,back:false},
                  {key:"front-right",  label:"Chest Right",  cx:21,cy:40,back:false},
                  {key:"left-sleeve",  label:"Right Sleeve", cx:7, cy:23,back:false},
                  {key:"right-sleeve", label:"Left Sleeve",  cx:53,cy:23,back:false},
                  {key:"back-top",     label:"Back Top",     cx:30,cy:24,back:true},
                  {key:"back-center",  label:"Centre Back",  cx:30,cy:52,back:true},
                  {key:"collar-left",  label:"Collar Right", cx:24,cy:14,back:false},
                  {key:"collar-right", label:"Collar Left",  cx:36,cy:14,back:false},
                ];
                const chipGrid=(isActive:(k:string)=>boolean, onSelect:(k:string)=>void)=>(
                  <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:6}}>
                    {CHIPS.map(c=>{
                      const isA=isActive(c.key);
                      const svg=`<svg viewBox="0 0 60 68" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 4L10 12L4 32L14 34L14 64H46L46 34L56 32L50 12L38 4L34 6C32 8 28 8 26 6Z" fill="#e8e4dc" stroke="#1a1a18" stroke-width="1.5"/>${c.back?`<text x="30" y="54" text-anchor="middle" font-size="6" fill="#999" font-family="sans-serif">back</text>`:""}<circle cx="${c.cx}" cy="${c.cy}" r="3.5" fill="${isA?"#c9a84c":"#aaa"}"/></svg>`;
                      return(
                        <div key={c.key} onClick={()=>onSelect(c.key)} style={{
                          display:"flex",flexDirection:"column",alignItems:"center",gap:4,cursor:"pointer",
                          padding:"10px 4px",borderRadius:9,transition:"all .18s",
                          border:`1.5px solid ${isA?V.ac:V.bd}`,background:isA?V.aclt:"transparent",
                        }}>
                          <div style={{width:42,height:48}} dangerouslySetInnerHTML={{__html:svg}}/>
                          <span style={{fontSize:11,textTransform:"uppercase",letterSpacing:".04em",fontFamily:"'Jost',sans-serif",color:isA?V.tx:"#4a4a48",fontWeight:isA?700:500,textAlign:"center",lineHeight:1.3}}>{c.label}</span>
                        </div>
                      );
                    })}
                  </div>
                );
                return(
                  <>
                    {logoPreview&&(
                      <div>
                        <div style={{...sb,marginBottom:8}}>Logo</div>
                        {chipGrid(
                          k=>logoPosition===k,
                          k=>{setLogoPosition(k as any);setCameraView(PLACEMENT_VIEW[k]??"front");setModelPaused(true);const mv_=mvRef.current as any;if(mv_){mv_.removeAttribute("auto-rotate");mv_.removeAttribute("auto-rotate-delay");}if(logoObjRef.current){const pos=LOGO_POSITIONS[k]||{left:512,top:512};logoObjRef.current.set({left:pos.left,top:pos.top,originX:"center",originY:"center",flipX:placementFlipX(k),flipY:placementFlipY(k),angle:placementAngle(k)});logoObjRef.current.setCoords();fcRef.current?.renderAll();syncTexture();}}
                        )}
                      </div>
                    )}
                    {(textInput.trim().length > 0 || textPlaced)&&(
                      <div>
                        <div style={{...sb,marginBottom:8}}>Text</div>
                        {chipGrid(
                          k=>textPosition===k,
                          k=>{const isCollar=k==="collar-left"||k==="collar-right";setTextPosition(k as any);if(isCollar)setTextFontSize(v=>Math.min(v,14));setCameraView(PLACEMENT_VIEW[k]??"front");setModelPaused(true);const mv_=mvRef.current as any;if(mv_){mv_.removeAttribute("auto-rotate");mv_.removeAttribute("auto-rotate-delay");}if(textObjRef.current){const pos=LOGO_POSITIONS[k]||{left:512,top:512};const fs=isCollar?Math.min(textFontSize,14):textFontSize;textObjRef.current.set({left:pos.left,top:pos.top,originX:"center",originY:"center",flipX:placementFlipX(k),flipY:placementFlipY(k),angle:placementAngle(k),fontSize:fs,scaleX:1,scaleY:1});clampCollarText(textObjRef.current,k);textObjRef.current.setCoords();fcRef.current?.renderAll();syncTexture();}}
                        )}
                      </div>
                    )}
                    {!logoPreview&&!textPlaced&&(
                      <div style={{fontSize:11,color:V.mu,fontFamily:"'Jost',sans-serif",lineHeight:1.7,textAlign:"center",paddingTop:8}}>
                        Upload a logo or add text to see placement options.
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}

      </div>

      {/* ── COLOR PICKER MODAL ───────────────────────────────────────────── */}
      {colorModalFor&&(
        <div style={{
          position:"fixed",inset:0,zIndex:200,
          background:"rgba(26,26,24,0.45)",
          display:"flex",
          alignItems:isMd ? "flex-end" : "center",
          justifyContent:isMd ? "stretch" : "flex-start",
          padding:isMd ? 0 : "0 0 0 16px",
        }} onClick={()=>{setColorModalFor(null);setPendingColorPick(null);}}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:V.bg,
            borderRadius:isMd ? "20px 20px 0 0" : 20,
            padding:isMd ? "6px 20px 28px" : "22px 20px 20px",
            width:isMd ? "100%" : "min(320px, calc(100vw - 32px))",
            maxHeight:isMd ? "82vh" : "90vh",
            overflowY:"auto",
            boxShadow:"0 32px 80px rgba(26,26,24,0.32)",
            border:`1px solid rgba(201,168,76,0.18)`,
          }}>
            {isMd && <div style={{width:40,height:4,borderRadius:2,background:V.bd,margin:"12px auto 16px"}}/>}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,fontWeight:600,color:V.tx,letterSpacing:".02em"}}>
                Choose Colour
              </div>
              <button onClick={()=>{setColorModalFor(null);setPendingColorPick(null);}} style={{
                background:"transparent",border:"none",cursor:"pointer",
                fontSize:18,color:V.mu,lineHeight:1,padding:"2px 6px",
                borderRadius:99,transition:"all .2s",
              }}
              onMouseEnter={e=>{e.currentTarget.style.background=V.sf2;e.currentTarget.style.color=V.tx;}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color=V.mu;}}>✕</button>
            </div>

            <div style={{fontFamily:"'Jost',sans-serif",fontSize:10,color:V.mu,letterSpacing:".05em",marginBottom:12,textTransform:"uppercase",fontWeight:500}}>
              Click a colour to apply it instantly
            </div>

            {/* Preset swatches — click to apply immediately */}
            {(()=>{
              const pickedVal = colorModalFor==="pattern" ? patColorB : colorModalFor==="base" ? patColorA : colorModalFor==="collar" ? (zoneColors.collar||primaryColor) : colorModalFor==="leftSleeve" ? (zoneColors.leftSleeve||primaryColor) : colorModalFor==="rightSleeve" ? (zoneColors.rightSleeve||primaryColor) : primaryColor;
              const displayCol = pendingColorPick ?? pickedVal;
              const applyCol = (col: string) => {
                if(colorModalFor==="all"){
                  // "Full Body → Colour": solid colour replaces the print entirely.
                  applyPrimary(col);
                } else if(colorModalFor==="base-body"){
                  // "Base Body → Colour": recompose the print tile with the new colour
                  // as background so both the colour and print are visible together.
                  // Falls back to solid colour if no print is active.
                  applyPrimary(col,{recompose:true});
                } else if(colorModalFor==="base"){
                  setPatColorA(col);
                  applyPatternColors(col, patColorB);
                } else if(colorModalFor==="collar"){
                  applyZoneColor("collar",col);
                } else if(colorModalFor==="leftSleeve"){
                  applyZoneColor("leftSleeve",col);
                } else if(colorModalFor==="rightSleeve"){
                  applyZoneColor("rightSleeve",col);
                } else {
                  setPatColorB(col);
                  applyPatternColors(patColorA, col);
                }
                setPendingColorPick(null);
                setColorModalFor(null);
              };
              return(<>
                <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:7,marginBottom:16}}>
                  {[
                    "#1a1a18","#2c2c2a","#4a4a48","#6b6b68","#9b9b98","#c8c8c4",
                    "#ffffff","#faf8f4","#f2ede4","#e8e2d8","#d4cfc6","#c9c4bb",
                    "#c9a84c","#e8c96a","#b8943e","#8b6914","#5c4209","#f5e6c0",
                    "#8B1A1A","#C24B4B","#E07070","#F0A0A0","#FDDEDE","#FFE4E4",
                    "#1A3A8B","#2B5CC8","#4D7FE0","#86AFF5","#C0D8FF","#E0EDFF",
                    "#1A6B3A","#2D9A54","#4DC472","#80E0A0","#B8F0CC","#DFF8E8",
                    "#6B1A8B","#9B3AC0","#C060E0","#D890F0","#ECC0F8","#F5E0FF",
                    "#8B4A1A","#C47030","#E09050","#F0B880","#F8D8B0","#FFF0E0",
                  ].map(col=>(
                    <button key={col} onClick={()=>applyCol(col)} style={{
                      width:"100%",aspectRatio:"1",borderRadius:7,cursor:"pointer",
                      background:col,
                      border:displayCol===col?`2.5px solid ${V.ac}`:`1px solid rgba(26,26,24,0.15)`,
                      transition:"all .15s",
                      boxShadow:displayCol===col?`0 2px 8px rgba(201,168,76,0.35)`:"none",
                    }} title={col}/>
                  ))}
                </div>
                {/* Custom colour — apply on input change */}
                <div style={{fontFamily:"'Jost',sans-serif",fontSize:9,color:V.mu,letterSpacing:".06em",textTransform:"uppercase",marginBottom:6,fontWeight:600}}>
                  Pick a custom colour
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{width:36,height:36,borderRadius:8,background:displayCol,border:`1.5px solid ${V.bd}`,flexShrink:0}}/>
                  <input type="color" value={displayCol}
                    onChange={e=>{if(colorModalFor==='all'){applyPrimary(e.target.value);}else if(colorModalFor==='base-body'){applyPrimary(e.target.value,{recompose:true});}else if(colorModalFor==='base'){setPatColorA(e.target.value);applyPatternColors(e.target.value,patColorB);}else if(colorModalFor==='collar'){applyZoneColor('collar',e.target.value);}else{setPatColorB(e.target.value);applyPatternColors(patColorA,e.target.value);}setPendingColorPick(null);}}
                    style={{width:44,height:36,padding:2,border:`1.5px solid ${V.bd}`,borderRadius:8,cursor:"pointer",background:V.sf2}}/>
                  <input type="text" defaultValue={displayCol}
                    onBlur={e=>{
                      e.target.style.borderColor=V.bd;
                      const hex=cssColorToHex(e.target.value.trim());
                      if(hex) applyCol(hex);
                    }}
                    onKeyDown={e=>{ if(e.key==="Enter"){ const hex=cssColorToHex((e.target as HTMLInputElement).value.trim()); if(hex) applyCol(hex); } }}
                    placeholder="#c9a84c or colour name"
                    style={{
                      flex:1,padding:"8px 10px",borderRadius:8,
                      border:`1.5px solid ${V.bd}`,background:V.sf2,
                      fontFamily:"'Jost',sans-serif",fontSize:12,color:V.tx,
                      outline:"none",letterSpacing:".04em",
                    }}
                    onFocus={e=>e.target.style.borderColor=V.ac}/>
                </div>
                {/* Flat-canvas eyedropper — samples the actual design texture, not the
                    lit/shaded 3D render, so results match your uploaded artwork's real hex. */}
                <button
                  title="Sample a colour directly from your uploaded design (no 3D lighting effects)"
                  onClick={()=>{
                    const fc=fcRef.current as any; if(!fc) return;
                    fc.renderAll();
                    const rawEl: HTMLCanvasElement|null = typeof fc.getElement==="function"?fc.getElement():null;
                    if(!rawEl) return;
                    setModalSamplerPreview(rawEl.toDataURL("image/png"));
                    setModalSamplerActive(true);
                  }}
                  style={{
                    display:"flex",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",
                    width:"100%",marginTop:8,padding:"8px 12px",borderRadius:8,
                    border:`1.5px solid ${V.bd}`,background:V.sf2,
                    fontFamily:"'Jost',sans-serif",fontSize:10,fontWeight:600,
                    color:V.tx,letterSpacing:".05em",
                  }}
                >🔬 Match Body Color to Logo</button>
                {/* Sampler overlay — click a pixel on the flat design canvas to apply its exact colour */}
                {modalSamplerActive&&modalSamplerPreview&&(
                  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:9999,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}} onClick={()=>setModalSamplerActive(false)}>
                    <div style={{fontFamily:"'Jost',sans-serif",fontSize:12,color:"#fff",letterSpacing:".06em",textTransform:"uppercase",fontWeight:600}}>
                      Click anywhere on the design to sample that colour
                    </div>
                    <div style={{position:"relative",cursor:"crosshair"}} onClick={e=>{
                      e.stopPropagation();
                      const rect=(e.currentTarget as HTMLElement).getBoundingClientRect();
                      const xRatio=(e.clientX-rect.left)/rect.width;
                      const yRatio=(e.clientY-rect.top)/rect.height;
                      const fc=fcRef.current as any;
                      if(!fc) return;
                      const rawEl: HTMLCanvasElement|null = typeof fc.getElement==="function"?fc.getElement():null;
                      if(!rawEl) return;
                      const ctx=rawEl.getContext("2d"); if(!ctx) return;
                      const px=Math.round(xRatio*rawEl.width);
                      const py=Math.round(yRatio*rawEl.height);
                      const d=ctx.getImageData(px,py,1,1).data;
                      const toHex=(n:number)=>n.toString(16).padStart(2,"0");
                      const sampledHex=`#${toHex(d[0])}${toHex(d[1])}${toHex(d[2])}`;
                      applyCol(sampledHex);
                      setModalSamplerActive(false);
                    }}>
                      <img src={modalSamplerPreview ?? undefined} alt="Design canvas" style={{display:"block",maxWidth:"min(80vw,400px)",maxHeight:"min(80vh,400px)",imageRendering:"pixelated",border:"2px solid rgba(255,255,255,0.3)",borderRadius:4}}/>
                    </div>
                    <div style={{fontFamily:"'Jost',sans-serif",fontSize:10,color:"rgba(255,255,255,0.5)",letterSpacing:".04em"}}>Click outside to cancel</div>
                  </div>
                )}
              </>);
            })()}
          </div>
        </div>
      )}

      {/* ── PRINT PICKER MODAL ───────────────────────────────────────────── */}
      {printModalFor&&(
        <div style={{
          position:"fixed",inset:0,zIndex:200,
          background:"rgba(26,26,24,0.45)",
          display:"flex",
          alignItems:isMd ? "flex-end" : "center",
          justifyContent:isMd ? "stretch" : "flex-start",
          padding:isMd ? 0 : "0 0 0 16px",
        }} onClick={()=>{setPrintModalFor(null);setPendingPrintKey(null);}}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:V.bg,
            borderRadius:isMd ? "20px 20px 0 0" : 20,
            padding:isMd ? "6px 20px 28px" : "22px 20px 20px",
            width:isMd ? "100%" : "min(380px, calc(100vw - 32px))",
            maxHeight:isMd ? "82vh" : "90vh",
            overflowY:"auto",
            boxShadow:"0 32px 80px rgba(26,26,24,0.32)",
            border:`1px solid rgba(201,168,76,0.18)`,
          }}>
            {isMd && <div style={{width:40,height:4,borderRadius:2,background:V.bd,margin:"12px auto 16px"}}/>}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,fontWeight:600,color:V.tx,letterSpacing:".02em"}}>
                Choose Print
              </div>
              <button onClick={()=>{setPrintModalFor(null);setPendingPrintKey(null);}} style={{
                background:"transparent",border:"none",cursor:"pointer",
                fontSize:18,color:V.mu,lineHeight:1,padding:"2px 6px",
                borderRadius:99,transition:"all .2s",
              }}
              onMouseEnter={e=>{e.currentTarget.style.background=V.sf2;e.currentTarget.style.color=V.tx;}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color=V.mu;}}>✕</button>
            </div>

            <div style={{fontFamily:"'Jost',sans-serif",fontSize:10,color:V.mu,letterSpacing:".05em",marginBottom:12,textTransform:"uppercase",fontWeight:500}}>
              Click a print to apply it instantly
            </div>

            {/* Print grid — click to apply immediately */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              {visiblePatterns.map(p=>{
                const isActive=allOverPrintId===p.id;
                const applyPrint=(chosen:typeof p)=>{
                  if(printModalFor==="base-body"){
                    applyZonePrint("front",chosen); applyZonePrint("back",chosen);
                    applyZonePrint("leftSleeve",chosen); applyZonePrint("rightSleeve",chosen);
                  } else if(printModalFor==="collar"){
                    applyZonePrint("collar",chosen);
                  } else if(printModalFor==="accent"){
                    applyPatternDesignPrint(chosen);
                  } else {
                    applyAllOverPrint(chosen);
                  }
                  saveHistory();
                  setPendingPrintKey(null);
                  setPrintModalFor(null);
                };
                return(
                  <div key={p.id} onClick={()=>applyPrint(p)} style={{
                    cursor:"pointer",borderRadius:10,overflow:"hidden",
                    border:`2px solid ${isActive?V.ac:V.bd}`,
                    transition:"all .2s",
                    background:"rgba(0,0,0,0.06)",
                    boxShadow:isActive?`0 4px 16px rgba(201,168,76,0.3)`:"none",
                  }}>
                    <img src={patternUrl(p.file)} alt={p.label} loading="lazy" decoding="async" fetchPriority="low"
                      style={{width:"100%",aspectRatio:"1",objectFit:"cover",display:"block"}}/>
                    <div style={{
                      padding:"5px 6px",background:isActive?V.aclt:V.sf2,
                      fontFamily:"'Jost',sans-serif",fontSize:9,
                      letterSpacing:".06em",textTransform:"uppercase",
                      color:isActive?V.tx:V.mu,fontWeight:isActive?700:400,
                      textAlign:"center",lineHeight:1.3,
                    }}>{p.label}</div>
                  </div>
                );
              })}
            </div>

            {allOverPrintId&&(
              <button onClick={()=>{clearAllOverPrint();saveHistory();setPrintModalFor(null);setPendingPrintKey(null);}} style={{
                display:"block",width:"100%",marginTop:12,padding:"10px 0",
                borderRadius:99,border:`1px solid rgba(196,92,92,.35)`,
                background:"transparent",color:"#c45c5c",fontSize:11,
                cursor:"pointer",fontFamily:"'Jost',sans-serif",letterSpacing:".05em",
              }}>✕ Remove Print</button>
            )}
          </div>
        </div>
      )}

      {/* Mobile Save Bottom Sheet */}
      {showMobileSaveSheet&&(
        <div
          style={{position:"fixed",inset:0,zIndex:400,background:"rgba(26,26,24,0.55)",backdropFilter:"blur(4px)"}}
          onClick={()=>setShowMobileSaveSheet(false)}
        >
          <div
            onClick={e=>e.stopPropagation()}
            style={{
              position:"fixed",bottom:0,left:0,right:0,
              background:V.bg,borderRadius:"20px 20px 0 0",
              padding:"24px 20px 36px",
              boxShadow:"0 -8px 40px rgba(26,26,24,0.22)",
              border:`1px solid rgba(201,168,76,0.18)`,
              borderBottom:"none",
            }}
          >
            {/* Handle bar */}
            <div style={{width:40,height:4,borderRadius:2,background:V.bd,margin:"0 auto 20px"}}/>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:600,color:V.tx,letterSpacing:".02em",marginBottom:6}}>
              Save Your Design
            </div>
            <div style={{fontFamily:"'Jost',sans-serif",fontSize:11,color:V.mu,letterSpacing:".04em",marginBottom:18}}>
              Give your design a name so you can find it later
            </div>
            <input
              value={designName}
              onChange={e=>setDesignName(e.target.value)}
              placeholder={`${product?.name||"Custom"} Design`}
              autoFocus
              style={{
                width:"100%",padding:"12px 16px",boxSizing:"border-box",
                borderRadius:12,border:`1.5px solid ${V.bd}`,
                background:V.sf2,color:V.tx,
                fontFamily:"'Jost',sans-serif",fontSize:14,
                outline:"none",marginBottom:16,
              }}
              onFocus={e=>e.target.style.borderColor=V.ac}
              onBlur={e=>e.target.style.borderColor=V.bd}
            />
            <div style={{display:"flex",gap:10}}>
              <button
                onClick={()=>setShowMobileSaveSheet(false)}
                style={{
                  flex:1,padding:"13px 0",borderRadius:40,
                  border:`1.5px solid ${V.bd}`,background:"transparent",
                  color:V.mu,fontFamily:"'Jost',sans-serif",fontSize:12,fontWeight:500,
                  letterSpacing:".06em",textTransform:"uppercase",cursor:"pointer",
                  transition:"all .2s",
                }}
              >Cancel</button>
              <button
                onClick={()=>{handleSave();setShowMobileSaveSheet(false);}}
                disabled={saveMut.isPending}
                style={{
                  flex:2,padding:"13px 0",borderRadius:40,
                  border:"none",background:V.tx,color:"#fff",
                  fontFamily:"'Jost',sans-serif",fontSize:12,fontWeight:600,
                  letterSpacing:".06em",textTransform:"uppercase",cursor:"pointer",
                  opacity:saveMut.isPending?.6:1,transition:"all .2s",
                }}
                onMouseEnter={e=>{e.currentTarget.style.background=V.ac;e.currentTarget.style.color=V.tx;}}
                onMouseLeave={e=>{e.currentTarget.style.background=V.tx;e.currentTarget.style.color="#fff";}}
              >{saveMut.isPending?"Saving…":"✦ Save Design"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Fabric canvas (texture pipeline) */}
      <div id="fc-wrapper" style={{position:"fixed",left:"-9999px",top:0,width:"1024px",height:"1024px",pointerEvents:"none",opacity:0.01,zIndex:-1}}>
        <div id="fc-scale-host" style={{position:"absolute",left:0,top:0,width:"1024px",height:"1024px",transformOrigin:"top left"}}>
          <canvas ref={canvasElRef}/>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Jost:wght@200;300;400;500;600&display=swap');
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes slideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:${V.cream3};border-radius:2px}
        ::-webkit-scrollbar-track{background:transparent}
        input[type=range]::-webkit-slider-thumb{
          -webkit-appearance:none;width:14px;height:14px;
          background:${V.ac};border-radius:50%;cursor:pointer;
          border:2px solid #fff;box-shadow:0 1px 4px rgba(201,168,76,0.3);
        }
        input[type=range]{-webkit-appearance:none;appearance:none}
        details summary{list-style:none}
        details summary::-webkit-details-marker{display:none}
        @media(max-width:479px){
          .progress-label{display:none!important}
          .studio-title-center{display:none!important}
          .design-name-input{display:none!important}
        }
        @media(max-width:639px){
          .studio-title-center{display:none!important}
          .design-name-input{width:90px!important;font-size:10px!important}
        }
        @media(max-width:767px){
          .placement-right-panel{display:none!important}
          .step-panel{-webkit-overflow-scrolling:touch;overscroll-behavior:contain;position:relative}
          .step-panel-gradient{
            position:sticky;bottom:0;left:0;right:0;height:36px;
            background:linear-gradient(to bottom,transparent,rgba(249,247,244,0.95));
            pointer-events:none;flex-shrink:0;margin-top:-36px;z-index:3;
          }
        }
      `}</style>

    </div>

    {/* Cart drawer — rendered outside the studio div so fixed positioning works identically to the Navbar's CartDrawer */}
    <CartDrawer open={isCartOpen} onClose={closeCart} cart={cart} />
    </>
  );
}