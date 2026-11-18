"use client";

/**
 * CX do TikTok Shop, direto da Open API (app da Torre, tokens por marca), no mesmo padrao da
 * Shopee e do Mercado Livre: faixa de taxas (% dos pedidos do Data Mart) que abre o detalhe por
 * marca; Pareto dos motivos (clicar abre marcas e, na marca, os produtos) ao lado de "O que exige
 * atencao"; e a tabela de problemas por marca. Nao pago (o TikTok cancela sozinho) fica fora do Pareto.
 */
import { useCallback, useEffect, useState } from "react";
import { Ban, Clock3, PackageX, Undo2 } from "lucide-react";

import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import DrilldownContextLine from "@/components/drilldown/DrilldownContextLine";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import EvidenceRow from "@/components/drilldown/EvidenceRow";
import TableScrollHint from "@/components/TableScrollHint";
import CartaoIndicador from "@/components/ui/CartaoIndicador";
import Chip from "@/components/ui/Chip";
import InfoDica from "@/components/ui/InfoDica";
import type { IdentidadeKpi } from "@/components/ui/KpiTile";
import NumeroAnimado from "@/components/ui/NumeroAnimado";
import Panel from "@/components/ui/Panel";
import SeloAtualizado from "@/components/ui/SeloAtualizado";
import StateBlock from "@/components/ui/StateBlock";
import { inteiro, pctCx, reais, type FiltrosCx } from "@/lib/cx";
import {
  atencaoTikTok, carregarCxTikTok, itensParetoTikTok, linhasTikTok, resumoTikTok, totalTikTok,
  type IndicadorTikTok, type LinhaTikTok, type ResultadoTikTok,
} from "@/lib/cx-tiktok";
import { brandLabel } from "@/lib/filters/brands";
import { torreFetch } from "@/lib/torre-fetch";

import {
  AbaCx, Celula, COR_CX, FaixaCarregando, GRADE_FAIXA, PainelAtencao, PainelPareto, pesosDaColuna,
  TD, TentarNovamente, TH, TH_MARCA, THEAD, ThAjuda, TR, TR_TOTAL,
} from "./CxConteudo";

/** Classes LITERAIS: o Tailwind so' gera o que encontra escrito. */
const COR_TIPO: Record<string, string> = { Devolução: "bg-canal-tiktok", Cancelamento: "bg-accent" };
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const ROTULO: Record<IndicadorTikTok, string> = { cancelamento: "Cancelamento", devolucao: "Devolução", reembolso: "Reembolso", naoPago: "Não pagos" };
const AJUDA: Record<IndicadorTikTok, string> = {
  cancelamento: "Cancelamentos ÷ pedidos do período, de qualquer autor, sem os não pagos. Pedidos: Data Mart (TikTok por marca e dia).",
  devolucao: "Pedidos de devolução ou reembolso abertos ÷ pedidos do período (sem os que o comprador desistiu).",
  reembolso: "Valor de reembolso das devoluções ÷ faturamento do TikTok no período.",
  naoPago: "Pedidos que o comprador não pagou ÷ pedidos do período. O TikTok cancela sozinho: ficam fora do Pareto.",
};
const VISUAL: Record<IndicadorTikTok, { cor: string; icone: typeof Ban; identidade: IdentidadeKpi }> = {
  cancelamento: { cor: COR_CX.cancelamento, icone: Ban, identidade: "ads" },
  devolucao: { cor: COR_CX.devolucao, icone: PackageX, identidade: "pedidos" },
  reembolso: { cor: COR_CX.reembolso, icone: Undo2, identidade: "prazo" },
  naoPago: { cor: COR_CX.resposta, icone: Clock3, identidade: "gmv" },
};
const ORDEM: IndicadorTikTok[] = ["cancelamento", "devolucao", "reembolso", "naoPago"];
const contagem = (i: IndicadorTikTok, l: LinhaTikTok) => (i === "reembolso" ? reais(l.n.reembolso) : inteiro(l.n[i]));

export default function CxTikTok({ filtros }: { filtros: FiltrosCx }) {
  const { marca, dias } = filtros;
  const [r, setR] = useState<ResultadoTikTok | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [marcaAberta, setMarcaAberta] = useState<string | null>(null);
  const [taxaAberta, setTaxaAberta] = useState<IndicadorTikTok | null>(null);

  const carregar = useCallback(() => {
    let vivo = true;
    setR(null);
    setAberto(null);
    carregarCxTikTok({ marca, dias }, torreFetch as typeof fetch, undefined, undefined, () => vivo).then((x) => vivo && setR(x));
    return () => {
      vivo = false;
    };
  }, [marca, dias]);
  useEffect(() => carregar(), [carregar]);

  if (!r) {
    return (
      <AbaCx canal="tiktok" filtros={filtros} selo={<SeloAtualizado em={null} carregando />} faixa={<FaixaCarregando />}>
        <StateBlock tipo="carregando" titulo="Lendo devoluções e cancelamentos no TikTok Shop" />
      </AbaCx>
    );
  }
  if (!r.ok) {
    return (
      <AbaCx canal="tiktok" filtros={filtros}>
        <StateBlock tipo="erro" titulo="Não foi possível carregar a CX do TikTok" descricao={r.motivo} acao={<TentarNovamente onClick={() => carregar()} />} />
      </AbaCx>
    );
  }

  const d = r.dados;
  const s = resumoTikTok(d);
  const linhas = linhasTikTok(d);
  const total = totalTikTok(linhas);
  const itens = itensParetoTikTok(d);
  const abertoItem = itens.find((i) => i.chave === aberto) ?? null;
  const intervalo = `${dataBr(d.inicio)}–${dataBr(d.fim)}`;
  const periodo = `${dataBr(d.inicio)} a ${dataBr(d.fim)}`;
  const selo = (
    <span className="flex flex-wrap items-center gap-1.5">
      {s.parcial && <Chip tom="atencao" title="Alguma marca ainda tem dias por ler (limite do TikTok) ou passou de 10 mil registros num dia.">Parcial</Chip>}
      <SeloAtualizado em={d.gerado_em} detalhe={`Direto da API do TikTok Shop · por data de abertura · ${intervalo}`} />
    </span>
  );
  const legenda = (i: IndicadorTikTok) =>
    i === "reembolso" ? `${reais(total.n.reembolso)} reembolsados` : `${inteiro(total.n[i])} ${i === "cancelamento" ? `cancelados · ${inteiro(s.comprador)} pelo comprador` : i === "devolucao" ? "devoluções" : "não pagos"}`;
  const faixa = (
    <section aria-label="Indicadores do período">
      <div className={GRADE_FAIXA} data-testid="cx-faixa">
        {ORDEM.map((i) => (
          <CartaoIndicador key={i} rotulo={ROTULO[i]} icone={VISUAL[i].icone} cor={VISUAL[i].cor}
            valor={total.taxa[i] == null ? null : pctCx(total.taxa[i])} legenda={legenda(i)}
            ajuda={<InfoDica emControle={total.taxa[i] != null} texto={AJUDA[i]} />}
            onAbrir={total.taxa[i] != null ? () => setTaxaAberta(i) : undefined} />
        ))}
      </div>
    </section>
  );
  const pesos = Object.fromEntries(ORDEM.map((i) => [i, pesosDaColuna(linhas.map((l) => (l.taxa[i] == null ? "—" : pctCx(l.taxa[i]))))])) as Record<IndicadorTikTok, (number | null)[]>;
  const barra = (p: number | null, cor: string) => (p == null ? null : { peso: p, cor });
  const marcaSel = abertoItem?.bruto.marcas.find((m) => m.marca === marcaAberta) ? marcaAberta : null;

  return (
    <AbaCx canal="tiktok" filtros={filtros} intervalo={intervalo} selo={selo} faixa={faixa}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <PainelPareto v={{ estado: itens.length ? "dado" : "vazio_legitimo", motivo: itens.length ? null : "Nenhuma devolução ou cancelamento no período.", itens, resto: null }}
          cores={COR_TIPO} semNome="sem motivo" aberta={aberto} aoAbrir={(i) => { setAberto(aberto === i.chave ? null : i.chave); setMarcaAberta(null); }}>
          {abertoItem && (
            <section className="rounded-lg border border-line bg-surface p-3" aria-label={`Detalhe: ${abertoItem.rotulo}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">
                  {abertoItem.tipo} · {abertoItem.rotulo}
                  <span className="ml-2 text-xs font-normal text-ink-muted">{inteiro(abertoItem.bruto.quantidade)} casos</span>
                </h3>
                <button type="button" onClick={() => setAberto(null)} className="min-h-11 rounded-md px-3 text-xs font-semibold text-ink-muted hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Fechar</button>
              </div>
              <p className="mt-2 text-xs text-ink-muted">Por marca · clique na marca para ver os produtos</p>
              <ul className="mt-1 flex flex-col gap-1">
                {abertoItem.bruto.marcas.map((m) => {
                  const pct = (m.quantidade / abertoItem.bruto.quantidade) * 100;
                  const skus = abertoItem.bruto.skus.filter((x) => x.marca === m.marca);
                  return (
                    <li key={m.marca}>
                      <button type="button" aria-expanded={marcaSel === m.marca} onClick={() => setMarcaAberta(marcaSel === m.marca ? null : m.marca)}
                        className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${marcaSel === m.marca ? "bg-raised" : ""}`}>
                        <span className="w-28 shrink-0 font-medium text-ink">{brandLabel(m.marca)}</span>
                        <span className="relative h-2 flex-1 rounded-full bg-line/60" aria-hidden="true">
                          <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.max(2, pct)}%` }} />
                        </span>
                        <span className="w-28 shrink-0 text-right tabular-nums text-ink-muted">{inteiro(m.quantidade)} · {Math.round(pct)}%</span>
                      </button>
                      {marcaSel === m.marca && (
                        <div className="ml-2 mt-1 border-l border-line pl-3">
                          {skus.length === 0 ? (
                            <p className="py-1 text-xs text-ink-muted">O TikTok não trouxe os produtos destes casos.</p>
                          ) : (
                            <table className="w-full border-collapse text-sm">
                              <caption className="sr-only">Produtos de {brandLabel(m.marca)} com o motivo {abertoItem.rotulo}</caption>
                              <thead>
                                <tr className="border-b border-line text-left text-xs font-semibold text-ink-faint">
                                  <th scope="col" className="py-1.5 pr-3">Produto</th>
                                  <th scope="col" className={TH}>Casos</th>
                                </tr>
                              </thead>
                              <tbody>
                                {skus.slice(0, 15).map((x) => (
                                  <tr key={x.sku} className="border-b border-line last:border-0">
                                    <td className="py-1.5 pr-3"><span className="block text-ink">{x.produto ?? x.sku}</span><span className="block text-xs text-ink-muted">SKU {x.sku}</span></td>
                                    <td className={TD}>{inteiro(x.quantidade)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </PainelPareto>
        <PainelAtencao
          ajuda="Marca com cancelamento, devolução ou reembolso a partir de 1,5x a média do grupo no período; marca sem dado do TikTok; leitura parcial."
          itens={atencaoTikTok(d, brandLabel)}
          vazio="Nenhuma marca muito acima da média do grupo no período."
        />
      </div>

      <Panel titulo="Problemas por marca" aria-label="Problemas por marca" semPadding>
        <TableScrollHint>
          <table className="w-full min-w-[720px] border-collapse text-sm" data-testid="cx-problemas-marca">
            <caption className="sr-only">Problemas do TikTok Shop por marca, em % dos pedidos</caption>
            <thead className={THEAD}>
              <tr>
                <th scope="col" className={TH_MARCA}>Marca</th>
                <th scope="col" className={TH}>Pedidos</th>
                <ThAjuda ajuda={AJUDA.cancelamento}>Cancel.</ThAjuda>
                <ThAjuda ajuda={AJUDA.devolucao}>Devol.</ThAjuda>
                <ThAjuda ajuda={AJUDA.reembolso}>Reembolsado</ThAjuda>
                <ThAjuda ajuda={AJUDA.naoPago}>Não pagos</ThAjuda>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, k) => (
                <tr key={l.chave} className={TR}>
                  <th scope="row" className="px-2 py-2 text-left font-medium text-ink">{brandLabel(l.chave)}{l.parcial ? " *" : ""}</th>
                  <td className={TD}>{inteiro(l.pedidos)}</td>
                  <Celula valor={pctCx(l.taxa.cancelamento)} barra={barra(pesos.cancelamento[k], COR_CX.cancelamento)} dica={`${inteiro(l.n.cancelamento)} cancelamentos`} />
                  <Celula valor={pctCx(l.taxa.devolucao)} barra={barra(pesos.devolucao[k], COR_CX.devolucao)} dica={`${inteiro(l.n.devolucao)} devoluções`} />
                  <Celula valor={reais(l.n.reembolso)} dica={l.taxa.reembolso == null ? null : `${pctCx(l.taxa.reembolso)} do faturamento`}>
                    {l.taxa.reembolso != null && <span className="ml-1 text-xs text-ink-muted">{pctCx(l.taxa.reembolso)}</span>}
                  </Celula>
                  <Celula valor={pctCx(l.taxa.naoPago)} dica={`${inteiro(l.n.naoPago)} não pagos`} />
                </tr>
              ))}
              <tr className={TR_TOTAL}>
                <th scope="row" className="px-2 py-2 text-left text-ink">Total</th>
                <td className={TD}>{inteiro(total.pedidos)}</td>
                <Celula valor={pctCx(total.taxa.cancelamento)} dica={`${inteiro(total.n.cancelamento)} cancelamentos`} />
                <Celula valor={pctCx(total.taxa.devolucao)} dica={`${inteiro(total.n.devolucao)} devoluções`} />
                <Celula valor={reais(total.n.reembolso)}>
                  {total.taxa.reembolso != null && <span className="ml-1 text-xs text-ink-muted">{pctCx(total.taxa.reembolso)}</span>}
                </Celula>
                <Celula valor={pctCx(total.taxa.naoPago)} dica={`${inteiro(total.n.naoPago)} não pagos`} />
              </tr>
            </tbody>
          </table>
        </TableScrollHint>
        {s.parcial && <p className="px-3 pb-3 text-xs text-ink-muted">* Leitura incompleta nesta marca: os dias que faltam entram na próxima atualização.</p>}
      </Panel>

      <KpiDrilldownDialog open={taxaAberta != null} onClose={() => setTaxaAberta(null)}
        title={taxaAberta ? `${ROTULO[taxaAberta]} · por marca` : ""}
        icone={taxaAberta ? VISUAL[taxaAberta].icone : undefined} identidade={taxaAberta ? VISUAL[taxaAberta].identidade : undefined}>
        {taxaAberta && (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5">
                <NumeroAnimado texto={pctCx(total.taxa[taxaAberta])} className="text-[32px] font-bold leading-none tracking-tight text-ink tabular-nums" />
                <span className="pb-0.5 text-xs text-ink-faint tabular-nums">
                  {taxaAberta === "reembolso" ? `${reais(total.n.reembolso)} de ${reais(total.faturamento)} faturados` : `${inteiro(total.n[taxaAberta])} de ${inteiro(total.pedidos)} pedidos`}
                </span>
              </div>
              <DrilldownContextLine leading="TikTok Shop" periodLabel={periodo} refreshedAt={d.gerado_em} dica={<InfoDica texto={AJUDA[taxaAberta]} />} />
            </div>
            <DrilldownSecao titulo="Por marca">
              <ul className="m-0 flex list-none flex-col p-0">
                {[...linhas].sort((a, b) => (b.taxa[taxaAberta] ?? -1) - (a.taxa[taxaAberta] ?? -1)).map((l) => (
                  <EvidenceRow key={l.chave} label={brandLabel(l.chave)} value={pctCx(l.taxa[taxaAberta])}
                    reference={taxaAberta === "reembolso" ? `${reais(l.n.reembolso)} de ${reais(l.faturamento)}` : `${contagem(taxaAberta, l)} de ${inteiro(l.pedidos)} pedidos`} />
                ))}
              </ul>
            </DrilldownSecao>
          </div>
        )}
      </KpiDrilldownDialog>
    </AbaCx>
  );
}
