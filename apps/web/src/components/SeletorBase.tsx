"use client";

import { useId } from "react";
import Segmented from "@/components/ui/Segmented";
import { useBaseVendas } from "@/hooks/useBaseVendas";
import type { BaseVendas } from "@/lib/base-vendas";

const OPCOES = [
  { valor: "pagos", texto: "Pagos" },
  { valor: "realizados", texto: "Realizados" },
] as const;

/**
 * Pagos | Realizados ao lado do periodo (Gerencial e Canais); o que cada um conta vai no ⓘ dos cards.
 * `semRealizados`: pediu Realizados e a API respondeu pagos (API sem o contrato, antiga ou demonstracao) —
 * o botao nao pode dizer uma coisa e o numero outra, entao o aviso fica VISIVEL.
 */
export default function SeletorBase({ semRealizados = false }: { semRealizados?: boolean }) {
  const [base, setBase] = useBaseVendas();
  const id = useId();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span id={id} className="hidden sm:inline text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Vendas
        </span>
        <Segmented<BaseVendas> rotulo="Vendas" rotuladoPor={id} opcoes={OPCOES} valor={base} aoEscolher={setBase} />
      </div>
      {base === "realizados" && semRealizados && (
        <p role="status" className="w-0 min-w-full text-right text-xs text-warn-ink">
          Realizados indisponível agora: mostrando só pagos.
        </p>
      )}
    </div>
  );
}
