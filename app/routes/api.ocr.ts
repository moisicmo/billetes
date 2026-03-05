import type { Route } from "./+types/api.ocr";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PSM } from "tesseract.js";

type TWorker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;

let _workerPromise: Promise<TWorker> | null = null;

async function getWorker(): Promise<TWorker> {
  if (_workerPromise) return _workerPromise;

  _workerPromise = (async () => {
    const { createWorker } = await import("tesseract.js");

    // Intentar usar el eng.traineddata local (evita descarga desde CDN)
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
      tessedit_pageseg_mode: "11" as PSM,
    });
    return w;
  })();

  _workerPromise.catch(() => { _workerPromise = null; });
  return _workerPromise;
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const { image } = (await request.json()) as { image: string };
    if (!image) return Response.json({ text: "" });

    const worker = await getWorker();

    // image es un data URL ("data:image/jpeg;base64,...")
    const base64 = image.includes(",") ? image.split(",")[1] : image;
    const buffer = Buffer.from(base64, "base64");

    const {
      data: { text },
    } = await worker.recognize(buffer);

    return Response.json({ text: text.trim() });
  } catch {
    return Response.json({ text: "" });
  }
}
