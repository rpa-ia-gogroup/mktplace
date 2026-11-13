"use client";

import { CircleDollarSign, MapPin, Percent, ShieldCheck, ShoppingBag, Truck, type LucideIcon } from "lucide-react";

import CartaoIndicador, { type TomPilula } from "@/components/ui/CartaoIndicador";
import InfoDica from "@/components/ui/InfoDica";
import type { IdentidadeKpi } from "@/components/ui/KpiTile";
import type { RegioesSummaryData } from "@/lib/api-client";
import { fmtBrlCurto, fmtNumCurto } from "@/lib/formatters";
import { coverageLabel, fmtPctOrNA } from "@/lib/regioes-format";
import { tomDaCobertura, type ChaveRegioes } from "@/lib/regioes-cartoes";
import { REGIONAL_GMV_LABEL, UF_FILL_LABEL } from "@/lib/regioes-scope";

/**
 * ALVO-GRADE (12/11/2026) — a faixa de Regioes: SEMPRE quatro `CartaoIndicador`.
 * GMV regional (`gmv`), Pedidos (`pedidos`), UFs com venda (`ticket`) e UF
 * preenchida (`roas`, com o nivel de cobertura que ja' existia — OK, parcial,
 * baixa — escrito na pilula). So' GMV e Pedidos abrem detalhe. Sem periodo
 * anterior e a serie de tendencia e' nacional (ignora o filtro de UF): nenhuma
 * linha nem variacao no cartao. Os dois indicadores de frete saem da faixa e
 * vao para `FreteRegioes` ("Mais detalhes").
 */
export const VISUAL_REGIOES: Record<ChaveRegioes, { icone: LucideIcon; identidade: IdentidadeKpi }> = {
  gmv: { icone: CircleDollarSign, identidade: "gmv" },
  pedidos: { icone: ShoppingBag, identidade: "pedidos" },
};

export const GRADE_REGIOES = "grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4";
export const TOTAL_DE_CARTOES_REGIOES = 4;

const AUSENTE = "sem dado no período";
const cor = (id: IdentidadeKpi) => `rgb(var(--tc-kpi-${id}))`;
const PILULA_DA_COBERTURA: Record<"bom" | "atencao" | "critico", TomPilula> = { bom: "ok", atencao: "warn", critico: "crit" };

interface Props {
  resumo: RegioesSummaryData | null;
  /** Texto do ⓘ do GMV: escopo regional e atraso de canal (muda a leitura do numero). */
  notaDoGmv?: string;
  onAbrir: (chave: ChaveRegioes) => void;
}

export default function CartoesRegioes({ resumo, notaDoGmv, onAbrir }: Props) {
  const r = resumo;
  const coberturaTom = tomDaCobertura(r?.coverage_level);
  return (
    <div className={GRADE_REGIOES}>
      <CartaoIndicador
        rotulo={REGIONAL_GMV_LABEL}
        icone={VISUAL_REGIOES.gmv.icone}
        cor={cor("gmv")}
        ajuda={notaDoGmv ? <InfoDica emControle texto={notaDoGmv} /> : undefined}
        valor={r ? fmtBrlCurto(r.gmv) : null}
        legenda={r ? undefined : AUSENTE}
        onAbrir={r ? () => onAbrir("gmv") : undefined}
      />
      <CartaoIndicador
        rotulo="Pedidos"
        icone={VISUAL_REGIOES.pedidos.icone}
        cor={cor("pedidos")}
        valor={r ? fmtNumCurto(r.orders) : null}
        legenda={r ? undefined : AUSENTE}
        onAbrir={r ? () => onAbrir("pedidos") : undefined}
      />
      <CartaoIndicador rotulo="UFs com venda" icone={MapPin} cor={cor("ticket")} valor={r ? `${r.ufs_com_venda}/27` : null} legenda={r ? undefined : AUSENTE} />
      <CartaoIndicador
        rotulo={UF_FILL_LABEL}
        icone={Percent}
        cor={cor("roas")}
        valor={r ? fmtPctOrNA(r.uf_fill_pct) : null}
        pilula={r && coberturaTom !== "ausente" ? { texto: coverageLabel(r.coverage_level), tom: PILULA_DA_COBERTURA[coberturaTom] } : null}
        legenda={r ? "dentro dos pedidos elegíveis" : AUSENTE}
      />
    </div>
  );
}

/** Os indicadores de frete (antes 5º e 6º cartoes), em linhas no "Mais detalhes". Ausencia escrita, nunca zero. */
export function FreteRegioes({ resumo }: { resumo: RegioesSummaryData | null }) {
  const r = resumo;
  const linhas = [
    { icone: ShieldCheck, rotulo: "Cobertura Custo Frete", valor: r ? fmtPctOrNA(r.shipping_cost_coverage_pct) : "N/A", nota: r ? "Shopee sem este dado" : AUSENTE },
    { icone: Truck, rotulo: "Custo Frete Seller", valor: r?.seller_shipping_cost != null ? fmtBrlCurto(r.seller_shipping_cost) : "N/A", nota: r ? undefined : AUSENTE },
  ];
  return (
    <dl className="flex flex-col divide-y divide-line">
      {linhas.map((l) => (
        <div key={l.rotulo} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <dt className="flex items-center gap-2 text-ink-muted">
            <l.icone aria-hidden="true" className="h-4 w-4 shrink-0" style={{ color: cor("prazo") }} />
            {l.rotulo}
            {l.nota && <span className="text-xs text-ink-faint">· {l.nota}</span>}
          </dt>
          <dd className={`font-semibold tabular-nums ${l.valor === "N/A" ? "text-ink-faint" : "text-ink"}`}>{l.valor}</dd>
        </div>
      ))}
    </dl>
  );
}
