"use client";

/**
 * FULL-UNIFICADO-1 — "Visão geral" do Full, em ordem piramidal:
 * manchete (com o frescor de cada foto colado nela) → ruptura por canal →
 * demais indicadores lado a lado → ruptura por marca → rupturas mais urgentes
 * → frescor de cada fonte.
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
import KpiTile from "@/components/ui/KpiTile";
import Panel from "@/components/ui/Panel";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import { fetchEstoqueFull, fetchMLFullEstoque } from "@/lib/api-client";
import { fmtDecimal, fmtInt } from "@/lib/estoque-full";
import { hrefAba } from "@/lib/full-abas";
import {
  NOME_CANAL,
  QUERY_ML,
  QUERY_SHOPEE,
  fmtPct,
  manchete,
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
  type ResumoCanal,
  type Totais,
} from "@/lib/full-visao-geral";
import { tituloMarca, validarPayloadML } from "@/lib/ml-full-estoque";

const DICA_RUPTURA =
  "Sem saldo no Full com demanda: venda nos últimos 28 dias e saldo Full disponível igual a 0. " +
  "Grão: no ML conta inventário (vários anúncios podem dividir um inventário); na Shopee conta item. " +
  "Fora do total: kits da Shopee (não conciliados), a Kokeshi na Shopee (sem conta na esteira de estoque) e a Ápice no ML.";
const NOTA_VENDEDOR =
  "Ruptura no Full não quer dizer venda parada: na Shopee o vendedor pode ter estoque próprio e seguir vendendo fora do Full.";
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

export default function VisaoGeralFull() {
  const [canais, setCanais] = useState<ResumoCanal[] | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setCanais(null);
    Promise.allSettled([
      fetchMLFullEstoque(QUERY_ML, ctrl.signal).then((r) => resumoML(validarPayloadML(r))),
      fetchEstoqueFull(QUERY_SHOPEE, ctrl.signal).then(resumoShopee),
    ]).then((res) => {
      if (ctrl.signal.aborted) return;
      setCanais(res.map((r, i) =>
        r.status === "fulfilled" ? r.value : { canal: CANAIS[i], status: "erro", motivo: motivoErro(r.reason) }));
    });
    return () => ctrl.abort();
  }, [tentativa]);

  return (
    <PageContainer>
      <PageHeader title="Visão geral do Full" icon={Warehouse} />
      {canais === null ? (
        <StateBlock tipo="carregando" titulo="Carregando o estoque Full do ML e da Shopee" />
      ) : (
        <Conteudo canais={canais} recarregar={recarregar} />
      )}
    </PageContainer>
  );
}

function Conteudo({ canais, recarregar }: { canais: ResumoCanal[]; recarregar: () => void }) {
  const ok = oks(canais);
  const m = manchete(canais);
  const tot = total(canais);
  const shopee = ok.find((c) => c.canal === "shopee");
  const marcas = rupturaPorMarca(canais);
  const pior = marcas[0]?.taxa ? marcas[0] : null;
  const top = topRupturas(canais);
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
      {/* a. Manchete, com o frescor de cada foto colado nela */}
      <section aria-labelledby="full-manchete" className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3.5">
        <div className="flex items-start gap-2">
          <h3 id="full-manchete" className={`text-xl font-bold leading-snug ${m.critico ? "text-crit-ink" : "text-ink"}`}>
            {m.texto}
          </h3>
          <InfoDica texto={DICA_RUPTURA} nota={NOTA_VENDEDOR} className="mt-1" />
        </div>
        {shopee && shopee.ruptura > 0 && (
          <p className="text-sm text-ink-muted">
            Shopee: {fmtInt(shopee.ruptura)} em ruptura no Full ·{" "}
            {shopee.semVendedor === null ? (
              <Ausente motivo="lista de rupturas incompleta" />
            ) : (
              <strong className="font-semibold text-ink">{fmtInt(shopee.semVendedor)} também sem estoque do vendedor</strong>
            )}{" "}
            (essas param a venda)
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {ok.map((c) => (
            <Chip key={c.canal} tom={c.frescorVelho ? "atencao" : "neutro"} ponto={c.frescorVelho} title={c.frescor}>
              {seloFrescor(c)}{c.frescorVelho ? " · desatualizada" : ""}
            </Chip>
          ))}
          {canais.filter((c) => c.status !== "ok").map((c) => (
            <Chip key={c.canal} tom="ausente">{NOME_CANAL[c.canal]}: sem dado</Chip>
          ))}
        </div>
      </section>

      {/* b. Ruptura por canal, depois os demais indicadores lado a lado */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[...canais, null].map((c) => {
          const rotulo = c ? `Ruptura · ${NOME_CANAL[c.canal]}` : "Ruptura · Total";
          const dado: Totais | null = c ? (c.status === "ok" ? c : null) : tot;
          const motivo = c ? (c.status === "ok" ? undefined : c.motivo) : "o total só aparece com os dois canais medidos";
          return (
            <KpiTile
              key={rotulo}
              rotulo={rotulo}
              destaque={!c}
              tom={dado ? (dado.ruptura > 0 ? "critico" : "neutro") : "ausente"}
              valor={dado ? fmtPct(pct(dado.ruptura, dado.base)) : "—"}
              comparacao={dado ? `${fmtInt(dado.ruptura)} de ${fmtInt(dado.base)} no Full` : motivo}
              ajuda={!c ? <InfoDica texto={DICA_RUPTURA} nota={NOTA_VENDEDOR} /> : undefined}
            />
          );
        })}
      </div>

      <Panel titulo="Indicadores por canal" semPadding>
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
                ["Sem saldo no Full com demanda", "ruptura"],
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
              <tr>
                <th scope="row" className="px-4 py-2 text-left font-medium text-ink">Ruptura também sem estoque do vendedor</th>
                <td className="px-4 py-2 text-right"><Ausente motivo="não se aplica ao ML" /></td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {shopee ? <Fracao parte={shopee.semVendedor} base={shopee.ruptura} motivo="lista de rupturas incompleta" /> : <Ausente />}
                </td>
                <td className="px-4 py-2 text-right"><Ausente motivo="só a Shopee informa o estoque do vendedor" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      {/* c. Ruptura por marca */}
      <Panel
        titulo="Ruptura por marca"
        descricao={pior ? (
          <>Pior: <strong className="font-semibold text-crit-ink">{tituloMarca(pior.marca)}</strong>, {fmtPct(pior.taxa)} em ruptura ({fmtInt(pior.ruptura)} de {fmtInt(pior.base)})</>
        ) : undefined}
        semPadding
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <caption className="sr-only">Percentual de itens em ruptura por marca e canal</caption>
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
                      {ehPior && <span className="ml-2 text-xs font-semibold text-crit-ink">pior</span>}
                    </th>
                    {CANAIS.map((canal) => {
                      const cel: MarcaCanal | undefined = l.celulas[canal];
                      const fora = canais.find((c) => c.canal === canal)?.status !== "ok";
                      return (
                        <td key={canal} className="px-4 py-2 text-right tabular-nums">
                          {cel ? <Fracao parte={cel.ruptura} base={cel.base} motivo={cel.motivo} /> : <Ausente motivo={fora ? "canal sem dado agora" : "marca fora deste canal"} />}
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
        descricao={`Top ${top.length} por venda média diária (28 dias)${algumaIncompleta ? " · lista incompleta" : ""}`}
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
            <table className="w-full min-w-[560px] text-sm">
              <caption className="sr-only">Rupturas no Full ordenadas por venda média diária</caption>
              <thead className="bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left">Produto</th>
                  <th scope="col" className="px-4 py-2 text-left">Marca</th>
                  <th scope="col" className="px-4 py-2 text-left">Canal</th>
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
