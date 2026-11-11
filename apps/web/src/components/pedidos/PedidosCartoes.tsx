"use client";

import { CircleDollarSign, PackageCheck, PackageX, Receipt, ShoppingBag, type LucideIcon } from "lucide-react";

import KpiTile, { type IdentidadeKpi } from "@/components/ui/KpiTile";
import InfoDica from "@/components/ui/InfoDica";
import { fmtBrlCurto, fmtNumCurto, fmtPctSimples } from "@/lib/formatters";
import { CHANNEL_DOT } from "@/lib/gerencial/channel-colors";
import { TITULO_DETALHE, tomDoCancelamento, type ChaveDetalhe, type Dados, type Series } from "@/lib/pedidos-cartoes";

/**
 * Cartoes de Pedidos no padrao da Gerencial (`KpiTile` gerencial). Identidades
 * (so' as 7 existentes): pedidos -> `pedidos`, GMV -> `gmv`, ticket -> `ticket`,
 * cancelamento -> `atendimento`, entregues -> `prazo`. O canal e' um ponto no
 * titulo do grupo, nunca cor de cartao. Sem periodo anterior nesta fonte, entao
 * sem pilula nem "antes"; o mini grafico usa a serie diaria real.
 */
const AUSENTE = "Sem dado no período";
const GRADE = "grid grid-cols-2 md:grid-cols-4 gap-3";

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

interface Props {
  dados: Dados;
  series: Series;
  onAbrir: (chave: ChaveDetalhe) => void;
}

function Tile({
  rotulo, icone, identidade, valor, comparacao, serie, tom, ajuda, onAbrir,
}: {
  rotulo: string; icone: LucideIcon; identidade: IdentidadeKpi; valor: string | null; comparacao?: string;
  serie?: number[]; tom?: "neutro" | "bom" | "atencao" | "critico" | "ausente"; ajuda?: React.ReactNode; onAbrir?: () => void;
}) {
  const ausente = valor == null;
  return (
    <KpiTile
      variante="gerencial"
      identidade={identidade}
      icone={icone}
      rotulo={rotulo}
      ajuda={ajuda}
      valor={valor ?? "—"}
      comparacao={ausente ? AUSENTE : comparacao}
      tom={ausente ? "ausente" : tom ?? "neutro"}
      serie={ausente ? undefined : serie}
      onAbrir={ausente ? undefined : onAbrir}
    />
  );
}

/** Os 4 totais da faixa: pedidos, GMV, ticket e cancelamento. */
export function FaixaTotais({ dados, series, onAbrir }: Props) {
  const k = dados.kpis;
  const canceladosTotal = (dados.tk?.canceled ?? 0) + (dados.ml?.canceled ?? 0);
  const taxa = k?.cancel_rate_pct ?? null;
  return (
    <div className={GRADE}>
      {/* B1-04: liquido (`dados` ja' vem de `paraPedidosLiquidos`); os cancelados ficam a parte, nunca somados. */}
      <Tile
        rotulo={TITULO_DETALHE.total_pedidos}
        icone={ShoppingBag}
        identidade="pedidos"
        valor={k ? fmtNumCurto(k.total_orders) : null}
        comparacao={k ? `${fmtNumCurto(canceladosTotal)} cancelados à parte` : undefined}
        serie={series.pedidos}
        onAbrir={() => onAbrir("total_pedidos")}
      />
      <Tile
        rotulo="GMV total"
        icone={CircleDollarSign}
        identidade="gmv"
        valor={k ? fmtBrlCurto(k.total_gmv) : null}
        serie={series.gmv}
        ajuda={<InfoDica emControle texto="Só TikTok Shop + Mercado Livre" />}
        onAbrir={() => onAbrir("total_gmv")}
      />
      <Tile rotulo="Ticket médio" icone={Receipt} identidade="ticket" valor={k ? fmtBrlCurto(k.avg_ticket) : null} serie={series.ticket} onAbrir={() => onAbrir("ticket")} />
      <Tile
        rotulo="Taxa de cancelamento"
        icone={PackageX}
        identidade="atendimento"
        valor={taxa != null ? fmtPctSimples(taxa) : null}
        comparacao={k ? `${fmtNumCurto(canceladosTotal)} cancelados` : undefined}
        tom={tomDoCancelamento(taxa)}
        serie={series.cancelamento}
        onAbrir={() => onAbrir("cancelamento")}
      />
    </div>
  );
}

/** Um canal: pedidos, GMV, cancelados e entregues. So' "Entregues" nao abre detalhe (nao ha dado por marca). */
export function GrupoCanal({
  canal, titulo, dados, serieOrders, serieCancelados, chaveOrders, chaveGmv, chaveCancelados, onAbrir,
}: {
  canal: "tiktok" | "ml";
  titulo: string;
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
    <section aria-label={titulo} className="flex flex-col gap-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-muted">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${CHANNEL_DOT[canal]}`} />
        {titulo}
      </h3>
      <div className={GRADE}>
        <Tile rotulo="Pedidos" icone={ShoppingBag} identidade="pedidos" valor={fmtNumCurto(dados.orders)} serie={serieOrders} onAbrir={() => onAbrir(chaveOrders)} />
        <Tile rotulo="GMV" icone={CircleDollarSign} identidade="gmv" valor={fmtBrlCurto(dados.gmv)} onAbrir={() => onAbrir(chaveGmv)} />
        <Tile
          rotulo="Cancelados"
          icone={PackageX}
          identidade="atendimento"
          valor={fmtNumCurto(dados.canceled)}
          comparacao={taxa != null ? `${fmtPctSimples(taxa)} dos pedidos` : undefined}
          tom={tomDoCancelamento(taxa)}
          serie={serieCancelados}
          onAbrir={() => onAbrir(chaveCancelados)}
        />
        {dados.delivered != null && <Tile rotulo="Entregues" icone={PackageCheck} identidade="prazo" valor={fmtNumCurto(dados.delivered)} />}
      </div>
    </section>
  );
}
