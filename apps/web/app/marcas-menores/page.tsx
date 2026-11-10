"use client";

/**
 * Marcas menores (Denavita, Yenzah, Auá, By Samia) — fonte: API do Bling v3 (a
 * conta da Denavita ainda não foi autorizada: "aguardando", nunca 0). Só ML,
 * Shopee e TikTok. Fica SEPARADA: não entra no GMV total, na meta nem na rosca
 * da Gerencial, e não tem meta.
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
import { toISODate } from "@/lib/filters/presets";
import { fmtNumber, fmtPctBr } from "@/lib/formatters";
import {
  corDaPlataforma,
  fatias,
  nomeDaPlataforma,
  variacaoPct,
  type Consolidado,
  type MarcaMenor,
  type MarcasMenores,
  type ProdutosMarcas,
} from "@/lib/marcas-menores";
import { fmtCompacto } from "@/lib/metas";

const SerieDiaria = dynamic(() => import("./SerieDiaria"), { ssr: false, loading: () => <div className="h-36" aria-hidden="true" /> });

const FONTE =
  "Fonte: API do Bling (conta da Rituária), em tempo quase real: o dia de hoje conta. A marca vem do canal do pedido, só Shopee e TikTok; nenhuma tem Mercado Livre. Receita = total do pedido (produtos − descontos + frete), sem cancelados. A Denavita está em outra conta, ainda sem autorização. Estas marcas ficam fora do GMV total, da meta e da rosca da Gerencial e não têm meta.";
const FONTE_PRODUTOS =
  "Origem: itens dos pedidos do Bling. Quantidade e receita por produto (valor × quantidade − desconto do item), sem cancelados. A Denavita aguarda autorização da conta. Os itens são lidos pedido a pedido: a tabela pode vir parcial e se completa sozinha.";

export default function MarcasMenoresPage() {
  const [filters, setFilters] = useGlobalFilters({ defaultPreset: "7d", defaultCompare: false });
  const [dados, setDados] = useState<MarcasMenores | null>(null);
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [produtos, setProdutos] = useState<ProdutosMarcas | null | undefined>(undefined);
  const [desistiu, setDesistiu] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    setEstado("carregando");
    setProdutos(undefined);
    setDesistiu(false);
    fetchMarcasMenores(filters.dateFrom, filters.dateTo).then((d) => {
      if (!vivo) return;
      setDados(d);
      setEstado(d ? "ok" : "erro");
      // Bloco próprio, falha sozinho. Os itens são lidos pedido a pedido: enquanto vier parcial, consulta de novo.
      const p = d?.periodo;
      const busca = (n: number) =>
        fetchProdutosMarcasMenores(p?.inicio ?? filters.dateFrom, p?.fim ?? filters.dateTo).then((r) => {
          if (!vivo) return;
          // Falha passageira no meio da leitura: mantem a tabela parcial em vez de apagá-la.
          setProdutos((antes) => (r === null && antes ? antes : r));
          if (r?.disponivel && !r.completo) {
            if (n < 60) setTimeout(() => vivo && busca(n + 1), 2000);
            else setDesistiu(true);
          }
        });
      busca(0);
    });
    return () => {
      vivo = false;
    };
  }, [filters.dateFrom, filters.dateTo, recarga]);

  // O dia de hoje ainda está andando: comparar com o período anterior inteiro enganaria. Sem variação.
  const emAndamento = !!dados?.periodo && dados.periodo.fim >= toISODate(new Date());
  const periodo = dados?.periodo ? fmtPeriodo(dados.periodo.inicio, dados.periodo.fim) : fmtPeriodo(filters.dateFrom, filters.dateTo);
  return (
    <PageContainer>
      <PageHeader
        title="Marcas menores"
        icon={Layers}
        meta={
          <>
            <Chip>{periodo}</Chip>
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
          {dados.consolidado && <Topo c={dados.consolidado} marcas={dados.marcas} emAndamento={emAndamento} />}
          <Marcas marcas={dados.marcas} emAndamento={emAndamento} />
          <Produtos r={produtos} desistiu={desistiu} onTentar={() => setRecarga((n) => n + 1)} />
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
function Topo({ c, marcas, emAndamento }: { c: Consolidado; marcas: MarcaMenor[]; emAndamento: boolean }) {
  const total = c.total;
  const partes = c.por_plataforma.filter((p) => p.faturamento > 0);
  const pct = (x: number) => Math.round(x * 100);
  // Parcial: marca sem dado fica de fora da soma e o topo diz isso (nunca soma ausencia como 0).
  const comDado = marcas.filter((m) => m.total != null).length;
  const parcial = comDado < marcas.length;
  // Variacao so' sobre as marcas que tem base nos dois periodos: o mesmo conjunto nos dois lados.
  const comBase = marcas.filter((m) => m.total != null && m.total_anterior != null && m.total_anterior > 0);
  const v = emAndamento ? null : variacaoPct(
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
          {(v != null || parcial || emAndamento) && (
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted tabular-nums">
              {v != null && (
                <span>
                  <Variacao pct={v} /> vs período anterior
                </span>
              )}
              {emAndamento && <span>inclui hoje, dia em andamento</span>}
              {parcial && (
                <span className="font-semibold text-warn-ink">
                  parcial (sem {marcas.filter((m) => m.total == null).map((m) => m.label).join(", ")})
                </span>
              )}
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
function Marcas({ marcas, emAndamento }: { marcas: MarcaMenor[]; emAndamento: boolean }) {
  const escala = Math.max(1, ...marcas.map((m) => m.total ?? 0));
  return (
    <section aria-labelledby="mm-marcas" className="rounded-xl border border-line bg-surface p-5">
      <h2 id="mm-marcas" className="mb-3 text-sm font-semibold text-ink">
        Marcas
      </h2>
      <ul className="flex flex-col">
        {marcas.map((m) => {
          const partes = fatias(m);
          const v = emAndamento ? null : variacaoPct(m.total, m.total_anterior);
          return (
            <li key={m.id} className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 first:pt-0">
              <div className="grid min-h-11 grid-cols-[88px_1fr_auto] items-center gap-3">
                <span className="truncate text-sm font-semibold text-ink">{m.label}</span>
                {m.total == null ? (
                  <span className="text-xs text-ink-muted">
                    {m.status === "aguardando_autorizacao" ? "Aguardando autorização." : "Sem dado no período."}
                  </span>
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

/** Produto, quantidade e receita por marca (itens dos pedidos). Sem item = "sem dado", nunca 0. */
function Produtos({ r, desistiu, onTentar }: { r: ProdutosMarcas | null | undefined; desistiu: boolean; onTentar: () => void }) {
  return (
    <section aria-labelledby="mm-produtos" className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 id="mm-produtos" className="text-sm font-semibold text-ink">
          Produtos
        </h2>
        <InfoDica texto={FONTE_PRODUTOS} />
        {r?.disponivel && !r.completo && (
          <span className="flex items-center gap-2 text-xs font-semibold text-warn-ink">
            {desistiu ? "leitura parcial" : "lendo os itens"}: {r.pedidos_lidos} de {r.pedidos_total} pedidos
            {desistiu && (
              <button type="button" onClick={onTentar} className="min-h-11 rounded px-2 text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                Tentar de novo
              </button>
            )}
          </span>
        )}
      </div>
      {r === undefined ? (
        <StateBlock tipo="carregando" titulo="Carregando os produtos" compacto />
      ) : r === null || !r.disponivel ? (
        <StateBlock tipo="indisponivel" titulo="Produtos indisponíveis" descricao={r?.motivo ?? undefined} compacto />
      ) : (
        <ul className="flex flex-col gap-4">
          {r.marcas.filter((m) => m.status !== "aguardando_autorizacao").map((m) => (
            <li key={m.id}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">{m.label}</h3>
              <TabelaProdutos m={m} lendo={!r.completo && !desistiu} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TabelaProdutos({ m, lendo }: { m: ProdutosMarcas["marcas"][number]; lendo: boolean }) {
  const [todos, setTodos] = useState(false);
  const linhas = m.produtos;
  const visiveis = todos ? linhas : linhas.slice(0, LINHAS_VISIVEIS);
  if (linhas.length === 0) {
    return <p className="text-sm text-ink-muted">{lendo ? "Lendo os itens…" : "Sem dado por produto no período."}</p>;
  }
  return (
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
          className="mt-1 min-h-11 text-xs font-semibold text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {todos ? "Ver menos" : `Ver todos (${linhas.length})`}
        </button>
      )}
    </>
  );
}
