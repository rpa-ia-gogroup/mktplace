"use client";

/**
 * FULL-UNIFICADO-1 — "Visão geral" do Full, no esqueleto da Gerencial
 * (IDENTIDADE-GERENCIAL): herói (% sem estoque, um canal por linha com a
 * foto) → faixa de KPIs (impacto potencial por canal com drilldown por
 * marca; quem para a venda na Shopee) → o que exige atenção agora → ruptura
 * por marca → mais detalhes (recolhido). Sem bloco de evolução: o Full não
 * tem série. Cada célula: 1 número + no máximo 1 secundário; o resto
 * (denominador, SKU, R$ bruto) em title + sr-only.
 *
 * Usa as duas rotas de estoque que ja' existem; as regras moram em
 * `src/lib/full-visao-geral.ts`. Ausencia nunca vira zero: canal fora,
 * marca sem foto ou lista truncada aparecem como "—" com o motivo.
 */

import Link from "next/link";
import { PackageX, TrendingDown, Warehouse } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import Chip from "@/components/ui/Chip";
import Heroi from "@/components/ui/Heroi";
import InfoDica from "@/components/ui/InfoDica";
import KpiTile from "@/components/ui/KpiTile";
import MaisDetalhes from "@/components/ui/MaisDetalhes";
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
  canaisMisturados,
  colunasMarca,
  descricaoTop,
  dicaImpacto,
  fracao,
  subtituloRuptura,
  impactosOk,
  heroiRuptura,
  impactoPorMarca,
  kpiImpacto,
  kpiParamVenda,
  pctDestaque,
  perdaDestaque,
  mediana,
  oks,
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

/** Um numero na vista; o detalhe (denominador, SKU, R$ bruto) vai para title + sr-only, nao so' hover. */
function Escondido({ texto, detalhe, className }: { texto: string; detalhe?: string | null; className?: string }) {
  return (
    <span title={detalhe ?? undefined} className={className}>
      {texto}{detalhe && <span className="sr-only"> ({detalhe})</span>}
    </span>
  );
}

/** So' o %; "x de y" no title + sr-only. */
function Fracao({ parte, base, motivo }: { parte: number | null; base: number | null; motivo?: string }) {
  const f = fracao(parte, base);
  if (!f) return <Ausente motivo={motivo ?? (base === 0 ? "sem itens no Full" : undefined)} />;
  return <Escondido texto={f.texto} detalhe={f.detalhe} className="font-semibold text-ink" />;
}

/** Segunda linha da celula de marca: so' o R$/dia; % do Full da marca e "sem preço" no title + sr-only. */
function ImpactoMarca({ canal, m, vendedorTemEstoque }: { canal: Canal; vendedorTemEstoque: boolean; m: { perda_dia: number | null; perda_dia_sem_vendedor: number | null; pct_gmv_full: number | null; pct_gmv_full_sem_vendedor: number | null; sem_preco: number } }) {
  // R$ 0 porque o vendedor cobre as rupturas: diz o porque, nao "R$ 0/dia".
  if (vendedorTemEstoque) {
    return <Escondido texto="vendedor tem estoque" detalhe={`${fmtReais(m.perda_dia)}/dia potencial no Full, sem contar o estoque do vendedor`} className="block text-xs text-ink-muted" />;
  }
  const v = perdaDestaque(canal, m);
  if (v === null) return <span className="block text-xs text-ink-muted"><Ausente motivo="sem preço" /></span>;
  const p = pctDestaque(canal, m);
  const detalhe = [p !== null ? `${fmtPct(p)} do Full da marca` : null, m.sem_preco > 0 ? `${fmtInt(m.sem_preco)} sem preço` : null].filter(Boolean).join(" · ");
  return <Escondido texto={`${fmtReais(v)}/dia`} detalhe={detalhe || null} className="block whitespace-nowrap text-xs text-ink-muted" />;
}

/** Linha de um canal no herói: % sem estoque + foto (e o aviso do canal, quando houver). */
function LinhaCanal({ c }: { c: ResumoOk }) {
  const nome = NOME_CANAL[c.canal];
  const f = fracao(c.ruptura, c.base);
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-ink">
          {c.ruptura === 0 ? `${nome}: nenhum produto sem estoque` : (
            <>{nome}: {f ? <Escondido texto={f.texto} detalhe={f.detalhe} /> : <Ausente />} sem estoque</>
          )}
        </span>
        <ChipFoto c={c} />
      </p>
      {c.aviso && <p className="text-xs text-warn-ink">{c.aviso}</p>}
    </>
  );
}

/** Frescor da foto do canal: desatualizada escreve a palavra, nao so' a cor; o frescor completo no title. */
function ChipFoto({ c }: { c: ResumoOk }) {
  return <Chip tom={c.frescorVelho ? "atencao" : "neutro"} ponto={c.frescorVelho} title={c.frescor}>{seloFrescor(c)}</Chip>;
}

/** Drilldown do cartao de impacto: marca | % do Full da marca | R$/dia potencial + o ⓘ do canal no rodape. */
function DetalheImpacto({ canal, impacto }: { canal: Canal; impacto: ImpactoRuptura | null }) {
  const linhas = impactoPorMarca(canal, impacto);
  return (
    <div className="flex flex-col gap-3 text-sm">
      {linhas === null ? (
        <p className="text-ink-muted">Impacto potencial indisponível agora.</p>
      ) : (
        <table className="w-full">
          <caption className="sr-only">Impacto potencial por marca no {NOME_CANAL[canal]}, da maior perda para a menor</caption>
          <thead className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            <tr>
              <th scope="col" className="py-2 pr-2 text-left">Marca</th>
              <th scope="col" className="px-2 py-2 text-right">% do Full da marca</th>
              <th scope="col" className="py-2 pl-2 text-right">R$/dia potencial</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {linhas.map((l) => (
              <tr key={l.marca}>
                <th scope="row" className="py-2 pr-2 text-left font-medium text-ink">{tituloMarca(l.marca)}</th>
                <td className="px-2 py-2 text-right tabular-nums">{l.vendedorTemEstoque ? "—" : l.pct === null ? <Ausente motivo="faturamento Full de 28 dias incompleto" /> : fmtPct(l.pct)}</td>
                <td className="py-2 pl-2 text-right tabular-nums">
                  {l.vendedorTemEstoque ? <span className="text-xs text-ink-muted">vendedor tem estoque</span>
                    : l.perda === null ? <Ausente motivo="sem preço" /> : `${fmtReais(l.perda)}/dia`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="border-t border-line pt-3 text-xs leading-snug text-ink-muted">
        {dicaImpacto(canal, impacto)} {canal === "ml" ? NOTA_IMPACTO : NOTA_VENDEDOR}
      </p>
    </div>
  );
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
  // Um so' dialogo na pagina para os drilldowns (identidade Gerencial).
  const [drill, setDrill] = useState<Canal | null>(null);
  const ok = oks(canais);
  const heroi = heroiRuptura(canais);
  const shopee = canais.find((c) => c.canal === "shopee");
  const semVendedor = shopee?.status === "ok" ? shopee.semVendedor : null;
  const tot = total(canais);
  const marcas = rupturaPorMarca(canais, impacto);
  const pior = marcas[0]?.maiorPerda || marcas[0]?.taxa ? marcas[0] : null;
  const top = topRupturas(canais, 10, impacto);
  const comImpacto = impactosOk(impacto).length > 0;
  const mistos = canaisMisturados(top);
  const colunas = colunasMarca(canais, marcas);
  const algumaIncompleta = ok.some((c) => !c.rupturasCompletas);
  const falhou = canais.some((c) => c.status === "erro");

  if (!ok.length || !heroi) {
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
      {/* 1. Heroi: o % sem estoque; o meio quebra por canal com a foto de cada um */}
      <Heroi
        rotulo="Sem estoque no Full com demanda"
        ajuda={<InfoDica texto={DICA_RUPTURA} nota={NOTA_VENDEDOR} />}
        valor={heroi.valor}
        tom={heroi.critico ? "critico" : "neutro"}
        contexto={<Escondido texto={heroi.contexto} detalhe={heroi.detalhe} />}
        meio={
          <ul className="grid grid-cols-1 gap-2">
            {canais.map((c) => (
              <li key={c.canal} className="flex flex-col gap-1">
                {c.status === "ok" ? <LinhaCanal c={c} /> : (
                  <>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-ink">
                      {NOME_CANAL[c.canal]}: <Chip tom="ausente">sem dado agora</Chip>
                    </p>
                    {c.motivo && <p className="text-xs text-ink-muted">{c.motivo}</p>}
                    {c.status === "erro" && <div><RetryButton onClick={recarregar} /></div>}
                  </>
                )}
              </li>
            ))}
          </ul>
        }
      />

      {/* 2. Faixa de KPIs: quanto custa (por canal, R$ nunca somado) e quem para a venda */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CANAIS.map((canal) => {
          const k = kpiImpacto(canal, impacto, canal === "shopee" ? semVendedor : null);
          return (
            <KpiTile
              key={canal}
              variante="gerencial"
              icone={TrendingDown}
              rotulo={`Impacto potencial · ${NOME_CANAL[canal]}`}
              ajuda={<InfoDica emControle texto={dicaImpacto(canal, impacto)} />}
              valor={k.valor}
              comparacao={k.comparacao}
              onAbrir={() => setDrill(canal)}
            />
          );
        })}
        {(() => {
          const k = kpiParamVenda(shopee);
          return (
            <KpiTile
              variante="gerencial"
              icone={PackageX}
              rotulo="Param a venda · Shopee"
              ajuda={<InfoDica texto={NOTA_VENDEDOR} />}
              valor={<Escondido texto={k.valor} detalhe={k.detalhe} />}
              comparacao={k.comparacao}
            />
          );
        })()}
      </div>
      <KpiDrilldownDialog
        open={drill !== null}
        onClose={() => setDrill(null)}
        title={`Impacto potencial por marca · ${drill ? NOME_CANAL[drill] : ""}`}
      >
        {drill && <DetalheImpacto canal={drill} impacto={impacto} />}
      </KpiDrilldownDialog>

      {/* 3. O que exige atencao agora: 2 colunas (marca, canal e venda na linha 2 do produto) */}
      <Panel
        titulo="O que exige atenção agora"
        descricao={descricaoTop(top, comImpacto, algumaIncompleta)}
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
          <table className="w-full text-sm">
            <caption className="sr-only">Rupturas no Full ordenadas por {comImpacto ? "impacto potencial em R$ por dia" : "venda média diária"}</caption>
            <thead className="bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
              <tr>
                <th scope="col" className="px-3 py-2 sm:px-4 text-left">Produto</th>
                <th scope="col" className="px-3 py-2 sm:px-4 text-right">{comImpacto ? "Impacto potencial/dia" : "Venda/dia"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {top.map((t, i) => (
                <tr key={`${t.canal}-${i}`}>
                  <th scope="row" className="px-3 py-2 sm:px-4 text-left font-normal">
                    <span className="line-clamp-2 font-medium text-ink" title={t.sku ? `${t.nome} · código ${t.sku}` : t.nome}>
                      {t.nome}{t.sku && <span className="sr-only"> (código {t.sku})</span>}
                    </span>
                    <span className="block text-xs text-ink-muted">{subtituloRuptura(t, { mostrarCanal: mistos, comImpacto })}</span>
                  </th>
                  <td className="whitespace-nowrap px-3 py-2 sm:px-4 text-right align-top font-semibold tabular-nums text-ink">
                    {!comImpacto ? `${fmtDecimal(t.mediaDiaria)} un.`
                      : t.perdaDia === undefined ? <Ausente motivo="impacto do canal indisponível" />
                      : t.perdaDia === null ? <Ausente motivo={t.canal === "shopee" && t.estoqueVendedor === null ? "estoque do vendedor não informado" : "sem preço"} />
                      : t.canal === "shopee" && (t.estoqueVendedor ?? 0) > 0 ? (
                        <Escondido
                          texto="vendedor tem estoque"
                          detalhe={`${fmtReais(t.perdaBruta)}/dia potencial no Full · ${fmtInt(t.estoqueVendedor ?? 0)} no estoque do vendedor`}
                          className="rounded-md bg-raised px-1.5 py-0.5 text-xs font-medium text-ink-muted ring-1 ring-inset ring-line"
                        />
                      ) : fmtReais(t.perdaDia)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* 4. Onde: ruptura por marca, so' os canais medidos (sem coluna Total: vai no title da marca) */}
      <Panel
        titulo="Ruptura por marca"
        descricao={marcas.some((l) => l.maiorPerda !== null)
          ? "% sem estoque e impacto potencial por dia, do maior impacto para o menor. R$ não é somado entre canais."
          : "% sem estoque, da maior taxa para a menor."}
        semPadding
      >
        <table className="w-full text-sm">
          <caption className="sr-only">Percentual sem estoque e impacto potencial por marca e canal</caption>
          <thead className="bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
            <tr>
              <th scope="col" className="px-3 py-2 sm:px-4 text-left">Marca</th>
              {colunas.map((c) => <th key={c} scope="col" className="px-3 py-2 sm:px-4 text-right">{NOME_CANAL[c]}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {marcas.map((l) => {
              const ehPior = l === pior;
              const ft = colunas.length > 1 && colunas.every((c) => l.celulas[c]?.ruptura != null) ? fracao(l.ruptura, l.base) : null;
              return (
                <tr key={l.marca} className={ehPior ? "bg-crit-soft" : undefined}>
                  <th scope="row" className="px-3 py-2 sm:px-4 text-left font-medium text-ink">
                    <Escondido texto={tituloMarca(l.marca)} detalhe={ft ? `Total: ${ft.texto} (${ft.detalhe})` : null} />
                    {ehPior && <span className="ml-2 text-xs font-semibold text-crit-ink">{l.maiorPerda !== null ? "maior impacto" : "pior"}</span>}
                  </th>
                  {colunas.map((canal) => {
                    const cel: MarcaCanal | undefined = l.celulas[canal];
                    return (
                      <td key={canal} className="px-3 py-2 sm:px-4 text-right tabular-nums">
                        {cel ? <Fracao parte={cel.ruptura} base={cel.base} motivo={cel.motivo} /> : <Ausente motivo="marca fora deste canal" />}
                        {cel && l.impacto[canal] && <ImpactoMarca canal={canal} m={l.impacto[canal]!} vendedorTemEstoque={canal === "shopee" && l.vendedorTemEstoque} />}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {/* 5. Mais detalhes (fechado): o denominador continua visivel em "Itens no Full" */}
      <MaisDetalhes resumo="estoque baixo, excesso, itens no Full e cobertura">
        <div className="-m-4">
        <table className="w-full text-sm">
          <caption className="sr-only">Outros indicadores do estoque Full por canal</caption>
          <thead className="bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
            <tr>
              <th scope="col" className="px-3 py-2 sm:px-4 text-left">Indicador</th>
              <th scope="col" className="px-3 py-2 sm:px-4 text-right">ML</th>
              <th scope="col" className="px-3 py-2 sm:px-4 text-right">Shopee</th>
              <th scope="col" className="px-3 py-2 sm:px-4 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {([
              ["Estoque baixo", "baixo"],
              ["Excesso", "excesso"],
            ] as const).map(([rotulo, k]) => (
              <tr key={k}>
                <th scope="row" className="px-3 py-2 sm:px-4 text-left font-medium text-ink">{rotulo}</th>
                {[...canais.map((c) => (c.status === "ok" ? c : null)), tot].map((d, i) => (
                  <td key={i} className="px-3 py-2 sm:px-4 text-right tabular-nums">
                    {d ? <Fracao parte={d[k]} base={d.base} /> : <Ausente motivo={i < 2 ? (canais[i] as { motivo?: string }).motivo : "falta um canal"} />}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-3 py-2 sm:px-4 text-left font-medium text-ink">
                <span className="inline-flex items-center gap-1.5">Itens no Full <InfoDica texto="ML: inventários Full lidos. Shopee: itens sem os kits não conciliados." /></span>
              </th>
              {[...canais.map((c) => (c.status === "ok" ? c : null)), tot].map((d, i) => (
                <td key={i} className="px-3 py-2 sm:px-4 text-right tabular-nums">{d ? fmtInt(d.base) : <Ausente />}</td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="px-3 py-2 sm:px-4 text-left font-medium text-ink">
                <span className="inline-flex items-center gap-1.5">Cobertura mediana <InfoDica texto={DICA_COBERTURA} /></span>
              </th>
              {[...canais.map((c) => (c.status === "ok" ? c : null)), tot].map((d, i) => {
                const v = d ? mediana(d.coberturas) : null;
                return (
                  <td key={i} className="px-3 py-2 sm:px-4 text-right tabular-nums">
                    {v === null ? <Ausente motivo={d && !d.coberturas ? "a API devolveu a lista truncada" : undefined} /> : `${fmtDecimal(v)} dias`}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
        </div>
      </MaisDetalhes>
    </>
  );
}
