import { useState, useRef, useEffect, useMemo } from "react";
import { Layout } from "@/components/layout/Layout";
import { useUser } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Plus, Pencil, Trash2, Upload, X, Check,
  ShieldCheck, Package, Users, Eye, ArrowLeft, BarChart3, ShoppingBag, UserCog, Download, ImageIcon, Mail, Tag, Zap,
  AlertTriangle, Power, RefreshCw, Pause, Play, Camera,
} from "lucide-react";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { AdminOrders } from "@/components/admin/AdminOrders";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AdminCoupons } from "@/components/admin/AdminCoupons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/format";
import { getApiUrl, getUploadApiUrl, getAssetUrl } from "@/lib/api";
import { PATTERNS, patternUrl } from "@/components/3d/patterns";

interface ProductAddOn {
  id: string;
  label: string;
  imageUrl?: string | null;
}

interface Product {
  id: number;
  name: string;
  description: string;
  category: string;
  gender?: string | null;
  productType?: string | null;
  subType?: string | null;
  sku?: string | null;
  stock: number;
  priceInPaise: number;
  modelUrl: string;
  thumbnailUrl?: string | null;
  additionalImages?: string | null;
  available: boolean;
  allowCustomization: boolean;
  sizes: string[];
  defaultColor: string;
  colorLabel?: string | null;
  customizationMode?: string | null;
  addOns?: ProductAddOn[] | null;
}

interface UserDesign {
  id: number;
  userId: string;
  userEmail: string;
  userName: string;
  productId: number;
  productName: string | null;
  productModelUrl: string | null;
  productThumbnailUrl: string | null;
  name: string;
  color: string;
  size: string;
  partsEnabled: Record<string, any> | null;
  canvasData: string | null;
  previewImageUrl: string | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  sideImageUrl: string | null;
  customizationChargeInPaise: number | null;
  designSpec: Record<string, any> | null;
  updatedAt: string;
}

const EMPTY_FORM = {
  name: "",
  description: "",
  category: "polo",
  gender: "",
  productType: "golf",
  subType: "",
  sku: "",
  stock: 100,
  priceText: "",
  modelUrl: "",
  thumbnailUrl: "",
  additionalImages: "",
  available: true,
  allowCustomization: false,
  sizes: ["S", "M", "L", "XL"],
  defaultColor: "#ffffff",
  colorLabel: "",
  customizationMode: "zone",
  addOns: [] as ProductAddOn[],
};

function isLightHex(hex: string): boolean {
  try {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 140;
  } catch { return false; }
}

async function exportDesignImages(design: UserDesign): Promise<{ count: number; errors: string[] }> {
  const slug = (design.name ?? "design").replace(/\s+/g, "-");

  // Include the original uploaded logo so the factory gets the source file.
  const logoUrl = (design.designSpec as any)?.logoUrl ?? "";

  // Exactly 4 files: front / back / side 3-D renders + the original logo.
  // The raw UV texture (frontImageUrl) is intentionally excluded — it is
  // a mirrored texture map, not a usable reference for production.
  const views: Array<{ url: string; label: string }> = [
    { url: design.previewImageUrl ?? "", label: "front-3d-render" },
    { url: design.backImageUrl    ?? "", label: "back-3d-render"  },
    { url: design.sideImageUrl    ?? "", label: "side-3d-render"  },
    { url: logoUrl,                      label: "logo-original"   },
  ].filter(v => !!v.url);

  // Deduplicate identical URLs
  const seen = new Set<string>();
  const unique = views.filter(v => { if (seen.has(v.url)) return false; seen.add(v.url); return true; });

  let count = 0;
  const errors: string[] = [];
  const token = await getToken();
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  for (const { url, label } of unique) {
    const filename = `${slug}-${label}.png`;
    try {
      if (url.startsWith("data:")) {
        const a = document.createElement("a"); a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        count++;
      } else {
        const proxyUrl = `${getApiUrl()}/api/admin/download-proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
        const res = await fetch(proxyUrl, { headers: authHeaders });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = objectUrl; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        count++;
      }
      await new Promise(r => setTimeout(r, 150));
    } catch (e: any) { errors.push(`${label}: ${e.message || e}`); }
  }
  return { count, errors };
}

async function getToken(): Promise<string | null> {
  try {
    const clerk = (window as any).Clerk;
    if (clerk?.session) return clerk.session.getToken();
    return null;
  } catch { return null; }
}

async function apiFetch(path: string, opts?: RequestInit): Promise<any> {
  const token = await getToken();
  const isFormData = opts?.body instanceof FormData;
  const headers: Record<string, string> = { ...(opts?.headers as any) };
  if (!isFormData) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${getApiUrl()}${path}`, { ...opts, headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// ── Design Left Panel ─────────────────────────────────────────────────────────
/** Crops blank/white space and returns a centred square PNG. */
async function trimToSquare(dataUrl: string, outSize = 1024, paddingRatio = 0.08): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl;
  });
  const src = document.createElement("canvas");
  src.width = img.naturalWidth; src.height = img.naturalHeight;
  const sctx = src.getContext("2d")!;
  sctx.drawImage(img, 0, 0);
  const { data, width, height } = sctx.getImageData(0, 0, src.width, src.height);
  let minX = width, minY = height, maxX = 0, maxY = 0;
  const isBg = (r: number, g: number, b: number, a: number) => a < 10 || (r > 248 && g > 248 && b > 248);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!isBg(data[i], data[i+1], data[i+2], data[i+3])) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return dataUrl;
  const boxW = maxX - minX, boxH = maxY - minY;
  const pad = Math.round(Math.max(boxW, boxH) * paddingRatio);
  const cropX = Math.max(0, minX - pad), cropY = Math.max(0, minY - pad);
  const cropW = Math.min(width - cropX, boxW + pad * 2);
  const cropH = Math.min(height - cropY, boxH + pad * 2);
  const side = Math.max(cropW, cropH);
  const out = document.createElement("canvas");
  out.width = outSize; out.height = outSize;
  const octx = out.getContext("2d")!;
  octx.fillStyle = "#ffffff"; octx.fillRect(0, 0, outSize, outSize);
  const scale = outSize / side;
  const dx = (outSize - cropW * scale) / 2, dy = (outSize - cropH * scale) / 2;
  octx.drawImage(src, cropX, cropY, cropW, cropH, dx, dy, cropW * scale, cropH * scale);
  return out.toDataURL("image/png", 1.0);
}

/** Compute CRC32 over a byte array (standard PNG polynomial). */
function crc32(data: Uint8Array): number {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Inserts a pHYs chunk into a PNG data-URL so the file opens at the correct
 * physical DPI in Photoshop / Illustrator / any standards-compliant editor.
 *
 * PNG pHYs encodes resolution in pixels-per-metre:
 *   300 DPI  →  11811 px/m   (300 / 0.0254)
 *
 * The chunk (21 bytes) is always inserted immediately after IHDR (offset 33).
 */
function patchPngDpi(dataUrl: string, dpi = 300): string {
  const base64 = dataUrl.split(",")[1];
  const bin = atob(base64);
  const src = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) src[i] = bin.charCodeAt(i);

  const ppm = Math.round(dpi / 0.0254); // pixels per metre

  // pHYs chunk data: X ppm (4 bytes BE) + Y ppm (4 bytes BE) + unit=1 (metre)
  const physData = new Uint8Array(9);
  const dv = new DataView(physData.buffer);
  dv.setUint32(0, ppm, false);
  dv.setUint32(4, ppm, false);
  physData[8] = 1;

  // CRC covers chunk type + data
  const crcInput = new Uint8Array(13);
  crcInput.set([0x70, 0x48, 0x59, 0x73]); // "pHYs"
  crcInput.set(physData, 4);
  const checksum = crc32(crcInput);

  // Full chunk: length(4) + "pHYs"(4) + data(9) + crc(4) = 21 bytes
  const chunk = new Uint8Array(21);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9, false);             // data length
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  chunk.set(physData, 8);
  cv.setUint32(17, checksum, false);

  // Insert after PNG signature (8 bytes) + IHDR chunk (4+4+13+4 = 25 bytes) = offset 33
  const insertAt = 33;
  const out = new Uint8Array(src.length + 21);
  out.set(src.subarray(0, insertAt));
  out.set(chunk, insertAt);
  out.set(src.subarray(insertAt), insertAt + 21);

  // Re-encode to data URL
  let binary = "";
  for (let i = 0; i < out.length; i++) binary += String.fromCharCode(out[i]);
  return "data:image/png;base64," + btoa(binary);
}

function DesignLeftPanel({ design, mvReady, viewerRef, textureReady, canvasDataLoading }: {
  design: UserDesign;
  mvReady: boolean;
  viewerRef: React.RefObject<any>;
  textureReady: boolean;
  canvasDataLoading: boolean;
}) {
  const [activeView, setActiveView] = useState<"front" | "back" | "side">("front");
  const [isPaused, setIsPaused] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const togglePause = () => {
    const mv = viewerRef.current;
    if (!mv) return;
    if (isPaused) {
      mv.setAttribute("auto-rotate", "");
      mv.setAttribute("rotation-per-second", "8deg");
    } else {
      mv.removeAttribute("auto-rotate");
      mv.removeAttribute("auto-rotate-delay");
    }
    setIsPaused(p => !p);
  };

  const saveThisAngle = async () => {
    const mv = viewerRef.current;
    if (!mv || typeof mv.toDataURL !== "function") return;
    setIsSaving(true);
    try {
      const raw     = mv.toDataURL("image/png", 1.0);
      const trimmed = await trimToSquare(raw, 2048);
      const patched = patchPngDpi(trimmed, 300); // embed 300 DPI pHYs chunk
      const a = document.createElement("a");
      a.href = patched;
      a.download = `${design.name ?? "design"}-300dpi-2048px.png`;
      a.click();
    } catch (e) {
      console.warn("[admin:saveAngle] failed", e);
    } finally {
      setIsSaving(false);
    }
  };

  // Use previewImageUrl (3-D front render) for the FRONT tab so the
  // admin sees the same correctly-oriented shirt view as the customer.
  // frontImageUrl is the raw UV texture — mirrored and contains colour
  // patches — so it is not suitable as a human-readable front reference.
  const snapshots = [
    { key: "front" as const, label: "FRONT", url: design.previewImageUrl ?? design.frontImageUrl },
    { key: "back"  as const, label: "BACK",  url: design.backImageUrl  },
    { key: "side"  as const, label: "SIDE",  url: design.sideImageUrl  },
  ].filter(s => !!s.url);

  const hasSnapshots = snapshots.length > 0;

  // Show 3D viewer only once canvasData has loaded and contains a texture
  if (design.productModelUrl && mvReady && textureReady) {
    return (
      <div className="flex-1 min-h-[300px] md:min-h-[500px] flex items-center justify-center relative" style={{ background: "rgba(0,0,0,0.5)" }}>
        <model-viewer
          ref={viewerRef}
          src={design.productModelUrl}
          camera-controls
          auto-rotate
          rotation-per-second="8deg"
          shadow-intensity="1"
          environment-image="neutral"
          exposure="1"
          tone-mapping="commerce"
          style={{ width: "100%", height: "100%", minHeight: "300px", "--poster-color": "transparent" } as any}
        />
        {/* 3D viewer controls overlay */}
        <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center gap-2 px-4">
          <button
            onClick={togglePause}
            title={isPaused ? "Resume rotation" : "Pause rotation"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium text-white transition-colors"
            style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.15)" }}
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            {isPaused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={saveThisAngle}
            disabled={isSaving}
            title="Save current angle as high-res PNG (2048px)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium text-white transition-colors disabled:opacity-50"
            style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.15)" }}
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
            Save this angle
          </button>
        </div>
      </div>
    );
  }

  // Snapshot image gallery (shown while canvas data loads or when no texture available)
  if (hasSnapshots) {
    const active = snapshots.find(s => s.key === activeView) ?? snapshots[0];
    return (
      <div className="flex-1 min-h-[300px] md:min-h-[500px] flex flex-col" style={{ background: "rgba(0,0,0,0.6)" }}>
        {/* Main image */}
        <div className="flex-1 flex items-center justify-center p-4 relative">
          <img
            src={active.url!}
            alt={active.label}
            className="max-w-full max-h-full object-contain"
            style={{ maxHeight: "420px" }}
          />
          {canvasDataLoading && (
            <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-black/50 text-white/50 text-[10px] rounded px-2 py-1">
              <Loader2 className="w-3 h-3 animate-spin" /> loading 3D…
            </div>
          )}
        </div>
        {/* Tabs */}
        {snapshots.length > 1 && (
          <div className="flex border-t border-white/10">
            {snapshots.map(s => (
              <button
                key={s.key}
                onClick={() => setActiveView(s.key)}
                className={`flex-1 py-2.5 text-[10px] tracking-[0.15em] font-medium transition-colors ${
                  activeView === s.key
                    ? "text-white bg-white/10"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Nothing available
  return (
    <div className="flex-1 min-h-[300px] md:min-h-[500px] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="flex flex-col items-center gap-3 text-white/40 p-8">
        <Package className="w-12 h-12" />
        <p className="text-sm">No preview available</p>
      </div>
    </div>
  );
}

// ── Design Viewer Modal ───────────────────────────────────────────────────────
function DesignViewerModal({ design, onClose }: { design: UserDesign; onClose: () => void }) {
  const [mvReady, setMvReady] = useState(false);
  const viewerRef = useRef<any>(null);
  // Lazy-fetch canvasData + designSpec (not returned by the list endpoint to keep it fast)
  const [fullCanvasData, setFullCanvasData] = useState<string | null | undefined>(undefined);
  const [fullDesignSpec, setFullDesignSpec] = useState<Record<string, any> | null | undefined>(undefined);
  const [fullCharge, setFullCharge] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch(`/api/admin/customizations/${design.id}`);
        if (!cancelled) {
          setFullCanvasData(data?.canvasData ?? null);
          setFullDesignSpec(data?.designSpec ?? null);
          setFullCharge(data?.customizationChargeInPaise ?? null);
        }
      } catch { if (!cancelled) { setFullCanvasData(null); setFullDesignSpec(null); setFullCharge(null); } }
    })();
    return () => { cancelled = true; };
  }, [design.id]);

  useEffect(() => {
    if (!document.querySelector('script[data-mv-loader]')) {
      const s = document.createElement("script");
      s.type = "module";
      s.setAttribute("data-mv-loader", "1");
      s.src = "https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js";
      s.onload = () => setMvReady(true);
      document.head.appendChild(s);
    } else {
      setMvReady(true);
    }
  }, []);

  // Merge list-level and lazily-fetched detail data — detail wins when available.
  const effectiveDesignSpec: Record<string, any> | null =
    fullDesignSpec !== undefined ? fullDesignSpec : design.designSpec ?? null;
  const effectiveCharge: number | null =
    fullCharge !== undefined ? fullCharge : design.customizationChargeInPaise ?? null;

  // Parse all the rich design data we now persist alongside each customization.
  // Use lazily-fetched canvasData so the list endpoint stays fast (no OOM).
  const effectiveCanvasData = fullCanvasData !== undefined ? fullCanvasData : design.canvasData;
  const parsedDesign = useMemo(() => {
    try {
      const parsed = effectiveCanvasData ? JSON.parse(effectiveCanvasData) : {};
      const canvasJSON = (() => {
        try {
          return typeof parsed.canvasJSON === "string"
            ? JSON.parse(parsed.canvasJSON)
            : parsed.canvasJSON;
        } catch { return null; }
      })();
      const objects: any[] = canvasJSON?.objects ?? [];
      const counts: Record<string, number> = {};
      const texts: string[] = [];
      let logoCount = 0;
      let shapeCount = 0;
      for (const o of objects) {
        const t = o.type || "object";
        counts[t] = (counts[t] ?? 0) + 1;
        if (t === "i-text" || t === "text" || t === "textbox" || t === "Text" || t === "FabricText" || t === "IText") {
          if (o.text) texts.push(o.text);
        }
        if (t === "image" || t === "Image" || t === "FabricImage") logoCount++;
        if (["rect","circle","triangle","polygon","line","path","Rect","Circle","Triangle","Polygon","Line","Path"].includes(t)) shapeCount++;
      }
      return {
        textureUrl: parsed.textureUrl as string | undefined,
        matColors: (parsed.matColors as string[] | undefined) ?? (design.partsEnabled as any)?.matColors ?? [],
        canvasBg: parsed.canvasBg as string | undefined,
        primaryColor: parsed.primaryColor as string | undefined,
        secondaryColor: parsed.secondaryColor as string | undefined,
        presetName: parsed.presetName as string | undefined ?? (design.partsEnabled as any)?.presetName,
        garmentState: parsed.garmentState as Record<string, any> | undefined,
        objectCount: objects.length,
        counts, texts, logoCount, shapeCount,
      };
    } catch {
      return { matColors: [], objectCount: 0, counts: {}, texts: [], logoCount: 0, shapeCount: 0 } as any;
    }
  }, [effectiveCanvasData, design.partsEnabled]);

  // Restore exact design on model load — uses the SAME robust iterate-all
  // pattern as the customizer so it works on arbitrary GLBs.
  useEffect(() => {
    if (!viewerRef.current || !mvReady) return;
    const mv = viewerRef.current;
    const handleLoad = async () => {
      const model = mv.model;
      if (!model?.materials?.length) return;
      const mats: any[] = Array.from(model.materials);
      // Per-material colors first (non-body trims, sleeves, collars, etc.)
      mats.forEach((mat: any, i: number) => {
        const hex = parsedDesign.matColors?.[i];
        if (hex && i > 0) {
          try { mat.pbrMetallicRoughness.setBaseColorFactor(hex); } catch {}
        }
      });
      // Then bake the design texture onto the first material that accepts one.
      const texSrc = parsedDesign.textureUrl || design.previewImageUrl;
      if (texSrc) {
        try {
          const tex = await mv.createTexture(texSrc);
          for (const mat of mats) {
            try {
              mat.pbrMetallicRoughness.baseColorTexture.setTexture(tex);
              mat.pbrMetallicRoughness.setBaseColorFactor([1, 1, 1, 1]);
              break;
            } catch {}
          }
        } catch {}
      }
    };
    mv.addEventListener("load", handleLoad);
    return () => mv.removeEventListener("load", handleLoad);
  }, [design, mvReady, parsedDesign]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div
        className="relative w-full max-w-5xl rounded-2xl overflow-hidden flex flex-col md:flex-row"
        style={{ background: "#100d0b", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "90vh" }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Left panel: 3D viewer when texture is ready, snapshot gallery otherwise */}
        <DesignLeftPanel
          design={design}
          mvReady={mvReady}
          viewerRef={viewerRef}
          textureReady={!!parsedDesign.textureUrl}
          canvasDataLoading={fullCanvasData === undefined}
        />

        {/* Info Panel */}
        <div className="w-full md:w-72 p-6 overflow-y-auto" style={{ borderLeft: "1px solid rgba(255,255,255,0.1)" }}>
          <h2 className="text-lg font-bold text-white mb-1">{design.name}</h2>
          <p className="text-xs text-white/40 mb-4">Customer Design</p>

          <div className="space-y-3 text-sm">
            <div>
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Customer</p>
              <p className="text-white font-medium">{design.userName}</p>
              <p className="text-white/60 text-xs">{design.userEmail}</p>
            </div>
            <div>
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Product</p>
              <p className="text-white">{design.productName ?? "—"}</p>
            </div>
            <div className="flex gap-4">
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Size</p>
                <p className="text-white">{design.size}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Color</p>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full border border-white/20" style={{ background: design.color }} />
                  <span className="text-white text-xs">{design.color}</span>
                </div>
              </div>
            </div>
            <div>
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Last Updated</p>
              <p className="text-white text-xs">{new Date(design.updatedAt).toLocaleString()}</p>
            </div>
          </div>

          {/* Material Colors */}
          {parsedDesign.matColors?.length > 0 && (
            <div className="mt-5">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Material Colors</p>
              <div className="flex flex-wrap gap-2">
                {parsedDesign.matColors.map((c: string, i: number) => (
                  <div key={i} className="flex items-center gap-1.5 bg-white/5 rounded px-2 py-1">
                    <div className="w-4 h-4 rounded-full border border-white/20" style={{ background: c }} />
                    <span className="text-white/70 text-[10px] font-mono">{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preset */}
          {parsedDesign.presetName && (
            <div className="mt-4">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Preset</p>
              <p className="text-white text-sm">{parsedDesign.presetName}</p>
            </div>
          )}

          {/* Garment State */}
          {parsedDesign.garmentState && (
            <div className="mt-4">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Garment Parts</p>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                {(["sleeves","collar","placket","panel","stripe"] as const).map(k => (
                  <div key={k} className="flex items-center justify-between bg-white/5 rounded px-2 py-1">
                    <span className="text-white/60 capitalize">{k}</span>
                    <span className={parsedDesign.garmentState?.[k] ? "text-emerald-400" : "text-white/30"}>
                      {parsedDesign.garmentState?.[k] ? "ON" : "off"}
                    </span>
                  </div>
                ))}
                {parsedDesign.garmentState?.pattern && parsedDesign.garmentState.pattern !== "none" && (
                  <div className="col-span-2 flex items-center justify-between bg-white/5 rounded px-2 py-1">
                    <span className="text-white/60">Pattern</span>
                    <span className="text-white">{parsedDesign.garmentState.pattern}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Customization charge */}
          {effectiveCharge != null && effectiveCharge > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Customization Charge</p>
              <p className="text-amber-400 font-semibold text-sm">
                ₹{(effectiveCharge / 100).toFixed(2)}
              </p>
            </div>
          )}

          {/* Design Spec — text, font, logo, colors */}
          {effectiveDesignSpec && (effectiveDesignSpec.textContent || effectiveDesignSpec.hasLogo || effectiveDesignSpec.logoUrl) && (
            <div className="mt-4">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Customization Details</p>
              <div className="space-y-1.5 text-xs">
                {effectiveDesignSpec.textContent && (
                  <>
                    <div className="bg-white/5 rounded px-2 py-1.5">
                      <span className="text-white/40">Text: </span>
                      <span className="text-white font-medium">"{effectiveDesignSpec.textContent}"</span>
                    </div>
                    {effectiveDesignSpec.textPlacement && (
                      <div className="bg-white/5 rounded px-2 py-1">
                        <span className="text-white/40">Text Placement: </span>
                        <span className="text-white">{effectiveDesignSpec.textPlacement}</span>
                      </div>
                    )}
                    {effectiveDesignSpec.fontFamily && (
                      <div className="bg-white/5 rounded px-2 py-1">
                        <span className="text-white/40">Font: </span>
                        <span className="text-white">{effectiveDesignSpec.fontFamily}
                          {effectiveDesignSpec.fontSize ? ` · ${effectiveDesignSpec.fontSize}px` : ""}
                          {effectiveDesignSpec.textBold ? " · Bold" : ""}
                          {effectiveDesignSpec.textItalic ? " · Italic" : ""}
                        </span>
                      </div>
                    )}
                    {effectiveDesignSpec.textColor && (
                      <div className="bg-white/5 rounded px-2 py-1 flex items-center gap-2">
                        <span className="text-white/40">Text Color: </span>
                        <div className="w-3 h-3 rounded-full border border-white/20" style={{ background: effectiveDesignSpec.textColor }} />
                        <span className="text-white font-mono">{effectiveDesignSpec.textColor}</span>
                      </div>
                    )}
                  </>
                )}
                {(effectiveDesignSpec.hasLogo || effectiveDesignSpec.logoUrl) && (
                  <>
                    {effectiveDesignSpec.logoPosition && (
                      <div className="bg-white/5 rounded px-2 py-1">
                        <span className="text-white/40">Logo Placement: </span>
                        <span className="text-white">{effectiveDesignSpec.logoPosition}</span>
                      </div>
                    )}
                    {effectiveDesignSpec.logoUrl && (
                      <div className="bg-white/5 rounded px-2 py-2 flex items-center gap-2">
                        <img
                          src={effectiveDesignSpec.logoUrl}
                          alt="Customer logo"
                          className="w-8 h-8 object-contain rounded bg-white/10"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-white/40 text-[10px]">Logo / Image</p>
                          <button
                            className="text-amber-400 hover:text-amber-300 text-[10px] underline transition-colors"
                            onClick={() => {
                              const a = document.createElement("a");
                              a.href = effectiveDesignSpec!.logoUrl;
                              a.download = `${design.name}-logo.png`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                            }}
                          >
                            ↓ Download original
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Design Elements summary (canvas object counts) */}
          {parsedDesign.objectCount > 0 && !effectiveDesignSpec?.textContent && parsedDesign.texts?.length > 0 && (
            <div className="mt-4">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-2">Canvas Text</p>
              <div className="bg-white/5 rounded px-2 py-1.5 text-xs">
                <span className="text-white">{parsedDesign.texts.map((t: string) => `"${t}"`).join(", ")}</span>
              </div>
            </div>
          )}

          {/* 3-view snapshot strip */}
          {(design.previewImageUrl || design.frontImageUrl || design.backImageUrl || design.sideImageUrl) && (
            <div className="mt-5">
              <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">Design Snapshots</p>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: "Front", url: design.previewImageUrl ?? design.frontImageUrl },
                  { label: "Back",  url: design.backImageUrl  },
                  { label: "Side",  url: design.sideImageUrl  },
                ].map(({ label, url }) => (
                  <div key={label}>
                    <p className="text-white/30 text-[9px] text-center mb-1 uppercase tracking-widest">{label}</p>
                    <div className="rounded overflow-hidden border border-white/10 bg-black/40 aspect-square flex items-center justify-center">
                      {url
                        ? <img src={url} alt={`${label} view`} className="w-full h-full object-contain" />
                        : <span className="text-white/20 text-[10px]">—</span>
                      }
                    </div>
                    {url && (
                      <a
                        href={url}
                        download={`${design.name}-${label.toLowerCase()}.png`}
                        className="block text-center text-[9px] text-white/30 hover:text-white/60 mt-1 transition-colors"
                        title={`Download ${label} view`}
                      >↓ save</a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!design.frontImageUrl && !design.previewImageUrl && !parsedDesign.textureUrl && (
            <div className="mt-5 p-4 rounded-lg border border-white/10 text-center">
              <p className="text-white/40 text-xs">No canvas design saved yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Admin Page ───────────────────────────────────────────────────────────
export default function AdminPage() {
  const { user, isLoaded } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const modelFileRef = useRef<HTMLInputElement>(null);
  const thumbFileRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<"dashboard" | "products" | "orders" | "users" | "designs" | "site" | "skuassets" | "enquiries" | "coupons" | "credits">("dashboard");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [uploadingModel, setUploadingModel] = useState(false);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [uploadingExtra, setUploadingExtra] = useState(false);
  const [uploadingHeroIdx, setUploadingHeroIdx] = useState<number | null>(null);
  const [heroImageUrls, setHeroImageUrls] = useState<(string | null)[]>([null, null, null, null]);
  const [viewingDesign, setViewingDesign] = useState<UserDesign | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // SKU Assets form state
  const skuAssetFileRef = useRef<HTMLInputElement>(null);
  const [skuAssetForm, setSkuAssetForm] = useState({ sku: "", assetType: "print" as "print" | "pattern" | "solid_colour" });
  const [uploadingSkuAsset, setUploadingSkuAsset] = useState(false);

  useEffect(() => {
    if (!user) return;
    getToken().then(async (token) => {
      try {
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${getApiUrl()}/api/admin/check`, { headers });
        setIsAdmin(res.ok);
      } catch { /* leave existing isAdmin state — don't flip to false on a transient error */ }
    });
  }, [user?.id]); // stable dependency: re-run only when the signed-in user actually changes

  const { data: products = [], isLoading: loadingProducts } = useQuery<Product[]>({
    queryKey: ["admin-products"],
    queryFn: () => apiFetch("/api/admin/products"),
    enabled: isAdmin === true,
  });

  const { data: designs = [], isLoading: loadingDesigns } = useQuery<UserDesign[]>({
    queryKey: ["admin-designs"],
    queryFn: () => apiFetch("/api/admin/customizations"),
    enabled: isAdmin === true && activeTab === "designs",
  });

  const { data: siteSettings } = useQuery<Record<string, unknown>>({
    queryKey: ["site-settings"],
    queryFn: () => apiFetch("/api/site-settings"),
    enabled: isAdmin === true,
  });

  const { data: skuAssets = [], isLoading: loadingSkuAssets } = useQuery<{
    id: number; sku: string; assetType: string; fileUrl: string; fileName: string; createdAt: string;
  }[]>({
    queryKey: ["admin-sku-assets"],
    queryFn: () => apiFetch("/api/admin/sku-assets"),
    enabled: isAdmin === true && activeTab === "skuassets",
  });

  const { data: hiddenPatternsData, refetch: refetchHidden } = useQuery<{ hiddenPatterns: string[] }>({
    queryKey: ["admin-hidden-patterns"],
    queryFn: () => apiFetch("/api/admin/site-settings/hidden-patterns"),
    enabled: isAdmin === true && activeTab === "skuassets",
  });

  const { data: enquiries = [], isLoading: loadingEnquiries, refetch: refetchEnquiries } = useQuery<{
    id: number; name: string; email: string; inquiryType: string; stylePreference: string | null;
    message: string; emailSent: boolean; createdAt: string;
  }[]>({
    queryKey: ["admin-enquiries"],
    queryFn: () => apiFetch("/api/admin/enquiries"),
    enabled: isAdmin === true && activeTab === "enquiries",
  });
  const hiddenPatterns: string[] = hiddenPatternsData?.hiddenPatterns ?? [];
  const [savingHidden, setSavingHidden] = useState(false);

  async function togglePattern(id: string) {
    const next = hiddenPatterns.includes(id)
      ? hiddenPatterns.filter(x => x !== id)
      : [...hiddenPatterns, id];
    setSavingHidden(true);
    try {
      await apiFetch("/api/admin/site-settings/hidden-patterns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hiddenPatterns: next }),
      });
      await refetchHidden();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSavingHidden(false); }
  }

  useEffect(() => {
    if (!siteSettings?.hero_banners) return;
    const banners = siteSettings.hero_banners as { slideIndex: number; imageUrl: string }[];
    const urls: (string | null)[] = [null, null, null, null];
    for (const b of banners) {
      if (b.slideIndex >= 0 && b.slideIndex < 4) urls[b.slideIndex] = b.imageUrl;
    }
    setHeroImageUrls(urls);
  }, [siteSettings]);

  const createMutation = useMutation({
    mutationFn: (data: Partial<Product>) => apiFetch("/api/admin/products", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-products"] }); toast({ title: "Product created" }); resetForm(); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Product> }) => apiFetch(`/api/admin/products/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-products"] }); toast({ title: "Product updated" }); resetForm(); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/admin/products/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-products"] }); toast({ title: "Product deleted" }); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteDesignMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/admin/customizations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-designs"] });
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      toast({ title: "Design deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const resetForm = () => { setForm({ ...EMPTY_FORM }); setEditingId(null); setShowForm(false); };

  const startEdit = (p: Product) => {
    setForm({
      ...p,
      priceText: (p.priceInPaise / 100).toFixed(2),
      thumbnailUrl: p.thumbnailUrl ?? "",
      additionalImages: p.additionalImages ?? "",
      gender: p.gender ?? "",
      productType: p.productType ?? "golf",
      subType: p.subType ?? "",
      sku: p.sku ?? "",
      stock: p.stock ?? 100,
      colorLabel: p.colorLabel ?? "",
      customizationMode: p.customizationMode ?? "zone",
      addOns: p.addOns ?? [],
    });
    setEditingId(p.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSave = async () => {
    const data = { ...form, priceInPaise: Math.round(parseFloat(form.priceText || "0") * 100) };
    if (!data.name || !data.modelUrl) { toast({ title: "Name and Model URL are required", variant: "destructive" }); return; }
    if (editingId) updateMutation.mutate({ id: editingId, data });
    else createMutation.mutate(data);
  };

  const handleModelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingModel(true);
    try {
      const token = await getToken();
      const fd = new FormData(); fd.append("model", file);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${getUploadApiUrl()}/api/admin/upload/model`, { method: "POST", body: fd, headers });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setForm(f => ({ ...f, modelUrl: data.url }));
      const stats = data.optimization;
      toast({
        title: "Model uploaded",
        description: stats && stats.reductionPct > 0
          ? `Optimised: ${(stats.originalBytes / 1024 / 1024).toFixed(1)} MB → ${(stats.optimizedBytes / 1024 / 1024).toFixed(1)} MB (−${stats.reductionPct}%)`
          : undefined,
      });
    } catch (err: any) { toast({ title: "Upload failed", description: err.message, variant: "destructive" }); }
    finally { setUploadingModel(false); if (e.target) e.target.value = ""; }
  };

  const handleThumbUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingThumb(true);
    try {
      const token = await getToken();
      const { compressImage } = await import("@/lib/imageCompression");
      const compressed = await compressImage(file, { maxPx: 1200, quality: 0.82 });
      const fd = new FormData(); fd.append("thumbnail", compressed);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${getUploadApiUrl()}/api/admin/upload/thumbnail`, { method: "POST", body: fd, headers });
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json();
      setForm(f => ({ ...f, thumbnailUrl: url }));
      const savedKB = Math.round((file.size - compressed.size) / 1024);
      toast({ title: "Thumbnail uploaded", description: savedKB > 0 ? `Compressed by ${savedKB} KB` : undefined });
    } catch (err: any) { toast({ title: "Upload failed", description: err.message, variant: "destructive" }); }
    finally { setUploadingThumb(false); if (e.target) e.target.value = ""; }
  };

  const [uploadingAddOnIdx, setUploadingAddOnIdx] = useState<number | null>(null);

  const handleAddOnImageUpload = async (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAddOnIdx(idx);
    try {
      const token = await getToken();
      const { compressImage } = await import("@/lib/imageCompression");
      const compressed = await compressImage(file, { maxPx: 800, quality: 0.82 });
      const fd = new FormData(); fd.append("thumbnail", compressed);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${getUploadApiUrl()}/api/admin/upload/thumbnail`, { method: "POST", body: fd, headers });
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json();
      setForm(f => {
        const addOns = [...(f.addOns ?? [])];
        addOns[idx] = { ...addOns[idx], imageUrl: url };
        return { ...f, addOns };
      });
      toast({ title: "Reference image uploaded" });
    } catch (err: any) { toast({ title: "Upload failed", description: err.message, variant: "destructive" }); }
    finally { setUploadingAddOnIdx(null); if (e.target) e.target.value = ""; }
  };

  const addAddOn = () => {
    setForm(f => ({ ...f, addOns: [...(f.addOns ?? []), { id: `addon-${Date.now()}`, label: "", imageUrl: null }] }));
  };
  const updateAddOnLabel = (idx: number, label: string) => {
    setForm(f => {
      const addOns = [...(f.addOns ?? [])];
      addOns[idx] = { ...addOns[idx], label };
      return { ...f, addOns };
    });
  };
  const removeAddOn = (idx: number) => {
    setForm(f => {
      const addOns = [...(f.addOns ?? [])];
      addOns.splice(idx, 1);
      return { ...f, addOns };
    });
  };

  function safeParseImages(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((u): u is string => typeof u === "string");
      if (typeof parsed === "string" && parsed.startsWith("http")) return [parsed];
      return [];
    } catch {
      if (raw.startsWith("http")) return [raw];
      return [];
    }
  }

  const handleExtraImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploadingExtra(true);
    try {
      const token = await getToken();
      const { compressImages } = await import("@/lib/imageCompression");
      const compressed = await compressImages(files, { maxPx: 1200, quality: 0.82 });
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const urls: string[] = [];
      for (const file of compressed) {
        const fd = new FormData(); fd.append("thumbnail", file);
        const res = await fetch(`${getUploadApiUrl()}/api/admin/upload/thumbnail`, { method: "POST", body: fd, headers });
        if (!res.ok) throw new Error(await res.text());
        const { url } = await res.json();
        urls.push(url);
      }
      setForm(f => {
        const existing = safeParseImages(f.additionalImages);
        return { ...f, additionalImages: JSON.stringify([...existing, ...urls]) };
      });
      toast({ title: `${urls.length} image${urls.length > 1 ? "s" : ""} uploaded` });
    } catch (err: any) { toast({ title: "Upload failed", description: err.message, variant: "destructive" }); }
    finally { setUploadingExtra(false); if (e.target) e.target.value = ""; }
  };

  const handleHeroUpload = async (slideIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingHeroIdx(slideIndex);
    try {
      const token = await getToken();
      const { compressImage } = await import("@/lib/imageCompression");
      const compressed = await compressImage(file, { maxPx: 1920, quality: 0.80 });
      const fd = new FormData(); fd.append("hero", compressed);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${getUploadApiUrl()}/api/admin/upload/hero`, { method: "POST", body: fd, headers });
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json();
      const newUrls = [...heroImageUrls];
      newUrls[slideIndex] = url;
      setHeroImageUrls(newUrls);
      const banners = newUrls
        .map((imageUrl, idx) => (imageUrl ? { slideIndex: idx, imageUrl } : null))
        .filter((b): b is { slideIndex: number; imageUrl: string } => b !== null);
      await fetch(`${getApiUrl()}/api/admin/site-settings/hero-banners`, {
        method: "PUT",
        body: JSON.stringify({ banners }),
        headers: { ...headers, "Content-Type": "application/json" },
      });
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
      const savedKB = Math.round((file.size - compressed.size) / 1024);
      toast({ title: `Slide ${slideIndex + 1} updated`, description: savedKB > 0 ? `Compressed by ${savedKB} KB` : undefined });
    } catch (err: any) { toast({ title: "Upload failed", description: err.message, variant: "destructive" }); }
    finally { setUploadingHeroIdx(null); if (e.target) e.target.value = ""; }
  };

  const removeExtraImage = (idx: number) => {
    setForm(f => {
      const imgs = safeParseImages(f.additionalImages);
      imgs.splice(idx, 1);
      return { ...f, additionalImages: imgs.length ? JSON.stringify(imgs) : "" };
    });
  };

  // ── Loading / Access Guards ──
  if (!isLoaded || isAdmin === null) {
    return <Layout><div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin w-8 h-8" /></div></Layout>;
  }

  if (!user) {
    return (
      <Layout>
        <div className="min-h-[70vh] flex flex-col items-center justify-center gap-6 text-center px-4">
          <ShieldCheck className="w-16 h-16 text-muted-foreground" />
          <h1 className="text-4xl font-serif">Sign in Required</h1>
          <p className="text-muted-foreground">Please sign in to access the admin panel.</p>
          <a href="/sign-in" className="text-sm font-medium tracking-widest border-b border-primary hover:text-primary transition-colors pb-1">SIGN IN</a>
        </div>
      </Layout>
    );
  }

  if (!isAdmin) {
    return (
      <Layout>
        <div className="min-h-[70vh] flex flex-col items-center justify-center gap-6 text-center px-4">
          <div className="text-6xl">🔒</div>
          <h1 className="text-4xl font-serif">Admin Access Required</h1>
          <p className="text-muted-foreground max-w-md">You do not have permission to access this page. Contact your administrator to grant access.</p>
          <a href="/" className="text-sm font-medium tracking-widest border-b border-primary hover:text-primary pb-1">RETURN TO COLLECTION</a>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-serif tracking-wider">Admin Panel</h1>
              <p className="text-xs text-muted-foreground">Signed in as {user.primaryEmailAddress?.emailAddress}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border mb-8">
          {[
            { id: "dashboard", label: "Dashboard", icon: BarChart3, count: 0 },
            { id: "products", label: "Products", icon: Package, count: products.length },
            { id: "orders", label: "Orders", icon: ShoppingBag, count: 0 },
            { id: "users", label: "Users", icon: UserCog, count: 0 },
            { id: "designs", label: "Designs", icon: Users, count: designs.length },
            { id: "site", label: "Site", icon: ImageIcon, count: 0 },
            { id: "skuassets", label: "SKU Assets", icon: Upload, count: skuAssets.length },
            { id: "enquiries", label: "Enquiries", icon: Mail, count: enquiries.length },
            { id: "coupons", label: "Coupons", icon: Tag, count: 0 },
            { id: "credits", label: "AI Credits", icon: Zap, count: 0 },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold tracking-wide transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── PRODUCTS TAB ── */}
        {activeTab === "dashboard" && <AdminDashboard />}
        {activeTab === "orders" && <AdminOrders onViewCustomization={setViewingDesign} />}
        {activeTab === "users" && <AdminUsers />}
        {activeTab === "coupons" && <AdminCoupons />}

        {activeTab === "products" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">All Products</h2>
              <Button onClick={() => { resetForm(); setShowForm(true); }} className="flex items-center gap-2 rounded-none text-xs tracking-widest">
                <Plus className="w-4 h-4" /> ADD PRODUCT
              </Button>
            </div>

            {/* Form */}
            {showForm && (
              <div className="border border-border mb-8 p-6 bg-card">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-base font-semibold">{editingId ? "Edit Product" : "New Product"}</h3>
                  <button onClick={resetForm}><X className="w-5 h-5 text-muted-foreground" /></button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Product Name *</label>
                    <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Signature Polo" className="rounded-none" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Category</label>
                    <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="h-10 border border-input bg-background px-3 text-sm rounded-none">
                      {["polo", "shorts", "trousers", "jacket", "t-shirt", "hoodie", "accessories","skorts","dress","q_club"].map(c => (
                        <option key={c} value={c}>{c === "q_club" ? "Q Club" : c.charAt(0).toUpperCase() + c.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Gender</label>
                    <select value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))} className="h-10 border border-input bg-background px-3 text-sm rounded-none">
                      <option value="">— Any —</option>
                      <option value="men">Men</option>
                      <option value="women">Women</option>
                      <option value="kids">Kids</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Collection</label>
                    <select value={form.productType} onChange={e => setForm(f => ({ ...f, productType: e.target.value }))} className="h-10 border border-input bg-background px-3 text-sm rounded-none">
                      <option value="golf">Golf</option>
                      <option value="gym">Gym</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Sub Type (Customiser)</label>
                    <select value={form.subType} onChange={e => setForm(f => ({ ...f, subType: e.target.value }))} className="h-10 border border-input bg-background px-3 text-sm rounded-none">
                      <option value="">— Not Set —</option>
                      <option value="solid">Solid (colours only)</option>
                      <option value="printed">Printed (print library)</option>
                      <option value="pattern">Pattern (GT geometric)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">SKU</label>
                    <Input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="e.g. KS-POLO-001" className="rounded-none" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Stock Units</label>
                    <Input type="number" min={0} value={form.stock} onChange={e => setForm(f => ({ ...f, stock: parseInt(e.target.value) || 0 }))} placeholder="100" className="rounded-none" />
                  </div>
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Description *</label>
                    <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the product..." rows={3} className="border border-input bg-background px-3 py-2 text-sm rounded-none resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Price (₹) *</label>
                    <Input type="number" value={form.priceText} onChange={e => setForm(f => ({ ...f, priceText: e.target.value }))} placeholder="e.g. 12500" className="rounded-none" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Default Color</label>
                    <div className="flex items-center gap-3">
                      <input type="color" value={form.defaultColor} onChange={e => setForm(f => ({ ...f, defaultColor: e.target.value }))} className="w-10 h-10 cursor-pointer border border-input rounded-none p-0" />
                      <span className="text-sm text-muted-foreground">{form.defaultColor}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Color Label</label>
                    <Input value={form.colorLabel ?? ""} onChange={e => setForm(f => ({ ...f, colorLabel: e.target.value }))} placeholder="e.g. Navy Floral Print, Sky Blue & Brown" className="rounded-none" />
                    <p className="text-[10px] text-muted-foreground leading-tight">Customer-facing colour name shown on product cards. Leave blank to auto-derive from product name.</p>
                  </div>

                  {/* 3D Model Upload */}
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">3D Model (.glb / .gltf) *</label>
                    <div className="flex gap-2">
                      <Input value={form.modelUrl} onChange={e => setForm(f => ({ ...f, modelUrl: e.target.value }))} placeholder="Paste URL or upload .glb file →" className="rounded-none flex-1 text-sm" />
                      <label className="cursor-pointer shrink-0">
                        <div className={`h-10 px-4 flex items-center gap-2 border border-input text-sm font-medium transition-colors ${uploadingModel ? "opacity-50" : "hover:bg-accent cursor-pointer"}`}>
                          {uploadingModel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                          <span>Upload .glb</span>
                        </div>
                        <input ref={modelFileRef} type="file" accept=".glb,.gltf" onChange={handleModelUpload} className="hidden" disabled={uploadingModel} />
                      </label>
                    </div>
                    {form.modelUrl && (
                      <p className="text-xs text-emerald-600 flex items-center gap-1"><Check className="w-3 h-3" /> {form.modelUrl.split("/").pop()}</p>
                    )}
                  </div>

                  {/* Thumbnail Upload */}
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Product Thumbnail Image</label>
                    <div className="flex gap-2">
                      <Input value={form.thumbnailUrl || ""} onChange={e => setForm(f => ({ ...f, thumbnailUrl: e.target.value }))} placeholder="Paste image URL or upload →" className="rounded-none flex-1 text-sm" />
                      <label className="cursor-pointer shrink-0">
                        <div className={`h-10 px-4 flex items-center gap-2 border border-input text-sm font-medium transition-colors ${uploadingThumb ? "opacity-50" : "hover:bg-accent cursor-pointer"}`}>
                          {uploadingThumb ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                          <span>Upload Image</span>
                        </div>
                        <input ref={thumbFileRef} type="file" accept="image/*" onChange={handleThumbUpload} className="hidden" disabled={uploadingThumb} />
                      </label>
                    </div>
                    {form.thumbnailUrl && (
                      <img src={getAssetUrl(form.thumbnailUrl)} alt="Thumbnail" className="h-24 w-24 object-cover border border-input mt-1" />
                    )}
                  </div>

                  {/* Additional Images Upload */}
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Additional Gallery Images</label>
                    <p className="text-xs text-muted-foreground">These appear as clickable thumbnails below the main product image on the product page.</p>
                    <label className="cursor-pointer w-fit">
                      <div className={`h-10 px-4 flex items-center gap-2 border border-input text-sm font-medium transition-colors ${uploadingExtra ? "opacity-50" : "hover:bg-accent cursor-pointer"}`}>
                        {uploadingExtra ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        <span>Upload Additional Images</span>
                      </div>
                      <input type="file" accept="image/*" multiple onChange={handleExtraImageUpload} className="hidden" disabled={uploadingExtra} />
                    </label>
                    {(() => {
                      const imgs = safeParseImages(form.additionalImages);
                      return imgs.length > 0 ? (
                        <div className="flex flex-wrap gap-2 mt-1">
                          {imgs.map((url, idx) => (
                            <div key={idx} className="relative group">
                              <img src={url} alt={`Extra ${idx + 1}`} className="h-20 w-20 object-cover border border-input" />
                              <button
                                type="button"
                                onClick={() => removeExtraImage(idx)}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Remove"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Availability</label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.available} onChange={e => setForm(f => ({ ...f, available: e.target.checked }))} className="w-4 h-4" />
                      <span className="text-sm">Product is live and purchasable</span>
                    </label>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Customization</label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.allowCustomization} onChange={e => setForm(f => ({ ...f, allowCustomization: e.target.checked }))} className="w-4 h-4" />
                      <span className="text-sm">Allow bespoke customization for this product</span>
                    </label>
                    <p className="text-xs text-muted-foreground">When enabled (and the Customization feature is active site-wide), a "Personalise" button will appear on this product's page.</p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs tracking-widest text-muted-foreground uppercase">Customization Mode</label>
                    <select value={form.customizationMode ?? "zone"} onChange={e => setForm(f => ({ ...f, customizationMode: e.target.value }))} className="h-10 border border-input bg-background px-3 text-sm rounded-none">
                      <option value="zone">Zone-based (per-part colours/prints)</option>
                      <option value="whole-garment">Whole Garment (single colour/print, no zones)</option>
                      <option value="collar-only">Collar Only</option>
                      <option value="two-part">Two-Part</option>
                    </select>
                    <p className="text-xs text-muted-foreground">Controls how the customiser behaves for this product. Pants &amp; shorts should use "Whole Garment".</p>
                  </div>

                  {form.customizationMode === "whole-garment" && (
                    <div className="flex flex-col gap-2 md:col-span-2 border border-dashed border-border p-4">
                      <div className="flex items-center justify-between">
                        <label className="text-xs tracking-widest text-muted-foreground uppercase">Yes/No Add-Ons</label>
                        <Button type="button" variant="outline" size="sm" onClick={addAddOn} className="rounded-none text-xs flex items-center gap-1">
                          <Plus className="w-3 h-3" /> Add Option
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Customer-facing Yes/No toggles shown during customization (e.g. Tee Holder, Side Pocket w/ Zipper, Velcro), each with an optional reference photo.</p>
                      {(form.addOns ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">No add-ons yet.</p>
                      ) : (
                        <div className="flex flex-col gap-3 mt-1">
                          {(form.addOns ?? []).map((a, idx) => (
                            <div key={a.id} className="flex items-center gap-3 border border-input p-2">
                              {a.imageUrl ? (
                                <img src={getAssetUrl(a.imageUrl)} alt={a.label} className="h-12 w-12 object-cover border border-input shrink-0" />
                              ) : (
                                <div className="h-12 w-12 bg-muted flex items-center justify-center shrink-0 text-[8px] text-muted-foreground">IMG</div>
                              )}
                              <Input value={a.label} onChange={e => updateAddOnLabel(idx, e.target.value)} placeholder="e.g. Tee Holder" className="rounded-none flex-1 text-sm" />
                              <label className="cursor-pointer shrink-0">
                                <div className={`h-9 px-3 flex items-center gap-1.5 border border-input text-xs font-medium transition-colors ${uploadingAddOnIdx === idx ? "opacity-50" : "hover:bg-accent cursor-pointer"}`}>
                                  {uploadingAddOnIdx === idx ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                                  <span>Photo</span>
                                </div>
                                <input type="file" accept="image/*" onChange={e => handleAddOnImageUpload(idx, e)} className="hidden" disabled={uploadingAddOnIdx === idx} />
                              </label>
                              <button type="button" onClick={() => removeAddOn(idx)} className="shrink-0 text-muted-foreground hover:text-destructive">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-border">
                  <Button variant="outline" onClick={resetForm} className="rounded-none text-xs tracking-widest">CANCEL</Button>
                  <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending} className="rounded-none text-xs tracking-widest flex items-center gap-2">
                    {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
                    {editingId ? "SAVE CHANGES" : "CREATE PRODUCT"}
                  </Button>
                </div>
              </div>
            )}

            {/* Products Table */}
            {loadingProducts ? (
              <div className="flex justify-center py-20"><Loader2 className="animate-spin w-8 h-8" /></div>
            ) : products.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border rounded-none">
                <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-muted-foreground">No products yet.</p>
                <button onClick={() => { resetForm(); setShowForm(true); }} className="mt-3 text-sm underline text-primary">Add your first product</button>
              </div>
            ) : (
              <div className="border border-border overflow-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead className="bg-muted/30">
                    <tr>
                      {["#", "Product", "Category", "Price", "Status", "3D Model", "Actions"].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] tracking-widest text-muted-foreground uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p, i) => (
                      <tr key={p.id} className={`border-t border-border ${i % 2 === 1 ? "bg-muted/10" : ""}`}>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{p.id}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {p.thumbnailUrl
                              ? <img src={getAssetUrl(p.thumbnailUrl)} alt="" className="w-10 h-10 object-cover border border-border shrink-0" />
                              : <div className="w-10 h-10 bg-muted flex items-center justify-center shrink-0 text-[9px] font-bold text-muted-foreground">IMG</div>
                            }
                            <div>
                              <p className="font-semibold leading-tight">{p.name}</p>
                              <p className="text-xs text-muted-foreground line-clamp-1 max-w-[200px]">{p.description}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 capitalize text-muted-foreground text-xs">{p.category}</td>
                        <td className="px-4 py-3 font-medium">{formatPrice(p.priceInPaise)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] px-2 py-1 tracking-wider font-semibold ${p.available ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                            {p.available ? "LIVE" : "HIDDEN"}
                          </span>
                        </td>
                        <td className="px-4 py-3 max-w-[140px]">
                          <a href={p.modelUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-500 underline hover:no-underline truncate block">
                            {p.modelUrl.split("/").pop() || "View"}
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <button onClick={() => startEdit(p)} className="p-1 hover:text-primary transition-colors" title="Edit">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => { if (confirm(`Delete "${p.name}"?`)) deleteMutation.mutate(p.id); }} className="p-1 hover:text-red-500 transition-colors" title="Delete" disabled={deleteMutation.isPending}>
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── USER DESIGNS TAB ── */}
        {activeTab === "designs" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">Customer Designs</h2>
              <button onClick={() => queryClient.invalidateQueries({ queryKey: ["admin-designs"] })} className="text-xs text-muted-foreground hover:text-foreground underline">Refresh</button>
            </div>

            {loadingDesigns ? (
              <div className="flex justify-center py-20"><Loader2 className="animate-spin w-8 h-8" /></div>
            ) : designs.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border">
                <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-muted-foreground">No customer designs yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Designs appear here when customers customize and save products.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {designs.map(d => (
                  <div key={d.id} className="border border-border bg-card flex flex-col overflow-hidden hover:border-primary transition-colors group">
                    {/* Preview — prefer 3-D render (previewImageUrl) so the card looks like a shirt,
                         fall back to the flat print-ready canvas, then the product thumbnail */}
                    <div className="aspect-square bg-muted relative overflow-hidden">
                      {(d.previewImageUrl || d.frontImageUrl) ? (
                        <img src={d.previewImageUrl ?? d.frontImageUrl!} alt={d.name} className="w-full h-full object-contain p-2" />
                      ) : d.productThumbnailUrl ? (
                        <img src={d.productThumbnailUrl} alt={d.name} className="w-full h-full object-cover opacity-50" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground/30 text-xs font-bold">NO PREVIEW</div>
                      )}
                      {/* Customization status badge */}
                      {(() => {
                        const spec = d.designSpec as any;
                        const hasLogoOrText = spec?.hasLogo || spec?.textContent || spec?.logoUrl;
                        const hasPrint = spec?.printId || spec?.kashaDesignId;
                        if (hasLogoOrText) return (
                          <span className="absolute top-2 left-2 bg-emerald-600 text-white text-[9px] px-2 py-0.5 tracking-wider font-semibold">CUSTOMIZED</span>
                        );
                        if (hasPrint) return (
                          <span className="absolute top-2 left-2 bg-sky-600 text-white text-[9px] px-2 py-0.5 tracking-wider font-semibold">PRINT</span>
                        );
                        if (d.frontImageUrl || d.previewImageUrl) return (
                          <span className="absolute top-2 left-2 bg-white/20 text-white text-[9px] px-2 py-0.5 tracking-wider">COLOUR ONLY</span>
                        );
                        return (
                          <span className="absolute top-2 left-2 bg-black/40 text-white/40 text-[9px] px-2 py-0.5 tracking-wider">NO CUSTOMIZATION</span>
                        );
                      })()}
                      {/* 3-view indicator badge */}
                      {d.frontImageUrl && d.backImageUrl && d.sideImageUrl && (
                        <span className="absolute top-2 right-2 bg-black/60 text-white/70 text-[8px] px-1.5 py-0.5 rounded tracking-wider">3-VIEW</span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-4 flex flex-col gap-2 flex-1">
                      <div>
                        <p className="font-semibold text-sm leading-tight">{d.name}</p>
                        <p className="text-xs text-muted-foreground">{d.productName ?? "Unknown product"}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <div className="w-3 h-3 rounded-full border border-muted-foreground/30 shrink-0" style={{ background: d.color }} />
                        <span>Size {d.size}</span>
                        <span>·</span>
                        <span className="truncate">{d.userEmail}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground/60">{new Date(d.updatedAt).toLocaleDateString()}</p>
                      <div className="mt-auto flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-none text-[10px] tracking-widest flex-1 flex items-center justify-center gap-2"
                          onClick={() => setViewingDesign(d)}
                        >
                          <Eye className="w-3 h-3" /> VIEW
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-none text-[10px] tracking-widest flex items-center justify-center gap-1 text-amber-700 hover:text-amber-800 hover:bg-amber-50 hover:border-amber-300"
                          title="Download design views"
                          onClick={async () => {
                            if (!d.frontImageUrl && !d.backImageUrl && !d.sideImageUrl && !d.previewImageUrl) {
                              alert("No design images saved for this customization yet.");
                              return;
                            }
                            const { count, errors } = await exportDesignImages(d);
                            if (count === 0) alert(errors.length ? `Export failed: ${errors.join("; ")}` : "No design images to download.");
                            else if (errors.length) alert(`Downloaded ${count} file(s). Some failed: ${errors.join("; ")}`);
                          }}
                        >
                          <Download className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-none text-[10px] tracking-widest flex items-center justify-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 hover:border-red-300"
                          title="Delete this customer design"
                          disabled={deleteDesignMutation.isPending && deleteDesignMutation.variables === d.id}
                          onClick={() => {
                            if (confirm(`Delete design "${d.name}" by ${d.userEmail ?? "this customer"}? This cannot be undone.`)) {
                              deleteDesignMutation.mutate(d.id);
                            }
                          }}
                        >
                          {deleteDesignMutation.isPending && deleteDesignMutation.variables === d.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                          {deleteDesignMutation.isPending && deleteDesignMutation.variables === d.id ? "DELETING" : "DELETE"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

        {/* ── SITE TAB ── */}
        {activeTab === "site" && (
          <div>
            <div className="mb-8">
              <h2 className="text-lg font-semibold mb-1">Hero Banners</h2>
              <p className="text-sm text-muted-foreground">Upload optimised images for the homepage carousel. Images are automatically compressed and converted to WebP before being saved to the CDN.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {[
                "Men's Collection (Slide 1)",
                "Men's T-Shirts (Slide 2)",
                "Women's Collection (Slide 3)",
                "All Products (Slide 4)",
              ].map((label, idx) => {
                const currentUrl = heroImageUrls[idx];
                const isUploading = uploadingHeroIdx === idx;
                const inputId = `hero-upload-${idx}`;
                return (
                  <div key={idx} className="border border-border rounded-sm overflow-hidden">
                    <div className="relative bg-[#F2F3F7]" style={{ aspectRatio: "16/9" }}>
                      {currentUrl ? (
                        <img src={currentUrl} alt={label} className="w-full h-full object-cover" />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                          <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
                          <span className="text-xs text-muted-foreground">No image set</span>
                        </div>
                      )}
                      {isUploading && (
                        <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                          <Loader2 className="w-6 h-6 animate-spin text-[#B8925A]" />
                        </div>
                      )}
                    </div>
                    <div className="p-3 flex items-center justify-between gap-3 bg-white border-t border-border">
                      <span className="text-xs font-medium text-muted-foreground truncate">{label}</span>
                      <label htmlFor={inputId} className={`flex items-center gap-1.5 text-xs px-3 py-1.5 border border-input font-medium cursor-pointer transition-colors ${isUploading ? "opacity-50 pointer-events-none" : "hover:bg-accent"}`}>
                        <Upload className="w-3 h-3" />
                        {currentUrl ? "Replace" : "Upload"}
                      </label>
                      <input
                        id={inputId}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={isUploading}
                        onChange={(e) => handleHeroUpload(idx, e)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Recommended: landscape photos, minimum 1920×1080 px. The system resizes and converts to WebP automatically.</p>
          </div>
        )}

        {/* ── SKU ASSETS TAB ── */}
        {activeTab === "skuassets" && (
          <div>
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-1">SKU Asset Manager</h2>
              <p className="text-sm text-muted-foreground">
                Upload print, pattern, or solid-colour assets tied to a specific product SKU.
                These assets are served to the customiser to drive the design flow.
              </p>
            </div>

            {/* ── GP Print Library Manager ── */}
            <div className="border border-border rounded-sm p-5 mb-8 bg-card">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold tracking-wide">GP Print Library</h3>
                <span className="text-xs text-muted-foreground">{hiddenPatterns.length} hidden · {PATTERNS.length - hiddenPatterns.length} visible</span>
              </div>
              <p className="text-xs text-muted-foreground mb-4">Toggle any print to hide it from the customiser. Changes take effect immediately for customers.</p>
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-3">
                {PATTERNS.map(p => {
                  const isHidden = hiddenPatterns.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      disabled={savingHidden}
                      onClick={() => togglePattern(p.id)}
                      title={isHidden ? `Show ${p.label}` : `Hide ${p.label}`}
                      className={`relative flex flex-col items-center gap-1.5 p-1.5 rounded border transition-all ${
                        isHidden
                          ? "border-destructive/40 bg-destructive/5 opacity-50"
                          : "border-border hover:border-primary bg-background hover:bg-muted/40"
                      }`}
                    >
                      <div className="relative w-full aspect-square overflow-hidden rounded-sm bg-muted">
                        <img
                          src={patternUrl(p.file)}
                          alt={p.label}
                          className="w-full h-full object-cover"
                          onError={e => { (e.currentTarget as HTMLImageElement).style.opacity = "0.2"; }}
                        />
                        {isHidden && (
                          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                            <X className="w-4 h-4 text-destructive" />
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] font-medium tracking-wide leading-none">{p.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Upload form */}
            <div className="border border-border rounded-sm p-5 mb-8 bg-card">
              <h3 className="text-sm font-semibold tracking-wide mb-4">Upload New Asset</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Product SKU</label>
                  <Input
                    value={skuAssetForm.sku}
                    onChange={e => setSkuAssetForm(f => ({ ...f, sku: e.target.value.toUpperCase() }))}
                    placeholder="e.g. KS1000BGP001"
                    className="rounded-none text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Asset Type</label>
                  <select
                    value={skuAssetForm.assetType}
                    onChange={e => setSkuAssetForm(f => ({ ...f, assetType: e.target.value as any }))}
                    className="w-full h-9 border border-input bg-background px-3 text-xs rounded-none"
                  >
                    <option value="print">Print</option>
                    <option value="pattern">Pattern</option>
                    <option value="solid_colour">Solid Colour</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">File (image / texture)</label>
                  <input
                    ref={skuAssetFileRef}
                    type="file"
                    accept="image/*,.glb,.gltf"
                    className="w-full h-9 text-xs file:mr-2 file:py-1 file:px-3 file:border-0 file:bg-muted file:text-xs file:font-medium cursor-pointer"
                  />
                </div>
              </div>
              <Button
                disabled={uploadingSkuAsset || !skuAssetForm.sku.trim()}
                onClick={async () => {
                  const file = skuAssetFileRef.current?.files?.[0];
                  if (!file || !skuAssetForm.sku.trim()) return;
                  setUploadingSkuAsset(true);
                  try {
                    const fd = new FormData();
                    fd.append("sku", skuAssetForm.sku.trim());
                    fd.append("assetType", skuAssetForm.assetType);
                    fd.append("file", file);
                    await apiFetch("/api/admin/sku-assets", { method: "POST", body: fd });
                    queryClient.invalidateQueries({ queryKey: ["admin-sku-assets"] });
                    setSkuAssetForm({ sku: "", assetType: "print" });
                    if (skuAssetFileRef.current) skuAssetFileRef.current.value = "";
                    toast({ title: "Asset uploaded", description: `${skuAssetForm.sku} · ${skuAssetForm.assetType}` });
                  } catch (e: any) {
                    toast({ title: "Upload failed", description: e.message, variant: "destructive" });
                  } finally {
                    setUploadingSkuAsset(false);
                  }
                }}
                className="rounded-none text-xs tracking-widest"
              >
                {uploadingSkuAsset ? <><Loader2 className="w-3 h-3 animate-spin mr-2" />Uploading…</> : <><Upload className="w-3 h-3 mr-2" />UPLOAD ASSET</>}
              </Button>
            </div>

            {/* Asset list */}
            {loadingSkuAssets ? (
              <div className="flex items-center justify-center h-24"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : skuAssets.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No assets uploaded yet.</div>
            ) : (
              <div className="border border-border rounded-sm overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-2 font-semibold text-muted-foreground">SKU</th>
                      <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Type</th>
                      <th className="text-left px-4 py-2 font-semibold text-muted-foreground">File</th>
                      <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Preview</th>
                      <th className="text-left px-4 py-2 font-semibold text-muted-foreground">Uploaded</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {skuAssets.map(a => (
                      <tr key={a.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 font-mono font-semibold text-primary">{a.sku}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full font-medium ${
                            a.assetType === "print" ? "bg-blue-50 text-blue-700" :
                            a.assetType === "pattern" ? "bg-amber-50 text-amber-700" :
                            "bg-emerald-50 text-emerald-700"
                          }`}>
                            {a.assetType}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground max-w-[180px] truncate">{a.fileName}</td>
                        <td className="px-4 py-2.5">
                          {/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(a.fileName) ? (
                            <img src={a.fileUrl} alt={a.sku} className="w-10 h-10 object-cover rounded border border-border" />
                          ) : (
                            <a href={a.fileUrl} target="_blank" rel="noreferrer" className="text-primary underline">View</a>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-2.5">
                          <button
                            onClick={async () => {
                              if (!confirm(`Delete asset for SKU ${a.sku}?`)) return;
                              try {
                                await apiFetch(`/api/admin/sku-assets/${a.id}`, { method: "DELETE" });
                                queryClient.invalidateQueries({ queryKey: ["admin-sku-assets"] });
                                toast({ title: "Asset deleted" });
                              } catch (e: any) {
                                toast({ title: "Error", description: e.message, variant: "destructive" });
                              }
                            }}
                            className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── ENQUIRIES TAB ── */}
        {activeTab === "enquiries" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-semibold">Customer Enquiries</h2>
                <p className="text-sm text-muted-foreground mt-1">Messages submitted via the Contact Us form. Reply directly by clicking the email address.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchEnquiries()} className="rounded-none text-xs tracking-widest">
                Refresh
              </Button>
            </div>
            {loadingEnquiries ? (
              <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : enquiries.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No enquiries yet.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {enquiries.map(enq => (
                  <div key={enq.id} className="border border-border rounded-sm p-5 bg-card">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                          <span className="font-semibold text-sm">{enq.name}</span>
                          <a href={`https://mail.google.com/mail/u/0/?to=${encodeURIComponent(enq.email)}&su=${encodeURIComponent("Re: " + enq.inquiryType + " Enquiry")}&fs=1&tf=cm`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-primary text-xs underline underline-offset-2 hover:opacity-80 truncate"
                            title="Click to reply in Gmail"
                          >{enq.email}</a>
                          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{enq.inquiryType}</span>
                          {enq.stylePreference && (
                            <span className="text-xs text-muted-foreground">Style: {enq.stylePreference}</span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full ${enq.emailSent ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}`}>
                            {enq.emailSent ? "Email sent" : "Email pending"}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{enq.message}</p>
                        <p className="text-xs text-muted-foreground mt-2 opacity-60">{new Date(enq.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        <a href={`https://mail.google.com/mail/u/0/?to=${encodeURIComponent(enq.email)}&su=${encodeURIComponent("Re: " + enq.inquiryType + " Enquiry — KA.SHA")}&fs=1&tf=cm`}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-primary text-primary rounded-none hover:bg-primary hover:text-primary-foreground transition-colors"
                        >
                          <Mail className="w-3 h-3" /> Reply
                        </a>
                        <button
                          onClick={async () => {
                            if (!confirm(`Delete enquiry from ${enq.name}?`)) return;
                            try {
                              const { getToken } = (window as any).Clerk?.session ?? {};
                              const token = typeof getToken === "function" ? await getToken() : null;
                              const headers: Record<string, string> = {};
                              if (token) headers["Authorization"] = `Bearer ${token}`;
                              await fetch(`${getApiUrl()}/api/admin/enquiries/${enq.id}`, { method: "DELETE", headers });
                              queryClient.setQueryData(["admin-enquiries"], (old: typeof enquiries) =>
                                old ? old.filter(e => e.id !== enq.id) : old
                              );
                            } catch { toast({ title: "Failed to delete", variant: "destructive" }); }
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-destructive border border-destructive/30 rounded-none hover:bg-destructive hover:text-destructive-foreground transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "credits" && <AdminCreditPackages />}

      {/* Design Viewer Modal */}
      {viewingDesign && (
        <DesignViewerModal design={viewingDesign} onClose={() => setViewingDesign(null)} />
      )}
    </Layout>
  );
}

/* ── Admin Credit Packages Component ──────────────────────────────────────── */
interface CreditPackageRow {
  id: number;
  name: string;
  creditsAmount: number;
  priceInPaise: number;
  bonusCredits: number;
  active: boolean;
}

function AdminCreditPackages() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<CreditPackageRow>>({});

  const { data: packages = [], isLoading } = useQuery<CreditPackageRow[]>({
    queryKey: ["admin-credit-packages"],
    queryFn: () => apiFetch("/api/admin/credits/packages"),
  });

  const patchPackage = useMutation({
    mutationFn: async ({ id, ...body }: Partial<CreditPackageRow> & { id: number }) => {
      const { getToken } = (window as any).Clerk?.session ?? {};
      const token = typeof getToken === "function" ? await getToken() : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${getApiUrl()}/api/admin/credits/packages/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<CreditPackageRow>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<CreditPackageRow[]>(["admin-credit-packages"], old =>
        old ? old.map(p => p.id === updated.id ? updated : p) : old
      );
      setEditingId(null);
      toast({ title: "Package updated" });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const startEdit = (pkg: CreditPackageRow) => {
    setEditingId(pkg.id);
    setEditForm({ name: pkg.name, creditsAmount: pkg.creditsAmount, priceInPaise: pkg.priceInPaise, bonusCredits: pkg.bonusCredits });
  };

  const saveEdit = (id: number) => {
    if (!editForm.name?.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    patchPackage.mutate({ id, ...editForm });
  };

  const toggleActive = (pkg: CreditPackageRow) =>
    patchPackage.mutate({ id: pkg.id, active: !pkg.active });

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin w-8 h-8" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">AI Credit Packages</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Edit package names, prices, and credit amounts. Changes take effect immediately for new purchases.
          </p>
        </div>
      </div>

      <div className="border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wider font-semibold text-muted-foreground">Package Name</th>
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wider font-semibold text-muted-foreground">Credits</th>
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wider font-semibold text-muted-foreground">Bonus Credits</th>
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wider font-semibold text-muted-foreground">Price (₹)</th>
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wider font-semibold text-muted-foreground">Per Credit</th>
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wider font-semibold text-muted-foreground">Active</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {packages.map(pkg => {
              const isEditing = editingId === pkg.id;
              const priceRs = pkg.priceInPaise / 100;
              const perCredit = pkg.creditsAmount > 0 ? Math.round(pkg.priceInPaise / pkg.creditsAmount / 100) : 0;

              return (
                <tr key={pkg.id} className={`border-b border-border last:border-0 ${!pkg.active ? "opacity-50" : ""}`}>

                  {/* Name */}
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <Input
                        value={editForm.name ?? ""}
                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        className="h-8 rounded-none w-40"
                      />
                    ) : (
                      <span className="font-medium">{pkg.name}</span>
                    )}
                  </td>

                  {/* Credits amount */}
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <Input
                        type="number" min={1}
                        value={editForm.creditsAmount ?? ""}
                        onChange={e => setEditForm(f => ({ ...f, creditsAmount: parseInt(e.target.value) || 1 }))}
                        className="h-8 rounded-none w-20"
                      />
                    ) : (
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-amber-500" /> {pkg.creditsAmount}
                      </span>
                    )}
                  </td>

                  {/* Bonus credits */}
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <Input
                        type="number" min={0}
                        value={editForm.bonusCredits ?? ""}
                        onChange={e => setEditForm(f => ({ ...f, bonusCredits: parseInt(e.target.value) || 0 }))}
                        className="h-8 rounded-none w-20"
                      />
                    ) : (
                      <span className="text-emerald-600">{pkg.bonusCredits > 0 ? `+${pkg.bonusCredits}` : "—"}</span>
                    )}
                  </td>

                  {/* Price in paise → display as ₹ */}
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">₹</span>
                        <Input
                          type="number" min={1} step={1}
                          value={editForm.priceInPaise !== undefined ? editForm.priceInPaise / 100 : ""}
                          onChange={e => setEditForm(f => ({ ...f, priceInPaise: Math.round(parseFloat(e.target.value) * 100) || 0 }))}
                          className="h-8 rounded-none w-24"
                          placeholder="49"
                        />
                      </div>
                    ) : (
                      <span className="font-semibold">₹{priceRs}</span>
                    )}
                  </td>

                  {/* Per-credit rate (read-only) */}
                  <td className="px-4 py-3 text-muted-foreground">₹{perCredit}</td>

                  {/* Active toggle */}
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(pkg)}
                      disabled={patchPackage.isPending}
                      className={`px-2 py-1 text-xs font-medium rounded-none border transition-colors ${
                        pkg.active
                          ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                          : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                      }`}
                    >
                      {pkg.active ? "Active" : "Hidden"}
                    </button>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(pkg.id)}
                          disabled={patchPackage.isPending}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          {patchPackage.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-border hover:bg-muted transition-colors"
                        >
                          <X className="w-3 h-3" /> Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(pkg)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-border hover:bg-muted transition-colors"
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground mt-4">
        Prices are stored in paise (1 ₹ = 100 paise). Changes apply to new Razorpay orders immediately — existing unpaid orders are unaffected.
        Use <strong>Hidden</strong> to temporarily remove a package from the storefront without deleting it.
      </p>

      <AdminGrantCredits />
      <AdminReplicateBalance />
    </div>
  );
}

function AdminGrantCredits() {
  const { toast } = useToast();
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState(1);
  const [loading, setLoading] = useState(false);

  const grant = async () => {
    if (!userId.trim()) { toast({ title: "Enter a Clerk user ID", variant: "destructive" }); return; }
    if (amount < 1 || amount > 1000) { toast({ title: "Amount must be 1–1000", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const { getToken } = (window as any).Clerk?.session ?? {};
      const token = typeof getToken === "function" ? await getToken() : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${getApiUrl()}/api/admin/credits/grant`, {
        method: "POST",
        headers,
        body: JSON.stringify({ userId: userId.trim(), amount }),
      });
      const data = await res.json() as { success?: boolean; creditsRemaining?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast({ title: `✓ Granted ${amount} credit${amount > 1 ? "s" : ""}`, description: `User now has ${data.creditsRemaining} credits.` });
      setUserId("");
      setAmount(1);
    } catch (e: any) {
      toast({ title: "Grant failed", description: String(e?.message ?? e), variant: "destructive" });
    }
    setLoading(false);
  };

  return (
    <div className="mt-8 border border-border p-5">
      <h3 className="text-sm font-semibold mb-1">Grant Credits to a User</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Use this to manually add credits — e.g. after a UPI QR payment that the system didn't auto-credit.
        Find the Clerk User ID in the Users tab.
      </p>
      <div className="flex gap-3 flex-wrap items-end">
        <div className="flex-1 min-w-48">
          <label className="text-xs text-muted-foreground mb-1 block">Clerk User ID</label>
          <Input
            value={userId}
            onChange={e => setUserId(e.target.value)}
            placeholder="user_xxxxxxxxxxxxxxxx"
            className="h-9 rounded-none font-mono text-xs"
          />
        </div>
        <div className="w-24">
          <label className="text-xs text-muted-foreground mb-1 block">Credits</label>
          <Input
            type="number" min={1} max={1000}
            value={amount}
            onChange={e => setAmount(parseInt(e.target.value) || 1)}
            className="h-9 rounded-none"
          />
        </div>
        <Button
          onClick={() => void grant()}
          disabled={loading || !userId.trim()}
          className="h-9 rounded-none px-5"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Zap className="w-4 h-4 mr-1" />}
          Grant
        </Button>
      </div>
    </div>
  );
}

/* ── Replicate Balance Panel ─────────────────────────────────────────────── */
interface ReplicateBalanceData {
  estimatedBalanceUsd: string;
  totalTopupsUsd: string;
  totalCostUsd: string;
  alertLevel: "ok" | "warning" | "danger" | "critical";
  thresholds: { warn: number; red: number; pause: number };
  generationStats: { total: number; succeeded: number; failed: number };
  recentTopups: { id: number; amountUsd: string; toppedUpAt: string; addedByAdminId: string; notes: string | null }[];
}

async function adminPost(path: string, body?: unknown): Promise<Response> {
  const { getToken } = (window as any).Clerk?.session ?? {};
  const token = typeof getToken === "function" ? await getToken() : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${getApiUrl()}${path}`, { method: "POST", headers, body: body != null ? JSON.stringify(body) : undefined });
}

function AdminReplicateBalance() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [topupAmount, setTopupAmount] = useState("");
  const [topupNotes, setTopupNotes] = useState("");
  const [forceEnabling, setForceEnabling] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery<ReplicateBalanceData>({
    queryKey: ["admin-replicate-balance"],
    queryFn: async () => {
      const { getToken } = (window as any).Clerk?.session ?? {};
      const token = typeof getToken === "function" ? await getToken() : null;
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${getApiUrl()}/api/admin/credits/replicate-balance`, { headers });
      if (!res.ok) throw new Error("Failed to load balance");
      return res.json() as Promise<ReplicateBalanceData>;
    },
    staleTime: 30_000,
  });

  const logTopup = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(topupAmount);
      if (!amt || amt <= 0) throw new Error("Enter a valid amount");
      const res = await adminPost("/api/admin/credits/topup", { amountUsd: amt, notes: topupNotes.trim() || undefined });
      const json = await res.json() as { success?: boolean; estimatedBalanceUsd?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed");
      return json;
    },
    onSuccess: (json) => {
      toast({ title: `✓ Top-up logged — estimated balance now $${json.estimatedBalanceUsd}` });
      setTopupAmount("");
      setTopupNotes("");
      void queryClient.invalidateQueries({ queryKey: ["admin-replicate-balance"] });
    },
    onError: (e: any) => toast({ title: "Top-up failed", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const forceEnable = async () => {
    setForceEnabling(true);
    try {
      const res = await adminPost("/api/admin/credits/force-enable");
      const json = await res.json() as { success?: boolean; message?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed");
      toast({ title: "✓ AI generations re-enabled", description: json.message });
      void refetch();
    } catch (e: any) {
      toast({ title: "Failed", description: String(e?.message ?? e), variant: "destructive" });
    }
    setForceEnabling(false);
  };

  const levelColors: Record<string, string> = {
    ok:       "text-emerald-600 bg-emerald-50 border-emerald-200",
    warning:  "text-amber-600  bg-amber-50  border-amber-200",
    danger:   "text-orange-600 bg-orange-50 border-orange-200",
    critical: "text-red-600    bg-red-50    border-red-200",
  };
  const levelLabels: Record<string, string> = {
    ok: "OK", warning: "Low", danger: "Critical", critical: "DISABLED",
  };

  return (
    <div className="mt-8 border border-border p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold">Replicate Balance</h3>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Tracks your Replicate.com account balance using the internal ledger. Top up Replicate first, then log it here.
        Balance below ${data?.thresholds.pause ?? 5} auto-disables AI generation.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : data ? (
        <>
          {/* Status row */}
          <div className="flex flex-wrap gap-4 mb-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Est. Balance</span>
              <span className="text-xl font-semibold">${parseFloat(data.estimatedBalanceUsd).toFixed(2)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Total Topped Up</span>
              <span className="text-sm font-medium">${parseFloat(data.totalTopupsUsd).toFixed(2)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Total Spent</span>
              <span className="text-sm font-medium">${parseFloat(data.totalCostUsd).toFixed(4)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Status</span>
              <span className={`text-xs font-semibold px-2 py-0.5 border rounded-sm w-fit ${levelColors[data.alertLevel] ?? ""}`}>
                {levelLabels[data.alertLevel] ?? data.alertLevel}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Generations</span>
              <span className="text-sm font-medium">{data.generationStats.succeeded} ok / {data.generationStats.failed} failed</span>
            </div>
          </div>

          {/* Critical banner + force-enable */}
          {data.alertLevel === "critical" && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 p-3 mb-4">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 text-xs text-red-700">
                <p className="font-semibold mb-1">AI generation is currently DISABLED</p>
                <p>Balance is below the ${data.thresholds.pause} pause threshold. Top up Replicate and log it below, or use the override button if the ledger is miscalibrated.</p>
              </div>
              <button
                onClick={() => void forceEnable()}
                disabled={forceEnabling}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors flex-shrink-0"
              >
                {forceEnabling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                Force Re-enable
              </button>
            </div>
          )}

          {/* Log top-up form */}
          <div className="border-t border-border pt-4">
            <h4 className="text-xs font-semibold mb-3 uppercase tracking-wider text-muted-foreground">Log a Replicate Top-up</h4>
            <div className="flex gap-3 flex-wrap items-end">
              <div className="w-36">
                <label className="text-xs text-muted-foreground mb-1 block">Amount (USD)</label>
                <Input
                  type="number" min={1} step={1} placeholder="e.g. 25"
                  value={topupAmount}
                  onChange={e => setTopupAmount(e.target.value)}
                  className="h-9 rounded-none"
                />
              </div>
              <div className="flex-1 min-w-48">
                <label className="text-xs text-muted-foreground mb-1 block">Notes (optional)</label>
                <Input
                  placeholder="e.g. Recharged via Razorpay on Jul 21"
                  value={topupNotes}
                  onChange={e => setTopupNotes(e.target.value)}
                  className="h-9 rounded-none"
                />
              </div>
              <Button
                onClick={() => logTopup.mutate()}
                disabled={logTopup.isPending || !topupAmount}
                className="h-9 rounded-none px-5"
              >
                {logTopup.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Zap className="w-4 h-4 mr-1" />}
                Log Top-up
              </Button>
            </div>
          </div>

          {/* Recent top-ups */}
          {data.recentTopups.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold mb-2 uppercase tracking-wider text-muted-foreground">Recent Top-ups</h4>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 pr-4 text-muted-foreground font-medium">Date</th>
                    <th className="text-left py-1.5 pr-4 text-muted-foreground font-medium">Amount</th>
                    <th className="text-left py-1.5 text-muted-foreground font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentTopups.map(t => (
                    <tr key={t.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-4 text-muted-foreground">{new Date(t.toppedUpAt).toLocaleDateString("en-IN")}</td>
                      <td className="py-1.5 pr-4 font-medium">${parseFloat(t.amountUsd).toFixed(2)}</td>
                      <td className="py-1.5 text-muted-foreground">{t.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Failed to load balance data.</p>
      )}
    </div>
  );
}
