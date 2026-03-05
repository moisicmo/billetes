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
      tessedit_pageseg_mode: "11" as PSM, // sparse text — más tolerante
    });
    return w;
  })();

  _workerPromise.catch(() => { _workerPromise = null; });
  return _workerPromise;
}

/**
 * Preprocesa la imagen antes de pasarla a Tesseract:
 * - Grises + normalización de histograma (mejora contraste)
 * - Sharpening (bordes del texto más nítidos)
 * - Escala x3 para texto más grande → mejor OCR
 * NO se aplica umbral aquí — Tesseract hace su propio binarizado internamente.
 */
async function preprocessForOCR(inputBuffer: Buffer): Promise<Buffer> {
  const { width = 800, height = 200 } = await sharp(inputBuffer).metadata();

  return sharp(inputBuffer)
    .grayscale()
    .normalize()                      // estira histograma al rango completo
    .sharpen({ sigma: 1.5 })          // bordes más nítidos
    .resize(width * 3, height * 3, { kernel: "lanczos3" }) // 3x más grande
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
