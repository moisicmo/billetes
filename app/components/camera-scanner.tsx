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

// ─── OCR vía servidor — funciona en iOS, Android, todos los navegadores ────────

/** Precalienta el worker de Tesseract en el servidor (GET /api/ocr) */
function warmupServerOCR() {
  fetch("/api/ocr").catch(() => {});
}

async function serverOCR(canvas: HTMLCanvasElement): Promise<string> {
  try {
    const image = canvas.toDataURL("image/jpeg", 0.75);
    const res = await fetch("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
    if (!res.ok) return "";
    const { text } = (await res.json()) as { text: string };
    return text ?? "";
  } catch {
    return "";
  }
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
  const [cameraError, setCameraError] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult>({
    serialNumber: null,
    status: "scanning",
  });
  const [bbox, setBbox] = useState<BoundingBox | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualSerial, setManualSerial] = useState("");

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
        } catch { /* focusMode no soportado */ }
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
    setEngineReady(false);
    setScanResult({ serialNumber: null, status: "scanning" });
    setBbox(null);
    setManualMode(false);
    setManualSerial("");

    startCamera();

    // Intentar TextDetector nativo primero (Android Chrome)
    let usedTextDetector = false;
    if (HAS_TEXT_DETECTOR) {
      try {
        detectorRef.current = new TextDetector();
        setEngineReady(true);
        usedTextDetector = true;
      } catch {
        detectorRef.current = null;
      }
    }

    if (!usedTextDetector) {
      // Fallback: OCR vía servidor — siempre disponible
      detectorRef.current = null;
      setEngineReady(true);
      // Precalentar el worker de Tesseract en el servidor mientras la cámara inicia
      warmupServerOCR();
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

            const sorted = [...texts].sort(
              (a, b) => b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height
            );

            let found = false;
            for (const detected of sorted) {
              const result = checkSerial(detected.rawValue, denomination);
              if (result.serialNumber) {
                const vw = video.videoWidth;
                const vh = video.videoHeight;
                const box = detected.boundingBox;
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
                prev.status === "scanning" ? prev : { serialNumber: null, status: "scanning" }
              );
            }

            await pause(400);

          } else {
            // ── OCR servidor ────────────────────────────────────────────
            const canvas = canvasRef.current;
            if (!canvas) break;

            const vw = video.videoWidth;
            const vh = video.videoHeight;
            const cx = Math.floor(vw * 0.05);
            const cy = Math.floor(vh * 0.35);
            const cw = Math.floor(vw * 0.90);
            const ch = Math.floor(vh * 0.30);

            canvas.width = cw * 2;
            canvas.height = ch * 2;
            const ctx = canvas.getContext("2d");
            if (!ctx) break;

            ctx.drawImage(video, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);

            // El servidor aplica preprocesamiento (normalización + sharpening).
            // No binarizar aquí: JPEG sobre imagen B/N crea artefactos que rompen el OCR.
            const text = await serverOCR(canvas);
            if (scanActiveRef.current) {
              setScanResult(checkSerial(text, denomination));
            }

            await pause(1500);
          }
        } catch {
          await pause(500);
        }
      }
    };

    runLoop();
    return () => { scanActiveRef.current = false; };
  }, [cameraReady, engineReady, isOpen, denomination]);

  if (!isOpen) return null;

  const { serialNumber, status } = scanResult;
  const isLoading = !cameraReady || !engineReady;

  const engineLabel = HAS_TEXT_DETECTOR && detectorRef.current
    ? "Motor nativo del dispositivo"
    : "OCR servidor";

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

          {/* Bounding box sobre texto detectado (TextDetector) */}
          {bbox && (
            <div
              className={cn(
                "pointer-events-none absolute rounded border-2 transition-all duration-150",
                status === "invalid" ? "border-red-400 bg-red-400/10" : "border-green-400 bg-green-400/10"
              )}
              style={{ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height }}
            />
          )}

          {/* Guía estática */}
          {!bbox && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
                Número de Serie
              </p>
              <div className="h-14 w-4/5 rounded-lg border-2 border-white/50" />
            </div>
          )}

          {/* LIVE badge */}
          {cameraReady && engineReady && (
            <>
              <div className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1">
                <div className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                <span className="text-xs font-medium text-white">LIVE</span>
              </div>
              <div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-3 py-1">
                <span className="text-[10px] text-white/70">{engineLabel}</span>
              </div>
            </>
          )}

          {/* Pantalla de carga */}
          {isLoading && !cameraError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/65">
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <div className="h-9 w-9 animate-spin rounded-full border-4 border-white/30 border-t-white" />
                <span className="text-sm text-white">Iniciando cámara…</span>
              </div>
            </div>
          )}
        </div>

        {/* Canvas oculto */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Panel resultado */}
        <div className="p-4">
          {cameraError ? (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {cameraError}
            </div>
          ) : manualMode ? (
            <ManualInput
              denomination={denomination}
              value={manualSerial}
              onChange={setManualSerial}
              onSwitchToCamera={() => { setManualMode(false); setManualSerial(""); }}
            />
          ) : (
            <>
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

              <button
                onClick={() => setManualMode(true)}
                className="mt-2 w-full text-center text-xs text-gray-400 underline underline-offset-2 hover:text-gray-600 dark:text-gray-600 dark:hover:text-gray-400"
              >
                Ingresar número manualmente
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  );
}

// ─── Entrada manual ──────────────────────────────────────────────────────────
interface ManualInputProps {
  denomination: Denomination;
  value: string;
  onChange: (v: string) => void;
  onSwitchToCamera: () => void;
}

function ManualInput({ denomination, value, onChange, onSwitchToCamera }: ManualInputProps) {
  const result: ScanResult | null =
    value.trim().length >= 8 ? checkSerial(value.trim(), denomination) : null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          Número de serie
        </label>
        <input
          type="text"
          inputMode="text"
          autoFocus
          placeholder="Ej: 008708189 B"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          maxLength={13}
          className="mt-1.5 w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 font-mono text-2xl font-bold tracking-widest text-gray-900 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-blue-500"
        />
      </div>

      {result && (
        <div
          className={cn(
            "rounded-xl border-2 px-4 py-3",
            result.status === "valid"   && "border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/20",
            result.status === "invalid" && "border-red-400 bg-red-50 dark:border-red-600 dark:bg-red-900/20",
            result.status === "unclear" && "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/40",
          )}
        >
          <p
            className={cn(
              "text-sm font-semibold",
              result.status === "valid"   && "text-green-700 dark:text-green-400",
              result.status === "invalid" && "text-red-700 dark:text-red-400",
              result.status === "unclear" && "text-gray-400 dark:text-gray-500",
            )}
          >
            {result.status === "valid"   && "✓ Billete VÁLIDO — No está en los rangos invalidados"}
            {result.status === "invalid" && "⚠ ¡CUIDADO! Este billete está en los rangos INVALIDADOS por el BCB"}
            {result.status === "unclear" && "Formato no reconocido. Ingresá los 9 dígitos y la letra (A o B)."}
          </p>
        </div>
      )}

      <button
        onClick={onSwitchToCamera}
        className="text-center text-xs text-gray-400 underline underline-offset-2 hover:text-gray-600 dark:text-gray-600 dark:hover:text-gray-400"
      >
        Usar cámara
      </button>
    </div>
  );
}

function pause(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
