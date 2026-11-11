"use client";

import { CircleDollarSign, MapPin, Percent, ShieldCheck, ShoppingBag, Truck, type LucideIcon } from "lucide-react";

import InfoDica from "@/components/ui/InfoDica";
import KpiTile, { type IdentidadeKpi } from "@/components/ui/KpiTile";
import type { RegioesSummaryData } from "@/lib/api-client";
import { fmtBrlCurto, fmtNumCurto } from "@/lib/formatters";
import { coverageLabel, fmtPctOrNA } from "@/lib/regioes-format";
import { tomDaCobertura, type ChaveRegioes } from "@/lib/regioes-cartoes";
import { REGIONAL_GMV_LABEL, UF_FILL_LABEL } from "@/lib/regioes-scope";

/**
 * Cartoes de Regioes no padrao da Gerencial (`KpiTile` gerencial). Identidades (so'
 * as 7 existentes): GMV -> `gmv`, pedidos -> `pedidos`, UFs com venda -> `ticket`,
 * UF preenchida -> `roas` (com o tom da regra de cobertura que ja' existia: OK,
 * parcial, baixa), cobertura e custo de frete -> `prazo`. So' GMV e Pedidos abrem
 * detalhe (por UF e por marca, dados ja' carregados). Sem periodo anterior (o filtro
 * "Comparar" nao existe aqui) e a serie de tendencia e' nacional e ignora o filtro
 * de UF: nada disso entra no cartao.
 */
export const VISUAL_REGIOES: Record<ChaveRegioes, { icone: LucideIcon; identidade: IdentidadeKpi }> = {
  gmv: { icone: CircleDollarSign, identidade: "gmv" },
  pedidos: { icone: ShoppingBag, identidade: "pedidos" },
};

export const GRADE_REGIOES = "grid grid-cols-2 md:grid-cols-4 gap-3";
export const TOTAL_DE_CARTOES_REGIOES = 6;

const AUSENTE = "Sem dado no período";

interface Props {
  resumo: RegioesSummaryData | null;
  /** Texto do ⓘ do GMV: escopo regional e atraso de canal (muda a leitura do numero). */
  notaDoGmv?: string;
  onAbrir: (chave: ChaveRegioes) => void;
}

export default function CartoesRegioes({ resumo, notaDoGmv, onAbrir }: Props) {
  const r = resumo;
  const semResumo = r == null;
  const coberturaTom = tomDaCobertura(r?.coverage_level);
  return (
    <div className={GRADE_REGIOES}>
      <KpiTile
        variante="gerencial"
        identidade="gmv"
        icone={VISUAL_REGIOES.gmv.icone}
        rotulo={REGIONAL_GMV_LABEL}
        ajuda={notaDoGmv ? <InfoDica emControle texto={notaDoGmv} /> : undefined}
        valor={r ? fmtBrlCurto(r.gmv) : "—"}
        comparacao={semResumo ? AUSENTE : undefined}
        tom={semResumo ? "ausente" : "neutro"}
        onAbrir={semResumo ? undefined : () => onAbrir("gmv")}
      />
      <KpiTile
        variante="gerencial"
        identidade="pedidos"
        icone={VISUAL_REGIOES.pedidos.icone}
        rotulo="Pedidos"
        valor={r ? fmtNumCurto(r.orders) : "—"}
        comparacao={semResumo ? AUSENTE : undefined}
        tom={semResumo ? "ausente" : "neutro"}
        onAbrir={semResumo ? undefined : () => onAbrir("pedidos")}
      />
      <KpiTile
        variante="gerencial"
        identidade="ticket"
        icone={MapPin}
        rotulo="UFs com venda"
        valor={r ? `${r.ufs_com_venda}/27` : "—"}
        comparacao={semResumo ? AUSENTE : undefined}
        tom={semResumo ? "ausente" : "neutro"}
      />
      <KpiTile
        variante="gerencial"
        identidade="roas"
        icone={Percent}
        rotulo={UF_FILL_LABEL}
        valor={r ? fmtPctOrNA(r.uf_fill_pct) : "—"}
        comparacao={r ? `${coverageLabel(r.coverage_level)} · dentro dos pedidos elegíveis` : AUSENTE}
        tom={r ? coberturaTom : "ausente"}
      />
      <KpiTile
        variante="gerencial"
        identidade="prazo"
        icone={ShieldCheck}
        rotulo="Cobertura Custo Frete"
        valor={r ? fmtPctOrNA(r.shipping_cost_coverage_pct) : "—"}
        comparacao={r ? "Shopee sem este dado" : AUSENTE}
        tom={r ? "neutro" : "ausente"}
      />
      <KpiTile
        variante="gerencial"
        identidade="prazo"
        icone={Truck}
        rotulo="Custo Frete Seller"
        valor={r?.seller_shipping_cost != null ? fmtBrlCurto(r.seller_shipping_cost) : "N/A"}
        comparacao={semResumo ? AUSENTE : undefined}
        tom={r?.seller_shipping_cost != null ? "neutro" : "ausente"}
      />
    </div>
  );
}

