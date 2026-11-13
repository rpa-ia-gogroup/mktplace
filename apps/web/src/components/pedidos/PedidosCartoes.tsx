"use client";

import { CircleDollarSign, PackageCheck, PackageX, Receipt, ShoppingBag, type LucideIcon } from "lucide-react";

import CartaoIndicador, { type TomPilula } from "@/components/ui/CartaoIndicador";
import type { IdentidadeKpi } from "@/components/ui/KpiTile";
import InfoDica from "@/components/ui/InfoDica";
import { fmtBrlCurto, fmtNumCurto, fmtPctSimples } from "@/lib/formatters";
import { TITULO_DETALHE, tomDoCancelamento, type ChaveDetalhe, type Dados, type Series } from "@/lib/pedidos-cartoes";

/**
 * ALVO-GRADE (12/11/2026) — a faixa de Pedidos: SEMPRE quatro `CartaoIndicador`.
 * Visao geral: pedidos, GMV, ticket e cancelamento. Aba de canal: pedidos, GMV,
 * cancelados e entregues. A cor do cartao e' a da identidade (pedidos -> `pedidos`,
 * GMV -> `gmv`, ticket -> `ticket`, cancelamento -> `atendimento`, entregues ->
 * `prazo`); bom/ruim fica so' na pilula. Sem periodo anterior nesta fonte: sem
 * variacao; a linha usa a serie diaria real.
 */
const AUSENTE = "sem dado no período";
export const GRADE_PEDIDOS = "grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4";

/** Icone e cor de identidade do detalhe de cada cartao (o modal herda os do cartao que o abriu). */
export const VISUAL_DETALHE: Record<ChaveDetalhe, { icone: LucideIcon; identidade: IdentidadeKpi }> = {
  total_pedidos: { icone: ShoppingBag, identidade: "pedidos" },
  total_gmv: { icone: CircleDollarSign, identidade: "gmv" },
  ticket: { icone: Receipt, identidade: "ticket" },
  cancelamento: { icone: PackageX, identidade: "atendimento" },
  tk_pedidos: { icone: ShoppingBag, identidade: "pedidos" },
  ml_pedidos: { icone: ShoppingBag, identidade: "pedidos" },
  tk_cancelados: { icone: PackageX, identidade: "atendimento" },
  ml_cancelados: { icone: PackageX, identidade: "atendimento" },
  tk_gmv: { icone: CircleDollarSign, identidade: "gmv" },
  ml_gmv: { icone: CircleDollarSign, identidade: "gmv" },
};

/** Faixa da taxa de cancelamento (regra existente: 2% e 5%) escrita na pilula; sem taxa, sem pilula. */
const PILULA_CANCELAMENTO: Record<"bom" | "atencao" | "critico", { texto: string; tom: TomPilula }> = {
  bom: { texto: "Abaixo de 2%", tom: "ok" },
  atencao: { texto: "Entre 2% e 5%", tom: "warn" },
  critico: { texto: "Acima de 5%", tom: "crit" },
};
function pilulaDoCancelamento(taxa: number | null) {
  const t = tomDoCancelamento(taxa);
  return t === "ausente" ? null : PILULA_CANCELAMENTO[t];
}

function Cartao({
  rotulo, icone, identidade, valor, legenda, serie, pilula, ajuda, onAbrir,
}: {
  rotulo: string; icone: LucideIcon; identidade: IdentidadeKpi; valor: string | null; legenda?: string;
  serie?: number[]; pilula?: { texto: string; tom: TomPilula } | null; ajuda?: React.ReactNode; onAbrir?: () => void;
}) {
  // ausencia nunca vira zero: "N/D" no numero e o motivo escrito na legenda
  const ausente = valor == null;
  return (
    <CartaoIndicador
      rotulo={rotulo}
      icone={icone}
      cor={`rgb(var(--tc-kpi-${identidade}))`}
      valor={valor}
      legenda={ausente ? AUSENTE : legenda}
      pilula={ausente ? null : pilula}
      serie={ausente ? undefined : serie}
      ajuda={ajuda}
      onAbrir={ausente ? undefined : onAbrir}
    />
  );
}

/** Os 4 totais da Visao geral: pedidos, GMV, ticket e cancelamento. */
export function FaixaTotais({ dados, series, onAbrir }: { dados: Dados; series: Series; onAbrir: (chave: ChaveDetalhe) => void }) {
  const k = dados.kpis;
  const canceladosTotal = (dados.tk?.canceled ?? 0) + (dados.ml?.canceled ?? 0);
  const taxa = k?.cancel_rate_pct ?? null;
  return (
    <div className={GRADE_PEDIDOS}>
      {/* B1-04: liquido (`dados` ja' vem de `paraPedidosLiquidos`); os cancelados ficam a parte, nunca somados. */}
      <Cartao
        rotulo={TITULO_DETALHE.total_pedidos}
        icone={ShoppingBag}
        identidade="pedidos"
        valor={k ? fmtNumCurto(k.total_orders) : null}
        legenda={k ? `${fmtNumCurto(canceladosTotal)} cancelados à parte` : undefined}
        serie={series.pedidos}
        onAbrir={() => onAbrir("total_pedidos")}
      />
      <Cartao
        rotulo="GMV total"
        icone={CircleDollarSign}
        identidade="gmv"
        valor={k ? fmtBrlCurto(k.total_gmv) : null}
        serie={series.gmv}
        ajuda={<InfoDica emControle texto="Só TikTok Shop + Mercado Livre" />}
        onAbrir={() => onAbrir("total_gmv")}
      />
      <Cartao rotulo="Ticket médio" icone={Receipt} identidade="ticket" valor={k ? fmtBrlCurto(k.avg_ticket) : null} serie={series.ticket} onAbrir={() => onAbrir("ticket")} />
      <Cartao
        rotulo="Taxa de cancelamento"
        icone={PackageX}
        identidade="atendimento"
        valor={taxa != null ? fmtPctSimples(taxa) : null}
        legenda={k ? `${fmtNumCurto(canceladosTotal)} cancelados` : undefined}
        pilula={pilulaDoCancelamento(taxa)}
        serie={series.cancelamento}
        onAbrir={() => onAbrir("cancelamento")}
      />
    </div>
  );
}

/** Aba de um canal: pedidos, GMV, cancelados e entregues. So' "Entregues" nao abre detalhe (nao ha dado por marca). */
export function GrupoCanal({
  dados, serieOrders, serieCancelados, chaveOrders, chaveGmv, chaveCancelados, onAbrir,
}: {
  dados: NonNullable<Dados["tk"]>;
  serieOrders: number[];
  serieCancelados: number[];
  chaveOrders: ChaveDetalhe;
  chaveGmv: ChaveDetalhe;
  chaveCancelados: ChaveDetalhe;
  onAbrir: (chave: ChaveDetalhe) => void;
}) {
  const taxa = dados.cancel_rate_pct;
  return (
    <div className={GRADE_PEDIDOS}>
      <Cartao rotulo="Pedidos" icone={ShoppingBag} identidade="pedidos" valor={fmtNumCurto(dados.orders)} serie={serieOrders} onAbrir={() => onAbrir(chaveOrders)} />
      <Cartao rotulo="GMV" icone={CircleDollarSign} identidade="gmv" valor={fmtBrlCurto(dados.gmv)} onAbrir={() => onAbrir(chaveGmv)} />
      <Cartao
        rotulo="Cancelados"
        icone={PackageX}
        identidade="atendimento"
        valor={fmtNumCurto(dados.canceled)}
        legenda={taxa != null ? `${fmtPctSimples(taxa)} dos pedidos` : undefined}
        pilula={pilulaDoCancelamento(taxa)}
        serie={serieCancelados}
        onAbrir={() => onAbrir(chaveCancelados)}
      />
      <Cartao rotulo="Entregues" icone={PackageCheck} identidade="prazo" valor={dados.delivered != null ? fmtNumCurto(dados.delivered) : null} />
    </div>
  );
}
