/**
 * Aba CX · Mercado Livre (10/11/2026) — `GET /api/v1/cx/mercadolivre?brands=&dias=`.
 *
 * Mesmas regras da CX da Shopee: ausencia nunca vira zero ("—"), numero Torre
 * sem faixa oficial, periodo anterior so' quando a API o mede (`sem_anterior`
 * explica quando nao). Funcoes puras testadas em node --test; a pagina so'
 * desenha a visao. Contrato: `docs/cx_atendimento_contrato.md` §7.3.
 */
import {
  deltaPp,
  duracao,
  inteiro,
  pctCx,
  razaoPct,
  somar,
  textoSemComparacao,
  type ComparacaoCard,
  type DeltaCx,
  type FiltrosCx,
  type SemComparacao,
} from "./cx.ts";
import {
  ROTULO_NATUREZA,
  type BlocoMotivos,
  type EstadoBloco,
  type Motivo,
} from "./performance-contas-atendimento.ts";
import { MOTIVO_TIMEOUT, repetirSeEstourar, TIMEOUT_API_MS } from "./performance-contas.ts";

export type IndicadorMl = "reclamacao" | "cancelamento" | "mediacao";
export const INDICADORES_ML: readonly IndicadorMl[] = ["reclamacao", "cancelamento", "mediacao"];
const CAMPO: Record<IndicadorMl, "reclamacoes" | "cancelamentos" | "mediacoes"> = {
  reclamacao: "reclamacoes",
  cancelamento: "cancelamentos",
  mediacao: "mediacoes",
};
export const ROTULO_ML: Record<IndicadorMl, string> = {
  reclamacao: "Taxa de reclamação",
  cancelamento: "Cancelamentos",
  mediacao: "Mediações",
};

export interface LinhaMl {
  marca: string;
  pedidos?: number | null;
  reclamacoes?: number | null;
  cancelamentos?: number | null;
  mediacoes?: number | null;
  perguntas?: number | null;
  pedidos_anterior?: number | null;
  reclamacoes_anterior?: number | null;
  cancelamentos_anterior?: number | null;
  mediacoes_anterior?: number | null;
  aguardando_nos?: number | null;
  vencidas?: number | null;
  vencem_24h?: number | null;
  prazo_mais_antigo?: string | null;
  perguntas_sem_resposta?: number | null;
  tempo_resposta_min?: number | null;
  mensagens_pendentes?: number | null;
  conta_dia?: string | null;
  resposta_mediana_h?: number | null;
  reclamacoes_com_historico?: number | null;
  reclamacoes_respondidas?: number | null;
}

export interface PontoDiaMl {
  dia: string;
  marca: string;
  pedidos?: number | null;
  reclamacoes?: number | null;
  cancelamentos?: number | null;
  mediacoes?: number | null;
}

export interface CxMlResponse {
  gerado_em: string;
  janela: { inicio: string; fim: string; dias: number };
  janela_anterior?: { inicio: string; fim: string; dias: number } | null;
  cobertura: { marcas: string[]; fora: { marca: string; motivo: string }[] };
  diario_estado: "dado" | "erro";
  reclamacoes_estado: "dado" | "erro";
  motivo_indisponivel?: string | null;
  marcas: LinhaMl[];
  reclamacoes_motivos?: BlocoMotivos | null;
  cancelamentos_motivos?: BlocoMotivos | null;
  serie_diaria?: PontoDiaMl[] | null;
  sem_anterior?: Partial<Record<IndicadorMl, SemComparacao>> | null;
  pendencias?: { codigo: string; titulo: string; motivo: string }[] | null;
  atualizado_em?: string | null;
  aviso_frescor?: string | null;
  coleta_desde: string;
}

// ---------------------------------------------------------------------------
// Fetch (nunca lanca)
// ---------------------------------------------------------------------------
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
export const ROTA_API_CX_ML = "/api/v1/cx/mercadolivre";

export function urlCxMl(base: string, f: FiltrosCx): string {
  const qs = new URLSearchParams();
  if (f.marca) qs.set("brands", f.marca);
  qs.set("dias", String(f.dias));
  return `${base}${ROTA_API_CX_ML}?${qs.toString()}`;
}

export function problemaNoPayloadMl(json: unknown): string | null {
  if (!json || typeof json !== "object") return "corpo vazio";
  const o = json as Record<string, unknown>;
  if (!o.janela || typeof o.janela !== "object") return "janela ausente";
  const cob = o.cobertura as Record<string, unknown> | undefined;
  if (!cob || !Array.isArray(cob.marcas) || !Array.isArray(cob.fora)) return "cobertura ausente";
  if (!Array.isArray(o.marcas)) return "marcas ausentes";
  return null;
}

export type ResultadoMl = { ok: true; dados: CxMlResponse } | { ok: false; motivo: string };

export async function carregarCxMl(
  f: FiltrosCx,
  fetchImpl?: typeof fetch,
  base?: string,
  timeoutMs?: number,
  aoRepetir?: () => void,
): Promise<ResultadoMl> {
  return repetirSeEstourar(() => umaVez(f, fetchImpl, base, timeoutMs), aoRepetir);
}

async function umaVez(
  f: FiltrosCx,
  fetchImpl: typeof fetch = fetch,
  base: string = API_URL,
  timeoutMs: number = TIMEOUT_API_MS,
): Promise<ResultadoMl> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetchImpl(urlCxMl(base, f), { cache: "no-store", signal: controle.signal });
    } catch {
      return { ok: false, motivo: controle.signal.aborted ? MOTIVO_TIMEOUT : "Não foi possível contatar a API." };
    }
    if (!res.ok) return { ok: false, motivo: `A API respondeu ${res.status}.` };
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { ok: false, motivo: controle.signal.aborted ? MOTIVO_TIMEOUT : "Resposta inválida da API (o corpo não é JSON)." };
    }
    const problema = problemaNoPayloadMl(json);
    if (problema) return { ok: false, motivo: `Resposta inválida da API (${problema}).` };
    return { ok: true, dados: json as CxMlResponse };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Resumo: taxa de cada indicador somando as marcas (so' as que tem os dois lados da conta)
// ---------------------------------------------------------------------------
const num = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);

/** Taxa por dia somando as marcas; uma marca sem medida no dia anula o ponto, e um ponto nulo anula o grafico. */
function serieDe(d: CxMlResponse, i: IndicadorMl): number[] | null {
  const pontos = d.serie_diaria ?? [];
  const dias = [...new Set(pontos.map((p) => p.dia))].sort();
  if (!dias.length) return null;
  const campo = CAMPO[i];
  const taxas = dias.map((dia) => {
    const rows = pontos.filter((p) => p.dia === dia);
    if (rows.some((p) => num(p.pedidos) == null || num(p[campo]) == null)) return null;
    return razaoPct([[somar(rows.map((p) => p[campo])), somar(rows.map((p) => p.pedidos))]]);
  });
  return taxas.every((t): t is number => t != null) ? taxas : null;
}

export interface ResumoMl {
  pedidos: number | null;
  /** Taxa (% dos pedidos) e contagem de cada indicador no periodo. */
  taxa: Record<IndicadorMl, number | null>;
  contagem: Record<IndicadorMl, number | null>;
  comparacao: Record<IndicadorMl, ComparacaoCard | null>;
  semAnterior: Partial<Record<IndicadorMl, { texto: string; detalhe: string | null }>>;
  perguntas: number | null;
  perguntasSemResposta: number | null;
}

export function resumoMl(d: CxMlResponse): ResumoMl {
  const ms = d.marcas;
  const taxa = {} as ResumoMl["taxa"];
  const contagem = {} as ResumoMl["contagem"];
  const comparacao = {} as ResumoMl["comparacao"];
  const semAnterior: ResumoMl["semAnterior"] = {};
  for (const i of INDICADORES_ML) {
    const c = CAMPO[i];
    const ant = `${c}_anterior` as const;
    // so' conta a marca com os dois lados (reclamacao e pedidos); sem um deles, fica fora, nunca zero
    const com = ms.filter((m) => num(m[c]) != null && num(m.pedidos) != null);
    taxa[i] = razaoPct(com.map((m) => [m[c], m.pedidos]));
    contagem[i] = somar(com.map((m) => m[c]));
    const comAnt = com.filter((m) => num(m[ant]) != null && num(m.pedidos_anterior) != null);
    const antes = comAnt.length === com.length ? razaoPct(comAnt.map((m) => [m[ant], m.pedidos_anterior])) : null;
    const delta = taxa[i] != null && antes != null ? taxa[i]! - antes : null;
    const serie = serieDe(d, i);
    comparacao[i] =
      delta == null && !serie
        ? null
        : { delta, unidade: "pp", tone: "lower_is_better", antes: antes == null ? null : `antes ${pctCx(antes)}`, serie, granularidade: "day" };
    const sem = textoSemComparacao(d.sem_anterior?.[i]);
    if (sem) semAnterior[i] = sem;
  }
  const comPerg = ms.filter((m) => num(m.perguntas) != null);
  return {
    pedidos: somar(ms.map((m) => m.pedidos)),
    taxa,
    contagem,
    comparacao,
    semAnterior,
    perguntas: somar(comPerg.map((m) => m.perguntas)),
    perguntasSemResposta: somar(ms.map((m) => m.perguntas_sem_resposta)),
  };
}

// ---------------------------------------------------------------------------
// Tabelas por marca
// ---------------------------------------------------------------------------
export interface CelulaTaxa {
  pct: string;
  n: string;
  delta: DeltaCx | null;
  antes: string | null;
}

export interface LinhaProblemasMl {
  chave: string;
  marca: string;
  pedidos: string;
  celulas: Record<IndicadorMl, CelulaTaxa>;
  /** Para ordenar: a pior taxa de reclamacao primeiro, sem medida no fim. */
  ordem: number;
}

function celula(m: LinhaMl, i: IndicadorMl): CelulaTaxa {
  const c = CAMPO[i];
  const atual = razaoPct([[m[c], m.pedidos]]);
  const antes = razaoPct([[m[`${c}_anterior` as const], m.pedidos_anterior]]);
  return { pct: pctCx(atual), n: inteiro(m[c]), delta: deltaPp(atual, antes), antes: antes == null ? null : pctCx(antes) };
}

export function montarProblemasMl(d: CxMlResponse, rotuloMarca: (m: string) => string) {
  const linhas: LinhaProblemasMl[] = d.marcas
    .map((m) => ({
      chave: m.marca,
      marca: rotuloMarca(m.marca),
      pedidos: inteiro(m.pedidos),
      celulas: Object.fromEntries(INDICADORES_ML.map((i) => [i, celula(m, i)])) as Record<IndicadorMl, CelulaTaxa>,
      ordem: razaoPct([[m.reclamacoes, m.pedidos]]) ?? -1,
    }))
    .sort((a, b) => b.ordem - a.ordem);
  const r = resumoMl(d);
  return { linhas, pedidosTotal: inteiro(r.pedidos), resumo: r };
}

export interface PrazoMl {
  texto: string;
  vencido: boolean;
}

/** "vence em 5 h" / "venceu há 2 d"; sem prazo, "—". */
export function textoPrazo(prazo: string | null | undefined, agora: number): PrazoMl | null {
  const t = prazo ? Date.parse(prazo) : NaN;
  if (!Number.isFinite(t)) return null;
  const s = Math.abs(t - agora) / 1000;
  return t < agora ? { texto: `venceu há ${duracao(s)}`, vencido: true } : { texto: `vence em ${duracao(s)}`, vencido: false };
}

export interface LinhaAtendimentoMl {
  chave: string;
  marca: string;
  aguardando: string;
  vencidas: number;
  /** "2 vencidas · 1 vence em 24 h" */
  aguardandoDica: string | null;
  prazo: PrazoMl | null;
  perguntasSemResposta: string;
  tempoResposta: string;
  mensagens: string;
  /** Mediana da 1a acao nossa; "—" sem historico. */
  primeiraResposta: string;
  primeiraRespostaDica: string | null;
  /** Para ordenar: o que mais urge primeiro (vencidas, depois aguardando). */
  ordem: number;
}

export function montarAtendimentoMl(d: CxMlResponse, rotuloMarca: (m: string) => string, agora: number) {
  const linhas: LinhaAtendimentoMl[] = d.marcas.map((m) => {
    const venc = num(m.vencidas) ?? 0;
    const v24 = num(m.vencem_24h) ?? 0;
    const dicaFila = [venc ? `${inteiro(venc)} ${venc === 1 ? "vencida" : "vencidas"}` : null, v24 ? `${inteiro(v24)} ${v24 === 1 ? "vence" : "vencem"} em 24 h` : null]
      .filter(Boolean)
      .join(" · ");
    const hist = num(m.reclamacoes_com_historico);
    return {
      chave: m.marca,
      marca: rotuloMarca(m.marca),
      aguardando: inteiro(m.aguardando_nos),
      vencidas: venc,
      aguardandoDica: dicaFila || null,
      prazo: (num(m.aguardando_nos) ?? 0) > 0 ? textoPrazo(m.prazo_mais_antigo, agora) : null,
      perguntasSemResposta: inteiro(m.perguntas_sem_resposta),
      tempoResposta: m.tempo_resposta_min == null ? "—" : duracao(m.tempo_resposta_min * 60),
      mensagens: inteiro(m.mensagens_pendentes),
      primeiraResposta: m.resposta_mediana_h == null ? "—" : duracao(m.resposta_mediana_h * 3600),
      primeiraRespostaDica:
        hist == null ? null : `${inteiro(m.reclamacoes_respondidas)} com ação nossa em ${inteiro(hist)} reclamações com histórico lido`,
      ordem: venc * 1000 + (num(m.aguardando_nos) ?? 0),
    };
  });
  linhas.sort((a, b) => b.ordem - a.ordem);
  const total = {
    aguardando: inteiro(somar(d.marcas.map((m) => m.aguardando_nos))),
    perguntasSemResposta: inteiro(somar(d.marcas.map((m) => m.perguntas_sem_resposta))),
    mensagens: inteiro(somar(d.marcas.map((m) => m.mensagens_pendentes))),
  };
  return { linhas, total };
}

// ---------------------------------------------------------------------------
// Pareto: motivos das reclamacoes + dos cancelamentos juntos, sem drill por pedido
// ---------------------------------------------------------------------------
export const MAX_ITENS_PARETO_ML = 10;

export interface ItemParetoMl {
  chave: string;
  rotulo: string;
  tipo: "Reclamação" | "Cancelamento";
  natureza: string;
  quantidade: string;
  pct: string;
  largura: number;
  mapeado: boolean;
}

export interface VisaoParetoMl {
  estado: EstadoBloco;
  motivo: string | null;
  itens: ItemParetoMl[];
  resto: string | null;
}

export function montarParetoMl(d: CxMlResponse): VisaoParetoMl {
  const blocos: [ItemParetoMl["tipo"], BlocoMotivos | null | undefined][] = [
    ["Reclamação", d.reclamacoes_motivos],
    ["Cancelamento", d.cancelamentos_motivos],
  ];
  const brutos: (Motivo & { tipo: ItemParetoMl["tipo"] })[] = blocos
    .flatMap(([tipo, b]) => (b?.estado === "dado" ? b.itens.map((m) => ({ ...m, tipo })) : []))
    .filter((m) => m.quantidade > 0)
    .sort((a, b) => b.quantidade - a.quantidade || a.rotulo.localeCompare(b.rotulo));
  const total = brutos.reduce((a, m) => a + m.quantidade, 0);
  const maior = brutos[0]?.quantidade ?? 0;
  const fora = brutos.slice(MAX_ITENS_PARETO_ML);
  const somaFora = fora.reduce((a, m) => a + m.quantidade, 0);
  const falhou = blocos.some(([, b]) => b?.estado === "erro");
  const semFonte = blocos.every(([, b]) => !b || b.estado === "sem_fonte");
  return {
    estado: brutos.length ? "dado" : falhou ? "erro" : semFonte ? "sem_fonte" : "vazio_legitimo",
    motivo: brutos.length
      ? null
      : falhou
        ? "Fonte indisponível nesta carga."
        : semFonte
          ? (blocos.find(([, b]) => b?.motivo_indisponivel)?.[1]?.motivo_indisponivel ?? "Sem dados.")
          : "Nenhuma reclamação nem cancelamento no período.",
    itens: brutos.slice(0, MAX_ITENS_PARETO_ML).map((m) => ({
      chave: `${m.tipo}:${m.codigo}`,
      rotulo: m.rotulo,
      tipo: m.tipo,
      natureza: ROTULO_NATUREZA[m.natureza] ?? m.natureza,
      quantidade: inteiro(m.quantidade),
      pct: pctCx((m.quantidade / total) * 100),
      largura: maior ? Math.max(2, Math.round((m.quantidade / maior) * 100)) : 0,
      mapeado: m.mapeado,
    })),
    resto: fora.length ? `+ ${fora.length} motivo(s) com ${inteiro(somaFora)} caso(s) (${pctCx((somaFora / total) * 100)})` : null,
  };
}

// ---------------------------------------------------------------------------
// "O que exige atencao agora"
// ---------------------------------------------------------------------------
export interface ItemAtencaoMl {
  chave: string;
  severidade: "critico" | "atencao" | "info";
  titulo: string;
  detalhe: string | null;
}

export const MAX_ITENS_ATENCAO_ML = 8;
const ORDEM = { critico: 0, atencao: 1, info: 2 } as const;
const plural = (n: number, um: string, varios: string) => `${inteiro(n)} ${n === 1 ? um : varios}`;

export function itensAtencaoMl(d: CxMlResponse, rotuloMarca: (m: string) => string, agora: number): ItemAtencaoMl[] {
  const itens: ItemAtencaoMl[] = [];
  for (const m of d.marcas) {
    const marca = rotuloMarca(m.marca);
    const prazo = textoPrazo(m.prazo_mais_antigo, agora);
    if ((num(m.vencidas) ?? 0) > 0) {
      itens.push({
        chave: `${m.marca}:vencidas`,
        severidade: "critico",
        titulo: `${marca}: ${plural(m.vencidas!, "reclamação com prazo vencido", "reclamações com prazo vencido")}`,
        detalhe: prazo?.vencido ? `a mais antiga ${prazo.texto}` : null,
      });
    }
    if ((num(m.vencem_24h) ?? 0) > 0) {
      itens.push({
        chave: `${m.marca}:24h`,
        severidade: "atencao",
        titulo: `${marca}: ${plural(m.vencem_24h!, "reclamação vence", "reclamações vencem")} em 24 h`,
        detalhe: prazo && !prazo.vencido ? `a primeira ${prazo.texto}` : null,
      });
    }
    if ((num(m.perguntas_sem_resposta) ?? 0) > 0) {
      itens.push({
        chave: `${m.marca}:perguntas`,
        severidade: "atencao",
        titulo: `${marca}: ${plural(m.perguntas_sem_resposta!, "pergunta sem resposta", "perguntas sem resposta")}`,
        detalhe: null,
      });
    }
    if ((num(m.mensagens_pendentes) ?? 0) > 0) {
      itens.push({
        chave: `${m.marca}:mensagens`,
        severidade: "info",
        titulo: `${marca}: ${plural(m.mensagens_pendentes!, "mensagem pós-venda não lida", "mensagens pós-venda não lidas")}`,
        detalhe: null,
      });
    }
  }
  return itens
    .map((x, idx) => ({ x, idx }))
    .sort((a, b) => ORDEM[a.x.severidade] - ORDEM[b.x.severidade] || a.idx - b.idx)
    .map(({ x }) => x)
    .slice(0, MAX_ITENS_ATENCAO_ML);
}

// ---------------------------------------------------------------------------
// Textos do ⓘ (a metodologia mora aqui, nao na tela)
// ---------------------------------------------------------------------------
export const AJUDA_ML = {
  reclamacao:
    "Reclamações abertas no período (tipo mediação, sem os cancelamentos) ÷ pedidos criados no período, somando as marcas. Cálculo da Torre: não é a taxa de reputação do Mercado Livre, que tem regras e exclusões próprias. Sem faixa de cor porque não há meta definida.",
  cancelamento:
    "Solicitações de cancelamento (cancel_purchase e cancel_sale) abertas no período ÷ pedidos criados no período. Cálculo da Torre.",
  mediacao:
    "Reclamações que chegaram à mediação do Mercado Livre (etapa dispute), abertas no período ÷ pedidos criados no período. Cálculo da Torre.",
  perguntas:
    "Perguntas de pré-venda que ainda estão sem resposta agora (não segue o período). O Mercado Livre apaga as não respondidas depois de 7 meses.",
  aguardando:
    "Reclamações abertas em que a ação pendente é nossa (agora, não segue o período). Vencidas = prazo já passou.",
  prazo: "O prazo mais urgente entre as reclamações que aguardam nossa resposta.",
  tempoResposta:
    "Tempo médio de resposta às perguntas, valor OFICIAL do Mercado Livre (janela de 14 dias, atualizada uma vez por dia). Não segue o período do filtro.",
  mensagens: "Mensagens pós-venda não lidas, só a contagem (foto do dia). Nunca lemos o conteúdo.",
  primeiraResposta:
    "Mediana do tempo entre a abertura da reclamação e a primeira ação nossa (mensagem, devolução liberada…). É PARCIAL: o histórico de ações só foi lido para as cerca de 300 reclamações mais recentes de cada conta; reclamações sem ação nossa (resolvidas pelo Mercado Livre) não entram na mediana.",
  comparacao: (dias: number) => `A seta compara com os ${dias} dias anteriores, em pontos percentuais; subir é pior.`,
} as const;
