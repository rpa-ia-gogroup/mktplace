"use client";

/**
 * Marcas contra a meta (GERENCIAL-METAS-1).
 *
 * Uma barra por marca, empilhada pelos canais selecionados, com um TRACO de
 * referencia: a meta da marca quando existe, senao o periodo anterior. A
 * direita, o atingimento (com a cor do status projetado) ou a variacao.
 *
 * A legenda diz qual referencia cada traco usa — misturar meta e periodo
 * anterior sem dizer seria ler um como o outro.
 *
 * Marca com meta (METAS-DIARIAS-1): a barra so' soma os canais que tem meta,
 * para barra e traco medirem a mesma coisa (TikTok sem meta fica fora).
 *
 * Com a proporcao Full por marca (`fullPorMarca`), cada marca ganha duas
 * barras, Full e sem Full (mais "sem dado" quando um canal nao tem a medida),
 * e o traco sai: a meta continua no chip. A legenda filtra o canal.
 */
import Link from "next/link";
import { useState } from "react";

import type { BrandRow } from "@/lib/api-client";
import type { Marketplace } from "@/lib/mock-data";
import { CHANNEL_DOT as PONTO } from "@/lib/gerencial/channel-colors";
import { CHANNEL_LABEL } from "@/lib/gerencial/kpi-band";
import { GMV_DO_CANAL, ROTULO_STATUS, type StatusMeta } from "@/lib/gerencial/meta-progress";
import type { StatusDia } from "@/lib/metas-curva";
import { MARCAS, fmtCompacto } from "@/lib/metas";
import { fmtPctBr } from "@/lib/formatters";
import { fullDaMarca, type FullDaMarca } from "@/lib/gerencial/divisao-full";
import { tendenciaNosCanais, type MarcaTendencia } from "@/lib/gerencial/hoje-por-hora";
import InfoDica from "@/components/ui/InfoDica";
import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";

const CHIP: Record<StatusMeta | StatusDia, string> = {
  atingida: "bg-ok-soft text-ok-ink",
  no_caminho: "bg-ok-soft text-ok-ink",
  atencao: "bg-warn-soft text-warn-ink",
  abaixo: "bg-crit-soft text-crit-ink",
  nao_atingida: "bg-crit-soft text-crit-ink",
  // Dia em andamento: o atingimento parcial ainda nao e' bom nem ruim.
  em_andamento: "bg-raised text-ink-muted",
};

/** Meta de uma marca no recorte: do mes (com status projetado) ou do dia. */
export interface MetaDaMarca {
  meta: number;
  realizado: number;
  atingimento: number;
  status: StatusMeta | StatusDia;
  /** Canais que entram no realizado (os que tem meta). */
  canais: Marketplace[];
  /** Projecao do mes pelo ritmo (so' a meta mensal tem). */
  projecao?: number | null;
}

interface Props {
  brands: BrandRow[];
  channels: Marketplace[];
  /** Meta por marca; ausente = marca sem meta no recorte. */
  progressoPorMarca: Record<string, MetaDaMarca | null>;
  /** "da meta" ou "da meta do dia", depois do percentual. */
  rotuloMeta?: string;
  compareActive: boolean;
  loading: boolean;
  error: boolean;
  brandHref: (brand: string) => string;
  /** Marcas sem meta (menores, Bling): selo "sem meta" no lugar do % da meta; abrem a aba delas. */
  semMeta?: string[];
  /** Com "Hoje": a tendencia de fechamento de cada marca, aberta por canal. */
  tendenciaDoDia?: Record<string, MarcaTendencia> | null;
  /** Com o mes atual: o fechamento projetado de cada marca (R$), o mesmo metodo do heroi. */
  tendenciaDoMes?: Record<string, number> | null;
  /** Proporcao Full por marca e canal; ausente = uma barra so', sem divisao. */
  fullPorMarca?: Record<string, { ml?: number | null; shopee?: number | null }> | null;
}

export default function MarcasMeta({
  brands: brandsDaPagina,
  channels: canaisDaPagina,
  progressoPorMarca: progressoDaPagina,
  rotuloMeta = "da meta",
  compareActive,
  loading,
  error,
  brandHref,
  semMeta = [],
  tendenciaDoDia: tendenciaDaPagina = null,
  tendenciaDoMes: tendenciaDoMesDaPagina = null,
  fullPorMarca = null,
}: Props) {
  // Filtro de canal SO' DESTE CARD: a pagina continua no filtro global.
  const [soCanal, setSoCanal] = useState<Marketplace | null>(null);
  // Marca cujo Full x sem Full esta' aberto no dialogo.
  const [aberta, setAberta] = useState<string | null>(null);
  const filtrado = soCanal != null && canaisDaPagina.includes(soCanal) && canaisDaPagina.length > 1;
  const channels = filtrado ? [soCanal] : canaisDaPagina;
  const brands = filtrado ? brandsDaPagina.map((b) => soDoCanal(b, soCanal)) : brandsDaPagina;
  // Meta e tendencia valem para o conjunto de canais: com um canal so', saem.
  const progressoPorMarca = filtrado ? {} : progressoDaPagina;
  const tendenciaDoDia = filtrado ? null : tendenciaDaPagina;
  const tendenciaDoMes = filtrado ? null : tendenciaDoMesDaPagina;

  // Marca com meta e sem linha em `/brands` (nada vendido no recorte) entra
  // com tudo zerado: mostrar 0% da meta e' o ponto, nao esconder a marca.
  const semVenda: BrandRow[] = Object.keys(progressoPorMarca)
    .filter((id) => progressoPorMarca[id] && !brands.some((b) => b.brand === id))
    .map((id) => linhaZerada(id));
  const canaisDa = (b: BrandRow) => progressoPorMarca[b.brand]?.canais ?? channels;
  const valor = (b: BrandRow) => progressoPorMarca[b.brand]?.realizado ?? b.total_gmv;
  const linhas = [...brands, ...semVenda]
    .filter((b) => b.total_gmv > 0 || progressoPorMarca[b.brand])
    .sort((a, b) => valor(b) - valor(a));
  const algumaMeta = linhas.some((b) => progressoPorMarca[b.brand]);
  // Sem meta (menores): sem traco de referencia, que nas outras marcas e' a meta.
  const referencia = (b: BrandRow) =>
    semMeta.includes(b.brand) ? null : progressoPorMarca[b.brand]?.meta ?? (compareActive && b.total_gmv_prev > 0 ? b.total_gmv_prev : null);
  const escala = Math.max(1, ...linhas.map((b) => Math.max(valor(b), referencia(b) ?? 0)));
  const canaisDaBarra = (b: BrandRow) => channels.filter((c) => canaisDa(b).includes(c));
  const divisao = (b: BrandRow): FullDaMarca | null =>
    fullPorMarca && !semMeta.includes(b.brand)
      ? fullDaMarca(
          Object.fromEntries(canaisDaBarra(b).map((c) => [c, b[GMV_DO_CANAL[c]] ?? 0])),
          fullPorMarca[b.brand] ?? {},
        )
      : null;
  const soma = (p: Partial<Record<Marketplace, number>>) => Object.values(p).reduce((a, v) => a + (v ?? 0), 0);
  return (
    <section aria-labelledby="marcas-meta-titulo" className="flex h-full flex-col rounded-xl border border-line bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 id="marcas-meta-titulo" className="text-sm font-semibold text-ink">
              Marcas
            </h2>
            <InfoDica
              texto={`GMV no período${algumaMeta ? "; com meta, só os canais que têm meta. Traço = meta da marca (ou período anterior, sem meta)" : ". Traço = período anterior"}.${
                fullPorMarca ? " Clique na marca para ver Full e sem Full." : ""
              }`}
            />
          </div>
        </div>
        <ul className="flex flex-wrap gap-1 text-xs" aria-label="Filtrar por canal">
          {canaisDaPagina.map((c) => {
            const ativo = channels.includes(c);
            const so = filtrado && soCanal === c;
            return (
              <li key={c}>
                <button
                  type="button"
                  onClick={() => setSoCanal(so ? null : c)}
                  disabled={canaisDaPagina.length < 2}
                  aria-pressed={so}
                  title={so ? "Voltar a todos os canais neste card" : `Ver só ${CHANNEL_LABEL[c]} neste card`}
                  className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    so
                      ? "bg-surface font-semibold text-ink ring-1 ring-line-strong"
                      : ativo
                        ? "text-ink-muted hover:bg-raised"
                        : "text-ink-faint hover:bg-raised"
                  }`}
                >
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${PONTO[c]} ${ativo ? "" : "opacity-40"}`} />
                  {CHANNEL_LABEL[c]}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {error ? (
        <p className="text-sm text-crit-ink">Desempenho por marca indisponível.</p>
      ) : loading && linhas.length === 0 ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-raised motion-reduce:animate-none" />
          ))}
        </div>
      ) : linhas.length === 0 ? (
        <p className="text-sm text-ink-faint">Sem venda por marca no período e filtros selecionados.</p>
      ) : (
        <ul className="flex flex-col">
          {linhas.map((b) => {
            const p = progressoPorMarca[b.brand] ?? null;
            const ref = referencia(b);
            const d = divisao(b);
            const tende = tendenciaDoMes?.[b.brand] ?? null;
            return (
              <li key={b.brand} className="border-t border-line first:border-t-0">
                <Linha
                  abrir={d ? () => setAberta(b.brand) : null}
                  href={semMeta.includes(b.brand) ? "/marcas-menores" : brandHref(b.brand)}
                >
                  <span className="truncate text-sm font-semibold text-ink transition-transform duration-200 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0">
                    {b.label}
                  </span>
                  {(
                    <span className="relative h-2.5 rounded-full bg-raised" aria-hidden="true">
                      <span
                        className="tc-barra absolute inset-y-0 left-0 flex overflow-hidden rounded-full"
                        style={{ width: `${(valor(b) / escala) * 100}%` }}
                      >
                        {canaisDaBarra(b).map((c) => {
                          const v = b[GMV_DO_CANAL[c]] ?? 0;
                          return v > 0 ? <span key={c} className={PONTO[c]} style={{ flex: v }} /> : null;
                        })}
                      </span>
                      {ref != null && (
                        <span className="absolute -inset-y-1 w-0.5 bg-ink" style={{ left: `${(ref / escala) * 100}%` }} />
                      )}
                    </span>
                  )}
                  <span className="flex flex-col items-end text-right tabular-nums">
                    <span className="text-sm font-semibold text-ink">{fmtCompacto(valor(b))}</span>
                    {/* Com a tendencia do mes, o realizado sai da vista e vai para o title do chip dela. */}
                    {semMeta.includes(b.brand) ? (
                      <>
                        <span className="rounded bg-raised px-1.5 text-xs font-semibold text-ink-muted">sem meta</span>
                        {compareActive && b.mom_pct != null && (
                          <span className={`text-xs font-semibold ${b.mom_pct >= 0 ? "text-ok-ink" : "text-crit-ink"}`}>{fmtPctBr(b.mom_pct)}</span>
                        )}
                      </>
                    ) : p && tende != null ? null : p ? (
                      <span className={`rounded px-1.5 text-xs font-semibold ${CHIP[p.status]}`}>
                        {Math.round(p.atingimento * 100)}% {rotuloMeta}
                      </span>
                    ) : compareActive && b.mom_pct != null ? (
                      <span className={`text-xs font-semibold ${b.mom_pct >= 0 ? "text-ok-ink" : "text-crit-ink"}`}>
                        {fmtPctBr(b.mom_pct)}
                      </span>
                    ) : null}
                    {/* Mesmos canais do valor ao lado: com meta, so' os que tem meta. */}
                    <TendenciaDoDia
                      t={tendenciaDoDia?.[b.brand] ? tendenciaNosCanais(tendenciaDoDia[b.brand], canaisDaBarra(b)) : null}
                    />
                    {tende != null && <TendenciaDoMes tende={tende} p={p} className="hidden sm:flex" />}
                  </span>
                  {/* 390: ao lado das barras nao cabe; desce para uma linha propria. */}
                  {tende != null && <TendenciaDoMes tende={tende} p={p} className="col-span-full flex justify-self-end sm:hidden" />}
                </Linha>
              </li>
            );
          })}
        </ul>
      )}

      {(() => {
        const b = linhas.find((x) => x.brand === aberta);
        const d = b ? divisao(b) : null;
        const comFull = d ? soma(d.full) + soma(d.semFull) : 0;
        const escalaD = d ? Math.max(1, soma(d.full), soma(d.semFull), soma(d.semDado)) : 1;
        return (
          <KpiDrilldownDialog open={b != null && d != null} onClose={() => setAberta(null)} title={b ? `${b.label} · Full e sem Full` : ""}>
            {b && d && (
              <div className="flex flex-col gap-4">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-muted tabular-nums">
                  <b className="text-2xl font-semibold text-ink">{fmtCompacto(valor(b))}</b>
                  {comFull > 0 && <span>{Math.round((soma(d.full) / comFull) * 100)}% Full</span>}
                </p>
                <div className="flex flex-col gap-2">
                  {/* Venda toda sem medida de Full no canal: Full e sem Full zerados nao dizem nada. */}
                  {comFull > 0 && (
                    <>
                      <BarraFull rotulo="Full" partes={d.full} canais={canaisDaBarra(b)} escala={escalaD} />
                      <BarraFull rotulo="Sem Full" partes={d.semFull} canais={canaisDaBarra(b)} escala={escalaD} />
                    </>
                  )}
                  {soma(d.semDado) > 0 && (
                    <BarraFull
                      rotulo="Sem medida"
                      dica="Sem medida de Full: a modalidade de envio dos pedidos deste canal não foi medida no período."
                      partes={d.semDado}
                      canais={canaisDaBarra(b)}
                      escala={escalaD}
                    />
                  )}
                </div>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted tabular-nums">
                  {canaisDaBarra(b).map((c) => (
                    <li key={c}>
                      <span aria-hidden="true" className={`mr-1.5 inline-block h-2 w-2 rounded-full ${PONTO[c]}`} />
                      {CHANNEL_LABEL[c]} <b className="font-semibold text-ink">{fmtCompacto(b[GMV_DO_CANAL[c]] ?? 0)}</b>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-ink-faint">{FULL_DICA}</p>
                <Link
                  href={brandHref(b.brand)}
                  className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Abrir {b.label} →
                </Link>
              </div>
            )}
          </KpiDrilldownDialog>
        );
      })()}
    </section>
  );
}

const FULL_DICA = "Full = ML Full + Shopee FBS, pela proporção medida até ontem; TikTok entra em sem Full.";

const LINHA =
  "group grid min-h-11 w-full grid-cols-[88px_1fr_auto] items-center gap-3 rounded-lg px-1.5 py-2.5 text-left transition-colors duration-200 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** A linha da marca: com a divisao Full medida, abre o dialogo; sem ela, vai para a pagina da marca. */
function Linha({ abrir, href, children }: { abrir: (() => void) | null; href: string; children: React.ReactNode }) {
  return abrir ? (
    <button type="button" aria-haspopup="dialog" onClick={abrir} className={LINHA}>
      {children}
      <span className="sr-only"> (abrir Full e sem Full)</span>
    </button>
  ) : (
    <Link href={href} className={LINHA}>
      {children}
    </Link>
  );
}

/** A linha da marca so' com um canal: total, anterior e variacao daquele canal. */
function soDoCanal(b: BrandRow, c: Marketplace): BrandRow {
  const atual = b[GMV_DO_CANAL[c]] ?? 0;
  const antes = b[`${c}_gmv_prev` as const] ?? 0;
  return {
    ...b,
    tiktok_gmv: c === "tiktok" ? b.tiktok_gmv : null,
    ml_gmv: c === "ml" ? b.ml_gmv : null,
    shopee_gmv: c === "shopee" ? b.shopee_gmv : null,
    total_gmv: atual,
    total_gmv_prev: antes,
    mom_pct: antes > 0 ? ((atual - antes) / antes) * 100 : null,
  };
}

/** Uma das barras da marca (Full, sem Full ou sem medida), empilhada por canal. */
function BarraFull({
  rotulo,
  dica,
  partes,
  canais,
  escala,
}: {
  rotulo: string;
  dica?: string;
  partes: Partial<Record<Marketplace, number>>;
  canais: Marketplace[];
  escala: number;
}) {
  const total = Object.values(partes).reduce((a, v) => a + (v ?? 0), 0);
  return (
    <span className="grid grid-cols-[72px_minmax(48px,1fr)_auto] items-center gap-2 text-xs text-ink-muted" title={dica}>
      <span className="whitespace-nowrap">{rotulo}</span>
      <span className="relative h-2 rounded-full bg-raised" aria-hidden="true">
        <span
          className="tc-barra absolute inset-y-0 left-0 flex overflow-hidden rounded-full"
          style={{ width: `${(total / escala) * 100}%` }}
        >
          {canais.map((c) => {
            const v = partes[c] ?? 0;
            return v > 0 ? <span key={c} className={PONTO[c]} style={{ flex: v }} /> : null;
          })}
        </span>
      </span>
      <span className="whitespace-nowrap text-right tabular-nums">{fmtCompacto(total)}</span>
    </span>
  );
}

/**
 * "tende a 105% da meta · R$ 8,68 mi": percentual antes do absoluto, com a cor
 * do status projetado (rotulo no sr-only: a cor nunca e' a unica pista). O
 * realizado vai para o title. Sem meta: so' "tende a R$ X".
 */
function TendenciaDoMes({ tende, p, className }: { tende: number; p: MetaDaMarca | null; className: string }) {
  if (!p) {
    return (
      <span className={`${className} whitespace-nowrap text-xs text-ink-muted`} title="Pelo ritmo dos dias com dado até ontem. Marca sem meta: só o valor.">
        tende a <b className="ml-1 font-semibold text-ink">{fmtCompacto(tende)}</b>
      </span>
    );
  }
  const real = Math.round(p.atingimento * 100);
  return (
    <span
      className={`${className} items-center gap-x-1 whitespace-nowrap text-xs text-ink-muted`}
      title={`Tende a ${fmtCompacto(tende)}. Realizado: ${real}% da meta até ontem. Tendência pelo ritmo dos dias com dado, na curva da meta (o mesmo cálculo do total).`}
    >
      <span className={`rounded px-1.5 font-semibold ${CHIP[p.status]}`}>
        tende a {Math.round((tende / p.meta) * 100)}% da meta
        <span className="sr-only"> ({ROTULO_STATUS[p.status as StatusMeta] ?? ""}; realizado {real}% da meta até ontem)</span>
      </span>

    </span>
  );
}

/** "tende a R$ 1,2 mi · ▲ 8% vs ontem": a projecao contra o dia inteiro de ontem. */
function TendenciaDoDia({ t }: { t: { projecao: number; ontemDia: number } | null }) {
  if (!t) return null;
  const pct = t.ontemDia > 0 ? ((t.projecao - t.ontemDia) / t.ontemDia) * 100 : null;
  return (
    <span
      className="text-xs text-ink-muted"
      title={`Pelo ritmo de ontem até a mesma hora. Ontem fechou em ${fmtCompacto(t.ontemDia)}.`}
    >
      tende a <b className="font-semibold text-ink">{fmtCompacto(t.projecao)}</b>
      {pct != null && (
        <span className={`ml-1 font-semibold ${pct >= 0 ? "text-ok-ink" : "text-crit-ink"}`}>
          {pct >= 0 ? "▲" : "▼"} {fmtPctBr(Math.abs(pct)).replace("+", "")} vs ontem
        </span>
      )}
    </span>
  );
}

function linhaZerada(brand: string): BrandRow {
  const label = MARCAS.find((m) => m.id === brand)?.label ?? brand.toUpperCase();
  return {
    brand, label, tiktok_gmv: null, ml_gmv: null, shopee_gmv: null, total_gmv: 0, orders: 0,
    avg_ticket: null, tiktok_avg_ticket: null, ml_avg_ticket: null,
    tiktok_gmv_prev: null, ml_gmv_prev: null, shopee_gmv_prev: null, total_gmv_prev: 0,
    mom_pct: null, cos_pct: null, gpm: null, ml_roas: null, ml_cancel_rate_pct: null,
  };
}
