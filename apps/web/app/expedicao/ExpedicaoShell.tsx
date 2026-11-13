"use client";

/**
 * Gate EXP-TK-OPS-1 — casca que escolhe entre a fila (Shopee, Mercado Livre) e
 * a serie diaria do TikTok Shop.
 *
 * POR QUE UMA CASCA E NAO UM TERCEIRO CANAL DENTRO DO `ExpedicaoClient`
 * ---------------------------------------------------------------------
 * `Canal` (em `expedicao-contract.ts`) e' o tipo da FILA, e varios contratos
 * sao `Record<Canal, ...>`: `ROTULO_CANAL`, `KPIS_PRINCIPAIS`, `canalTemPrazo`,
 * `montarMapaDeRisco`, `montarTimeline`. Acrescentar `"tiktokshop"` aquele tipo
 * obrigaria a inventar KPI de fila, mapa de risco e timeline para um canal que
 * nao publica fila nenhuma — dados que nao existem, so' para satisfazer o
 * compilador. Os corpos continuam separados: `ExpedicaoClient` (fila) e
 * `TikTokDispatchPanel` (coorte por vencimento).
 *
 * EXPEDICAO-UX-UNIFICADA-1 — UM SELETOR, UMA PROFUNDIDADE
 * -------------------------------------------------------
 * Antes eram dois niveis de navegacao: "Fila (Shopee / ML) | TikTok" aqui e
 * "Shopee | Mercado Livre" dentro da fila. Pareciam produtos diferentes. Agora
 * a casca e' dona de um seletor so' — Shopee | Mercado Livre | TikTok Shop — e
 * da profundidade (visao do gestor / detalhe operacional), que vale igual
 * para os tres.
 *
 * Os dois estados vivem na URL (`?channel=`, `?visao=`), com os mesmos valores
 * de antes para o canal: link antigo abre onde abria. A janela (`?dias=`)
 * continua sendo de cada painel; a casca so' a descarta quando a troca
 * atravessa fila <-> TikTok, porque os limites sao diferentes.
 *
 * Shopee <-> Mercado Livre NAO remonta a fila: o mesmo `ExpedicaoClient`
 * recebe o canal novo e aplica `aplicarCanal`, que decide campo a campo o que
 * atravessa a troca — exatamente como quando o seletor morava dentro dele.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import Aba from "@/components/layout/Aba";
import type { Moldura } from "@/components/expedicao/LayoutExpedicao";

import ExpedicaoClient from "./ExpedicaoClient";
import LdrTopo from "@/components/expedicao/LdrTopo";
import PerformanceOficial, { itensForaDoLimite, usePerformanceOficial } from "@/components/expedicao/PerformanceOficial";
import TikTokDispatchPanel from "@/components/expedicao/TikTokDispatchPanel";
import Note from "@/components/ui/Note";
import { demoAtivo } from "@/lib/expedicao-demo";
import {
  ROTULO_CANAL_EXPEDICAO,
  canaisHabilitados,
  ehCanalDaFila,
  lerCanalExpedicao,
  urlDoCanal,
  type CanalExpedicao,
} from "@/lib/expedicao-canal";
import {
  VISAO_PADRAO,
  lerMarca,
  lerVisao,
  urlComMarca,
  urlComVisao,
  type Visao,
} from "@/lib/expedicao-ux";

/**
 * Flags de canal, escritas INLINE: o Next troca `process.env.NEXT_PUBLIC_*`
 * por literal em build, a comparacao dobra para `false` e o minificador
 * elimina a opcao (e o painel do TikTok) do bundle. Atras de uma chamada de
 * funcao o compilador nao dobraria. `expedicaoMlHabilitado` continua sendo a
 * mesma regra, e ha teste amarrando as duas.
 */
const ML_LIGADO = process.env.NEXT_PUBLIC_EXPEDICAO_ML_ENABLED === "true";
const TIKTOK_LIGADO = process.env.NEXT_PUBLIC_EXPEDICAO_TIKTOK_ENABLED === "true";

const FLAGS = { ml: ML_LIGADO, tiktok: TIKTOK_LIGADO };

/**
 * CX-MKT-2/3: faixa de LDR no topo + secao "Performance" (nota oficial).
 * INLINE pelo mesmo motivo das flags de canal. Desligada, nada monta nem busca.
 */
const PERFORMANCE_LIGADA = process.env.NEXT_PUBLIC_EXPEDICAO_PERFORMANCE_ENABLED === "true";
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/** Identidade do canal: ponto com a cor do canal, nunca cor de estado. */
const PONTO_DO_CANAL: Record<CanalExpedicao, string> = {
  shopee: "bg-canal-shopee",
  mercadolivre: "bg-canal-ml",
  tiktokshop: "bg-canal-tiktok",
};

export default function ExpedicaoShell() {
  /**
   * Comeca no padrao e corrige no efeito: ler `window` durante o render faria
   * o HTML do servidor divergir do primeiro render do cliente.
   */
  const [canal, setCanal] = useState<CanalExpedicao>("shopee");
  const [visao, setVisao] = useState<Visao>(VISAO_PADRAO);
  // EXPEDICAO-UX-3: a marca e' a mesma entidade nos tres canais, entao o
  // filtro mora aqui e atravessa a troca de canal, como a profundidade.
  const [marca, setMarca] = useState<string | null>(null);
  const [pronta, setPronta] = useState(false);
  // T-0010: `?demo=` (dados ficticios para QA). `demoAtivo` e' sempre falso em producao.
  const [demo, setDemo] = useState(false);

  // IDENTIDADE-GERENCIAL: a Performance oficial vai para "Mais detalhes" do
  // painel, e as metricas fora do limite sobem para "O que exige atencao".
  const performance = usePerformanceOficial(API, canal, marca, PERFORMANCE_LIGADA && pronta);

  const lerDaUrl = useCallback(() => {
    setCanal(lerCanalExpedicao(window.location.search, FLAGS));
    setVisao(lerVisao(window.location.search));
    setMarca(lerMarca(window.location.search));
    setDemo(demoAtivo(window.location.search));
  }, []);

  useEffect(() => {
    lerDaUrl();
    setPronta(true);
  }, [lerDaUrl]);

  // Voltar/avancar do navegador troca a URL sem remontar.
  useEffect(() => {
    const aoVoltar = () => lerDaUrl();
    window.addEventListener("popstate", aoVoltar);
    return () => window.removeEventListener("popstate", aoVoltar);
  }, [lerDaUrl]);

  /**
   * Foco do teclado na troca de canal. Shopee <-> Mercado Livre nao remonta
   * nada, entao o foco fica onde estava. Fila <-> TikTok troca o CORPO
   * inteiro, e as abas de canal renascem dentro do outro painel: sem isto,
   * quem anda pelo teclado perdia o foco para o `body` a cada travessia. Se o
   * foco estava numa aba, ele volta para a aba marcada.
   */
  const devolverFoco = useRef(false);

  const trocarCanal = useCallback(
    (novo: CanalExpedicao) => {
      if (novo === canal) return;
      devolverFoco.current = document.activeElement?.getAttribute("role") === "tab";
      window.history.replaceState(null, "", urlDoCanal(window.location.href, canal, novo));
      setCanal(novo);
    },
    [canal],
  );

  useEffect(() => {
    if (!devolverFoco.current) return;
    devolverFoco.current = false;
    document.querySelector<HTMLButtonElement>('[data-esqueleto="aba"] [role="tab"][aria-selected="true"]')?.focus();
  }, [canal]);

  const trocarVisao = useCallback((nova: Visao) => {
    setVisao(nova);
    window.history.replaceState(null, "", urlComVisao(window.location.href, nova));
  }, []);

  const trocarMarca = useCallback((nova: string | null) => {
    setMarca(nova);
    window.history.replaceState(null, "", urlComMarca(window.location.href, nova));
  }, []);

  // ALVO-GRADE: os canais sao as ABAS da moldura, com o ponto de identidade.
  const visoes = canaisHabilitados(FLAGS).map((c) => ({
    id: c,
    rotulo: ROTULO_CANAL_EXPEDICAO[c],
    ponto: PONTO_DO_CANAL[c],
  }));
  // A casca desenha a moldura; cada painel entrega selo, filtros e corpo.
  // Funcao, nao componente: trocar de canal nao remonta o painel da fila.
  const moldura: Moldura = (partes) => (
    <Aba
      // Com um canal so' nao ha abas: o canal vai no titulo, para o numero de
      // uma loja nunca ficar sob o titulo de outra (EXP-3C2-R/V).
      titulo={visoes.length > 1 ? "Expedição" : `Expedição — ${ROTULO_CANAL_EXPEDICAO[canal]}`}
      visoes={visoes}
      visao={canal}
      onVisao={trocarCanal}
      {...partes}
    />
  );

  // Ate' a URL ser lida, NENHUM painel monta. Antes a fila montava "por
  // enquanto" — e, com a janela na URL, ela lia `?dias=45` de um link do
  // TikTok pela regra DELA (maximo 14), julgava invalido e apagava o
  // parametro antes de o painel do TikTok nascer: o link de 45 dias abria em
  // 7 (medido no QA do EXPEDICAO-UX-JANELA-CUSTOMIZAVEL-1).
  if (!pronta) {
    return (
      <p role="status" className="py-12 text-center text-sm text-ink-muted">
        Carregando a Expedição…
      </p>
    );
  }
  // CX-MKT-3: o LDR entra no esqueleto (slot `faixaTopo`), depois de "Backlog por marca".
  const destaque = PERFORMANCE_LIGADA ? <LdrTopo api={API} marca={marca} /> : undefined;
  const extras = PERFORMANCE_LIGADA
    ? { performance: <PerformanceOficial estado={performance} />, itensOficiais: itensForaDoLimite(performance) }
    : {};
  const corpo = ehCanalDaFila(canal) ? (
    <ExpedicaoClient
      canal={canal}
      moldura={moldura}
      visao={visao}
      aoTrocarVisao={trocarVisao}
      marca={marca}
      aoTrocarMarca={trocarMarca}
      faixaTopo={destaque}
      {...extras}
    />
  ) : (
    <TikTokDispatchPanel
      moldura={moldura}
      visao={visao}
      aoTrocarVisao={trocarVisao}
      marca={marca}
      aoTrocarMarca={trocarMarca}
      faixaTopo={destaque}
      {...extras}
    />
  );
  if (!demo) return corpo;
  // T-0010: modo de demonstracao (so' fora de producao). A faixa e' ESCRITA:
  // numero ficticio nao pode parecer real em print nenhum.
  return (
    <>
      <div className="w-full px-4 pt-4">
        <Note tom="atencao" papel="status">
          Dados fictícios — modo de demonstração.
        </Note>
      </div>
      {corpo}
    </>
  );
}
