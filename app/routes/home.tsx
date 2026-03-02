import { useState } from "react";
import type { Route } from "./+types/home";
import { CameraScanner } from "@/components/camera-scanner";
import type { Denomination } from "@/data/invalid-ranges";

const SITE_TITLE = "Verificador de Billetes Serie B — BCB Bolivia";
const SITE_DESC =
  "Verificá si tu billete de Bs10, Bs20 o Bs50 de la Serie B está en los rangos invalidados por el Banco Central de Bolivia tras el siniestro aéreo del 27 de febrero de 2026 en El Alto. Escaneo con cámara y OCR en tiempo real.";

export function meta({}: Route.MetaArgs) {
  return [
    { title: SITE_TITLE },

    // Básico
    { name: "description", content: SITE_DESC },
    { name: "keywords", content: "billetes invalidados, serie B, BCB, Banco Central Bolivia, verificar billete, billetes robados, avión FAB El Alto, Bs10, Bs20, Bs50, número de serie, billete válido, billete inválido, siniestro aéreo 2026" },
    { name: "robots", content: "index, follow" },
    { name: "author", content: "Verificador BCB Bolivia" },
    { name: "language", content: "Spanish" },

    // Open Graph — Google, Facebook, WhatsApp, ChatGPT search
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Verificador Billetes Serie B" },
    { property: "og:title", content: SITE_TITLE },
    { property: "og:description", content: SITE_DESC },
    { property: "og:locale", content: "es_BO" },

    // Twitter / X
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SITE_TITLE },
    { name: "twitter:description", content: SITE_DESC },

    // JSON-LD — datos estructurados para Google y rastreadores de IA
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: "Verificador de Billetes Serie B Bolivia",
        description: SITE_DESC,
        applicationCategory: "UtilityApplication",
        operatingSystem: "Web",
        inLanguage: "es-BO",
        isAccessibleForFree: true,
        about: {
          "@type": "Event",
          name: "Siniestro aéreo FAB El Alto — 27 febrero 2026",
          description:
            "Un avión de la Fuerza Aérea Boliviana sufrió un accidente en El Alto transportando billetes de la Nueva Familia de Bolivianos Serie B. El Banco Central de Bolivia (BCB) invalidó los rangos de números de serie sustraídos en los cortes de Bs10, Bs20 y Bs50.",
          startDate: "2026-02-27",
          location: {
            "@type": "Place",
            name: "El Alto, Bolivia",
          },
        },
        featureList: [
          "Escaneo de número de serie con cámara y OCR",
          "Verificación de billetes Bs10, Bs20 y Bs50 Serie B",
          "Rangos oficiales del BCB — Comunicado CP8/2026",
        ],
        provider: {
          "@type": "Organization",
          name: "Banco Central de Bolivia",
          url: "https://www.bcb.gob.bo",
        },
      },
    },

    // FAQPage — ayuda a que Google y ChatGPT muestren respuestas directas
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "¿Cómo sé si mi billete de la Serie B es inválido?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Ingresá a este verificador, seleccioná el valor del billete (Bs10, Bs20 o Bs50) y apuntá la cámara al número de serie. La herramienta compara el número contra los rangos invalidados por el BCB en el Comunicado CP8/2026. También podés verificar en el sitio oficial: bcb.gob.bo.",
            },
          },
          {
            "@type": "Question",
            name: "¿Qué billetes de la Serie B quedaron invalidados?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Los billetes de Bs10, Bs20 y Bs50 de la Serie B de la Nueva Familia de Bolivianos con números de serie comprendidos en los rangos publicados por el BCB (Comunicado CP8/2026 del 28 de febrero de 2026) quedaron sin valor legal. El resto de la Serie B es válido desde el 2 de marzo de 2026.",
            },
          },
          {
            "@type": "Question",
            name: "¿Por qué se invalidaron los billetes de la Serie B?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "El 27 de febrero de 2026, un avión de la Fuerza Aérea Boliviana (FAB) sufrió un siniestro en El Alto mientras transportaba 17.1 millones de billetes nuevos de la Serie B. Se estima que el 30% fue sustraído ilegalmente. El BCB publicó los rangos de series robadas para proteger al sistema financiero.",
            },
          },
          {
            "@type": "Question",
            name: "¿Dónde puedo verificar oficialmente un billete Serie B?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "El Banco Central de Bolivia habilitó un verificador oficial en: https://www.bcb.gob.bo/?q=content/verificador-de-numero-de-serie",
            },
          },
        ],
      },
    },
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
