import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { checkSerial, type Denomination, type ScanResult } from "@/data/invalid-ranges";

// ─── Worker cache a nivel de módulo ────────────────────────────────────────────
// Se crea UNA SOLA VEZ por sesión. Re-abriendo el modal no re-descarga nada.
type TWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;

let _workerPromise: Promise<TWorker> | null = null;

function getWorker(): Promise<TWorker> {
  if (!_workerPromise) {
    _workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      await worker.setParameters({ tessedit_char_whitelist: "0123456789" });
      return worker;
    })();
    // Si falla, limpiar para que el próximo intento reintente
    _workerPromise.catch(() => { _workerPromise = null; });
  }
  return _workerPromise;
}

// ─── Componente ────────────────────────────────────────────────────────────────
interface CameraScannerProps {
  isOpen: boolean;
  onClose: () => void;
  denomination: Denomination;
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

  const [cameraReady, setCameraReady] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);
  const [workerError, setWorkerError] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult>({
    serialNumber: null,
    status: "scanning",
  });

  const stopCamera = useCallback(() => {
    scanActiveRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setCameraError("No se pudo acceder a la cámara. Verificá los permisos del navegador.");
    }
  }, []);

  // Abre/cierra cámara y pre-carga el worker en paralelo
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    scanActiveRef.current = false;
    setCameraError("");
    setWorkerError(false);
    setScanResult({ serialNumber: null, status: "scanning" });
    setWorkerReady(false);

    startCamera();

    // Pre-carga (o reutiliza) el worker mientras la cámara arranca
    let cancelled = false;
    getWorker()
      .then(() => { if (!cancelled) setWorkerReady(true); })
      .catch(() => { if (!cancelled) setWorkerError(true); });

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [isOpen, startCamera, stopCamera]);

  // Bucle de escaneo — arranca cuando CÁMARA y WORKER están listos
  useEffect(() => {
    if (!cameraReady || !workerReady || !isOpen) return;

    scanActiveRef.current = true;

    const runLoop = async () => {
      const worker = await getWorker();

      while (scanActiveRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) break;

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (vw === 0 || vh === 0) {
          await pause(500);
          continue;
        }

        // ── CROP al área del rectángulo guía ──────────────────────────────
        // El guía CSS es w-4/5 (80%) centrado horizontalmente y h-14 centrado
        // verticalmente. Estimamos en coordenadas de video:
        //   X: 10% – 90%  (guide 10%-90%)
        //   Y: 33% – 67%  (guide ≈ centered ±17%)
        const srcX = Math.floor(vw * 0.10);
        const srcY = Math.floor(vh * 0.33);
        const srcW = Math.floor(vw * 0.80);
        const srcH = Math.floor(vh * 0.34);

        // Escalar ×2 para que Tesseract trabaje con más píxeles
        canvas.width = srcW * 2;
        canvas.height = srcH * 2;

        const ctx = canvas.getContext("2d");
        if (!ctx) break;

        ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);

        // Escala de grises + umbralización para mejorar contraste
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const val = gray > 128 ? 255 : 0;
          d[i] = d[i + 1] = d[i + 2] = val;
        }
        ctx.putImageData(img, 0, 0);

        try {
          const { data: { text } } = await worker.recognize(canvas);
          if (scanActiveRef.current) {
            setScanResult(checkSerial(text, denomination));
          }
        } catch {
          // ignorar errores individuales de scan, reintentar en el próximo ciclo
        }

        await pause(1800);
      }
    };

    runLoop();

    return () => {
      scanActiveRef.current = false;
    };
  }, [cameraReady, workerReady, isOpen, denomination]);

  if (!isOpen) return null;

  const { serialNumber, status } = scanResult;
  const isLoading = !cameraReady || (!workerReady && !workerError);

  const loadingLabel = !cameraReady && !workerReady
    ? "Iniciando cámara y motor OCR…"
    : !cameraReady
    ? "Iniciando cámara…"
    : "Cargando motor de reconocimiento… (requiere internet la primera vez)";

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
              Apuntá la cámara al número de serie del billete
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

          {/* Rectángulo guía */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
              Número de Serie
            </p>
            <div
              className={cn(
                "h-14 w-4/5 rounded-lg border-2 transition-colors duration-300",
                status === "valid"   && "border-green-400",
                status === "invalid" && "border-red-400 animate-pulse",
                (status === "scanning" || status === "unclear") && "border-white/70"
              )}
            />
          </div>

          {/* LIVE badge */}
          {cameraReady && workerReady && (
            <div className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1">
              <div className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="text-xs font-medium text-white">LIVE</span>
            </div>
          )}

          {/* Pantalla de carga */}
          {isLoading && !cameraError && !workerError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/65">
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <div className="h-9 w-9 animate-spin rounded-full border-4 border-white/30 border-t-white" />
                <span className="text-sm text-white">{loadingLabel}</span>
                {!workerReady && cameraReady && (
                  <span className="text-xs text-white/60">
                    Primera vez: descargando motor OCR (~4 MB)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Error de carga del worker */}
          {workerError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/75">
              <div className="flex flex-col items-center gap-4 px-6 text-center">
                <span className="text-3xl">📶</span>
                <p className="text-sm font-medium text-white">
                  No se pudo cargar el motor OCR.
                </p>
                <p className="text-xs text-white/60">
                  Verificá tu conexión a internet e intentá de nuevo.
                </p>
                <button
                  onClick={() => {
                    setWorkerError(false);
                    setWorkerReady(false);
                    getWorker()
                      .then(() => setWorkerReady(true))
                      .catch(() => setWorkerError(true));
                  }}
                  className="rounded-xl bg-white px-6 py-2.5 text-sm font-semibold text-gray-900 transition-opacity hover:opacity-90 active:scale-95"
                >
                  Reintentar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Canvas oculto — recibe solo el recorte del área guía */}
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
                {status === "scanning" && "Escaneando continuamente…"}
                {status === "unclear" && "No se pudo leer. Ajustá el número de serie dentro del marco."}
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
