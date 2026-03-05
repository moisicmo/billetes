/**
 * Motor OCR basado en @xenova/transformers (ONNX Runtime Web).
 * Corre 100% en el browser — iOS, Android, escritorio.
 * El modelo (~77 MB) se descarga la primera vez y queda cacheado en el browser.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pipe = (input: any) => Promise<Array<{ generated_text?: string }>>;

let _pipe: Pipe | null = null;
let _initPromise: Promise<void> | null = null;
let _onProgress: ((p: OcrLoadProgress) => void) | null = null;

export interface OcrLoadProgress {
  /** 0–100 */
  progress: number;
  message: string;
}

export function initOCR(onProgress?: (p: OcrLoadProgress) => void): Promise<void> {
  if (onProgress) _onProgress = onProgress;
  if (_pipe) return Promise.resolve();
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
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

export function isOCRReady(): boolean {
  return _pipe !== null;
}

/**
 * Preprocesa el canvas para TrOCR:
 * 1. Escala el crop (generalmente panorámico) a 512×512 con padding blanco.
 *    Sin esto, TrOCR squishea la imagen 5:1 → 1:1 y los dígitos quedan deformados.
 * 2. Convierte a escala de grises.
 * 3. Normaliza el contraste (stretch histograma a 0-255).
 * @param invert  Si true, invierte los colores (para texto claro sobre fondo oscuro).
 */
function preprocessForOCR(src: HTMLCanvasElement, invert = false): HTMLCanvasElement {
  const SIZE = 512;
  const out = document.createElement("canvas");
  out.width = SIZE;
  out.height = SIZE;
  const ctx = out.getContext("2d")!;

  // Fondo blanco
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Escalar manteniendo aspect ratio, centrar
  const scale = Math.min(SIZE / src.width, SIZE / src.height);
  const dw = Math.round(src.width * scale);
  const dh = Math.round(src.height * scale);
  const dx = Math.floor((SIZE - dw) / 2);
  const dy = Math.floor((SIZE - dh) / 2);
  ctx.drawImage(src, dx, dy, dw, dh);

  // Grayscale + contraste
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;

  // Solo analizar la zona de texto (excluir padding blanco del cálculo de min/max)
  let min = 255, max = 0;
  for (let y = dy; y < dy + dh; y++) {
    for (let x = dx; x < dx + dw; x++) {
      const i = (y * SIZE + x) * 4;
      const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      if (g < min) min = g;
      if (g > max) max = g;
    }
  }

  const range = max - min || 1;
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    let v = Math.round(((g - min) / range) * 255);
    v = Math.max(0, Math.min(255, v));
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }

  ctx.putImageData(img, 0, 0);
  return out;
}

/** Heurística: ¿el texto parece un número de serie? (8–10 dígitos consecutivos) */
function looksLikeSerial(text: string): boolean {
  return /\d{8,10}/.test(text);
}

async function recognize(canvas: HTMLCanvasElement): Promise<string> {
  const dataUrl = canvas.toDataURL("image/png");
  const result = await _pipe!(dataUrl);
  return result?.[0]?.generated_text?.trim() ?? "";
}

/**
 * Corre TrOCR con preprocesamiento sobre el canvas dado.
 * Intenta normal y luego invertido si el primero no produce un serial legible.
 */
export async function runOCR(canvas: HTMLCanvasElement): Promise<string> {
  if (!_pipe) return "";
  try {
    const normal = preprocessForOCR(canvas, false);
    const textNormal = await recognize(normal);
    if (looksLikeSerial(textNormal)) return textNormal;

    // Segundo intento: imagen invertida (para billetes con texto claro sobre fondo oscuro)
    const inverted = preprocessForOCR(canvas, true);
    const textInverted = await recognize(inverted);
    if (looksLikeSerial(textInverted)) return textInverted;

    // Retornar lo que haya aunque sea parcial
    return textNormal || textInverted;
  } catch {
    return "";
  }
}
