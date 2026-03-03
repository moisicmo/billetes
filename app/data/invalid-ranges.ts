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

/**
 * El número de serie boliviano siempre tiene formato: 9 dígitos + letra (A, B, u otra).
 * Puede empezar con ceros: "001234567 B".
 *
 * Regla:
 *  - Letra ≠ "B"  →  Serie A u otra  →  siempre VÁLIDO
 *  - Letra = "B"  →  Serie B         →  evaluar los 9 dígitos contra rangos BCB
 *  - Sin letra legible → buscar el mejor grupo de 8-10 dígitos y evaluar igual
 *    (10 dígitos: el último probablemente es "B" leído como "8" por OCR)
 */
export function checkSerial(rawText: string, denomination: Denomination): ScanResult {
  const upper = rawText.toUpperCase();
  const ranges = INVALID_RANGES[denomination];

  // ── Caso 1: OCR leyó la letra correctamente ─────────────────────────────────
  // Patrón: exactamente 9 dígitos (con posibles ceros al inicio), espacio opcional, letra
  const fullMatch = upper.match(/(\d{9})\s{0,3}([A-Z])(?![0-9A-Z])/);
  if (fullMatch) {
    const digits = fullMatch[1];
    const letter = fullMatch[2];
    // Cualquier letra distinta de B → válido de inmediato (Serie A u otra)
    if (letter !== "B") return { serialNumber: digits, status: "valid" };
    // Serie B → comparar contra rangos BCB
    const num = parseInt(digits, 10);
    return {
      serialNumber: digits,
      status: ranges.some((r) => num >= r.from && num <= r.to) ? "invalid" : "valid",
    };
  }

  // ── Caso 2: OCR no capturó la letra → buscar grupo de 8-10 dígitos ─────────
  // Se ignoran grupos < 8 (ej: "901", "28", "1986" del texto impreso en el billete).
  // Se prioriza longitud 9; si hay 10, el último dígito es probablemente "B"→"8".
  const groups = (upper.match(/\d+/g) ?? [])
    .filter((g) => g.length >= 8 && g.length <= 10)
    .sort((a, b) => Math.abs(a.length - 9) - Math.abs(b.length - 9)); // más cercano a 9 primero

  if (groups.length === 0) return { serialNumber: null, status: "unclear" };

  // Normalizar a 9 dígitos:
  // - 10 dígitos: descartar el último (probable "B" leído como "8")
  // - 8 dígitos: rellenar con "0" a la izquierda (cero inicial perdido por OCR)
  // padStart no afecta el valor numérico, solo el display
  const raw = groups[0].length === 10 ? groups[0].slice(0, 9) : groups[0];
  const digits = raw.padStart(9, "0");
  const num = parseInt(digits, 10);
  return {
    serialNumber: digits,
    status: ranges.some((r) => num >= r.from && num <= r.to) ? "invalid" : "valid",
  };
}
