"use client";

/**
 * FULL-UNIFICADO-1 — "Visão geral" do Full, em ordem piramidal:
 * titulo (% sem estoque) → uma linha por canal (ruptura, foto, impacto
 * potencial; ressalvas no ⓘ) → outros indicadores → ruptura por marca →
 * rupturas mais urgentes → frescor de cada fonte.
 *
 * Usa as duas rotas de estoque que ja' existem; as regras moram em
 * `src/lib/full-visao-geral.ts`. Ausencia nunca vira zero: canal fora,
 * marca sem foto ou lista truncada aparecem como "—" com o motivo.
 */

import Link from "next/link";
import { Warehouse } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import Chip from "@/components/ui/Chip";
import InfoDica from "@/components/ui/InfoDica";
import Panel from "@/components/ui/Panel";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import { fetchEstoqueFull, fetchImpactoRuptura, fetchMLFullEstoque } from "@/lib/api-client";
import { fmtDecimal, fmtInt } from "@/lib/estoque-full";
import { hrefAba } from "@/lib/full-abas";
import {
  NOME_CANAL,
  QUERY_ML,
  QUERY_SHOPEE,
  fmtPct,
  fmtReais,
  dicaImpacto,
  impactosOk,
  linhaImpacto,
  manchete,
  pctDestaque,
  perdaDestaque,
  mediana,
  oks,
  pct,
  resumoML,
  resumoShopee,
  rupturaPorMarca,
  seloFrescor,
  topRupturas,
  total,
  type Canal,
  type MarcaCanal,
  type ImpactoRuptura,
  type ResumoCanal,
  type ResumoOk,
} from "@/lib/full-visao-geral";
import { tituloMarca, validarPayloadML } from "@/lib/ml-full-estoque";

const DICA_RUPTURA =
  "Sem estoque no Full com demanda: venda nos últimos 28 dias e saldo Full disponível igual a 0. " +
  "Grão: no ML conta inventário (vários anúncios podem dividir um inventário); na Shopee conta item. " +
  "Fora do total: kits da Shopee (não conciliados), a Kokeshi na Shopee (sem conta na esteira de estoque) e a Ápice no ML.";
const NOTA_VENDEDOR =
  "Ruptura no Full não quer dizer venda parada: na Shopee o vendedor pode ter estoque próprio e seguir vendendo fora do Full.";
const NOTA_IMPACTO =
  "No ML, anúncios do mesmo inventário fora do Full podem seguir vendendo. Item sem preço fica fora da soma.";
const DICA_COBERTURA =
  "Mediana da cobertura em dias dos itens com venda nos 28 dias, como a API calcula item a item. Itens sem venda ficam fora.";

const CANAIS: Canal[] = ["ml", "shopee"];

function motivoErro(e: unknown): string {
  return e instanceof Error ? e.message : "Falha ao carregar.";
}

/** "—" com o motivo legivel por leitor de tela e no hover. */
function Ausente({ motivo }: { motivo?: string }) {
  return (
    <span title={motivo}>
      —{motivo && <span className="sr-only"> ({motivo})</span>}
    </span>
  );
}

function Fracao({ parte, base, motivo }: { parte: number | null; base: number | null; motivo?: string }) {
  const v = pct(parte, base);
  if (v === null || parte === null || base === null) return <Ausente motivo={motivo ?? (base === 0 ? "sem itens no Full" : undefined)} />;
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold text-ink">{fmtPct(v)}</span>{" "}
      <span className="text-xs text-ink-faint">{fmtInt(parte)} de {fmtInt(base)}</span>
    </span>
  );
}

/** Segunda linha da celula de marca: R$/dia e % do Full da marca naquele canal. */
function ImpactoMarca({ canal, m, vendedorTemEstoque }: { canal: Canal; vendedorTemEstoque: boolean; m: { perda_dia: number | null; perda_dia_sem_vendedor: number | null; pct_gmv_full: number | null; pct_gmv_full_sem_vendedor: number | null; sem_preco: number } }) {
  const v = perdaDestaque(canal, m);
  const p = pctDestaque(canal, m);
  // R$ 0 porque o vendedor cobre as rupturas: diz o porque, nao "R$ 0/dia · 0,0%".
  if (vendedorTemEstoque) {
    return <span className="block text-xs text-ink-muted" title={`${fmtReais(m.perda_dia)}/dia no Full, sem contar o estoque do vendedor`}>vendedor tem estoque</span>;
  }
  return (
    <span className="block text-xs text-ink-muted">
      {v === null ? <Ausente motivo="sem preço" /> : `${fmtReais(v)}/dia`}
      {p !== null && ` · ${fmtPct(p)} do Full`}
      {m.sem_preco > 0 && ` · ${fmtInt(m.sem_preco)} sem preço`}
    </span>
  );
}

/** Linha de um canal medido no topo: ruptura + foto, (Shopee) vendedor, impacto potencial. */
function LinhaCanal({ c, impacto }: { c: ResumoOk; impacto: ImpactoRuptura | null }) {
  const nome = NOME_CANAL[c.canal];
  if (c.ruptura === 0) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-ink">
        {nome}: nenhum produto sem estoque <ChipFoto c={c} />
      </p>
    );
  }
  const li = linhaImpacto(c.canal, impacto, c.canal === "shopee" ? c.semVendedor : null);
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-ink">
          {nome}: {fmtPct(pct(c.ruptura, c.base))} sem estoque
          <span className="font-normal text-ink-faint"> ({fmtInt(c.ruptura)} de {fmtInt(c.base)})</span>
        </span>
        <ChipFoto c={c} />
      </p>
      {c.canal === "shopee" && (
        <p className="text-sm text-ink-muted">
          {c.semVendedor === null ? (
            <>Estoque do vendedor: <Ausente motivo="lista de rupturas incompleta" /></>
          ) : c.semVendedor === 0 ? (
            "Todas têm estoque do vendedor: a venda segue fora do Full"
          ) : (
            <><strong className="font-semibold text-ink">{fmtPct(pct(c.semVendedor, c.ruptura))} ({fmtInt(c.semVendedor)})</strong> também sem estoque do vendedor: {c.semVendedor === 1 ? "esse para" : "esses param"} a venda</>
          )}
        </p>
      )}
      {/* ⓘ no fluxo do texto: quebra junto da ultima palavra, nao sozinho */}
      <p className="text-sm text-ink-muted">
        {li.rotulo}: {li.valor === null ? <Ausente motivo="sem preço" /> : li.valor}{" "}
        <InfoDica texto={dicaImpacto(c.canal, impacto)} nota={c.canal === "ml" ? NOTA_IMPACTO : NOTA_VENDEDOR} className="align-middle" />
      </p>
    </>
  );
}

/** Frescor da foto do canal: desatualizada escreve a palavra, nao so' a cor. */
function ChipFoto({ c }: { c: ResumoOk }) {
  return <Chip tom={c.frescorVelho ? "atencao" : "neutro"} ponto={c.frescorVelho} title={c.frescor}>{seloFrescor(c)}</Chip>;
}

export default function VisaoGeralFull() {
  const [canais, setCanais] = useState<ResumoCanal[] | null>(null);
  // `null` = impacto nao carregou: a tela segue sem R$, nunca com R$ 0.
  const [impacto, setImpacto] = useState<ImpactoRuptura | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setCanais(null);
    setImpacto(null);
    Promise.allSettled([
      fetchMLFullEstoque(QUERY_ML, ctrl.signal).then((r) => resumoML(validarPayloadML(r))),
      fetchEstoqueFull(QUERY_SHOPEE, ctrl.signal).then(resumoShopee),
      fetchImpactoRuptura(ctrl.signal),
    ]).then(([ml, shopee, imp]) => {
      if (ctrl.signal.aborted) return;
      setCanais([ml, shopee].map((r, i) =>
        r.status === "fulfilled" ? r.value : { canal: CANAIS[i], status: "erro" as const, motivo: motivoErro(r.reason) }));
      setImpacto(imp.status === "fulfilled" ? imp.value : null);
    });
    return () => ctrl.abort();
  }, [tentativa]);

  return (
    <PageContainer>
      <PageHeader title="Visão geral do Full" icon={Warehouse} />
      {canais === null ? (
        <StateBlock tipo="carregando" titulo="Carregando o estoque Full do ML e da Shopee" />
      ) : (
        <Conteudo canais={canais} impacto={impacto} recarregar={recarregar} />
      )}
    </PageContainer>
  );
}

function Conteudo({ canais, impacto, recarregar }: { canais: ResumoCanal[]; impacto: ImpactoRuptura | null; recarregar: () => void }) {
  const ok = oks(canais);
  const m = manchete(canais);
  const tot = total(canais);
  const marcas = rupturaPorMarca(canais, impacto);
  const pior = marcas[0]?.maiorPerda || marcas[0]?.taxa ? marcas[0] : null;
  const top = topRupturas(canais, 10, impacto);
  const imp = impactosOk(impacto);
  const algumaIncompleta = ok.some((c) => !c.rupturasCompletas);
  const falhou = canais.some((c) => c.status === "erro");

  if (!ok.length) {
    return (
      <StateBlock
        tipo={falhou ? "erro" : "indisponivel"}
        titulo="Estoque Full sem dado agora"
        descricao={canais.map((c) => `${NOME_CANAL[c.canal]}: ${c.status === "ok" ? "" : c.motivo}`).join(" · ")}
        acao={falhou ? <RetryButton onClick={recarregar} /> : undefined}
      />
    );
  }

  return (
    <>
      {/* a. Titulo + uma linha por canal (ressalvas tecnicas no ⓘ de cada canal) */}
      <section aria-labelledby="full-manchete" className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3.5">
        <div className="flex items-start gap-2">
          <h3 id="full-manchete" className={`text-xl font-bold leading-snug ${m.critico ? "text-crit-ink" : "text-ink"}`}>{m.texto}</h3>
          <InfoDica texto={DICA_RUPTURA} nota={NOTA_VENDEDOR} className="mt-1" />
        </div>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {canais.map((c) => (
            <li key={c.canal} className="flex flex-col gap-1">
              {c.status === "ok" ? <LinhaCanal c={c} impacto={impacto} /> : (
                <>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-ink">
                    {NOME_CANAL[c.canal]}: <Chip tom="ausente">sem dado agora</Chip>
                  </p>
                  {c.motivo && <p className="text-xs text-ink-muted">{c.motivo}</p>}
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Panel titulo="Outros indicadores por canal" semPadding>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="sr-only">Indicadores do estoque Full por canal</caption>
            <thead className="bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
              <tr>
                <th scope="col" className="px-4 py-2 text-left">Indicador</th>
                <th scope="col" className="px-4 py-2 text-right">ML</th>
                <th scope="col" className="px-4 py-2 text-right">Shopee</th>
                <th scope="col" className="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {([
                ["Estoque baixo", "baixo"],
                ["Excesso", "excesso"],
              ] as const).map(([rotulo, k]) => (
                <tr key={k}>
                  <th scope="row" className="px-4 py-2 text-left font-medium text-ink">{rotulo}</th>
                  {[...canais.map((c) => (c.status === "ok" ? c : null)), tot].map((d, i) => (
                    <td key={i} className="px-4 py-2 text-right tabular-nums">
                      {d ? <Fracao parte={d[k]} base={d.base} /> : <Ausente motivo={i < 2 ? (canais[i] as { motivo?: string }).motivo : "falta um canal"} />}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="px-4 py-2 text-left font-medium text-ink">
                  <span className="inline-flex items-center gap-1.5">Itens no Full <InfoDica texto="ML: inventários Full lidos. Shopee: itens sem os kits não conciliados." /></span>
                </th>
                {[...canais.map((c) => (c.status === "ok" ? c : null)), tot].map((d, i) => (
                  <td key={i} className="px-4 py-2 text-right tabular-nums">{d ? fmtInt(d.base) : <Ausente />}</td>
                ))}
              </tr>
              <tr>
                <th scope="row" className="px-4 py-2 text-left font-medium text-ink">
                  <span className="inline-flex items-center gap-1.5">Cobertura mediana <InfoDica texto={DICA_COBERTURA} /></span>
                </th>
                {[...canais.map((c) => (c.status === "ok" ? c : null)), tot].map((d, i) => {
                  const v = d ? mediana(d.coberturas) : null;
                  return (
                    <td key={i} className="px-4 py-2 text-right tabular-nums">
                      {v === null ? <Ausente motivo={d && !d.coberturas ? "a API devolveu a lista truncada" : undefined} /> : `${fmtDecimal(v)} dias`}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      {/* c. Ruptura por marca */}
      <Panel
        titulo="Ruptura por marca"
        descricao={marcas.some((l) => l.maiorPerda !== null)
          ? "Da maior para a menor perda potencial por dia. R$ não é somado entre canais."
          : "Da maior para a menor taxa de ruptura."}
        semPadding
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <caption className="sr-only">Percentual de itens em ruptura e impacto potencial por marca e canal, da maior perda para a menor</caption>
            <thead className="bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
              <tr>
                <th scope="col" className="px-4 py-2 text-left">Marca</th>
                <th scope="col" className="px-4 py-2 text-right">ML</th>
                <th scope="col" className="px-4 py-2 text-right">Shopee</th>
                <th scope="col" className="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {marcas.map((l) => {
                const ehPior = l === pior;
                return (
                  <tr key={l.marca} className={ehPior ? "bg-crit-soft" : undefined}>
                    <th scope="row" className="px-4 py-2 text-left font-medium text-ink">
                      {tituloMarca(l.marca)}
                      {ehPior && <span className="ml-2 text-xs font-semibold text-crit-ink">{l.maiorPerda !== null ? "maior impacto" : "pior"}</span>}
                    </th>
                    {CANAIS.map((canal) => {
                      const cel: MarcaCanal | undefined = l.celulas[canal];
                      const fora = canais.find((c) => c.canal === canal)?.status !== "ok";
                      return (
                        <td key={canal} className="px-4 py-2 text-right tabular-nums">
                          {cel ? <Fracao parte={cel.ruptura} base={cel.base} motivo={cel.motivo} /> : <Ausente motivo={fora ? "canal sem dado agora" : "marca fora deste canal"} />}
                          {cel && l.impacto[canal] && <ImpactoMarca canal={canal} m={l.impacto[canal]!} vendedorTemEstoque={canal === "shopee" && l.vendedorTemEstoque} />}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-right tabular-nums"><Fracao parte={l.ruptura} base={l.base} motivo="sem medição" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* d. Rupturas mais urgentes */}
      <Panel
        titulo="Rupturas mais urgentes"
        descricao={`Top ${top.length} por ${imp.length ? "impacto potencial R$/dia" : "venda média diária (28 dias)"}${algumaIncompleta ? " · lista incompleta" : ""}`}
        acao={
          <span className="flex flex-wrap gap-3 text-sm">
            {ok.map((c) => (
              <Link key={c.canal} href={hrefAba(c.canal === "ml" ? "estoque-ml" : "estoque-shopee")} className="inline-flex min-h-11 items-center font-medium text-accent hover:underline">
                Estoque {NOME_CANAL[c.canal]} →
              </Link>
            ))}
          </span>
        }
        semPadding
      >
        {top.length === 0 ? (
          <StateBlock tipo="vazio" titulo="Nenhuma ruptura no Full" compacto />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Rupturas no Full ordenadas por {imp.length ? "impacto potencial em R$ por dia" : "venda média diária"}</caption>
              <thead className="bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left">Produto</th>
                  <th scope="col" className="px-4 py-2 text-left">Marca</th>
                  <th scope="col" className="px-4 py-2 text-left">Canal</th>
                  <th scope="col" className="px-4 py-2 text-right">Impacto potencial/dia</th>
                  <th scope="col" className="px-4 py-2 text-right">Venda/dia</th>
                  <th scope="col" className="px-4 py-2 text-right">Estoque do vendedor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {top.map((t, i) => (
                  <tr key={`${t.canal}-${i}`}>
                    <th scope="row" className="max-w-[280px] truncate px-4 py-2 text-left font-medium text-ink" title={t.nome}>{t.nome}</th>
                    <td className="px-4 py-2 text-ink-muted">{tituloMarca(t.marca)}</td>
                    <td className="px-4 py-2 text-ink-muted">{NOME_CANAL[t.canal]}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-ink">
                      {t.perdaDia === undefined ? <Ausente motivo="impacto do canal indisponível" />
                        : t.perdaDia === null ? <Ausente motivo={t.canal === "shopee" && t.estoqueVendedor === null ? "estoque do vendedor não informado" : "sem preço"} />
                        : t.canal === "shopee" && (t.estoqueVendedor ?? 0) > 0 ? (
                          <span className="flex flex-col items-end font-normal">
                            <span className="rounded-md bg-raised px-1.5 py-0.5 text-xs font-medium text-ink-muted ring-1 ring-inset ring-line">vendedor tem estoque</span>
                            <span className="text-xs text-ink-faint">{fmtReais(t.perdaBruta)} no Full</span>
                          </span>
                        ) : fmtReais(t.perdaDia)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtDecimal(t.mediaDiaria)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {t.estoqueVendedor === undefined ? <Ausente motivo="não se aplica ao ML" />
                        : t.estoqueVendedor === null ? <Ausente motivo="a API não informou" />
                        : fmtInt(t.estoqueVendedor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* e. Frescor de cada fonte */}
      <footer className="flex flex-col gap-1 px-1 text-xs text-ink-muted">
        {canais.map((c) => (
          <p key={c.canal}>
            <span className="font-semibold">Estoque Full {NOME_CANAL[c.canal]}:</span>{" "}
            {c.status === "ok" ? c.frescor : `sem dado (${c.motivo})`}
            {c.status === "ok" && c.aviso ? ` · ${c.aviso}` : ""}
          </p>
        ))}
        {falhou && <div><RetryButton onClick={recarregar} /></div>}
      </footer>
    </>
  );
}
