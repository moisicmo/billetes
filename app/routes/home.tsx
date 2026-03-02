import { useState } from "react";
import type { Route } from "./+types/home";
import { CameraScanner } from "@/components/camera-scanner";
import type { Denomination } from "@/data/invalid-ranges";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Verificador de Billetes — BCB Bolivia" },
    { name: "description", content: "Verificá si un billete de la Serie B está en los rangos invalidados por el BCB tras el siniestro del 27 feb 2026." },
  ];
}

interface Bill {
  denomination: Denomination;
  amount: string;
  gradient: string;
  shadow: string;
  badge: string;
}

const BILLS: Bill[] = [
  {
    denomination: "10",
    amount: "10",
    gradient: "from-sky-500 to-blue-700",
    shadow: "shadow-sky-300 dark:shadow-sky-900",
    badge: "bg-sky-400/30",
  },
  {
    denomination: "20",
    amount: "20",
    gradient: "from-amber-400 to-orange-600",
    shadow: "shadow-amber-300 dark:shadow-amber-900",
    badge: "bg-amber-400/30",
  },
  {
    denomination: "50",
    amount: "50",
    gradient: "from-emerald-400 to-green-700",
    shadow: "shadow-emerald-300 dark:shadow-emerald-900",
    badge: "bg-emerald-400/30",
  },
];

export default function Home() {
  const [active, setActive] = useState<Denomination | null>(null);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gray-50 p-6 dark:bg-gray-950">

      {/* Título */}
      <div className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          Verificador de Billetes
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Serie B — Siniestro FAB, El Alto, 27 feb 2026
        </p>
      </div>

      {/* Instrucción */}
      <p className="text-center text-base text-gray-600 dark:text-gray-300 max-w-sm">
        Seleccioná el valor del billete que querés verificar y apuntá la cámara al{" "}
        <span className="font-semibold text-gray-800 dark:text-gray-100">número de serie</span>.
      </p>

      {/* Botones de billetes */}
      <div className="flex flex-col gap-4 w-full max-w-sm sm:flex-row sm:max-w-none sm:justify-center">
        {BILLS.map((bill) => (
          <button
            key={bill.denomination}
            onClick={() => setActive(bill.denomination)}
            className={`
              group relative overflow-hidden rounded-2xl bg-linear-to-br ${bill.gradient}
              ${bill.shadow} shadow-xl
              w-full sm:w-44 h-28 sm:h-36
              flex flex-col items-center justify-center gap-1
              text-white transition-all duration-150
              hover:scale-105 hover:shadow-2xl active:scale-95
            `}
          >
            {/* Fondo decorativo */}
            <div className={`absolute inset-0 opacity-20 ${bill.badge}`} />
            <div className="absolute -right-4 -bottom-4 h-24 w-24 rounded-full bg-white/10" />
            <div className="absolute -left-4 -top-4 h-16 w-16 rounded-full bg-white/10" />

            {/* Contenido */}
            <p className="relative text-xs font-medium tracking-widest uppercase opacity-80">
              Banco Central de Bolivia
            </p>
            <p className="relative text-5xl font-black leading-none">
              {bill.amount}
            </p>
            <p className="relative text-xs font-semibold tracking-wider opacity-90">
              BOLIVIANOS · SERIE B
            </p>
          </button>
        ))}
      </div>

      {/* Aviso */}
      <p className="text-center text-xs text-gray-400 dark:text-gray-600 max-w-xs">
        Verificar también en el sitio oficial del BCB:{" "}
        <a
          href="https://www.bcb.gob.bo/?q=content/verificador-de-numero-de-serie"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-600 dark:hover:text-gray-400"
        >
          bcb.gob.bo
        </a>
      </p>

      {/* Scanner modal */}
      {active && (
        <CameraScanner
          isOpen={true}
          onClose={() => setActive(null)}
          denomination={active}
        />
      )}
    </main>
  );
}
