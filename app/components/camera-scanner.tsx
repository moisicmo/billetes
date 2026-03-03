import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { checkSerial, type Denomination, type ScanResult } from "@/data/invalid-ranges";

// ─── TextDetector nativo (Android Chrome / Edge) — sin internet, sin descargas ──
declare global {
  class TextDetector {
    constructor();
    detect(image: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | ImageBitmap): Promise<
      Array<{ rawValue: string; boundingBox: DOMRectReadOnly }>
    >;
  }
}

const HAS_TEXT_DETECTOR =
  typeof window !== "undefined" && "TextDetector" in window;

// ─── Tesseract fallback (solo si TextDetector no disponible) ─────────────────
import type { PSM } from "tesseract.js";
type TWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;

let _workerPromise: Promise<TWorker> | null = null;

async function createTesseractWorker(): Promise<TWorker> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: "/tessdata/worker.min.js",
    langPath: "/tessdata",
    corePath: "/tessdata",
  });
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789B",
    tessedit_pageseg_mode: "11" as PSM, // SPARSE_TEXT: encuentra texto en cualquier posición
  });
  return worker;
}

function getTesseractWorker(): Promise<TWorker> {
  if (!_workerPromise) {
    _workerPromise = createTesseractWorker();
    _workerPromise.catch(() => { _workerPromise = null; });
  }
  return _workerPromise;
}

// ─── Tipos ───────────────────────────────────────────────────────────────────
interface CameraScannerProps {
  isOpen: boolean;
  onClose: () => void;
  denomination: Denomination;
}

interface BoundingBox {
  left: string;
  top: string;
  width: string;
  height: string;
}

const BILL_LABEL: Record<Denomination, string> = {
  "10": "Bs 10",
  "20": "Bs 20",
  "50": "Bs 50",
};

export function CameraScanner({ isOpen, onClose, denomination }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanActiveRef = useRef(false);
  const detectorRef = useRef<InstanceType<typeof TextDetector> | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult>({
    serialNumber: null,
    status: "scanning",
  });
  const [bbox, setBbox] = useState<BoundingBox | null>(null);

  const stopCamera = useCallback(() => {
    scanActiveRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
    setBbox(null);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          await track.applyConstraints({
            advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
          });
        } catch { /* focusMode no soportado — continuar */ }
      }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setCameraError("No se pudo acceder a la cámara. Verificá los permisos del navegador.");
    }
  }, []);

  // Inicialización al abrir/cerrar
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    scanActiveRef.current = false;
    setCameraError("");
    setEngineError(false);
    setScanResult({ serialNumber: null, status: "scanning" });
    setBbox(null);

    startCamera();

    if (HAS_TEXT_DETECTOR) {
      // TextDetector nativo: listo al instante, sin internet
      detectorRef.current = new TextDetector();
      setEngineReady(true);
    } else {
      // Cargar Tesseract solo si no hay TextDetector
      setEngineReady(false);
      let cancelled = false;
      getTesseractWorker()
        .then(() => { if (!cancelled) setEngineReady(true); })
        .catch(() => { if (!cancelled) setEngineError(true); });
      return () => {
        cancelled = true;
        stopCamera();
      };
    }

    return () => { stopCamera(); };
  }, [isOpen, startCamera, stopCamera]);

  // Bucle de escaneo
  useEffect(() => {
    if (!cameraReady || !engineReady || !isOpen) return;

    scanActiveRef.current = true;

    const runLoop = async () => {
      while (scanActiveRef.current) {
        const video = videoRef.current;
        if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
          await pause(300);
          continue;
        }

        try {
          if (detectorRef.current) {
            // ── TextDetector nativo ─────────────────────────────────────
            const texts = await detectorRef.current.detect(video);

            if (!scanActiveRef.current) break;

            let found = false;
            // Ordenar por tamaño de bounding box (más grande primero — más relevante)
            const sorted = [...texts].sort(
              (a, b) => b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height
            );

            for (const detected of sorted) {
              const result = checkSerial(detected.rawValue, denomination);
              if (result.serialNumber) {
                const vw = video.videoWidth;
                const vh = video.videoHeight;
                const box = detected.boundingBox;
                // Padding visual para que el cuadro sea más visible
                const pad = 0.01;
                setBbox({
                  left: `${Math.max(0, (box.x / vw) - pad) * 100}%`,
                  top: `${Math.max(0, (box.y / vh) - pad) * 100}%`,
                  width: `${Math.min(1, (box.width / vw) + pad * 2) * 100}%`,
                  height: `${Math.min(1, (box.height / vh) + pad * 2) * 100}%`,
                });
                setScanResult(result);
                found = true;
                break;
              }
            }

            if (!found) {
              setBbox(null);
              setScanResult((prev) =>
                prev.status === "scanning"
                  ? prev
                  : { serialNumber: null, status: "scanning" }
              );
            }

            await pause(400);

          } else {
            // ── Tesseract fallback ──────────────────────────────────────
            const canvas = canvasRef.current;
            if (!canvas) break;
            const vw = video.videoWidth;
            const vh = video.videoHeight;

            // Crop amplio: 5%-95% horizontal, 20%-80% vertical
            const cx = Math.floor(vw * 0.05);
            const cy = Math.floor(vh * 0.20);
            const cw = Math.floor(vw * 0.90);
            const ch = Math.floor(vh * 0.60);

            canvas.width = cw * 2;
            canvas.height = ch * 2;
            const ctx = canvas.getContext("2d");
            if (!ctx) break;

            ctx.drawImage(video, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);

            // Escala de grises simple
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const d = img.data;
            for (let i = 0; i < d.length; i += 4) {
              const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
              d[i] = d[i + 1] = d[i + 2] = g;
            }
            ctx.putImageData(img, 0, 0);

            const worker = await getTesseractWorker();
            const { data: { text } } = await worker.recognize(canvas);
            if (scanActiveRef.current) {
              setScanResult(checkSerial(text, denomination));
            }

            await pause(1200);
          }
        } catch {
          // ignorar errores de frame individual
          await pause(500);
        }
      }
    };

    runLoop();

    return () => { scanActiveRef.current = false; };
  }, [cameraReady, engineReady, isOpen, denomination]);

  if (!isOpen) return null;

  const { serialNumber, status } = scanResult;
  const isLoading = !cameraReady || (!engineReady && !engineError);

  const engineLabel = HAS_TEXT_DETECTOR
    ? "Motor nativo del dispositivo"
    : "Motor Tesseract (local)";

  const loadingLabel = !cameraReady
    ? "Iniciando cámara…"
    : "Cargando motor OCR local…";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">

        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-bold dark:text-white">
              Verificar {BILL_LABEL[denomination]}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Apuntá la cámara al número de serie
            </p>
          </div>
          <button
            onClick={() => { stopCamera(); onClose(); }}
            className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
            aria-label="Cerrar"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Video */}
        <div className="relative aspect-video bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onCanPlay={() => setCameraReady(true)}
            className="h-full w-full object-cover"
          />

          {/* Cuadro dinámico sobre el texto detectado */}
          {bbox && (
            <div
              className={cn(
                "pointer-events-none absolute rounded border-2 transition-all duration-150",
                status === "invalid" ? "border-red-400 bg-red-400/10" : "border-green-400 bg-green-400/10"
              )}
              style={{
                left: bbox.left,
                top: bbox.top,
                width: bbox.width,
                height: bbox.height,
              }}
            />
          )}

          {/* Guía estática cuando no hay detección */}
          {!bbox && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
                Número de Serie
              </p>
              <div className="h-14 w-4/5 rounded-lg border-2 border-white/50" />
            </div>
          )}

          {/* Badge motor + LIVE */}
          {cameraReady && engineReady && (
            <div className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1">
              <div className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="text-xs font-medium text-white">LIVE</span>
            </div>
          )}
          {cameraReady && engineReady && (
            <div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-3 py-1">
              <span className="text-[10px] text-white/70">{engineLabel}</span>
            </div>
          )}

          {/* Pantalla de carga */}
          {isLoading && !cameraError && !engineError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/65">
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <div className="h-9 w-9 animate-spin rounded-full border-4 border-white/30 border-t-white" />
                <span className="text-sm text-white">{loadingLabel}</span>
              </div>
            </div>
          )}

          {/* Error de carga */}
          {engineError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/75">
              <div className="flex flex-col items-center gap-4 px-6 text-center">
                <span className="text-3xl">⚠️</span>
                <p className="text-sm font-medium text-white">No se pudo cargar el motor OCR.</p>
                <button
                  onClick={() => {
                    setEngineError(false);
                    setEngineReady(false);
                    getTesseractWorker()
                      .then(() => setEngineReady(true))
                      .catch(() => setEngineError(true));
                  }}
                  className="rounded-xl bg-white px-6 py-2.5 text-sm font-semibold text-gray-900 transition-opacity hover:opacity-90 active:scale-95"
                >
                  Reintentar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Canvas oculto para Tesseract */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Panel resultado */}
        <div className="p-4">
          {cameraError ? (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {cameraError}
            </div>
          ) : (
            <div
              className={cn(
                "rounded-xl border-2 px-5 py-4 transition-all duration-300",
                status === "valid"   && "border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/20",
                status === "invalid" && "border-red-400 bg-red-50 dark:border-red-600 dark:bg-red-900/20",
                (status === "scanning" || status === "unclear") &&
                  "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/40"
              )}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                    Número leído
                  </p>
                  <p
                    className={cn(
                      "mt-1 font-mono text-3xl font-bold tracking-wider",
                      status === "valid"   && "text-green-700 dark:text-green-300",
                      status === "invalid" && "text-red-700 dark:text-red-300",
                      status === "scanning" && "animate-pulse text-gray-300 dark:text-gray-600",
                      status === "unclear" && "text-gray-400 dark:text-gray-500"
                    )}
                  >
                    {serialNumber ?? (status === "scanning" ? "········" : "- - - -")}
                  </p>
                </div>

                <div className="text-5xl leading-none select-none">
                  {status === "valid"   && "✅"}
                  {status === "invalid" && "⛔"}
                  {status === "scanning" && (
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-gray-500" />
                  )}
                  {status === "unclear" && "❓"}
                </div>
              </div>

              <p
                className={cn(
                  "mt-3 text-sm font-semibold",
                  status === "valid"   && "text-green-700 dark:text-green-400",
                  status === "invalid" && "text-red-700 dark:text-red-400",
                  (status === "scanning" || status === "unclear") && "text-gray-400 dark:text-gray-500"
                )}
              >
                {status === "valid"   && "✓ Billete VÁLIDO — No está en los rangos invalidados"}
                {status === "invalid" && "⚠ ¡CUIDADO! Este billete está en los rangos INVALIDADOS por el BCB"}
                {status === "scanning" && "Buscando número de serie…"}
                {status === "unclear" && "No se pudo leer. Ajustá el número de serie frente a la cámara."}
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function pause(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
