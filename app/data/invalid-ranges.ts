// Rangos de series INVALIDADAS por el BCB — Comunicado CP8/2026, 28 feb 2026
// Siniestro aéreo FAB, El Alto, 27 feb 2026 — Billetes Serie B
// Verificador oficial: https://www.bcb.gob.bo/?q=content/verificador-de-numero-de-serie

export type Denomination = "10" | "20" | "50";

interface Range {
  from: number;
  to: number;
}

const INVALID_RANGES: Record<Denomination, Range[]> = {
  "10": [
    { from: 67250001, to: 67700000 },
    { from: 69050001, to: 69500000 },
    { from: 69500001, to: 69950000 },
    { from: 69950001, to: 70400000 },
    { from: 70400001, to: 70850000 },
    { from: 70850001, to: 71300000 },
    { from: 76310012, to: 85139995 },
    { from: 86400001, to: 86850000 },
    { from: 90900001, to: 91350000 },
    { from: 91800001, to: 92250000 },
  ],
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
  "50": [
    { from: 77100001, to: 77550000 },
    { from: 78000001, to: 78450000 },
    { from: 78900001, to: 79350000 },
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
};

export type ScanStatus = "scanning" | "valid" | "invalid" | "unclear";

export interface ScanResult {
  serialNumber: string | null;
  status: ScanStatus;
}

/** Extrae el número de serie del texto OCR y valida contra los rangos invalidados */
export function checkSerial(rawText: string, denomination: Denomination): ScanResult {
  // Busca secuencias de 7-10 dígitos (el número de serie de los billetes bolivianos)
  const matches = rawText.replace(/\s+/g, "").match(/\d{7,10}/g);
  if (!matches) return { serialNumber: null, status: "unclear" };

  // Toma la coincidencia más larga
  const serialStr = matches.sort((a, b) => b.length - a.length)[0];
  const serial = parseInt(serialStr, 10);

  const isInvalid = INVALID_RANGES[denomination].some(
    (r) => serial >= r.from && serial <= r.to
  );

  return {
    serialNumber: serialStr,
    status: isInvalid ? "invalid" : "valid",
  };
}
