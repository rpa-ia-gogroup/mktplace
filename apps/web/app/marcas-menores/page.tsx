"use client";

/**
 * Marcas menores (Denavita, Yenzah, Auá, By Samia) — fonte: API do Avoe, não o
 * Data Mart (só os produtos da Denavita no TikTok vêm de lá). Só ML, Shopee e
 * TikTok. Fica SEPARADA: não entra no GMV total, na meta nem na rosca da
 * Gerencial, e não tem meta. O Avoe só entrega até ontem (D-1).
 */
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Layers } from "lucide-react";

import DateRangeFilter from "@/components/DateRangeFilter";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import Chip from "@/components/ui/Chip";
import InfoDica from "@/components/ui/InfoDica";
import StateBlock from "@/components/ui/StateBlock";
import { useGlobalFilters } from "@/hooks/useGlobalFilters";
import { fetchMarcasMenores, fetchProdutosMarcasMenores } from "@/lib/api-client";
import { fmtPeriodo } from "@/lib/filters/format";
import { fmtNumber, fmtPctBr } from "@/lib/formatters";
import {
  corDaPlataforma,
  fatias,
  nomeDaPlataforma,
  variacaoPct,
  type Consolidado,
  type MarcaMenor,
  type MarcasMenores,
  type ProdutosDenavitaTiktok,
} from "@/lib/marcas-menores";
import { fmtCompacto } from "@/lib/metas";

const SerieDiaria = dynamic(() => import("./SerieDiaria"), { ssr: false, loading: () => <div className="h-36" aria-hidden="true" /> });

const FONTE =
  "Fonte: API do Avoe, não o Data Mart. O Avoe entrega até ontem (D-1), então o dia de hoje não aparece. Só Mercado Livre, Shopee e TikTok. Estas marcas ficam fora do GMV total, da meta e da rosca da Gerencial e não têm meta.";
const FONTE_PRODUTOS =
  "Origem: Data Mart (gold.fct_tiktok_product_daily), só Denavita no TikTok. O Avoe traz apenas faturamento por dia, marca e canal, sem produto nem quantidade. Nenhuma outra marca ou canal tem produto em fonte alguma. A receita daqui (Data Mart) pode diferir do faturamento do Avoe.";

export default function MarcasMenoresPage() {
  const [filters, setFilters] = useGlobalFilters({ defaultPreset: "7d", defaultCompare: false });
  const [dados, setDados] = useState<MarcasMenores | null>(null);
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [produtos, setProdutos] = useState<ProdutosDenavitaTiktok | null | undefined>(undefined);

  useEffect(() => {
    let vivo = true;
    setEstado("carregando");
    setProdutos(undefined);
    fetchMarcasMenores(filters.dateFrom, filters.dateTo).then((d) => {
      if (!vivo) return;
      setDados(d);
      setEstado(d ? "ok" : "erro");
      // Mesmo recorte do Avoe (até ontem); bloco próprio, falha sozinho.
      const p = d?.periodo;
      fetchProdutosMarcasMenores(p?.inicio ?? filters.dateFrom, p?.fim ?? filters.dateTo).then((r) => vivo && setProdutos(r));
    });
    return () => {
      vivo = false;
    };
  }, [filters.dateFrom, filters.dateTo]);

  const periodo = dados?.periodo ? fmtPeriodo(dados.periodo.inicio, dados.periodo.fim) : fmtPeriodo(filters.dateFrom, filters.dateTo);
  return (
    <PageContainer>
      <PageHeader
        title="Marcas menores"
        icon={Layers}
        meta={
          <>
            <Chip>{periodo}</Chip>
            {dados?.ajustado && <Chip>dado até ontem</Chip>}
            <InfoDica texto={FONTE} />
          </>
        }
        filters={
          <DateRangeFilter
            dateFrom={filters.dateFrom}
            dateTo={filters.dateTo}
            compare={false}
            onChange={(v) => setFilters(v)}
            onCompareChange={() => {}}
            hideCompare
          />
        }
      />
      {estado === "carregando" ? (
        <StateBlock tipo="carregando" titulo="Carregando as marcas" />
      ) : estado === "erro" || !dados ? (
        <StateBlock tipo="erro" titulo="Não foi possível contatar a API" />
      ) : !dados.disponivel ? (
        <StateBlock tipo="indisponivel" titulo="Marcas menores indisponíveis" descricao={dados.motivo ?? undefined} />
      ) : (
        <>
          {dados.consolidado && <Topo c={dados.consolidado} marcas={dados.marcas} />}
          <Marcas marcas={dados.marcas} />
          <Produtos r={produtos} />
        </>
      )}
    </PageContainer>
  );
}

/** "▲ 12%" contra o período anterior; sem base, nada. */
function Variacao({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  return (
    <span className={`font-semibold ${pct >= 0 ? "text-ok-ink" : "text-crit-ink"}`}>
      {pct >= 0 ? "▲" : "▼"} {fmtPctBr(Math.abs(pct)).replace("+", "")}
    </span>
  );
}

/** Receita consolidada das 4 marcas + rosca por canal (o mesmo desenho da Gerencial, sem meta). */
function Topo({ c, marcas }: { c: Consolidado; marcas: MarcaMenor[] }) {
  const total = c.total;
  const partes = c.por_plataforma.filter((p) => p.faturamento > 0);
  const pct = (x: number) => Math.round(x * 100);
  // Parcial: marca sem dado fica de fora da soma e o topo diz isso (nunca soma ausencia como 0).
  const comDado = marcas.filter((m) => m.total != null).length;
  const parcial = comDado < marcas.length;
  // Variacao so' sobre as marcas que tem base nos dois periodos: o mesmo conjunto nos dois lados.
  const comBase = marcas.filter((m) => m.total != null && m.total_anterior != null && m.total_anterior > 0);
  const v = variacaoPct(
    comBase.reduce((a, m) => a + (m.total ?? 0), 0),
    comBase.reduce((a, m) => a + (m.total_anterior ?? 0), 0) || null,
  );
  let inicio = 0;
  const folga = partes.length > 1 ? 1 : 0;
  const arcos = partes.map((p) => {
    const tam = total ? (p.faturamento / total) * 100 : 0;
    const arco = { ...p, tam: Math.max(tam - folga, 0), inicio };
    inicio += tam;
    return arco;
  });
  return (
    <section aria-label="Receita consolidada" className="rounded-xl border border-kpi-gmv/30 bg-surface">
      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(220px,1fr)_2fr] lg:items-center lg:gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Receita das marcas</p>
          <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums text-ink">{total == null ? "—" : fmtCompacto(total)}</p>
          {(v != null || parcial) && (
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted tabular-nums">
              {v != null && (
                <span>
                  <Variacao pct={v} /> vs período anterior
                </span>
              )}
              {parcial && <span className="font-semibold text-warn-ink">parcial ({comDado} de {marcas.length} marcas)</span>}
            </p>
          )}
        </div>
        {total != null && partes.length > 0 && (
          <div className="flex items-center gap-4 text-xs text-ink-muted tabular-nums">
            <svg
              viewBox="0 0 42 42"
              className="h-[84px] w-[84px] shrink-0 -rotate-90"
              role="img"
              aria-label={partes.map((p) => `${nomeDaPlataforma(p.plataforma)} ${pct(p.faturamento / total)}% da receita`).join("; ")}
            >
              <circle cx="21" cy="21" r="17" fill="none" className="stroke-raised" strokeWidth="4.5" />
              {arcos.map((a) => (
                <circle
                  key={a.plataforma}
                  cx="21"
                  cy="21"
                  r="17"
                  fill="none"
                  pathLength={100}
                  stroke={corDaPlataforma(a.plataforma)}
                  strokeWidth="4.5"
                  strokeDasharray={`${a.tam} ${100 - a.tam}`}
                  strokeDashoffset={-a.inicio}
                />
              ))}
            </svg>
            <ul className="flex min-w-0 flex-wrap gap-x-6 gap-y-2">
              {partes.map((p) => (
                <li key={p.plataforma} className="min-w-0 leading-snug">
                  <p>
                    <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: corDaPlataforma(p.plataforma) }} />
                    <span className="text-sm font-bold text-ink">{pct(p.faturamento / total)}%</span>{" "}
                    <span className="font-semibold text-ink">{nomeDaPlataforma(p.plataforma)}</span>
                  </p>
                  <p className="pl-3.5">{fmtCompacto(p.faturamento)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/** Bloco de marcas no padrão da Gerencial: linha por marca (barra por canal, total, variação) e a série diária. */
function Marcas({ marcas }: { marcas: MarcaMenor[] }) {
  const escala = Math.max(1, ...marcas.map((m) => m.total ?? 0));
  return (
    <section aria-labelledby="mm-marcas" className="rounded-xl border border-line bg-surface p-5">
      <h2 id="mm-marcas" className="mb-3 text-sm font-semibold text-ink">
        Marcas
      </h2>
      <ul className="flex flex-col">
        {marcas.map((m) => {
          const partes = fatias(m);
          const v = variacaoPct(m.total, m.total_anterior);
          return (
            <li key={m.id} className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 first:pt-0">
              <div className="grid min-h-11 grid-cols-[88px_1fr_auto] items-center gap-3">
                <span className="truncate text-sm font-semibold text-ink">{m.label}</span>
                {m.total == null ? (
                  <span className="text-xs text-ink-muted">Sem dado do Avoe no período.</span>
                ) : (
                  <span className="relative h-2.5 rounded-full bg-raised" aria-hidden="true">
                    <span className="absolute inset-y-0 left-0 flex overflow-hidden rounded-full" style={{ width: `${(m.total / escala) * 100}%` }}>
                      {partes.map((p) => (
                        <span key={p.plataforma} style={{ flex: p.frac, background: corDaPlataforma(p.plataforma) }} />
                      ))}
                    </span>
                  </span>
                )}
                <span className="flex flex-col items-end text-right tabular-nums">
                  <span className="text-sm font-semibold text-ink">{m.total == null ? "—" : fmtCompacto(m.total)}</span>
                  <span className="text-xs">
                    <Variacao pct={v} />
                  </span>
                </span>
              </div>
              {m.total != null && (
                <ul className="flex flex-wrap gap-x-4 gap-y-1 pl-1 text-xs text-ink-muted tabular-nums">
                  {m.por_plataforma.map((p, i) => (
                    <li key={p.plataforma} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: corDaPlataforma(p.plataforma) }} aria-hidden="true" />
                      <b className="font-semibold text-ink">{Math.round(partes[i].frac * 100)}%</b>
                      {nomeDaPlataforma(p.plataforma)}
                      <span>{fmtCompacto(p.faturamento)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {/* Um dia só: a barra repetiria a lista acima. */}
              {m.serie.length > 1 && <SerieDiaria marca={m} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const LINHAS_VISIVEIS = 10;

/** Produto, quantidade e receita: só Denavita no TikTok. O resto é "sem dado por produto", nunca 0. */
function Produtos({ r }: { r: ProdutosDenavitaTiktok | null | undefined }) {
  const [todos, setTodos] = useState(false);
  const linhas = r?.produtos ?? [];
  const visiveis = todos ? linhas : linhas.slice(0, LINHAS_VISIVEIS);
  return (
    <section aria-labelledby="mm-produtos" className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 id="mm-produtos" className="text-sm font-semibold text-ink">
          Produtos · Denavita no TikTok
        </h2>
        <InfoDica texto={FONTE_PRODUTOS} />
      </div>
      {r === undefined ? (
        <StateBlock tipo="carregando" titulo="Carregando os produtos" compacto />
      ) : r === null || !r.disponivel ? (
        <StateBlock tipo="indisponivel" titulo="Produtos indisponíveis" descricao={r?.motivo ?? undefined} compacto />
      ) : linhas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-sm text-ink-muted">Sem dado por produto no período.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-faint">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Produto</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-semibold">Qtd.</th>
                  <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Receita</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {visiveis.map((p) => (
                  <tr key={p.sku} className="border-t border-line">
                    <td className="max-w-[9rem] py-2 pr-3 text-ink sm:max-w-md" title={p.produto}><span className="line-clamp-2">{p.produto}</span></td>
                    <td className="px-3 py-2 text-right text-ink-muted">{p.quantidade == null ? "—" : fmtNumber(p.quantidade)}</td>
                    <td className="py-2 pl-3 text-right font-semibold text-ink">{p.receita == null ? "—" : fmtCompacto(p.receita)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {linhas.length > LINHAS_VISIVEIS && (
            <button
              type="button"
              onClick={() => setTodos((v) => !v)}
              className="mt-2 min-h-11 text-xs font-semibold text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {todos ? "Ver menos" : `Ver todos (${linhas.length})`}
            </button>
          )}
        </>
      )}
      <p className="mt-2 text-xs text-ink-muted">Demais marcas e canais: sem dado por produto.</p>
    </section>
  );
}
