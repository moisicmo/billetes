import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { checkSerial, type Denomination, type ScanResult } from "@/data/invalid-ranges";

interface CameraScannerProps {
  isOpen: boolean;
  onClose: () => void;
  denomination: Denomination;
}

export function CameraScanner({ isOpen, onClose, denomination }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelRef = useRef(false);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult>({ serialNumber: null, status: "scanning" });

  const stopCamera = useCallback(() => {
    cancelRef.current = true;
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

  useEffect(() => {
    if (isOpen) {
      cancelRef.current = false;
      setCameraError("");
      setScanResult({ serialNumber: null, status: "scanning" });
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen, startCamera, stopCamera]);

  // Bucle de escaneo continuo — se activa cuando la cámara está lista
  useEffect(() => {
    if (!cameraReady || !isOpen) return;

    cancelRef.current = false;

    const runLoop = async () => {
      // Importación dinámica para evitar problemas con SSR
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      await worker.setParameters({ tessedit_char_whitelist: "0123456789" });

      try {
        while (!cancelRef.current) {
          if (videoRef.current && canvasRef.current) {
            const canvas = canvasRef.current;
            const video = videoRef.current;

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(video, 0, 0);

              // Convertir a escala de grises con contraste alto para mejorar el OCR
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const d = imageData.data;
              for (let i = 0; i < d.length; i += 4) {
                const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                const val = gray > 110 ? 255 : 0; // umbralización
                d[i] = val;
                d[i + 1] = val;
                d[i + 2] = val;
              }
              ctx.putImageData(imageData, 0, 0);

              const { data: { text } } = await worker.recognize(canvas);

              if (!cancelRef.current) {
                setScanResult(checkSerial(text, denomination));
              }
            }
          }

          // Pausa entre escaneos
          await new Promise<void>((resolve) => {
            const id = setTimeout(resolve, 1800);
            // Si se cancela, resolver inmediatamente
            const check = setInterval(() => {
              if (cancelRef.current) {
                clearTimeout(id);
                clearInterval(check);
                resolve();
              }
            }, 100);
            setTimeout(() => clearInterval(check), 2000);
          });
        }
      } finally {
        await worker.terminate();
      }
    };

    runLoop();

    return () => {
      cancelRef.current = true;
    };
  }, [cameraReady, isOpen, denomination]);

  if (!isOpen) return null;

  const { serialNumber, status } = scanResult;

  const BILL_LABEL: Record<Denomination, string> = {
    "10": "Bs 10",
    "20": "Bs 20",
    "50": "Bs 50",
  };

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

        {/* Feed de cámara */}
        <div className="relative aspect-video bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onCanPlay={() => setCameraReady(true)}
            className="h-full w-full object-cover"
          />

          {/* Marco guía donde el usuario debe colocar el número */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
            <p className="text-xs font-medium text-white/70">NÚMERO DE SERIE</p>
            <div
              className={cn(
                "h-14 w-4/5 rounded-lg border-2 transition-colors",
                status === "valid" && "border-green-400",
                status === "invalid" && "border-red-400 animate-pulse",
                (status === "scanning" || status === "unclear") && "border-white/70"
              )}
            />
          </div>

          {/* Indicador LIVE */}
          {cameraReady && (
            <div className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1">
              <div className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="text-xs font-medium text-white">LIVE</span>
            </div>
          )}

          {/* Pantalla de carga de cámara */}
          {!cameraReady && !cameraError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="flex flex-col items-center gap-3">
                <div className="h-9 w-9 animate-spin rounded-full border-4 border-white/30 border-t-white" />
                <span className="text-sm text-white">Iniciando cámara…</span>
              </div>
            </div>
          )}
        </div>

        {/* Canvas oculto para capturar frames */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Panel de resultado */}
        <div className="p-4">
          {cameraError ? (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {cameraError}
            </div>
          ) : (
            <div
              className={cn(
                "rounded-xl border-2 px-5 py-4 transition-all duration-300",
                status === "valid" && "border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/20",
                status === "invalid" && "border-red-400 bg-red-50 dark:border-red-600 dark:bg-red-900/20",
                (status === "scanning" || status === "unclear") && "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/40"
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
                      status === "valid" && "text-green-700 dark:text-green-300",
                      status === "invalid" && "text-red-700 dark:text-red-300",
                      status === "scanning" && "text-gray-300 dark:text-gray-600 animate-pulse",
                      status === "unclear" && "text-gray-400 dark:text-gray-500"
                    )}
                  >
                    {serialNumber ?? (status === "scanning" ? "········" : "- - - -")}
                  </p>
                </div>

                <div className="text-5xl leading-none select-none">
                  {status === "valid" && "✅"}
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
                  status === "valid" && "text-green-700 dark:text-green-400",
                  status === "invalid" && "text-red-700 dark:text-red-400",
                  (status === "scanning" || status === "unclear") && "text-gray-400 dark:text-gray-500"
                )}
              >
                {status === "valid" && "✓ Billete VÁLIDO — No está en los rangos invalidados"}
                {status === "invalid" && "⚠ ¡CUIDADO! Este billete está en los rangos INVALIDADOS por el BCB"}
                {status === "scanning" && "Escaneando continuamente…"}
                {status === "unclear" && "No se pudo leer. Ajustá el billete dentro del marco blanco."}
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
