"use client";

import { FlaskConical, OctagonX, Rocket, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import InfoDica from "@/components/ui/InfoDica";
import CartaoIndicador from "@/components/ui/CartaoIndicador";
import type { IdentidadeKpi } from "@/components/ui/KpiTile";
import { fmtBrlCurto } from "@/lib/formatters";
import type { Priority } from "@/lib/inteligencia/priorities";

/**
 * Icone e cor de IDENTIDADE de cada prioridade (so' as 7 existentes; nao e' cor de
 * estado, o que cada prioridade significa esta' no titulo): desperdicio de Ads ->
 * `ads`, escala (retorno alto) -> `roas`, teste organico -> `gmv`. O detalhe que o
 * cartao abre herda os dois (`KpiDrilldownDialog`).
 */
export const VISUAL_PRIORIDADE: Record<Priority["kind"], { icone: LucideIcon; identidade: IdentidadeKpi }> = {
  parar: { icone: OctagonX, identidade: "ads" },
  escalar: { icone: Rocket, identidade: "roas" },
  testar: { icone: FlaskConical, identidade: "gmv" },
};

/**
 * ALVO-GRADE: rotulo curto no cartao (cabe em 1440); o titulo inteiro segue no detalhe.
 * Escalar e Teste organico dizem que sao os N primeiros da fila: o quadrante "Escalar"
 * do mapa, logo abaixo, e' o universo inteiro (outro numero, mesmo nome).
 */
export function rotuloCurto(p: Priority): string {
  if (p.kind === "parar") return "Ads sem venda";
  return `${p.kind === "escalar" ? "Escalar" : "Teste orgânico"} · top ${p.received}`;
}

interface Props {
  priorities: Priority[];
  onOpen: (p: Priority) => void;
  disabled?: boolean;
  /** ALVO-GRADE: cartao(oes) de fora da fotografia ML (TikTok), como irmaos na MESMA faixa. */
  extra?: ReactNode;
}

/**
 * Bloco 2 — prioridades da fotografia ML (Gate V3-1A), no `CartaoIndicador` da
 * grade unica (ALVO-GRADE).
 *
 * Duas regras que o componente materializa e nao permite burlar:
 * - a contagem exibida e' de REGISTROS RECEBIDOS (nunca "N produtos no
 *   total"); a limitacao da amostra fica no "ⓘ" do cartao;
 * - cartao sem registro nao chega aqui — `buildPriorities` ja' o omite, entao
 *   nao existe "prioridade zero".
 *
 * O cartao inteiro e' um `<button>` real (nome acessivel = rotulo + valor + acao).
 * Sem periodo anterior nem serie nesta fotografia: sem pilula e sem linha.
 * `disabled` (atualizando) tira o clique, nao o numero.
 */
export default function PriorityCards({ priorities, onOpen, disabled, extra }: Props) {
  if (priorities.length === 0 && !extra) return null;
  return (
    <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
      {priorities.map((p) => {
        const { icone, identidade } = VISUAL_PRIORIDADE[p.kind];
        return (
          <CartaoIndicador
            key={p.kind}
            rotulo={rotuloCurto(p)}
            icone={icone}
            cor={`rgb(var(--tc-kpi-${identidade}))`}
            ajuda={<InfoDica texto={p.limitation} emControle />}
            valor={fmtBrlCurto(p.amount)}
            legenda={`${p.amountLabel} · ${p.received} registro${p.received === 1 ? "" : "s"} exibido${p.received === 1 ? "" : "s"}`}
            onAbrir={disabled ? undefined : () => onOpen(p)}
          />
        );
      })}
      {extra}
    </div>
  );
}
