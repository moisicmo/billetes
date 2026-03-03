// Rangos de series INVALIDADAS por el BCB — Comunicado CP8/2026, 28 feb 2026
// Siniestro aéreo FAB, El Alto, 27 feb 2026 — Billetes Serie B
// Verificador oficial: https://www.bcb.gob.bo/?q=content/verificador-de-numero-de-serie

export type Denomination = "10" | "20" | "50";

interface Range {
  from: number;
  to: number;
}

// Fuente: Ministerio de Economía y Finanzas Públicas de Bolivia (imágenes oficiales)
const INVALID_RANGES: Record<Denomination, Range[]> = {
  // Imagen oficial Bs10 — 12 rangos
  "10": [
    { from: 77100001, to: 77550000 },
    { from: 78000001, to: 78450000 },
    { from: 78900001, to: 96350000 }, // rango amplio confirmado en imagen oficial
    { from: 96350001, to: 96800000 },
    { from: 96800001, to: 97250000 },
    { from: 98150001, to: 98600000 },
    { from: 104900001, to: 105350000 },
    { from: 105350001, to: 105800000 },
    { from: 106700001, to: 107150000 },
    { from: 107600001, to: 108050000 },
    { from: 108050001, to: 108500000 },
    { from: 109400001, to: 109850000 },
  ],
  // Imagen oficial Bs20 — 16 rangos
  "20": [
    { from: 87280145, to: 91646549 },
    { from: 96650001, to: 97100000 },
    { from: 99800001, to: 100250000 },
    { from: 100250001, to: 100700000 },
    { from: 109250001, to: 109700000 },
    { from: 110600001, to: 111050000 },
    { from: 111050001, to: 111500000 },
    { from: 111950001, to: 112400000 },
    { from: 112400001, to: 112850000 },
    { from: 112850001, to: 113300000 },
    { from: 114200001, to: 114650000 },
    { from: 114650001, to: 115100000 },
    { from: 115100001, to: 115550000 },
    { from: 118700001, to: 119150000 },
    { from: 119150001, to: 119600000 },
    { from: 120500001, to: 120950000 },
  ],
  // Imagen oficial Bs50 — 10 rangos
  "50": [
    { from: 67250001, to: 67700000 },
    { from: 69050001, to: 69500000 },
    { from: 69500001, to: 69950000 },
    { from: 69950001, to: 70400000 },
    { from: 70400001, to: 70850000 },
    { from: 70850001, to: 71300000 },
    { from: 76310012, to: 85139995 }, // rango amplio confirmado en imagen oficial
    { from: 86400001, to: 86850000 },
    { from: 90900001, to: 91350000 },
    { from: 91800001, to: 92250000 },
  ],
};

export type ScanStatus = "scanning" | "valid" | "invalid" | "unclear";

export interface ScanResult {
  serialNumber: string | null;
  status: ScanStatus;
}

/** Extrae el número de serie del texto OCR y valida contra los rangos invalidados.
 *
 *  IMPORTANTE: NO concatenar todos los dígitos del rawText antes de buscar.
 *  PSM 11 lee texto disperso de todo el billete ("901", "1986", "20", etc.).
 *  Concatenarlos crea cadenas largas con falsos positivos por ventana deslizante.
 *  En cambio, cada grupo de dígitos separado por letras/espacios se evalúa
 *  de forma INDEPENDIENTE — solo el grupo más largo (≥7 dígitos) se considera
 *  candidato a número de serie.
 */
export function checkSerial(rawText: string, denomination: Denomination): ScanResult {
  const upper = rawText.toUpperCase();
  const ranges = INVALID_RANGES[denomination];

  // ── 1. Detectar Serie A: "XXXXXXXX A" → siempre VÁLIDO ─────────────────────
  // La "A" puede estar pegada o separada; no exigir fin de cadena (puede haber
  // más texto OCR a continuación, ej: "282999724A901").
  const serieAMatch = upper.match(/(\d{7,10})\s{0,3}A(?![0-9A-Z])/);
  if (serieAMatch) {
    return { serialNumber: serieAMatch[1].slice(-8), status: "valid" };
  }

  // ── 2. Extraer grupos de dígitos individuales (sin mezclar grupos) ──────────
  // "LEY 901 DEL 28 1986" → ["901","28","1986"] → ninguno ≥7 dígitos → ignorados
  // "087280145 B"         → ["087280145"] → 9 dígitos → se evalúa
  const groups = (upper.match(/\d+/g) ?? []).filter(g => g.length >= 7);

  if (groups.length === 0) return { serialNumber: null, status: "unclear" };

  // Tomar el grupo más largo como candidato al número de serie
  const best = groups.sort((a, b) => b.length - a.length)[0];

  // ── 3. Ventana deslizante SOLO sobre el grupo principal ─────────────────────
  for (const len of [8, 9]) {
    if (best.length < len) continue;
    for (let i = 0; i <= best.length - len; i++) {
      const candidate = best.substring(i, i + len);
      const num = parseInt(candidate, 10);
      if (ranges.some((r) => num >= r.from && num <= r.to)) {
        return { serialNumber: candidate, status: "invalid" };
      }
    }
  }

  return { serialNumber: best.slice(-8), status: "valid" };
}
