import type { Route } from "./+types/api.ocr";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PSM } from "tesseract.js";
import sharp from "sharp";

type TWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;

let _workerPromise: Promise<TWorker> | null = null;

async function getWorker(): Promise<TWorker> {
  if (_workerPromise) return _workerPromise;

  _workerPromise = (async () => {
    const { createWorker } = await import("tesseract.js");

    const candidates = [
      join(process.cwd(), "public", "tessdata"),
      join(process.cwd(), "build", "client", "tessdata"),
    ];
    const localLangPath = candidates.find((p) =>
      existsSync(join(p, "eng.traineddata"))
    );

    const w = await createWorker("eng", 1, localLangPath ? { langPath: localLangPath } : {});
    await w.setParameters({
      tessedit_char_whitelist: "0123456789AB",
      tessedit_pageseg_mode: "7" as PSM,  // single text line — más preciso cuando la imagen está bien recortada
    });
    return w;
  })();

  _workerPromise.catch(() => { _workerPromise = null; });
  return _workerPromise;
}

/**
 * Preprocesa la imagen para OCR:
 * - Escala de grises
 * - Normaliza el histograma (estira el rango de contraste)
 * - Sharpening de bordes
 * - Umbral adaptativo (binarización) → texto negro puro sobre fondo blanco
 * - Escala a altura fija para Tesseract
 */
async function preprocessForOCR(inputBuffer: Buffer): Promise<Buffer> {
  // Paso 1: grises, normalizar, enfocar
  const normalized = await sharp(inputBuffer)
    .grayscale()
    .normalize()          // estira el histograma al rango completo
    .sharpen(2, 1, 2)     // enfoca bordes del texto
    .toBuffer();

  // Paso 2: obtener metadatos para ajustar escala
  const meta = await sharp(normalized).metadata();
  const targetH = 80; // altura fija — Tesseract funciona mejor con texto grande y uniforme
  const scale = meta.height ? targetH / meta.height : 1;
  const newW = Math.round((meta.width ?? 800) * scale);

  // Paso 3: escalar + umbral → blanco/negro limpio
  return sharp(normalized)
    .resize(newW, targetH, { kernel: "lanczos3" })
    .threshold(0)  // Otsu automático (sharp calcula el umbral óptimo cuando es 0)
    .toBuffer();
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const { image } = (await request.json()) as { image: string };
    if (!image) return Response.json({ text: "" });

    const base64 = image.includes(",") ? image.split(",")[1] : image;
    const raw = Buffer.from(base64, "base64");

    const processed = await preprocessForOCR(raw);

    const worker = await getWorker();
    const { data: { text } } = await worker.recognize(processed);

    return Response.json({ text: text.trim() });
  } catch (e) {
    console.error("OCR error:", e);
    return Response.json({ text: "" });
  }
}
