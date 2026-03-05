/**
 * Motor OCR basado en Tesseract.js corriendo en el browser.
 * Todos los archivos se sirven desde /tessdata/ (mismo CDN de Vercel).
 * eng.traineddata (~4 MB) se cachea en IndexedDB tras la primera carga.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TWorker = any;

let _worker: TWorker = null;
let _initPromise: Promise<void> | null = null;
let _onProgress: ((p: OcrLoadProgress) => void) | null = null;

export interface OcrLoadProgress {
  /** 0–100 */
  progress: number;
  message: string;
}

export function initOCR(onProgress?: (p: OcrLoadProgress) => void): Promise<void> {
  if (onProgress) _onProgress = onProgress;
  if (_worker) return Promise.resolve();
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const { createWorker } = await import("tesseract.js");

    const w = await createWorker("eng", 1, {
      workerPath: "/tessdata/worker.min.js",
      corePath: "/tessdata/",
      langPath: "/tessdata/",
      gzip: false,            // eng.traineddata está sin comprimir → no buscar .gz
      cacheMethod: "write",   // cachea traineddata en IndexedDB
      workerBlobURL: false,   // iOS Safari: evitar restricciones de Blob workers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: (m: any) => {
        if (typeof m.progress === "number") {
          const pct = Math.round(m.progress * 100);
          _onProgress?.({ progress: pct, message: `Cargando OCR… ${pct}%` });
        }
      },
    });

    await w.setParameters({
      tessedit_char_whitelist: "0123456789AB",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tessedit_pageseg_mode: "11" as any, // PSM.SPARSE_TEXT
    });

    _worker = w;
  })();

  _initPromise.catch(() => {
    _initPromise = null;
    _worker = null;
  });

  return _initPromise;
}

export function isOCRReady(): boolean {
  return _worker !== null;
}

/**
 * Preprocesa el canvas antes de enviarlo a Tesseract:
 * 1. Escala de grises.
 * 2. Normalización de contraste (stretch histograma → 0-255).
 */
function preprocessForOCR(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(src, 0, 0);

  const img = ctx.getImageData(0, 0, src.width, src.height);
  const d = img.data;

  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  const range = max - min || 1;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.min(255, Math.max(0, Math.round(((d[i] - min) / range) * 255)));
    d[i] = d[i + 1] = d[i + 2] = v;
  }

  ctx.putImageData(img, 0, 0);
  return out;
}

/**
 * Corre Tesseract OCR sobre el canvas.
 * Retorna "" si el worker no está listo o hay error.
 */
export async function runOCR(canvas: HTMLCanvasElement): Promise<string> {
  if (!_worker) return "";
  try {
    const processed = preprocessForOCR(canvas);
    const { data: { text } } = await _worker.recognize(processed);
    return text.trim();
  } catch {
    return "";
  }
}
