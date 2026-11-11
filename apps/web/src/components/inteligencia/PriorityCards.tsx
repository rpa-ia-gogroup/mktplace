"use client";

import { FlaskConical, OctagonX, Rocket, type LucideIcon } from "lucide-react";

import InfoDica from "@/components/ui/InfoDica";
import KpiTile, { type IdentidadeKpi } from "@/components/ui/KpiTile";
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

interface Props {
  priorities: Priority[];
  onOpen: (p: Priority) => void;
  disabled?: boolean;
}

/**
 * Bloco 2 — prioridades da fotografia ML (Gate V3-1A), no padrao da Gerencial
 * (`KpiTile` gerencial).
 *
 * Duas regras que o componente materializa e nao permite burlar:
 * - a contagem exibida e' de REGISTROS RECEBIDOS (nunca "N produtos no
 *   total"); a limitacao da amostra fica no "ⓘ" do cartao;
 * - cartao sem registro nao chega aqui — `buildPriorities` ja' o omite, entao
 *   nao existe "prioridade zero".
 *
 * O cartao inteiro e' um `<button>` real (nome acessivel = rotulo + valor + acao),
 * com `card-hover`. Sem periodo anterior nem serie nesta fotografia: sem pilula e
 * sem grafico. `disabled` (atualizando) tira o clique e o hover, nao o numero.
 */
export default function PriorityCards({ priorities, onOpen, disabled }: Props) {
  if (priorities.length === 0) return null;
  const impar = priorities.length % 2 === 1;
  return (
    <ul className="grid grid-cols-2 lg:grid-cols-3 gap-3 list-none p-0 m-0">
      {priorities.map((p, i) => {
        const { icone, identidade } = VISUAL_PRIORIDADE[p.kind];
        // Em 2 colunas (celular/tablet), o ultimo de uma quantidade impar fecha a linha.
        const fechaLinha = impar && i === priorities.length - 1;
        return (
          <li key={p.kind} className={fechaLinha ? "col-span-2 lg:col-span-1" : undefined}>
            <KpiTile
              variante="gerencial"
              identidade={identidade}
              icone={icone}
              rotulo={p.title}
              ajuda={<InfoDica texto={p.limitation} emControle />}
              valor={fmtBrlCurto(p.amount)}
              comparacao={`${p.amountLabel} · ${p.received} registro${p.received === 1 ? "" : "s"} exibido${p.received === 1 ? "" : "s"}`}
              onAbrir={disabled ? undefined : () => onOpen(p)}
            />
          </li>
        );
      })}
    </ul>
  );
}
