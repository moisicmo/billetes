import type { Route } from "./+types/api.ocr";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PSM } from "tesseract.js";
import sharp from "sharp";

type TWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;

const TMP_LANG = "/tmp/billetes-tessdata";

/**
 * Obtiene la ruta donde está eng.traineddata.
 * Orden de preferencia:
 * 1. /tmp/ (ya descargado en esta instancia)
 * 2. Filesystem local (desarrollo / builds con acceso a disco)
 * 3. Nuestro propio CDN (mismo servidor Vercel → descarga rápida <1s)
 * 4. CDN externo de tesseract.js (fallback lento pero funcional)
 */
async function getLangPath(requestHost: string): Promise<string | undefined> {
  // 1. Caché en /tmp/ (persiste entre invocaciones warm)
  if (existsSync(join(TMP_LANG, "eng.traineddata"))) return TMP_LANG;

  // 2. Rutas locales del filesystem
  for (const p of [
    join(process.cwd(), "public", "tessdata"),
    join(process.cwd(), "build", "client", "tessdata"),
  ]) {
    if (existsSync(join(p, "eng.traineddata"))) return p;
  }

  // 3. Descargar desde nuestro propio CDN usando el host del request
  //    (los archivos de public/ están siempre disponibles como assets estáticos)
  const proto = requestHost.startsWith("localhost") ? "http" : "https";
  const url = `${proto}://${requestHost}/tessdata/eng.traineddata`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      mkdirSync(TMP_LANG, { recursive: true });
      writeFileSync(join(TMP_LANG, "eng.traineddata"), Buffer.from(await res.arrayBuffer()));
      return TMP_LANG;
    }
  } catch {
    // ignorar — caer al fallback
  }

  // 4. Sin langPath → tesseract.js usa su CDN externo por defecto
  return undefined;
}

// Singleton del worker (persiste entre invocaciones warm de la función)
let _workerPromise: Promise<TWorker> | null = null;

async function getWorker(requestHost: string): Promise<TWorker> {
  if (_workerPromise) return _workerPromise;

  _workerPromise = (async () => {
    const { createWorker } = await import("tesseract.js");
    const langPath = await getLangPath(requestHost);

    const w = await createWorker("eng", 1, langPath ? { langPath } : {});
    await w.setParameters({
      tessedit_char_whitelist: "0123456789AB",
      tessedit_pageseg_mode: "11" as PSM,
    });
    return w;
  })();

  _workerPromise.catch(() => { _workerPromise = null; });
  return _workerPromise;
}

async function preprocessForOCR(inputBuffer: Buffer): Promise<Buffer> {
  return sharp(inputBuffer)
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .toBuffer();
}

// ─── GET: precalienta el worker (llamar al abrir el scanner) ─────────────────
export async function loader({ request }: Route.LoaderArgs) {
  const host = request.headers.get("host") ?? "localhost";
  // Iniciar worker en background sin bloquear
  getWorker(host).catch(() => {});
  return Response.json({ ok: true });
}

// ─── POST: procesa imagen y retorna texto OCR ─────────────────────────────────
export async function action({ request }: Route.ActionArgs) {
  const host = request.headers.get("host") ?? "localhost";

  try {
    const { image } = (await request.json()) as { image: string };
    if (!image) return Response.json({ text: "" });

    const base64 = image.includes(",") ? image.split(",")[1] : image;
    const raw = Buffer.from(base64, "base64");

    const [processed, worker] = await Promise.all([
      preprocessForOCR(raw),
      getWorker(host),
    ]);

    const { data: { text } } = await worker.recognize(processed);
    return Response.json({ text: text.trim() });
  } catch (e) {
    console.error("OCR error:", e);
    return Response.json({ text: "" });
  }
}
