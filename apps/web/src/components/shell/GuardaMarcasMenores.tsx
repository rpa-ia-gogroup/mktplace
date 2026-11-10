"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import StateBlock from "@/components/ui/StateBlock";
import { brandLabel, escopoDeMarcas, FILTER_BRAND_KEYS } from "@/lib/filters/brands";

/**
 * As marcas menores (Bling) estao no filtro de marca global, mas so' a Gerencial e a aba delas
 * tem dado delas. Nas demais abas:
 *  - so' menores selecionadas: nao ha dado — "sem dado", e a aba nem consulta (um filtro de marca
 *    vazio na API significaria "todas as grandes", o que enganaria);
 *  - menores junto de grandes: a aba mostra as grandes e uma linha avisa quais ficaram de fora.
 * "Todas" (sem selecao) nao muda nada.
 */
const ROTAS_COM_DADO_DAS_MENORES = ["/", "/marcas-menores"];

function Guarda({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (ROTAS_COM_DADO_DAS_MENORES.includes(pathname ?? "")) return <>{children}</>;
  const sel = (params.get("brands") ?? "")
    .split(",")
    .map((b) => b.trim())
    .filter((b) => FILTER_BRAND_KEYS.includes(b));
  const escopo = escopoDeMarcas(sel);
  if (!escopo.temMenores || sel.length === 0) return <>{children}</>;

  if (escopo.soMenores) {
    const todas = new URLSearchParams(params.toString());
    todas.delete("brands");
    const qs = todas.toString();
    return (
      <div className="w-full px-4 py-4">
        <StateBlock
          tipo="vazio"
          titulo="Sem dado das marcas menores nesta aba"
          descricao={`${escopo.menores.map(brandLabel).join(", ")}: o dado delas vem do Bling e está na Gerencial e em Marcas menores.`}
          acao={
            <Link href={`${pathname}${qs ? `?${qs}` : ""}`} className="min-h-11 py-2.5 text-xs font-semibold text-accent-ink hover:underline">
              Ver todas as marcas
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <>
      <p className="mx-4 mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn-ink" role="status">
        {escopo.menores.map(brandLabel).join(", ")}: sem dado nesta aba. Mostrando só {escopo.grandes.map(brandLabel).join(", ")}.
      </p>
      {children}
    </>
  );
}

export default function GuardaMarcasMenores({ children }: { children: React.ReactNode }) {
  // Sem a leitura da URL (primeira renderizacao no servidor), a aba aparece como sempre.
  return (
    <Suspense fallback={<>{children}</>}>
      <Guarda>{children}</Guarda>
    </Suspense>
  );
}
