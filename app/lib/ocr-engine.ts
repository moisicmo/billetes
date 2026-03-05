/**
 * Motor OCR basado en @xenova/transformers (ONNX Runtime Web).
 * Corre 100% en el browser — iOS, Android, escritorio.
 * El modelo (~77 MB) se descarga la primera vez y queda cacheado en el browser.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pipe = (input: any) => Promise<Array<{ generated_text?: string }>>;

let _pipe: Pipe | null = null;
let _initPromise: Promise<void> | null = null;
// Último callback registrado recibe el progreso (el más reciente gana)
let _onProgress: ((p: OcrLoadProgress) => void) | null = null;

export interface OcrLoadProgress {
  /** 0–100 */
  progress: number;
  message: string;
}

/**
 * Inicializa (descarga y cachea) el modelo TrOCR.
 * Seguro llamar varias veces — el modelo se inicializa solo una vez.
 */
export function initOCR(onProgress?: (p: OcrLoadProgress) => void): Promise<void> {
  if (onProgress) _onProgress = onProgress;
  if (_pipe) return Promise.resolve();
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    // Dynamic import para evitar errores en SSR
    const { pipeline, env } = await import("@xenova/transformers");
    env.allowLocalModels = false;
    env.allowRemoteModels = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = await pipeline("image-to-text", "Xenova/trocr-small-printed", {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progress_callback: (info: any) => {
        const pct = typeof info?.progress === "number" ? info.progress : null;
        if (pct != null && _onProgress) {
          _onProgress({
            progress: Math.min(100, Math.round(pct)),
            message: `Cargando motor OCR… ${Math.min(100, Math.round(pct))}%`,
          });
        }
      },
    });

    _pipe = p as unknown as Pipe;
  })();

  _initPromise.catch(() => {
    _initPromise = null;
    _pipe = null;
  });

  return _initPromise;
}

/** true si el modelo ya está listo para inferencia. */
export function isOCRReady(): boolean {
  return _pipe !== null;
}

/**
 * Corre TrOCR sobre el canvas dado y retorna el texto reconocido.
 * Retorna "" si el modelo no está listo o hay un error.
 */
export async function runOCR(canvas: HTMLCanvasElement): Promise<string> {
  if (!_pipe) return "";
  try {
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const result = await _pipe(dataUrl);
    return result?.[0]?.generated_text?.trim() ?? "";
  } catch {
    return "";
  }
}
