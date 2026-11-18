"use client";

/**
 * CX do TikTok Shop, direto da Open API (app da Torre, tokens por marca): devolucoes,
 * reembolsado e cancelamentos da janela, Pareto dos motivos (clicar abre marcas e SKUs) e
 * a tabela por marca. Nao pago (o TikTok cancela sozinho) fica fora do Pareto, contado a' parte.
 */
import { useCallback, useEffect, useState } from "react";
import { Ban, CircleDollarSign, Clock3, Undo2 } from "lucide-react";

import CartaoIndicador from "@/components/ui/CartaoIndicador";
import Chip from "@/components/ui/Chip";
import InfoDica from "@/components/ui/InfoDica";
import Panel from "@/components/ui/Panel";
import SeloAtualizado from "@/components/ui/SeloAtualizado";
import StateBlock from "@/components/ui/StateBlock";
import { inteiro, reais, reaisCurto, type FiltrosCx } from "@/lib/cx";
import { carregarCxTikTok, itensParetoTikTok, resumoTikTok, type ResultadoTikTok } from "@/lib/cx-tiktok";
import { brandLabel } from "@/lib/filters/brands";
import { torreFetch } from "@/lib/torre-fetch";

import { AbaCx, COR_CX, FaixaCarregando, GRADE_FAIXA, PainelPareto, TD, TentarNovamente, TH, TH_MARCA, THEAD, TR, TR_TOTAL } from "./CxConteudo";

const COR_TIPO: Record<string, string> = { Devolução: "bg-canal-tiktok", Cancelamento: "bg-accent" };
const ESTADO: Record<string, string> = {
  sem_permissao: "Sem permissão do app nesta loja",
  nao_autorizada: "Loja não autorizou o app",
  erro: "TikTok indisponível agora",
};
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export default function CxTikTok({ filtros }: { filtros: FiltrosCx }) {
  const { marca, dias } = filtros;
  const [r, setR] = useState<ResultadoTikTok | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

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
        <StateBlock tipo="carregando" titulo="Lendo devoluções e cancelamentos no TikTok Shop" descricao="A primeira leitura do período pode levar até 1 minuto; depois fica guardada por 10 minutos." />
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
  const itens = itensParetoTikTok(d);
  const abertoItem = itens.find((i) => i.chave === aberto) ?? null;
  const intervalo = `${dataBr(d.inicio)}–${dataBr(d.fim)}`;
  const selo = (
    <span className="flex flex-wrap items-center gap-1.5">
      {s.parcial && <Chip tom="atencao" title="Alguma marca ainda tem dias por ler (limite do TikTok) ou passou de 10 mil registros num dia: o número real é maior.">Parcial</Chip>}
      <SeloAtualizado em={d.gerado_em} detalhe={`Direto da API do TikTok Shop · por data de abertura · ${intervalo}`} />
    </span>
  );
  const faixa = (
    <div className={GRADE_FAIXA}>
      <CartaoIndicador rotulo="Devoluções" icone={Undo2} cor={COR_CX.devolucao} valor={inteiro(s.devolucoes)} legenda="Pedidos de devolução ou reembolso abertos (sem os que o comprador desistiu)" />
      <CartaoIndicador rotulo="Reembolsado" icone={CircleDollarSign} cor={COR_CX.reembolso} valor={reaisCurto(s.reembolsado)} legenda="Valor de reembolso das devoluções do período" />
      <CartaoIndicador rotulo="Cancelamentos" icone={Ban} cor={COR_CX.cancelamento} valor={inteiro(s.cancelamentos)} legenda={`${inteiro(s.comprador)} pelo comprador`} />
      <CartaoIndicador rotulo="Não pagos" icone={Clock3} cor={COR_CX.resposta} valor={inteiro(s.naoPagos)} legenda="O TikTok cancela sozinho: fora do Pareto" />
    </div>
  );

  return (
    <AbaCx canal="tiktok" filtros={filtros} intervalo={intervalo} selo={selo} faixa={faixa}>
      {s.semDado.length > 0 && (
        <p className="text-sm text-warn-ink">
          Sem dado agora: {s.semDado.map((m) => `${brandLabel(m.marca)} (${ESTADO[m.estado] ?? m.estado})`).join(", ")}.
        </p>
      )}
      <PainelPareto v={{ estado: itens.length ? "dado" : "vazio_legitimo", motivo: itens.length ? null : "Nenhuma devolução ou cancelamento no período.", itens, resto: null }}
        cores={COR_TIPO} semNome="sem motivo" aberta={aberto} aoAbrir={(i) => setAberto(aberto === i.chave ? null : i.chave)}>
        {abertoItem && (
          <section className="rounded-lg border border-line bg-surface p-3" aria-label={`Detalhe: ${abertoItem.rotulo}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">{abertoItem.tipo} · {abertoItem.rotulo}</h3>
              <button type="button" onClick={() => setAberto(null)} className="min-h-11 rounded-md px-3 text-xs font-semibold text-ink-muted hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Fechar</button>
            </div>
            <p className="mt-1 text-xs text-ink-muted">Por marca</p>
            <ul className="mt-1 flex flex-col gap-1">
              {abertoItem.bruto.marcas.map((m) => (
                <li key={m.marca} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 font-medium text-ink">{brandLabel(m.marca)}</span>
                  <span className="relative h-2 flex-1 rounded-full bg-line/60" aria-hidden="true">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.max(2, (m.quantidade / abertoItem.bruto.quantidade) * 100)}%` }} />
                  </span>
                  <span className="w-16 shrink-0 text-right tabular-nums text-ink-muted">{inteiro(m.quantidade)}</span>
                </li>
              ))}
            </ul>
            {abertoItem.bruto.skus.length > 0 && (
              <table className="mt-3 w-full border-collapse text-sm">
                <caption className="sr-only">Produtos com o motivo {abertoItem.rotulo}</caption>
                <thead>
                  <tr className="border-b border-line text-left text-xs font-semibold text-ink-faint">
                    <th scope="col" className="py-1.5 pr-3">Produto</th>
                    <th scope="col" className="py-1.5 pr-3">Marca</th>
                    <th scope="col" className={TH}>Casos</th>
                  </tr>
                </thead>
                <tbody>
                  {abertoItem.bruto.skus.slice(0, 15).map((x) => (
                    <tr key={`${x.marca}|${x.sku}`} className="border-b border-line last:border-0">
                      <td className="py-1.5 pr-3"><span className="block text-ink">{x.produto ?? x.sku}</span><span className="block text-xs text-ink-muted">SKU {x.sku}</span></td>
                      <td className="py-1.5 pr-3 text-ink-muted">{brandLabel(x.marca)}</td>
                      <td className={TD}>{inteiro(x.quantidade)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </PainelPareto>

      <Panel titulo="Problemas por marca" aria-label="Problemas por marca" semPadding>
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <caption className="sr-only">Devoluções e cancelamentos do TikTok Shop por marca</caption>
          <thead className={THEAD}>
            <tr>
              <th scope="col" className={TH_MARCA}>Marca</th>
              <th scope="col" className={TH}>Devoluções</th>
              <th scope="col" className={TH}>Reembolsado</th>
              <th scope="col" className={TH}>Cancelamentos</th>
              <th scope="col" className={TH}>
                <span className="inline-flex items-center gap-1">Não pagos <InfoDica texto="Pedidos que o comprador não pagou: o TikTok cancela sozinho. Ficam fora do Pareto." /></span>
              </th>
            </tr>
          </thead>
          <tbody>
            {s.comDado.map((m) => (
              <tr key={m.marca} className={TR}>
                <th scope="row" className="px-2 py-2 text-left font-medium text-ink">{brandLabel(m.marca)}{m.truncado ? " *" : ""}</th>
                <td className={TD}>{inteiro(m.devolucoes)}</td>
                <td className={TD}>{reais(m.reembolsado)}</td>
                <td className={TD}>{inteiro(m.cancelamentos)}</td>
                <td className={TD}>{inteiro(m.nao_pagos)}</td>
              </tr>
            ))}
            <tr className={TR_TOTAL}>
              <th scope="row" className="px-2 py-2 text-left text-ink">Total</th>
              <td className={TD}>{inteiro(s.devolucoes)}</td>
              <td className={TD}>{reais(s.reembolsado)}</td>
              <td className={TD}>{inteiro(s.cancelamentos)}</td>
              <td className={TD}>{inteiro(s.naoPagos)}</td>
            </tr>
          </tbody>
        </table>
        {s.parcial && <p className="px-3 pb-3 text-xs text-ink-muted">* Leitura incompleta nesta marca (dias ainda por ler ou mais de 10 mil registros num dia): o número real é maior. Os dias que faltam entram na próxima atualização.</p>}
      </Panel>
    </AbaCx>
  );
}
