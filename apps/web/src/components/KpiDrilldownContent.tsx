"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { BrandRow, OverviewData } from "@/lib/api-client";
import type { Marketplace } from "@/lib/mock-data";
import { isMarketplaceSelected } from "@/lib/marketplace-filter";
import {
  KPI_META,
  avgTicketBrandBreakdown,
  gmvBrandBreakdown,
  gmvChannelBreakdown,
  ordersBrandBreakdown,
  roasBreakdown,
  type KpiKind,
} from "@/lib/kpi-drilldown";
import { CHANNEL_DOT } from "@/lib/gerencial/channel-colors";
import { acosDoRoas } from "@/lib/gerencial/kpi-band";
import { notaBase } from "@/lib/base-vendas";
import { fullDaMarca, fullPedidosDaMarca, type FullDaMarca, type FullDoDetalhe } from "@/lib/gerencial/divisao-full";
import { suavizar, type TendenciaKpi } from "@/lib/gerencial/kpi-trend";
import { fmtBrlCurto, fmtNumCurto, fmtPctBr, fmtPctSimples } from "@/lib/formatters";
import DrilldownContextLine from "@/components/drilldown/DrilldownContextLine";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import EvidenceRow from "@/components/drilldown/EvidenceRow";
import { BarrasFull, FullResumo, type Segmento } from "@/components/drilldown/FullDivisao";
import DrilldownCta from "@/components/drilldown/DrilldownCta";
import InfoDica from "@/components/ui/InfoDica";
import { IDENTIDADE, type IdentidadeKpi } from "@/components/ui/KpiTile";
import NumeroAnimado from "@/components/ui/NumeroAnimado";
import Sparkline from "@/components/ui/Sparkline";

interface Props {
  kind: KpiKind;
  value: string;
  periodLabel: string;
  refreshedAt: string | null;
  overview: OverviewData;
  brands: BrandRow[];
  /** Selecao atual de marketplace (Finding 3) — repassada para a
   * decomposicao de GMV por canal, para distinguir canal nao selecionado
   * (omitido) de canal selecionado sem valor no contrato ("Sem dado"). */
  channels: Marketplace[];
  buildHref: (href: string) => string;
  /** Full x sem Full por marca (so' GMV e Pedidos); ausente = sem divisao. */
  full?: FullDoDetalhe | null;
  /**
   * KPIS-COMPARACAO-1 — a comparacao que o CARD mostrou (variacao % e "antes
   * X"). Vem pronta da faixa para o detalhe nunca contradizer o card; ausente
   * = sem comparacao.
   */
  comparacao?: { deltaPct: number | null; reference: string | null; deltaTone?: string };
  /** POPUPS-1 — a mesma serie do mini grafico do card, aqui em tamanho legivel. */
  tendencia?: TendenciaKpi | null;
  /** Falso quando nao ha' base justa (comparar desligado ou dia em andamento). */
  comparar?: boolean;
  /** Periodo e' so' o dia de hoje, ainda aberto. */
  diaEmAndamento?: boolean;
  /** Cor de identidade do cartao que abriu o detalhe (gráfico da tendencia). */
  identidade?: IdentidadeKpi;
  /** Ressalva extra do número (vai no ⓘ, junto da definição). */
  nota?: string | null;
}

function fmtPct1(v: number | null): string {
  return v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function variacao(atual: number | null | undefined, anterior: number | null | undefined): number | null {
  return atual != null && anterior != null && anterior > 0 ? (atual / anterior - 1) * 100 : null;
}

/** Referência vs período anterior — SÓ com dado já carregado (Gate G2).
 * GMV lê `prev_gmv`/`gmv_mom_pct`; os demais (KPIS-COMPARACAO-1) recebem a
 * comparação que o card já calculou, para o detalhe nunca contradizer o card.
 * POPUPS-1: sem base, nao ha' linha nenhuma — a ausencia de pilula ja' diz. */
function KpiReference({
  kind,
  overview,
  comparacao,
}: {
  kind: KpiKind;
  overview: OverviewData;
  comparacao?: { deltaPct: number | null; reference: string | null; deltaTone?: string };
}) {
  const gmv = kind === "gmv" && comparacao != null && overview.gmv_mom_pct != null && overview.prev_gmv != null;
  const outra = kind !== "gmv" && comparacao?.deltaPct != null && comparacao.reference ? comparacao : null;
  if (!gmv && !outra) return null;
  const pct = gmv ? overview.gmv_mom_pct! : outra!.deltaPct!;
  const antes = gmv ? fmtBrlCurto(overview.prev_gmv!) : outra!.reference!;
  const neutro = kind === "ad_spend" || outra?.deltaTone === "neutral";
  const sobe = pct >= 0;
  const Seta = sobe ? ArrowUpRight : ArrowDownRight;
  const pele = neutro ? "bg-raised text-ink-muted" : sobe ? "bg-ok-soft text-ok-ink" : "bg-crit-soft text-crit-ink";
  return (
    <span className="flex flex-wrap items-center gap-2 pb-0.5">
      <span className={`inline-flex items-center gap-0.5 rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums ${pele}`}>
        <Seta aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
        {fmtPctBr(pct)}
      </span>
      <span className="text-xs text-ink-faint tabular-nums">vs {antes} no período anterior</span>
    </span>
  );
}

/**
 * Conteudo interno do KpiDrilldownDialog, um por KPI (Gate U2, Task 4;
 * alinhado ao contrato transversal no Gate G2 — ver
 * docs/DRILLDOWN_ARCHITECTURE.md §3) — decomposicao usando somente dados ja
 * carregados (OverviewData/BrandRow), sem fetch/endpoint novo.
 *
 * POPUPS-1 — numero, variacao, tendencia e decomposicao com barras. Definicao,
 * formula e ressalva do indicador ficam no "ⓘ" ao lado do periodo.
 */
export default function KpiDrilldownContent({
  kind,
  value,
  periodLabel,
  refreshedAt,
  overview,
  brands,
  channels,
  buildHref,
  full = null,
  comparacao: comparacaoDoCard,
  tendencia,
  comparar = true,
  diaEmAndamento = false,
  identidade,
  nota,
}: Props) {
  const meta = KPI_META[kind];
  const comparacao = comparar ? comparacaoDoCard : undefined;
  const venda = kind === "gmv" || kind === "orders" || kind === "avg_ticket" ? notaBase(overview, channels) : null;
  const explicacao = [DICA[kind], venda, nota].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5">
          <NumeroAnimado texto={value} className="text-[32px] font-bold leading-none tracking-tight text-ink tabular-nums" />
          <KpiReference kind={kind} overview={overview} comparacao={comparacao} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <DrilldownContextLine
            leading={diaEmAndamento ? "Dia em andamento" : null}
            periodLabel={periodLabel}
            refreshedAt={refreshedAt}
          />
          {explicacao && <InfoDica texto={explicacao} />}
        </div>
      </div>

      {tendencia && tendencia.pontos.length >= 4 && <Tendencia t={tendencia} identidade={identidade} />}

      {kind === "gmv" && <GmvBreakdown overview={overview} brands={brands} channels={channels} full={full} />}
      {kind === "orders" && <OrdersBreakdown brands={brands} full={full} />}
      {kind === "avg_ticket" && <AvgTicketBreakdown brands={brands} />}
      {kind === "ad_spend" && <AdSpendBreakdown overview={overview} brands={brands} channels={channels} />}
      {kind === "roas" && <RoasBreakdown overview={overview} brands={brands} channels={channels} />}

      <DrilldownCta href={buildHref(meta.nextHref)}>{meta.nextLabel} →</DrilldownCta>
    </div>
  );
}

/**
 * POPUPS-1 — o "ⓘ" so' existe quando MUDA a leitura do numero. "Pedidos e'
 * a soma dos pedidos" nao muda nada; a regra de GMV por canal, a cobertura do
 * investimento e o ROAS sem consolidado mudam.
 */
const DICA: Partial<Record<KpiKind, string>> = {
  gmv: KPI_META.gmv.definition,
  ad_spend: KPI_META.ad_spend.caveat,
  roas: KPI_META.roas.caveat,
};

/** Serie do periodo em area, suavizada como no card, com a variacao recente. */
function Tendencia({ t, identidade }: { t: TendenciaKpi; identidade?: IdentidadeKpi }) {
  // IDENTIDADE-GERENCIAL: o mesmo desenho do cartao (cor do KPI, degrade e ponto
  // final), so' mais alto. Sem identidade, o violeta de destaque de antes.
  const tinta = identidade ? IDENTIDADE[identidade].tinta : "text-accent";
  return (
    <DrilldownSecao
      titulo="Tendência"
      acao={
        t.variacaoPct != null && (
          <span className="tabular-nums">
            <b className={`font-semibold ${t.variacaoPct >= 0 ? "text-ok-ink" : "text-crit-ink"}`}>{fmtPctBr(t.variacaoPct)}</b> · {t.rotulo}
          </span>
        )
      }
    >
      {/* Mais alto que no cartao (h-9): a altura vem de fora, o Sparkline fica igual. */}
      <div className="[&>span]:h-16">
        <Sparkline pontos={suavizar(t.pontos)} tinta={tinta} />
      </div>
    </DrilldownSecao>
  );
}

const CANAIS_FULL = ["ml", "shopee", "tiktok"] as const;
const CANAL_NOME = { ml: "Mercado Livre", shopee: "Shopee", tiktok: "TikTok" } as const;

/** GMV da marca por canal (so' o que tem valor), para a divisao Full. */
function gmvDaMarca(b: BrandRow) {
  return { tiktok: b.tiktok_gmv ?? undefined, ml: b.ml_gmv ?? undefined, shopee: b.shopee_gmv ?? undefined };
}

const seg = (partes: FullDaMarca["full"]): Segmento[] =>
  CANAIS_FULL.map((c) => ({ cls: CHANNEL_DOT[c], v: partes[c] ?? 0 }));
const somaPartes = (partes: FullDaMarca["full"]) => CANAIS_FULL.reduce((a, c) => a + (partes[c] ?? 0), 0);

const DICA_FULL_GMV =
  "Estimativa: a % de Full medida até ontem, aplicada ao GMV do período. Full = ML Full + Shopee FBS. TikTok não tem Full.";
const DICA_FULL_PEDIDOS =
  "Full = pedidos enviados pelo ML Full e pela Shopee FBS, contados um a um. TikTok não tem Full.";
const DICA_FULL_PEDIDOS_HOJE = `${DICA_FULL_PEDIDOS} Hoje ainda não tem tipo de envio: o dia usa a proporção até ontem (estimativa).`;

function GmvBreakdown({
  overview,
  brands,
  channels,
  full,
}: {
  overview: OverviewData;
  brands: BrandRow[];
  channels: Marketplace[];
  full: FullDoDetalhe | null;
}) {
  const byChannel = gmvChannelBreakdown(overview, channels);
  const byBrand = [...gmvBrandBreakdown(brands)].sort((a, b) => b.value - a.value);
  const mom = new Map(brands.map((b) => [b.brand, b.mom_pct]));
  const rowBrand = new Map(brands.map((b) => [b.brand, b]));
  const ds = byBrand.map((b) => {
    const row = rowBrand.get(b.brand);
    return full && row ? fullDaMarca(gmvDaMarca(row), full.por[b.brand] ?? {}) : null;
  });
  const tot = ds.reduce(
    (t, d) => (d ? { f: t.f + somaPartes(d.full), s: t.s + somaPartes(d.semFull), n: t.n + somaPartes(d.semDado) } : t),
    { f: 0, s: 0, n: 0 },
  );
  const escala = Math.max(0, ...ds.map((d) => (d ? Math.max(somaPartes(d.full), somaPartes(d.semFull), somaPartes(d.semDado)) : 0)));
  return (
    <>
      <FullResumo full={tot.f} semFull={tot.s} semMedida={tot.n} fmt={fmtBrlCurto} dica={DICA_FULL_GMV} estimado />
      <DrilldownSecao titulo="Por canal">
        <ul className="flex flex-col">
          {byChannel.map((c) => (
            <EvidenceRow
              key={c.channel}
              label={c.label}
              ponto={CHANNEL_DOT[c.channel]}
              barra={CHANNEL_DOT[c.channel]}
              pct={c.pct}
              value={c.value != null ? `${fmtBrlCurto(c.value)} · ${fmtPct1(c.pct)}` : "Sem dado"}
              tone={c.value != null ? "value" : "muted"}
            />
          ))}
        </ul>
      </DrilldownSecao>
      <DrilldownSecao titulo="Por marca" acao={<span>{byBrand.length}</span>}>
        <ul className="flex flex-col">
          {byBrand.map((b, i) => {
            const d = mom.get(b.brand);
            const dv = ds[i];
            const comMedida = dv != null && somaPartes(dv.full) + somaPartes(dv.semFull) > 0;
            const semDado = dv != null && somaPartes(dv.semDado) > 0;
            return (
              <EvidenceRow
                key={b.brand}
                label={b.label}
                pct={b.pct}
                delta={d != null ? { pct: d } : null}
                value={`${fmtBrlCurto(b.value)} · ${fmtPct1(b.pct)}`}
              >
                {dv && (comMedida || semDado) && (
                  <BarrasFull
                    full={seg(dv.full)}
                    semFull={seg(dv.semFull)}
                    semDado={seg(dv.semDado)}
                    nomeSemDado={CANAIS_FULL.filter((c) => (dv.semDado[c] ?? 0) > 0)
                      .map((c) => CANAL_NOME[c])
                      .join(" + ")}
                    escala={escala}
                    fmt={fmtBrlCurto}
                  />
                )}
              </EvidenceRow>
            );
          })}
        </ul>
      </DrilldownSecao>
    </>
  );
}

function OrdersBreakdown({ brands, full }: { brands: BrandRow[]; full: FullDoDetalhe | null }) {
  const byBrand = [...ordersBrandBreakdown(brands)].sort((a, b) => b.value - a.value);
  const rowBrand = new Map(brands.map((b) => [b.brand, b]));
  // Real: contagem das fatos. Sem medida (null): a marca fica sem divisao e fora do %.
  const divisoes = byBrand.map((b) => {
    const row = rowBrand.get(b.brand);
    const f = full?.por[b.brand];
    return full && row ? fullPedidosDaMarca(b.value, f, full.aproximado, fullDaMarca(gmvDaMarca(row), f ?? {})) : null;
  });
  const tot = divisoes.reduce(
    (t, d, i) => (d ? { ...t, f: t.f + d.full, s: t.s + d.semFull } : { ...t, n: t.n + byBrand[i].value }),
    { f: 0, s: 0, n: 0 },
  );
  const escala = Math.max(0, ...divisoes.map((d) => (d ? Math.max(d.full, d.semFull) : 0)));
  return (
    <>
      <FullResumo
        full={tot.f}
        semFull={tot.s}
        semMedida={tot.n}
        fmt={fmtNumCurto}
        dica={full?.aproximado ? DICA_FULL_PEDIDOS_HOJE : DICA_FULL_PEDIDOS}
        estimado={full?.aproximado}
      />
      <DrilldownSecao titulo="Por marca" acao={<span>{byBrand.length}</span>}>
        <ul className="flex flex-col">
          {byBrand.map((b, i) => {
            const d = divisoes[i];
            return (
              <EvidenceRow
                key={b.brand}
                label={b.label}
                pct={b.pct}
                value={`${fmtNumCurto(b.value)} · ${fmtPct1(b.pct)}`}
                reference={full && !d ? "Sem medida de Full" : null}
              >
                {d && (
                  <BarrasFull
                    full={[{ cls: "bg-accent", v: d.full }]}
                    semFull={[{ cls: "bg-ink-faint", v: d.semFull }]}
                    escala={escala}
                    fmt={fmtNumCurto}
                  />
                )}
              </EvidenceRow>
            );
          })}
        </ul>
      </DrilldownSecao>
    </>
  );
}

function AvgTicketBreakdown({ brands }: { brands: BrandRow[] }) {
  const rows = [...avgTicketBrandBreakdown(brands)].sort((a, b) => (b.avgTicket ?? -1) - (a.avgTicket ?? -1));
  const maior = Math.max(0, ...rows.map((r) => r.avgTicket ?? 0));
  return (
    <DrilldownSecao titulo="Por marca" acao={<span>maior → menor</span>}>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <EvidenceRow
            key={r.brand}
            label={r.label}
            pct={r.avgTicket != null && maior > 0 ? (r.avgTicket / maior) * 100 : null}
            value={r.avgTicket != null ? fmtBrlCurto(r.avgTicket) : "—"}
            tone={r.avgTicket != null ? "value" : "muted"}
          />
        ))}
      </ul>
    </DrilldownSecao>
  );
}

/**
 * Investimento em Ads (Gate V2-1): declara a COBERTURA em vez de fingir que a
 * soma cobre os tres canais. O TikTok aparece como indisponivel nesta fonte,
 * nunca como R$ 0.
 */
function AdSpendBreakdown({ overview, brands, channels }: { overview: OverviewData; brands: BrandRow[]; channels: Marketplace[] }) {
  const mlSelected = isMarketplaceSelected(channels, "ml");
  const shopeeSelected = isMarketplaceSelected(channels, "shopee");
  const tiktokSelected = isMarketplaceSelected(channels, "tiktok");
  const porMarca = brands.filter((b) => b.ad_spend != null).sort((a, b) => b.ad_spend! - a.ad_spend!);
  const total = porMarca.reduce((s, b) => s + b.ad_spend!, 0);
  return (
    <>
    <DrilldownSecao titulo="Por canal">
      <ul className="flex flex-col">
        {(mlSelected || shopeeSelected) && (
          <EvidenceRow
            label="Mercado Livre + Shopee"
            value={overview.ad_spend != null ? fmtBrlCurto(overview.ad_spend) : "Sem dado"}
            tone={overview.ad_spend != null ? "value" : "muted"}
          />
        )}
        {tiktokSelected && <EvidenceRow label="TikTok Shop" ponto={CHANNEL_DOT.tiktok} value="Não reporta" tone="muted" />}
      </ul>
    </DrilldownSecao>
    {porMarca.length > 0 && (
      <DrilldownSecao titulo="Por marca" acao={<span>{porMarca.length}</span>}>
        <ul className="flex flex-col">
          {porMarca.map((b) => {
            const pct = total > 0 ? (b.ad_spend! / total) * 100 : null;
            return (
              <EvidenceRow
                key={b.brand}
                label={b.label}
                pct={pct}
                barra="bg-kpi-ads"
                // Neutro como o card: investir mais nao e' bom nem ruim por si.
                delta={(() => {
                  const d = variacao(b.ad_spend, b.ad_spend_prev);
                  return d != null ? { pct: d, neutro: true } : null;
                })()}
                value={`${fmtBrlCurto(b.ad_spend!)} · ${fmtPct1(pct)}`}
              />
            );
          })}
        </ul>
      </DrilldownSecao>
    )}
    </>
  );
}

/**
 * ROAS por canal (Gate V2-1): uma linha por canal, sem nenhum consolidado.
 * Canal nao selecionado e' omitido; canal selecionado sem valor fica explicito.
 * POPUPS-1: variacao de cada canal contra o periodo anterior, e o ROAS do
 * Mercado Livre por marca — a pergunta seguinte de quem abre o detalhe.
 */
function RoasBreakdown({ overview, brands, channels }: { overview: OverviewData; brands: BrandRow[]; channels: Marketplace[] }) {
  const roas = roasBreakdown(overview);
  // ACOS (menor = melhor) substituiu o ROAS na tela; a fonte segue sendo o ROAS.
  const r = { ml: acosDoRoas(roas.ml), shopee: acosDoRoas(roas.shopee) };
  const mlSel = isMarketplaceSelected(channels, "ml");
  const porMarca = mlSel
    ? brands
        .map((b) => ({ ...b, acos: acosDoRoas(b.ml_roas) }))
        .filter((b) => b.acos != null)
        .sort((a, b) => a.acos! - b.acos!)
    : [];
  const maior = Math.max(0, ...porMarca.map((b) => b.acos!));
  const x = fmtPctSimples;
  const dMl = variacao(r.ml, acosDoRoas(overview.prev_ml_roas));
  const dShopee = variacao(r.shopee, acosDoRoas(overview.prev_shopee_roas));
  return (
    <>
      <DrilldownSecao titulo="Por canal">
        <ul className="flex flex-col">
          {mlSel && (
            <EvidenceRow
              label="Mercado Livre"
              ponto={CHANNEL_DOT.ml}
              delta={dMl != null ? { pct: dMl, menorMelhor: true } : null}
              value={r.ml != null ? x(r.ml) : "Sem dado"}
              tone={r.ml != null ? "value" : "muted"}
            />
          )}
          {isMarketplaceSelected(channels, "shopee") && (
            <EvidenceRow
              label="Shopee"
              ponto={CHANNEL_DOT.shopee}
              delta={dShopee != null ? { pct: dShopee, menorMelhor: true } : null}
              value={r.shopee != null ? x(r.shopee) : "Sem dado"}
              tone={r.shopee != null ? "value" : "muted"}
            />
          )}
          {isMarketplaceSelected(channels, "tiktok") && (
            <EvidenceRow label="TikTok Shop" ponto={CHANNEL_DOT.tiktok} value="Não reporta" tone="muted" />
          )}
        </ul>
      </DrilldownSecao>
      {porMarca.length > 1 && (
        <DrilldownSecao titulo="Mercado Livre por marca">
          <ul className="flex flex-col">
            {porMarca.map((b) => (
              <EvidenceRow
                key={b.brand}
                label={b.label}
                pct={maior > 0 ? (b.acos! / maior) * 100 : null}
                barra={CHANNEL_DOT.ml}
                value={x(b.acos!)}
              />
            ))}
          </ul>
        </DrilldownSecao>
      )}
    </>
  );
}
