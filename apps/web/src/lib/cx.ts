/**
 * Aba CX (menu principal, 04/11/2026) — primeira versao, so' Shopee.
 *
 * `GET /api/v1/cx/shopee?brands=&dias=` junta:
 *   - chat: recorte de atendimento da Saude da Conta (fotografia diaria
 *     oficial, com a meta da Shopee);
 *   - atendimento: cancelamentos com motivo e pedidos em devolucao.
 * Mercado Livre e TikTok entram depois (dependem de permissao nos apps).
 *
 * Funcoes puras testadas em node --test; a pagina so' desenha a visao.
 */
import {
  JANELA_PADRAO,
  JANELAS_DIAS,
  problemaNoPayloadAtendimento,
  type AtendimentoResponse,
  type BlocoMotivos,
  ROTULO_NATUREZA,
  type CanalAtendimento,
  type EstadoBloco,
  type JanelaDias,
  type Motivo,
  textoJanela,
} from "./performance-contas-atendimento.ts";
import { formatarInstante, MOTIVO_TIMEOUT, repetirSeEstourar, TIMEOUT_API_MS } from "./performance-contas.ts";
import { valorMetrica, type ContaOficial } from "./expedicao-performance.ts";
import type { DeltaTone } from "./gerencial/kpi-band.ts";

export { JANELAS_DIAS, JANELA_PADRAO, type JanelaDias };

type ParamBruto = string | string[] | undefined;

export interface NaoLidas {
  marca: string;
  valor: number | null;
  capturado_em: string | null;
  /** Volume de conversas (get_conversation_list). Ausente/null = coleta ainda sem essa leitura. */
  conversas_7d?: number | null;
  conversas_30d?: number | null;
  aguardando_resposta?: number | null;
  /** true = a leitura bateu o teto de paginas: o numero e' um piso. */
  conversas_truncado?: boolean | null;
  /** API-3: conversas da foto de N dias atras; null = coleta ainda nao cobre (90 d: sempre null). */
  conversas_anterior?: number | null;
  /** Fila: das que aguardam resposta, quantas esperam ate' 1 h, 1-4 h, 4-24 h, mais de 24 h. */
  aguardando_ate_1h?: number | null;
  aguardando_1a4h?: number | null;
  aguardando_4a24h?: number | null;
  aguardando_mais_24h?: number | null;
  /** Espera da conversa mais antiga sem resposta (segundos). */
  espera_max_s?: number | null;
  /** Tempo de resposta no periodo (segundos): mediana (lojas com app) ou media do Seller Centre (Kokeshi). */
  tempo_resposta_s?: number | null;
  tempo_resposta_p90_s?: number | null;
  respostas?: number | null;
  respostas_ate_1h_pct?: number | null;
  respostas_desde?: string | null;
  tempo_resposta_fonte?: "mediana" | "media_seller_centre" | null;
}

export interface ChatShopee {
  estado: "dado" | "sem_fonte" | "erro";
  motivo?: string | null;
  fonte: string;
  /** API-3: `resposta_anterior_pct` = shopee_11 na foto de N dias antes (nao o last_period). */
  contas: (ContaOficial & { resposta_anterior_pct?: number | null })[];
  sem_foto: { marca: string; motivo: string }[];
  /** Coleta propria (`shopee_cx_coleta`), a cada 2 h. Ausente na API antiga. */
  nao_lidas_estado?: EstadoBloco;
  nao_lidas?: NaoLidas[];
}

export interface DevolucoesShopee {
  estado: EstadoBloco;
  fonte: string;
  motivo_indisponivel?: string | null;
  total?: number | null;
  aceitas?: number | null;
  em_andamento?: number | null;
  canceladas?: number | null;
  /** So' das aceitas. */
  reembolsado?: number | null;
  motivos?: BlocoMotivos | null;
  marcas: {
    marca: string;
    devolucoes: number | null;
    aceitas?: number | null;
    em_andamento?: number | null;
    canceladas?: number | null;
    reembolsado: number | null;
    /** API-3: na `janela_anterior`; null = coleta nao cobre. */
    aceitas_anterior?: number | null;
    reembolsado_anterior?: number | null;
  }[];
}

/** API-3: um ponto por dia x loja do recorte; campo null = nao medido naquele dia/loja. */
export interface PontoDiarioCx {
  dia: string;
  marca: string;
  pedidos: number | null;
  cancelamentos: number | null;
  devolucoes_aceitas: number | null;
  reembolsado: number | null;
  resposta_pct: number | null;
}

export interface CxShopeeResponse {
  gerado_em: string;
  janela: AtendimentoResponse["janela"];
  chat: ChatShopee;
  atendimento: CanalAtendimento;
  /** Ausente na API antiga: a pagina mostra "sem fonte". */
  devolucoes?: DevolucoesShopee;
  /** Base de `*_anterior` (os `dias` antes de `janela`). Ausente na API antiga. */
  janela_anterior?: AtendimentoResponse["janela"] | null;
  /**
   * API-3: por que um indicador nao tem periodo anterior e quando passa a ter.
   * A chave so' vem quando falta; `a_partir_de` null = nunca (ex.: contact rate em 90 dias).
   */
  sem_anterior?: Partial<Record<ChaveApiCx, SemComparacao>> | null;
  /** API-3: serie diaria por loja (o front agrega com a regra do card). */
  serie_diaria?: PontoDiarioCx[] | null;
  sem_serie?: Partial<Record<ChaveApiCx, SemComparacao>> | null;
}

/**
 * Comparacao de um card (API-3): delta na unidade do card, "antes" no formato
 * do valor e a serie do periodo. null = sem medida (sem pilula / sem grafico).
 */
export interface ComparacaoCard {
  delta: number | null;
  unidade: "pp" | "pct" | "pts";
  tone: DeltaTone;
  antes: string | null;
  serie: number[] | null;
  granularidade: "day" | "week" | "month";
}

/** API-3 (contrato com o Sextante, 09/11): por que falta a comparacao e quando ela passa a existir. */
export interface SemComparacao {
  /** Curto e minusculo: "coleta desde 04/11". */
  motivo: string;
  /** Primeiro dia com o mesmo recorte coberto; null = nunca. */
  a_partir_de: string | null;
  /** Texto longo, para o title. */
  detalhe?: string | null;
}

/**
 * Linha neutra do card, comecando pelo que o gestor procura: "comparação a
 * partir de 04/12" (ou "sem comparação", quando nunca). O motivo e o detalhe
 * ("coleta desde 04/11 · …") vao para o title e o sr-only.
 */
export function textoSemComparacao(x: SemComparacao | null | undefined): { texto: string; detalhe: string | null } | null {
  if (!x?.motivo) return null;
  const [a, m, d] = (x.a_partir_de ?? "").slice(0, 10).split("-");
  return {
    texto: a && m && d ? `comparação a partir de ${d}/${m}` : "sem comparação",
    // o detalhe ja' diz o motivo por extenso; sem ele, o motivo curto
    detalhe: x.detalhe || x.motivo,
  };
}

/** Chave do indicador na API-3 (`sem_anterior`, `sem_serie`). */
export type ChaveApiCx = "contact_rate" | "resposta" | "cancelamento" | "reembolso";

// ---------------------------------------------------------------------------
// Filtros (URL e' a fonte de verdade)
// ---------------------------------------------------------------------------
export interface FiltrosCx {
  marca: string | null;
  dias: JanelaDias;
}

function primeiro(v: ParamBruto): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function lerFiltrosCx(
  params: Readonly<Record<string, ParamBruto>>,
  marcasPermitidas: readonly string[],
): FiltrosCx {
  const marca = primeiro(params.brands)?.trim().toLowerCase();
  const dias = Number(primeiro(params.dias));
  return {
    marca: marca && marcasPermitidas.includes(marca) ? marca : null,
    dias: (JANELAS_DIAS as readonly number[]).includes(dias) ? (dias as JanelaDias) : JANELA_PADRAO,
  };
}

export function hrefCx(f: FiltrosCx): string {
  const qs = new URLSearchParams();
  if (f.marca) qs.set("brands", f.marca);
  if (f.dias !== JANELA_PADRAO) qs.set("dias", String(f.dias));
  const s = qs.toString();
  return s ? `/cx?${s}` : "/cx";
}

/**
 * CX-FILTROS-PADRAO: o `BrandFilter` do app e' multi-selecao; a CX le' UMA
 * marca na URL. Do que o filtro devolve, fica a marca recem-escolhida; vazio
 * (ou a mesma marca desmarcada) volta a "todas".
 */
export function marcaUnica(escolha: readonly string[], atual: string | null): string | null {
  return escolha.find((m) => m !== atual) ?? (atual && escolha.includes(atual) ? atual : null);
}

/** Resumo do botao "Filtros" no celular, no formato do `resumoDosFiltros` do app. */
export function resumoFiltrosCx(f: FiltrosCx, rotuloMarca: (m: string) => string): string {
  return ["Shopee", f.marca ? rotuloMarca(f.marca) : "Todas as marcas", `Últimos ${f.dias} dias`].join(" · ");
}

// ---------------------------------------------------------------------------
// Payload e fetch no servidor
// ---------------------------------------------------------------------------
export function problemaNoPayloadCx(json: unknown): string | null {
  if (!json || typeof json !== "object") return "corpo vazio";
  const o = json as Record<string, unknown>;
  const chat = o.chat as Record<string, unknown> | undefined;
  if (!chat || typeof chat !== "object" || !Array.isArray(chat.contas) || !Array.isArray(chat.sem_foto)) {
    return "chat ausente";
  }
  if (!o.atendimento || typeof o.atendimento !== "object") return "atendimento ausente";
  return problemaNoPayloadAtendimento({
    gerado_em: o.gerado_em,
    janela: o.janela,
    canais: [o.atendimento],
  });
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export const ROTA_API_CX_SHOPEE = "/api/v1/cx/shopee";

export function urlCxShopee(base: string, f: FiltrosCx): string {
  const qs = new URLSearchParams();
  if (f.marca) qs.set("brands", f.marca);
  qs.set("dias", String(f.dias));
  return `${base}${ROTA_API_CX_SHOPEE}?${qs.toString()}`;
}

export type ResultadoCx = { ok: true; dados: CxShopeeResponse } | { ok: false; motivo: string };

/** Nunca lanca: qualquer falha volta como `{ ok: false }` e a pagina mostra erro. */
/** Com uma nova tentativa se estourar o tempo (`repetirSeEstourar`). */
export async function carregarCxShopee(
  ...args: Parameters<typeof carregarCxShopeeUmaVez>
): ReturnType<typeof carregarCxShopeeUmaVez> {
  return repetirSeEstourar(() => carregarCxShopeeUmaVez(...args));
}

async function carregarCxShopeeUmaVez(
  f: FiltrosCx,
  fetchImpl: typeof fetch = fetch,
  base: string = API_URL,
  timeoutMs: number = TIMEOUT_API_MS,
): Promise<ResultadoCx> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetchImpl(urlCxShopee(base, f), { cache: "no-store", signal: controle.signal });
    } catch {
      if (controle.signal.aborted) return { ok: false, motivo: MOTIVO_TIMEOUT };
      return { ok: false, motivo: "Não foi possível contatar a API." };
    }
    if (!res.ok) return { ok: false, motivo: `A API respondeu ${res.status}.` };
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      if (controle.signal.aborted) return { ok: false, motivo: MOTIVO_TIMEOUT };
      return { ok: false, motivo: "Resposta inválida da API (o corpo não é JSON)." };
    }
    const problema = problemaNoPayloadCx(json);
    if (problema) return { ok: false, motivo: `Resposta inválida da API (${problema}).` };
    return { ok: true, dados: json as CxShopeeResponse };
  } finally {
    clearTimeout(timer);
  }
}

const FMT_INT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const FMT_PCT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const FMT_BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function inteiro(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : FMT_INT.format(v);
}

function pct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${FMT_PCT.format(v)}%`;
}

export function reais(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : FMT_BRL.format(v);
}

/** Soma ignorando ausentes; tudo ausente = null (nunca zero). */
function somar(vals: (number | null | undefined)[]): number | null {
  const ok = vals.filter((v): v is number => v != null && Number.isFinite(v));
  return ok.length ? ok.reduce((a, b) => a + b, 0) : null;
}

// ---------------------------------------------------------------------------
// Bloco 1 — Atendimento (planilha 1.2: nº de chats, em aberto, % respondido,
// tempo de resposta, contact rate). Uma linha por loja Shopee.
// ---------------------------------------------------------------------------
export const COD_RESPONDIDO = "shopee_11";
export const COD_NOTA = "shopee_22";

export interface CelulaMeta {
  valor: string;
  fora: boolean;
  meta: string | null;
}

export interface LinhaAtendimentoCx {
  chave: string;
  marca: string;
  conversas: string;
  /** Aguardando resposta ÷ conversas do periodo; "—" sem as duas leituras. */
  aguardandoPct: string;
  /** Contagem (vai no title/texto pequeno). */
  aguardando: string;
  naoLidas: string;
  respondido: CelulaMeta | null;
  nota: CelulaMeta | null;
  contactRate: string;
  /** Nota da loja (Saude da Conta) em numero, para ordenar pior primeiro; null sem nota. */
  notaNum: number | null;
  /** Mediana (ou media, Kokeshi) do tempo de resposta; "—" sem medida. */
  tempoResposta: string;
  /** Detalhe do tempo (p90, % em ate' 1 h), para o title da celula. */
  tempoDetalhe: string | null;
}

export interface LinhaFilaCx {
  chave: string;
  marca: string;
  ate1h: string;
  de1a4h: string;
  de4a24h: string;
  mais24h: string;
  /** true = ha' conversa esperando ha' mais de 24 h. */
  atrasada: boolean;
  maisAntiga: string;
}

export interface VisaoAtendimentoCx {
  estado: "dado" | "sem_fonte" | "erro";
  motivo: string | null;
  rotuloConversas: string;
  totais: {
    conversas: string;
    aguardando: string;
    /** Aguardando ÷ conversas, so' nas lojas com as duas leituras. */
    aguardandoPct: string;
    naoLidas: string;
    mais24h: string;
    foraDaMeta: string[];
  };
  linhas: LinhaAtendimentoCx[];
  /** Fila do chat por loja (so' lojas com a leitura das faixas). */
  fila: LinhaFilaCx[];
  /** Uma nota por coisa que falta, no rodape (ausencia nunca parece zero). */
  notas: string[];
}

/** Duracao legivel: "< 1 min", "12 min", "2 h 05", "3 d 4 h". */
export function duracao(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s) || s < 0) return "—";
  if (s < 60) return "< 1 min";
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")}`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

function tempoDaLoja(n: NaoLidas | undefined): { tempo: string; detalhe: string | null } {
  if (!n || n.tempo_resposta_s == null) return { tempo: "—", detalhe: null };
  if (n.tempo_resposta_fonte === "media_seller_centre") {
    return { tempo: `${duracao(n.tempo_resposta_s)} (média)`, detalhe: "Média do Seller Centre (bot)." };
  }
  const partes = [
    n.respostas != null ? `${inteiro(n.respostas)} respostas` : null,
    n.tempo_resposta_p90_s != null ? `9 em cada 10 em até ${duracao(n.tempo_resposta_p90_s)}` : null,
    n.respostas_ate_1h_pct != null ? `${pct(n.respostas_ate_1h_pct)} em até 1 h` : null,
  ].filter(Boolean);
  return { tempo: duracao(n.tempo_resposta_s), detalhe: partes.length ? partes.join(" · ") : null };
}

type MetricaCx = ContaOficial["metricas"][number];


/** % com 1 casa, como o resto da aba; nota com 2 (com uma, 4,77 e 4,83 viram o mesmo 4,8 e a pior some). */
export function valorOficial(m: Pick<MetricaCx, "codigo" | "valor" | "unidade">): string {
  if (m.valor == null || !Number.isFinite(m.valor)) return valorMetrica(m);
  if (m.codigo === COD_NOTA) return FMT_NOTA.format(m.valor);
  return m.unidade === "pct" ? pct(m.valor) : valorMetrica(m);
}

function celulaMeta(conta: ContaOficial | undefined, codigo: string): CelulaMeta | null {
  const m = conta?.metricas.find((x) => x.codigo === codigo);
  if (!m) return null;
  return { valor: valorOficial(m), fora: m.situacao === "fora", meta: metaDaMetrica(m) };
}

export function montarAtendimentoCx(
  dados: Pick<CxShopeeResponse, "chat" | "atendimento" | "janela">,
  rotuloMarca: (m: string) => string,
): VisaoAtendimentoCx {
  const { chat, atendimento } = dados;
  const dias = dados.janela.dias;
  const usa7 = dias === 7;
  const comContactRate = dias === 7 || dias === 30;
  const contas = new Map(chat.contas.map((c) => [c.marca, c]));
  const fotos = chat.nao_lidas_estado === "dado" ? chat.nao_lidas ?? [] : [];
  const conversas = new Map(fotos.map((n) => [n.marca, n]));
  const pedidos = new Map(atendimento.marcas.map((m) => [m.marca, m.pedidos]));
  const marcas = [...contas.keys(), ...[...conversas.keys()].filter((m) => !contas.has(m))];

  const brutas = marcas.map((m) => {
    const n = conversas.get(m);
    const conv = n ? ((usa7 ? n.conversas_7d : n.conversas_30d) ?? null) : null;
    return { m, n, conv, ped: pedidos.get(m) ?? null };
  });
  const linhas: LinhaAtendimentoCx[] = brutas.map(({ m, n, conv, ped }) => ({
    chave: m,
    marca: rotuloMarca(m),
    conversas: conv == null ? "—" : `${n?.conversas_truncado ? "≥ " : ""}${inteiro(conv)}`,
    // conversas truncadas sao piso, entao o % e' teto
    aguardandoPct: conv && n?.aguardando_resposta != null ? `${n.conversas_truncado ? "≤ " : ""}${pct((n.aguardando_resposta / conv) * 100)}` : "—",
    aguardando: inteiro(n?.aguardando_resposta),
    naoLidas: inteiro(n?.valor),
    respondido: celulaMeta(contas.get(m), COD_RESPONDIDO),
    nota: celulaMeta(contas.get(m), COD_NOTA),
    notaNum: contas.get(m)?.metricas.find((x) => x.codigo === COD_NOTA)?.valor ?? null,
    contactRate: comContactRate && conv != null && ped ? pct((conv / ped) * 100) : "—",
    tempoResposta: tempoDaLoja(n).tempo,
    tempoDetalhe: tempoDaLoja(n).detalhe,
  }));
  const fila: LinhaFilaCx[] = brutas
    .filter(({ n }) => n?.aguardando_ate_1h != null)
    .map(({ m, n }) => ({
      chave: m,
      marca: rotuloMarca(m),
      ate1h: inteiro(n?.aguardando_ate_1h),
      de1a4h: inteiro(n?.aguardando_1a4h),
      de4a24h: inteiro(n?.aguardando_4a24h),
      mais24h: inteiro(n?.aguardando_mais_24h),
      atrasada: (n?.aguardando_mais_24h ?? 0) > 0,
      maisAntiga: duracao(n?.espera_max_s),
    }));

  const notas: string[] = [];
  if (chat.nao_lidas_estado === "erro") {
    notas.push("Conversas indisponíveis nesta carga.");
  } else if (brutas.every((b) => b.conv == null)) {
    notas.push("Conversas e contact rate: aguardando a coleta com a lista de conversas (shopee_cx_coleta, a cada 2 h).");
  }
  if (!comContactRate) notas.push("Conversas cobrem os últimos 30 dias; contact rate só em 7 e 30 dias.");
  if (brutas.every((b) => b.n?.tempo_resposta_s == null)) {
    notas.push("Tempo de resposta: aguardando as primeiras respostas medidas pela coleta (a cada 2 h).");
  } else {
    const inicio = new Date(`${dados.janela.inicio}T00:00:00-03:00`).getTime();
    const desde = brutas
      .map((b) => b.n?.respostas_desde)
      .filter((d): d is string => !!d)
      .map((d) => new Date(d).getTime())
      .filter((t) => Number.isFinite(t) && t > inicio);
    if (desde.length) {
      const dia = new Date(Math.min(...desde)).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
      notas.push(`Tempo de resposta medido desde ${dia} (início da coleta): o período ainda não está completo.`);
    }
  }
  if (brutas.some((b) => b.n?.conversas_truncado)) {
    notas.push("“≥” = a loja tem mais conversas do que a coleta leu: o número é um piso.");
  }
  notas.push(...chat.sem_foto.map((s) => `${rotuloMarca(s.marca)}: ${s.motivo}`));

  return {
    estado: linhas.length ? "dado" : chat.estado === "erro" ? "erro" : "sem_fonte",
    motivo: linhas.length ? null : (chat.motivo ?? "Nenhuma loja Shopee no filtro."),
    rotuloConversas: usa7 ? "Conversas (7 dias)" : "Conversas (30 dias)",
    totais: {
      // conversas truncadas sao piso: o total tambem
      conversas: (() => {
        const t = inteiro(somar(brutas.map((b) => b.conv)));
        return t !== "—" && brutas.some((b) => b.conv != null && b.n?.conversas_truncado) ? `≥ ${t}` : t;
      })(),
      aguardando: inteiro(somar(brutas.map((b) => b.n?.aguardando_resposta))),
      aguardandoPct: (() => {
        const v = razaoPct(brutas.map((b) => [b.n?.aguardando_resposta, b.conv]));
        return v != null && brutas.some((b) => b.n?.conversas_truncado) ? `≤ ${pct(v)}` : pct(v);
      })(),
      naoLidas: inteiro(somar(brutas.map((b) => b.n?.valor))),
      mais24h: inteiro(somar(brutas.map((b) => b.n?.aguardando_mais_24h))),
      foraDaMeta: linhas.filter((l) => l.respondido?.fora).map((l) => l.marca),
    },
    linhas,
    fila,
    notas,
  };
}

// ---------------------------------------------------------------------------
// Avaliacao da loja (Saude da Conta, metric_id 22 "Shop Rating"): a media das
// notas que os compradores deram a loja, 0 a 5, com a meta da propria Shopee.
// ---------------------------------------------------------------------------
export interface AvaliacaoLojaCx {
  /** "meta ≥ 4,5" quando vier igual para todas as lojas. */
  meta: string | null;
  /** Da pior para a melhor; so' lojas com nota (sem nota nao aparece, nunca vira zero). */
  itens: { chave: string; marca: string; nota: string; fora: boolean; pior: boolean }[];
}

const SINAL_META: Record<string, string> = { ">=": "≥", "<=": "≤", ">": ">", "<": "<" };
/** Duas casas: com uma, 4,77 e 4,83 viram o mesmo 4,8 e a pior some. */
const FMT_NOTA = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function montarAvaliacaoLoja(
  dados: Pick<CxShopeeResponse, "chat">,
  rotuloMarca: (m: string) => string,
): AvaliacaoLojaCx | null {
  const comNota = dados.chat.contas
    .map((c) => ({ marca: c.marca, m: c.metricas.find((x) => x.codigo === COD_NOTA) }))
    .filter((x): x is { marca: string; m: ContaOficial["metricas"][number] & { valor: number } } =>
      x.m?.valor != null && Number.isFinite(x.m.valor),
    )
    .sort((a, b) => a.m.valor - b.m.valor || a.marca.localeCompare(b.marca));
  if (!comNota.length) return null;
  const metas = [
    ...new Set(
      comNota.map(({ m }) =>
        m.meta == null ? null : `meta ${SINAL_META[m.comparador ?? ""] ?? m.comparador ?? ""} ${valorMetrica({ valor: m.meta, unidade: m.unidade })}`.replace(/\s+/g, " "),
      ),
    ),
  ];
  return {
    meta: metas.length === 1 ? metas[0] : null,
    itens: comNota.map(({ marca, m }, i) => ({
      chave: marca,
      marca: rotuloMarca(marca),
      nota: FMT_NOTA.format(m.valor),
      fora: m.situacao === "fora",
      pior: i === 0 && comNota.length > 1,
    })),
  };
}

// ---------------------------------------------------------------------------
// Ajuda dos numeros (o "ⓘ" ao lado do rotulo; a tela fica so' com o numero)
// ---------------------------------------------------------------------------
export const AJUDA_CX = {
  conversas:
    "Conversas do chat da Shopee com mensagem no período (7 ou 30 dias, pela última mensagem). Cada comprador conta uma vez, mesmo que mande várias mensagens.",
  aguardando: "Conversas em que a última mensagem é do comprador: ele está esperando a loja responder.",
  aguardandoPct:
    "Conversas esperando a resposta da loja na última leitura do chat ÷ conversas do período. Embaixo, a contagem.",
  cancelamentosMarca:
    "Cancelados ÷ pedidos do período (embaixo, a contagem); os não pagos, que a Shopee cancela sozinha, ficam de fora. A seta compara com o período anterior de mesmo tamanho, em pontos percentuais; subir é pior.",
  devolucoesMarca:
    "Pedidos de devolução ou reembolso abertos pelo comprador ÷ pedidos do período (embaixo, a contagem). Os que o próprio comprador cancelou ficam de fora.",
  reembolsadoMarca: "Valor reembolsado nas devoluções aceitas; ao lado, devoluções aceitas ÷ pedidos.",
  avaliacao:
    "Nota da loja na Saúde da Conta da Shopee: a média das avaliações que os compradores deram à loja, de 0 a 5. A meta é a da própria Shopee. Em destaque, a pior.",
  naoLidas: "Conversas com mensagem ainda não aberta pela loja, na última leitura do chat (a cada 2 h).",
  contactRate: "Conversas ÷ pedidos do período: de cada 100 pedidos, quantos viraram conversa no chat.",
  tempoResposta:
    "Mediana do tempo entre a primeira mensagem do comprador e a resposta da loja, no período (relógio corrido, sem as respostas automáticas). Metade das respostas sai mais rápido que isso. Kokeshi: média do Seller Centre.",
  fila:
    "Conversas em que a última mensagem é do comprador, separadas por quanto tempo ele está esperando, na última leitura do chat (a cada 2 h).",
  mais24h: "Conversas em que o comprador está esperando a resposta da loja há mais de 24 horas.",
  cancelamentos:
    "Pedidos criados no período e cancelados, por qualquer autor (comprador, loja, Shopee ou logística). Os pedidos não pagos, que a Shopee cancela sozinha, ficam de fora.",
  devolucoes:
    "Pedidos de devolução ou reembolso abertos pelo comprador no período. Os que o próprio comprador cancelou ficam de fora.",
  status:
    "Classificação oficial da Saúde da Conta da Shopee (Excelente, Bom, Precisa melhorar ou Ruim). Em vermelho, as métricas fora da meta da Shopee.",
} as const;

// ---------------------------------------------------------------------------
// Status por marca (visao com todas as marcas): a nota oficial da Shopee e o
// que esta' fora da meta, para achar a loja com problema sem ler a tabela.
// ---------------------------------------------------------------------------
export type TomStatus = "bom" | "atencao" | "critico" | "neutro" | "ausente";

export interface StatusMarca {
  chave: string;
  marca: string;
  tom: TomStatus;
  /** Nivel oficial ("Bom") ou o motivo de nao haver foto. */
  rotulo: string;
  /** Metricas fora da meta: "Taxa de resposta do chat 45,3% (meta >= 60)". */
  alertas: string[];
  aguardando: string;
  cancelamento: string;
  devolucoes: string;
}

const ORDEM_TOM: Record<TomStatus, number> = { critico: 0, atencao: 1, neutro: 2, bom: 3, ausente: 4 };

export function montarStatusMarcas(
  dados: Pick<CxShopeeResponse, "chat" | "atendimento" | "devolucoes">,
  rotuloMarca: (m: string) => string,
): StatusMarca[] {
  const { chat, atendimento, devolucoes } = dados;
  const contas = new Map(chat.contas.map((c) => [c.marca, c]));
  const semFoto = new Map(chat.sem_foto.map((s) => [s.marca, s.motivo]));
  const fotos = new Map((chat.nao_lidas_estado === "dado" ? chat.nao_lidas ?? [] : []).map((n) => [n.marca, n]));
  const pedidos = new Map(atendimento.marcas.map((m) => [m.marca, m]));
  const dev = new Map((devolucoes?.estado === "dado" ? devolucoes.marcas : []).map((m) => [m.marca, m]));
  const marcas = [...new Set([...pedidos.keys(), ...contas.keys(), ...semFoto.keys()])];

  return marcas
    .map((m): StatusMarca => {
      const conta = contas.get(m);
      const d = dev.get(m);
      const base = {
        chave: m,
        marca: rotuloMarca(m),
        aguardando: inteiro(fotos.get(m)?.aguardando_resposta),
        cancelamento: pct(pedidos.get(m)?.taxa_cancelamento_pct),
        devolucoes: inteiro(d?.devolucoes == null ? null : d.devolucoes - (d.canceladas ?? 0)),
      };
      if (!conta) {
        return { ...base, tom: "ausente", rotulo: "Sem Saúde da Conta", alertas: semFoto.has(m) ? [semFoto.get(m)!] : [] };
      }
      const alertas = conta.metricas
        .filter((x) => x.situacao === "fora")
        .map((x) => {
          const meta = metaDaMetrica(x);
          return `${x.rotulo} ${valorOficial(x)}${meta ? ` (${meta})` : ""}`;
        });
      // Tom e' o da propria Shopee (nivel); metrica fora da meta nunca fica verde.
      const tom: TomStatus = alertas.length && conta.tom === "bom" ? "atencao" : conta.tom;
      return { ...base, tom, rotulo: conta.nivel ?? "Sem nível", alertas };
    })
    .sort((a, b) => ORDEM_TOM[a.tom] - ORDEM_TOM[b.tom] || a.marca.localeCompare(b.marca));
}

// ---------------------------------------------------------------------------
// Bloco 2 — Pareto dos problemas (planilha 1.1: motivos + quanto
// reembolsamos, reenviamos e cancelamos). Devolucoes e cancelamentos juntos.
// ---------------------------------------------------------------------------
export const MAX_ITENS_PARETO = 10;
export const MOTIVO_REENVIO = "a Shopee não informa reenvio (nenhuma API dela marca o pedido reenviado)";

export interface ItemPareto {
  chave: string;
  /** Codigo do motivo na API (abre a lista de pedidos dele). */
  codigo: string;
  rotulo: string;
  tipo: "Devolução" | "Cancelamento";
  natureza: string;
  quantidade: string;
  pct: string;
  acumulado: string;
  /** 0-100, relativo ao maior motivo. */
  largura: number;
  mapeado: boolean;
}

export interface VisaoPareto {
  estado: EstadoBloco;
  motivo: string | null;
  totais: { reembolsado: string; devolucoes: string; cancelamentos: string; reenviados: string };
  itens: ItemPareto[];
  /** Motivos fora do top, somados numa linha. */
  resto: string | null;
  linhas: {
    chave: string;
    marca: string;
    pedidos: string;
    /** % dos pedidos; a contagem fica em `cancelamentos`/`devolucoes`. */
    cancelamentosPct: string;
    cancelamentos: string;
    /** Contra a janela anterior; null = sem historico. */
    cancelamentoDelta: DeltaCx | null;
    cancelamentoAntes: string | null;
    devolucoesPct: string;
    devolucoes: string;
    reembolsado: string;
    /** Devolucoes aceitas ÷ pedidos (a mesma taxa do card da Gerencial). */
    reembolsoPct: string | null;
  }[];
  /** Linha de total da tabela por marca (as mesmas contas, somando as lojas). */
  total: {
    pedidos: string;
    cancelamentosPct: string;
    cancelamentoDelta: DeltaCx | null;
    cancelamentoAntes: string | null;
    devolucoesPct: string;
    devolucoes: string;
    reembolsado: string;
    reembolsoPct: string | null;
  };
  notas: string[];
}

export function montarPareto(
  dados: Pick<CxShopeeResponse, "atendimento" | "devolucoes">,
  rotuloMarca: (m: string) => string,
): VisaoPareto {
  const dev = dados.devolucoes;
  const can = dados.atendimento;
  const blocoDev = dev?.estado === "dado" && dev.motivos?.estado === "dado" ? dev.motivos : null;
  const blocoCan = can.motivos?.estado === "dado" ? can.motivos : null;

  const brutos: (Motivo & { tipo: ItemPareto["tipo"] })[] = [
    ...(blocoDev?.itens ?? []).map((m) => ({ ...m, tipo: "Devolução" as const })),
    ...(blocoCan?.itens ?? []).map((m) => ({ ...m, tipo: "Cancelamento" as const })),
  ]
    .filter((m) => m.quantidade > 0)
    .sort((a, b) => b.quantidade - a.quantidade || a.rotulo.localeCompare(b.rotulo));
  const total = brutos.reduce((a, m) => a + m.quantidade, 0);
  const maior = brutos[0]?.quantidade ?? 0;
  let acum = 0;
  const todos: ItemPareto[] = brutos.map((m) => {
    acum += m.quantidade;
    return {
      chave: `${m.tipo}:${m.codigo}`,
      codigo: m.codigo,
      rotulo: m.rotulo,
      tipo: m.tipo,
      natureza: ROTULO_NATUREZA[m.natureza] ?? m.natureza,
      quantidade: inteiro(m.quantidade),
      pct: pct((m.quantidade / total) * 100),
      acumulado: pct((acum / total) * 100),
      largura: maior ? Math.max(2, Math.round((m.quantidade / maior) * 100)) : 0,
      mapeado: m.mapeado,
    };
  });
  const fora = brutos.slice(MAX_ITENS_PARETO);
  const somaFora = fora.reduce((a, m) => a + m.quantidade, 0);

  const devMarca = new Map((dev?.estado === "dado" ? dev.marcas : []).map((m) => [m.marca, m]));
  const canMarca = new Map(can.marcas.map((m) => [m.marca, m]));
  const marcas = [...canMarca.keys(), ...[...devMarca.keys()].filter((m) => !canMarca.has(m))];
  /** Devolucoes sem as que o proprio comprador cancelou (a mesma base do Pareto). */
  const liquidas = (m: { devolucoes: number | null; canceladas?: number | null } | undefined) =>
    m?.devolucoes == null ? null : m.devolucoes - (m.canceladas ?? 0);

  const notas: string[] = [];
  if (!blocoDev) {
    notas.push(
      dev?.motivo_indisponivel ?? dev?.motivos?.motivo_indisponivel ??
        "Devoluções: aguardando a coleta da Shopee (shopee_cx_coleta).",
    );
  }
  if (!blocoCan && can.motivos?.motivo_indisponivel) notas.push(`Cancelamentos: ${can.motivos.motivo_indisponivel}`);
  for (const b of [blocoDev, blocoCan]) {
    if (b?.excluidos && b.rotulo_excluidos) notas.push(`${inteiro(b.excluidos)} ${b.rotulo_excluidos}.`);
  }
  notas.push(`Reenvios: ${MOTIVO_REENVIO}; sem fonte ainda.`);

  const erro = dev?.estado === "erro" || can.motivos?.estado === "erro";
  // Total: so' as lojas com os dois lados de cada conta (sem historico fica fora da seta).
  const comHist = can.marcas.filter((m) => m.pedidos_anterior != null);
  const cancTotal = razaoPct(can.marcas.map((m) => [m.cancelamentos, m.pedidos]));
  const cancAntesTotal = razaoPct(comHist.map((m) => [m.cancelamentos_anterior, m.pedidos_anterior]));
  const cancAtualHist = razaoPct(comHist.map((m) => [m.cancelamentos, m.pedidos]));
  const devTotal = somar(marcas.map((m) => liquidas(devMarca.get(m))));
  const linhaTotal = {
    pedidos: inteiro(somar(can.marcas.map((m) => m.pedidos))),
    cancelamentosPct: pct(cancTotal),
    cancelamentoDelta: deltaPp(cancAtualHist, cancAntesTotal),
    cancelamentoAntes: cancAntesTotal == null ? null : pct(cancAntesTotal),
    devolucoesPct: pct(razaoPct(marcas.map((m) => [liquidas(devMarca.get(m)), canMarca.get(m)?.pedidos]))),
    devolucoes: inteiro(devTotal),
    reembolsado: dev?.estado === "dado" ? reais(dev.reembolsado) : "—",
    reembolsoPct: (() => {
      const v = razaoPct(marcas.map((m) => [devMarca.get(m)?.aceitas, canMarca.get(m)?.pedidos]));
      return v == null ? null : pct(v);
    })(),
  };
  return {
    total: linhaTotal,
    estado: todos.length ? "dado" : erro ? "erro" : blocoDev || blocoCan ? "vazio_legitimo" : "sem_fonte",
    motivo: todos.length ? null : erro ? "Fonte indisponível nesta carga." : "Nenhum problema registrado no período.",
    totais: {
      reembolsado: dev?.estado === "dado" ? reais(dev.reembolsado) : "—",
      devolucoes: inteiro(blocoDev?.total),
      cancelamentos: inteiro(somar(can.marcas.map((m) => m.cancelamentos))),
      reenviados: "—",
    },
    itens: todos.slice(0, MAX_ITENS_PARETO),
    resto: fora.length
      ? `+ ${fora.length} motivo(s) com ${inteiro(somaFora)} caso(s) (${pct((somaFora / total) * 100)})`
      : null,
    linhas: marcas.map((m) => {
      const c = canMarca.get(m);
      const d = devMarca.get(m);
      const atual = razaoPct([[c?.cancelamentos, c?.pedidos]]);
      const antes = razaoPct([[c?.cancelamentos_anterior, c?.pedidos_anterior]]);
      const reemb = razaoPct([[d?.aceitas, c?.pedidos]]);
      return {
        chave: m,
        marca: rotuloMarca(m),
        pedidos: inteiro(c?.pedidos),
        cancelamentosPct: pct(atual),
        cancelamentos: inteiro(c?.cancelamentos),
        cancelamentoDelta: deltaPp(atual, antes),
        cancelamentoAntes: antes == null ? null : pct(antes),
        devolucoesPct: pct(razaoPct([[liquidas(d), c?.pedidos]])),
        devolucoes: inteiro(liquidas(d)),
        reembolsado: d ? reais(d.reembolsado) : "—",
        reembolsoPct: reemb == null ? null : pct(reemb),
      };
    }),
    notas,
  };
}

// ---------------------------------------------------------------------------
// Resumo da Gerencial (GERENCIAL-CX, 07/11/2026): uma taxa por tile, somando
// as lojas do filtro. Cada taxa so' usa a marca que tem os dois lados da
// conta (Kokeshi sem chat fica fora do contact rate, nunca vira zero).
// ---------------------------------------------------------------------------
type Num = number | null | undefined;

function razaoPct(pares: [Num, Num][]): number | null {
  const ok = pares.filter((p): p is [number, number] => p[0] != null && p[1] != null && Number.isFinite(p[0]) && p[1] > 0);
  if (!ok.length) return null;
  return (ok.reduce((a, p) => a + p[0], 0) / ok.reduce((a, p) => a + p[1], 0)) * 100;
}

export type IndicadorCx = "contactRate" | "resposta" | "cancelamento" | "reembolso";
export const INDICADORES_CX: readonly IndicadorCx[] = ["contactRate", "resposta", "cancelamento", "reembolso"];
export const ROTULO_INDICADOR: Record<IndicadorCx, string> = {
  contactRate: "Contact rate",
  // NOME-UNICO: o nome da Saude da Conta (shopee_11), o mesmo da API e do Seller Centre.
  resposta: "Taxa de resposta do chat",
  cancelamento: "Cancelamento",
  reembolso: "Reembolso",
};
/** Na taxa de resposta, CAIR e' pior; nos outros tres, subir e' pior. */
export const MENOR_E_PIOR: ReadonlySet<IndicadorCx> = new Set<IndicadorCx>(["resposta"]);

/**
 * Regra de risco (v3/v4, 07/11/2026). A base de cada indicador e' a MEDIANA
 * das marcas medidas, cada marca com o mesmo peso: a taxa da Shopee e'
 * ponderada por pedidos e a Kokeshi (64% dos pedidos, taxas baixas) a puxava
 * para baixo. Com menos de 3 marcas medidas nao ha comparacao justa: o
 * indicador nao marca ninguem. Fora da curva = passa de 1,2x a mediana (ou,
 * na taxa de resposta, fica abaixo de mediana / 1,2). Cor pela contagem
 * (0 verde, 1 ambar, 2+ vermelho); ordem pela soma do excesso relativo.
 */
export const FOLGA_RISCO = 1.2;
/** Quantas marcas a linha "Atenção" mostra. */
export const MAX_ALERTAS = 2;
/** Nome curto do indicador na linha "Atenção". */
export const ROTULO_CURTO: Record<IndicadorCx, string> = {
  contactRate: "contact rate",
  resposta: "resposta do chat",
  cancelamento: "cancelamento",
  reembolso: "reembolso",
};
export const MIN_MARCAS_RISCO = 3;
/** shortcut: resposta 0% teria excesso infinito; o teto so' ordena, trocar se 0% virar caso real. */
const TETO_EXCESSO = 10;
export const AJUDA_RISCO =
  "Uma marca fica fora da curva quando passa de 1,2× a mediana das marcas em contact rate, cancelamento ou reembolso (subir é pior), ou quando a taxa de resposta do chat fica abaixo da mediana ÷ 1,2 (cair é pior). Cada marca pesa igual; com menos de 3 marcas medidas, o indicador não conta. Aparecem até 2 marcas, as mais fora, cada uma com o pior indicador. Âmbar: um indicador fora. Vermelho: dois ou mais. Taxa de resposta do chat abaixo da meta oficial da Shopee deixa a marca vermelha e em primeiro, mostrando a meta no lugar da mediana.";

/** Mediana; null com menos de `MIN_MARCAS_RISCO` valores. */
export function medianaRisco(vals: number[]): number | null {
  if (vals.length < MIN_MARCAS_RISCO) return null;
  const o = [...vals].sort((a, b) => a - b);
  const meio = Math.floor(o.length / 2);
  return o.length % 2 ? o[meio] : (o[meio - 1] + o[meio]) / 2;
}

/** Quanto a marca esta' alem da mediana, no sentido do pior (0 = na mediana). */
export function excessoRelativo(i: IndicadorCx, valor: number, mediana: number): number {
  if (MENOR_E_PIOR.has(i)) return valor > 0 ? mediana / valor - 1 : TETO_EXCESSO;
  return valor / mediana - 1;
}

export function foraDaCurva(i: IndicadorCx, valor: number | null, mediana: number | null): boolean {
  if (valor == null || mediana == null || mediana <= 0) return false;
  return MENOR_E_PIOR.has(i) ? valor < mediana / FOLGA_RISCO : valor > mediana * FOLGA_RISCO;
}

/**
 * Media da taxa de resposta: ponderada pelas conversas quando TODA marca com
 * taxa tem conversas medidas (> 0); senao, media simples. Nada medido = null.
 */
export function mediaResposta(
  itens: { valor: number | null; peso: number | null }[],
): { valor: number | null; tipo: "ponderada" | "simples" | null } {
  const ok = itens.filter((x): x is { valor: number; peso: number | null } => x.valor != null && Number.isFinite(x.valor));
  if (!ok.length) return { valor: null, tipo: null };
  if (ok.every((x) => x.peso != null && x.peso > 0)) {
    const peso = ok.reduce((a, x) => a + x.peso!, 0);
    return { valor: ok.reduce((a, x) => a + x.valor * x.peso!, 0) / peso, tipo: "ponderada" };
  }
  return { valor: ok.reduce((a, x) => a + x.valor, 0) / ok.length, tipo: "simples" };
}

export interface MarcaCx {
  chave: string;
  marca: string;
  /** Taxa (%) por indicador; null = sem medida para a marca. */
  valores: Record<IndicadorCx, number | null>;
  /** Numerador / denominador (ou a meta, na resposta), em texto curto. */
  detalhes: Record<IndicadorCx, string | null>;
  /** Por que nao ha valor (so' quando o valor e' null). */
  motivos: Record<IndicadorCx, string | null>;
  /** Cancelamento (%) na janela anterior; null = sem historico. */
  cancelamentoAnterior: number | null;
  reembolsado: number | null;
  acima: IndicadorCx[];
  /** Soma do excesso relativo nos indicadores fora da curva: a ordem do risco. */
  excesso: number;
  /** Taxa de resposta fora da meta oficial da Shopee (situacao do payload): vermelha e na frente. */
  foraMeta: boolean;
  tom: "bom" | "atencao" | "critico";
}

export interface AlertaCx {
  chave: string;
  marca: string;
  tom: "atencao" | "critico";
  indicador: IndicadorCx;
  valor: string;
  /** "(mediana 86,5%)" ou, fora da meta oficial, "(meta ≥ 60%)". */
  referencia: string;
}

export interface DeltaCx {
  /** "▲ 0,4 p.p." / "▼ 1,2 p.p." / "= estável" */
  texto: string;
  /** Subir e' pior: "piorou" quando a taxa sobe. */
  sentido: "piorou" | "melhorou" | "estavel";
}

export interface ResumoCx {
  contactRate: string;
  /** Taxa de resposta do chat (Saude da Conta), media das lojas. */
  resposta: string;
  respostaMedia: "ponderada" | "simples" | null;
  /** "Meta >= 60" da propria Shopee, quando vier igual para todas. */
  respostaMeta: string | null;
  cancelamento: string;
  reembolsado: string;
  /** Reembolsos aceitos ÷ pedidos; null quando nao da para tirar do payload. */
  reembolsoPct: string | null;
  /** Marcas com pedido e sem conversas lidas: fora do contact rate. */
  semChat: string[];
  /** Cancelamento contra a janela anterior, nas marcas com historico; null = sem historico. */
  cancelamentoDelta: DeltaCx | null;
  /** O mesmo delta em numero (p.p.), para a pilula do card; null = sem historico. */
  cancelamentoDeltaPp: number | null;
  /** Cancelamento da janela anterior ("2,5%"), nas marcas com historico; null = sem historico. */
  cancelamentoAntes: string | null;
  /** Marcas com pedido e sem historico de cancelamento (fora do delta). */
  semHistoricoCancelamento: string[];
  /** API-3: delta, "antes" e serie de cada card da /cx (taxas em p.p.). */
  comparacao: Record<IndicadorCx, ComparacaoCard | null>;
  /** API-3: o reembolso em R$ (card da Gerencial): delta em %, "antes R$". */
  comparacaoReembolsoReais: ComparacaoCard | null;
  /** Linha neutra do card sem periodo anterior (API-3): "comparação a partir de 04/12" (motivo no title). */
  semAnterior: Partial<Record<IndicadorCx, { texto: string; detalhe: string | null }>>;
  /** Base da seta quando ela exclui marcas: "antes → agora" so' das marcas com historico. */
  cancelamentoBase: { anterior: string; atual: string } | null;
  /** Valor da Shopee no filtro (os tiles). */
  totais: Record<IndicadorCx, number | null>;
  /** Mediana das marcas por indicador, base do risco; null = menos de 3 marcas medidas. */
  medianas: Record<IndicadorCx, number | null>;
  /** Linha "Atencao": ate' MAX_ALERTAS marcas, fora da meta oficial primeiro, depois maior excesso; cada uma com o PIOR indicador. */
  alertas: AlertaCx[];
  /** Fora da meta oficial primeiro, depois do maior excesso para o menor; so' marcas com alguma medida. */
  marcas: MarcaCx[];
  /** Todas as marcas do recorte, inclusive sem medida (o drill-down mostra "—" e o motivo). */
  todas: MarcaCx[];
}

const CHAVE_API: Record<IndicadorCx, ChaveApiCx> = {
  contactRate: "contact_rate",
  resposta: "resposta",
  cancelamento: "cancelamento",
  reembolso: "reembolso",
};

/** `sem_anterior` da API-3 em texto de card; sem a chave (ou sem a API-3), nada. */
export function textosSemAnterior(sem: CxShopeeResponse["sem_anterior"]): ResumoCx["semAnterior"] {
  const out: ResumoCx["semAnterior"] = {};
  for (const i of INDICADORES_CX) {
    const t = textoSemComparacao(sem?.[CHAVE_API[i]]);
    if (t) out[i] = t;
  }
  return out;
}

/** Uma casa decimal, como na tela: menos que 0,05 p.p. e' estavel. */
export function deltaPp(atual: number | null, anterior: number | null): DeltaCx | null {
  if (atual == null || anterior == null) return null;
  const d = atual - anterior;
  if (Math.abs(d) < 0.05) return { texto: "= estável", sentido: "estavel" };
  return { texto: `${d > 0 ? "▲" : "▼"} ${FMT_PCT.format(Math.abs(d))} p.p.`, sentido: d > 0 ? "piorou" : "melhorou" };
}

export function pctCx(v: number | null | undefined): string {
  return pct(v);
}

/**
 * ">=" vira "≥" e "<=" vira "≤" em todo texto de meta que chega da Shopee
 * (`rotulo_meta`): a tela inteira escreve o sinal matematico.
 */
export function simbolosMeta(texto: string): string {
  return texto.replace(/>=/g, "≥").replace(/<=/g, "≤");
}

/** "Meta >= 60" (Shopee) -> "meta ≥ 60%"; outro formato fica como veio. */
export function metaCurta(rotulo: string): string {
  const m = /^meta\s*(>=|<=|>|<)\s*([\d.,]+)\s*%?$/i.exec(rotulo.trim());
  if (!m) return simbolosMeta(rotulo).replace(/^Meta /, "meta "); // minusculo como o formato curto
  const sinal = { ">=": "≥", "<=": "≤", ">": ">", "<": "<" }[m[1]] ?? m[1];
  return `meta ${sinal} ${m[2]}%`;
}

function porIndicador<T>(f: (i: IndicadorCx) => T): Record<IndicadorCx, T> {
  return Object.fromEntries(INDICADORES_CX.map((i) => [i, f(i)])) as Record<IndicadorCx, T>;
}

export function resumoCxGerencial(dados: CxShopeeResponse, rotuloMarca: (m: string) => string): ResumoCx {
  const { chat, atendimento, devolucoes: dev } = dados;
  const usa7 = dados.janela.dias === 7;
  const comFotos = chat.nao_lidas_estado === "dado";
  const fotos = new Map((comFotos ? chat.nao_lidas ?? [] : []).map((n) => [n.marca, n]));
  const contas = new Map(chat.contas.map((c) => [c.marca, c]));
  const semFoto = new Map(chat.sem_foto.map((s) => [s.marca, s.motivo]));
  const linhas = new Map(atendimento.marcas.map((m) => [m.marca, m]));
  const pedidos = (m: string) => linhas.get(m)?.pedidos;
  const devOk = dev?.estado === "dado";
  const devs = new Map((devOk ? dev.marcas : []).map((m) => [m.marca, m]));
  const conv = (m: string) => {
    const n = fotos.get(m);
    return n ? ((usa7 ? n.conversas_7d : n.conversas_30d) ?? null) : null;
  };
  const metricaResposta = (m: string) => contas.get(m)?.metricas.find((x) => x.codigo === COD_RESPONDIDO);
  const resposta = (m: string) => {
    const v = metricaResposta(m)?.valor;
    return v != null && Number.isFinite(v) ? v : null;
  };
  const comChat = [...fotos.keys()].filter((m) => conv(m) != null);
  // "≥ 1.000" na coleta: a conversa e' um piso, entao o contact rate e' piso.
  const truncado = comChat.some((m) => fotos.get(m)?.conversas_truncado);
  const comCr = dados.janela.dias <= 30;

  /** (numerador, denominador) das tres taxas sobre pedidos/conversas. */
  const par = (i: IndicadorCx, m: string): [Num, Num] => {
    if (i === "contactRate") return comCr ? [conv(m), pedidos(m)] : [null, null];
    if (i === "cancelamento") return [linhas.get(m)?.cancelamentos, pedidos(m)];
    if (i === "reembolso") return [devs.get(m)?.aceitas, pedidos(m)];
    return [null, null];
  };
  const valor = (i: IndicadorCx, m: string) => (i === "resposta" ? resposta(m) : razaoPct([par(i, m)]));
  const chaves = [...new Set([...linhas.keys(), ...fotos.keys(), ...devs.keys(), ...contas.keys(), ...semFoto.keys()])];

  const media = mediaResposta(chaves.map((m) => ({ valor: resposta(m), peso: conv(m) })));
  const totais = porIndicador((i) => (i === "resposta" ? media.valor : razaoPct(chaves.map((m) => par(i, m)))));

  const detalhe = (i: IndicadorCx, m: string): string | null => {
    if (valor(i, m) == null) return null;
    if (i === "contactRate") return `${inteiro(conv(m))} conversas / ${inteiro(pedidos(m))} pedidos`;
    if (i === "cancelamento") return `${inteiro(linhas.get(m)?.cancelamentos)} cancelamentos / ${inteiro(pedidos(m))} pedidos`;
    if (i === "reembolso") {
      const r = devs.get(m)?.reembolsado;
      return `${inteiro(devs.get(m)?.aceitas)} devoluções aceitas / ${inteiro(pedidos(m))} pedidos${r != null ? ` · ${reais(r)}` : ""}`;
    }
    const meta = metricaResposta(m)?.rotulo_meta;
    const partes = [meta ? metaCurta(meta) : null, conv(m) != null ? `${inteiro(conv(m))} conversas` : null];
    return partes.filter(Boolean).join(" · ") || null;
  };
  const motivo = (i: IndicadorCx, m: string): string | null => {
    if (valor(i, m) != null) return null;
    const semPedidos = !pedidos(m) ? "Sem pedidos no período." : null;
    if (i === "contactRate") {
      if (!comCr) return "Contact rate só em 7 e 30 dias.";
      if (conv(m) == null) return comFotos ? "Sem leitura de conversas na coleta do chat." : "Conversas indisponíveis nesta carga.";
      return semPedidos;
    }
    if (i === "resposta") {
      if (semFoto.has(m)) return semFoto.get(m)!;
      return contas.has(m) ? "A Saúde da Conta não trouxe a taxa de resposta do chat." : "Sem Saúde da Conta da Shopee.";
    }
    if (i === "cancelamento") return linhas.has(m) ? semPedidos : "Pedidos indisponíveis nesta carga.";
    if (!devOk) return dev?.motivo_indisponivel ?? "Devoluções indisponíveis nesta carga.";
    if (devs.get(m)?.aceitas == null) return "Sem carga de devoluções desta loja.";
    return semPedidos;
  };

  // Delta: as mesmas marcas nas duas janelas (quem nao tem historico fica fora).
  const comHist = atendimento.marcas.filter((m) => m.pedidos_anterior != null);
  const cancAtual = razaoPct(comHist.map((m) => [m.cancelamentos, m.pedidos]));
  const cancAnt = razaoPct(comHist.map((m) => [m.cancelamentos_anterior, m.pedidos_anterior]));

  // ---- API-3: periodo anterior com as MESMAS lojas do valor; faltou uma, sem comparacao (nunca parcial)
  const medidasDe = (i: IndicadorCx) => chaves.filter((m) => valor(i, m) != null);
  const todasCom = (ms: string[], f: (m: string) => Num) => (ms.length && ms.every((m) => f(m) != null) ? ms : null);
  const anteriorDe = (i: IndicadorCx): number | null => {
    const ms = medidasDe(i);
    if (i === "contactRate") {
      const ok = comCr ? todasCom(ms, (m) => (fotos.get(m)?.conversas_anterior != null ? linhas.get(m)?.pedidos_anterior : null)) : null;
      return ok ? razaoPct(ok.map((m) => [fotos.get(m)?.conversas_anterior, linhas.get(m)?.pedidos_anterior])) : null;
    }
    if (i === "reembolso") {
      const ok = todasCom(ms, (m) => (devs.get(m)?.aceitas_anterior != null ? linhas.get(m)?.pedidos_anterior : null));
      return ok ? razaoPct(ok.map((m) => [devs.get(m)?.aceitas_anterior, linhas.get(m)?.pedidos_anterior])) : null;
    }
    if (i === "resposta") {
      // mesmos pesos do valor atual (conversas de hoje): compara a taxa, nao a mistura
      const ok = todasCom(ms, (m) => contas.get(m)?.resposta_anterior_pct);
      return ok ? mediaResposta(ok.map((m) => ({ valor: contas.get(m)!.resposta_anterior_pct ?? null, peso: conv(m) }))).valor : null;
    }
    return null; // cancelamento: o delta de hoje (marcas com historico) segue em cancelamentoDelta
  };
  // serie diaria: um ponto por dia; uma loja sem medida no dia anula o ponto; um ponto nulo, sem grafico
  const dias = [...new Set((dados.serie_diaria ?? []).map((p) => p.dia))].sort();
  const serieDe = (f: (rows: PontoDiarioCx[]) => number | null): number[] | null => {
    if (!dias.length) return null;
    const pts = dias.map((d) => f((dados.serie_diaria ?? []).filter((p) => p.dia === d)));
    return pts.every((v): v is number => v != null && Number.isFinite(v)) ? pts : null;
  };
  const taxaDia = (num: keyof PontoDiarioCx) => (rows: PontoDiarioCx[]) =>
    rows.some((r) => r[num] == null || r.pedidos == null) ? null : razaoPct(rows.map((r) => [r[num] as number, r.pedidos]));
  const series: Record<IndicadorCx, number[] | null> = {
    contactRate: null, // nao ha conversa por dia
    resposta: serieDe((rows) =>
      rows.some((r) => r.resposta_pct == null) ? null : mediaResposta(rows.map((r) => ({ valor: r.resposta_pct, peso: conv(r.marca) }))).valor,
    ),
    cancelamento: serieDe(taxaDia("cancelamentos")),
    reembolso: serieDe(taxaDia("devolucoes_aceitas")),
  };

  const porMarca = chaves.map((m) => ({ m, valores: porIndicador((i) => valor(i, m)) }));
  const medianas = porIndicador((i) =>
    medianaRisco(porMarca.map((x) => x.valores[i]).filter((v): v is number => v != null)),
  );

  const todas: MarcaCx[] = porMarca
    .map(({ m, valores }) => {
      const acima = INDICADORES_CX.filter((i) => foraDaCurva(i, valores[i], medianas[i]));
      const l = linhas.get(m);
      const foraMeta = metricaResposta(m)?.situacao === "fora" && valores.resposta != null;
      return {
        chave: m,
        marca: rotuloMarca(m),
        valores,
        detalhes: porIndicador((i) => detalhe(i, m)),
        motivos: porIndicador((i) => motivo(i, m)),
        cancelamentoAnterior: razaoPct([[l?.cancelamentos_anterior, l?.pedidos_anterior]]),
        reembolsado: devs.get(m)?.reembolsado ?? null,
        acima,
        excesso: acima.reduce((a, i) => a + excessoRelativo(i, valores[i]!, medianas[i]!), 0),
        foraMeta,
        tom: (foraMeta || acima.length >= 2 ? "critico" : acima.length === 1 ? "atencao" : "bom") as MarcaCx["tom"],
      };
    })
    .sort((a, b) => Number(b.foraMeta) - Number(a.foraMeta) || b.excesso - a.excesso || a.marca.localeCompare(b.marca));
  const marcas = todas.filter((x) => INDICADORES_CX.some((i) => x.valores[i] != null));
  const delta = deltaPp(cancAtual, cancAnt);
  const semHistoricoCancelamento = atendimento.marcas
    .filter((m) => m.pedidos && m.pedidos_anterior == null)
    .map((m) => rotuloMarca(m.marca));
  const metas = [...new Set(chaves.map((m) => metricaResposta(m)?.rotulo_meta).filter((x): x is string => !!x))];

  return {
    contactRate: totais.contactRate == null ? "—" : `${truncado ? "≥ " : ""}${pct(totais.contactRate)}`,
    resposta: pct(totais.resposta),
    respostaMedia: media.tipo,
    respostaMeta: metas.length === 1 ? metaCurta(metas[0]) : null,
    cancelamento: pct(totais.cancelamento),
    reembolsado: devOk ? reais(dev.reembolsado) : "—",
    reembolsoPct: totais.reembolso == null ? null : pct(totais.reembolso),
    semChat: atendimento.marcas.filter((m) => m.pedidos && conv(m.marca) == null).map((m) => rotuloMarca(m.marca)),
    cancelamentoDelta: delta,
    cancelamentoDeltaPp: delta && cancAtual != null && cancAnt != null ? cancAtual - cancAnt : null,
    cancelamentoAntes: delta ? pct(cancAnt) : null,
    semHistoricoCancelamento,
    semAnterior: textosSemAnterior(dados.sem_anterior),
    comparacao: porIndicador((i): ComparacaoCard | null => {
      const ant = anteriorDe(i);
      const atual = totais[i];
      const delta = ant != null && atual != null ? atual - ant : null;
      if (delta == null && !series[i]) return null;
      return {
        delta,
        unidade: "pp",
        tone: MENOR_E_PIOR.has(i) ? "higher_is_better" : "lower_is_better",
        antes: delta != null ? `antes ${pct(ant)}` : null,
        serie: series[i],
        granularidade: "day",
      };
    }),
    comparacaoReembolsoReais: (() => {
      const ms = devOk ? dev.marcas.filter((m) => m.reembolsado != null).map((m) => m.marca) : [];
      const ok = todasCom(ms, (m) => devs.get(m)?.reembolsado_anterior);
      const ant = ok ? somar(ok.map((m) => devs.get(m)?.reembolsado_anterior)) : null;
      const atual = devOk ? dev.reembolsado ?? null : null;
      const serie = serieDe((rows) => (rows.some((r) => r.reembolsado == null) ? null : somar(rows.map((r) => r.reembolsado))));
      const delta = ant && atual != null ? (atual / ant - 1) * 100 : null;
      if (delta == null && !serie) return null;
      return { delta, unidade: "pct", tone: "lower_is_better", antes: delta != null ? `antes ${reais(ant)}` : null, serie, granularidade: "day" };
    })(),
    cancelamentoBase: delta && semHistoricoCancelamento.length ? { anterior: pct(cancAnt), atual: pct(cancAtual) } : null,
    totais,
    medianas,
    marcas,
    todas,
    alertas: marcas
      .filter((m) => m.foraMeta || m.acima.length)
      .slice(0, MAX_ALERTAS)
      .map((m) => {
        // pior = maior excesso relativo, nao a ordem fixa dos indicadores; fora da meta oficial, a resposta
        const exc = (i: IndicadorCx) => excessoRelativo(i, m.valores[i]!, medianas[i]!);
        const pior = m.foraMeta ? "resposta" : m.acima.reduce((a, b) => (exc(b) > exc(a) ? b : a));
        const meta = metricaResposta(m.chave)?.rotulo_meta;
        return {
          chave: m.chave,
          marca: m.marca,
          tom: m.tom as AlertaCx["tom"],
          indicador: pior,
          valor: pct(m.valores[pior]),
          referencia: m.foraMeta ? `(${meta ? metaCurta(meta) : "fora da meta da Shopee"})` : `(mediana ${pct(medianas[pior])})`,
        };
      }),
  };
}

// ---------------------------------------------------------------------------
// Aba CX no padrao Gerencial (CX-IDENTIDADE, 08/11/2026): cabecalho em chips,
// heroi da taxa de resposta e "O que exige atencao agora".
// ---------------------------------------------------------------------------
const FMT_DIA_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});

export interface ChipsCx {
  /** "30 dias fechados · 05/10 a 03/11" */
  janela: string;
  /** Hora da resposta da API (title do chip; nao e' frescor). */
  geradoEm: string;
  /** Captura MAIS ANTIGA da Saude da Conta entre as lojas; null sem nenhuma. */
  saudeDaConta: string | null;
}

export function chipsCx(dados: Pick<CxShopeeResponse, "janela" | "gerado_em" | "chat">): ChipsCx {
  const capturas = dados.chat.contas
    .map((c) => (c.capturado_em ? new Date(c.capturado_em).getTime() : NaN))
    .filter(Number.isFinite);
  return {
    janela: textoJanela(dados.janela),
    geradoEm: `gerado em ${formatarInstante(dados.gerado_em) ?? dados.gerado_em}`,
    saudeDaConta: capturas.length ? `Saúde da Conta: ${FMT_DIA_HORA.format(Math.min(...capturas)).replace(",", "")}` : null,
  };
}

/** Estado da coleta do chat, quando falta: chip curto ao lado do numero do heroi. */
export function avisoColetaChat(dados: Pick<CxShopeeResponse, "chat">): string | null {
  const { chat } = dados;
  if (chat.nao_lidas_estado === "erro") return "Conversas indisponíveis nesta carga";
  const comLeitura = (chat.nao_lidas_estado === "dado" ? chat.nao_lidas ?? [] : []).some(
    (n) => n.aguardando_resposta != null || n.conversas_30d != null || n.conversas_7d != null,
  );
  return comLeitura ? null : "Conversas: aguardando a coleta";
}

export interface HeroiCx {
  /** "3 conversas aguardando · 1 há mais de 24 h"; null sem nenhuma leitura. */
  contexto: string | null;
  /** Regra: meta oficial da Shopee do "% respondido". null = nenhuma loja medida. */
  selo: { texto: string; tom: "ok" | "critico" } | null;
}

export function heroiCx(v: Pick<VisaoAtendimentoCx, "totais" | "linhas">): HeroiCx {
  const { aguardando, mais24h } = v.totais;
  const partes = [
    aguardando !== "—" ? `${aguardando} ${aguardando === "1" ? "conversa aguardando" : "conversas aguardando"}` : null,
    mais24h !== "—" ? `${mais24h} há mais de 24 h` : null,
  ].filter(Boolean);
  const medidas = v.linhas.filter((l) => l.respondido);
  const fora = v.totais.foraDaMeta.length;
  return {
    contexto: partes.length ? partes.join(" · ") : null,
    selo: !medidas.length
      ? null
      : fora
        ? { texto: `${fora} ${fora === 1 ? "loja abaixo" : "lojas abaixo"} da meta`, tom: "critico" }
        : { texto: "Todas na meta", tom: "ok" },
  };
}

export interface ItemAtencaoCx {
  chave: string;
  severidade: "critico" | "atencao" | "info";
  titulo: string;
  detalhe: string | null;
  /** O que o clique abre: o detalhe da marca ou o do indicador. */
  abre: { marca: string } | { indicador: IndicadorCx };
}

export const MAX_ITENS_ATENCAO = 8;
const ORDEM_SEVERIDADE = { critico: 0, atencao: 1, info: 2 } as const;

/** "meta ≥ 60%" a partir do numero da meta; sem numero, o rotulo da Shopee como veio. */
function metaDaMetrica(m: ContaOficial["metricas"][number]): string | null {
  if (m.meta != null && Number.isFinite(m.meta)) {
    return `meta ${SINAL_META[m.comparador ?? ""] ?? m.comparador ?? ""} ${valorMetrica({ valor: m.meta, unidade: m.unidade })}`.replace(/\s+/g, " ");
  }
  return m.rotulo_meta ? simbolosMeta(m.rotulo_meta.toLowerCase()) : null;
}

/**
 * Fila "O que exige atencao agora": metrica oficial fora da meta e conversa
 * esperando ha' mais de 24 h (critico), marca fora da curva (regra do
 * CxResumo; a resposta fora da meta oficial ja' entrou como metrica, nao
 * repete) e loja sem fotografia (informativo). Ate' `MAX_ITENS_ATENCAO`.
 */
export function itensAtencaoCx(
  dados: Pick<CxShopeeResponse, "chat" | "atendimento" | "devolucoes">,
  resumo: Pick<ResumoCx, "marcas" | "medianas">,
  rotuloMarca: (m: string) => string,
): ItemAtencaoCx[] {
  const { chat } = dados;
  const contas = new Map(chat.contas.map((c) => [c.marca, c]));
  const itens: ItemAtencaoCx[] = [];
  for (const s of montarStatusMarcas(dados, rotuloMarca)) {
    for (const m of contas.get(s.chave)?.metricas.filter((x) => x.situacao === "fora") ?? []) {
      itens.push({
        chave: `${s.chave}:${m.codigo}`,
        severidade: "critico",
        titulo: `${s.marca}: ${m.rotulo} ${valorOficial(m)}`,
        detalhe: metaDaMetrica(m),
        abre: { marca: s.chave },
      });
    }
  }
  for (const n of chat.nao_lidas_estado === "dado" ? chat.nao_lidas ?? [] : []) {
    const qtd = n.aguardando_mais_24h ?? 0;
    if (qtd <= 0) continue;
    itens.push({
      chave: `${n.marca}:mais24h`,
      severidade: "critico",
      titulo: `${rotuloMarca(n.marca)}: ${inteiro(qtd)} ${qtd === 1 ? "conversa" : "conversas"} há mais de 24 h`,
      detalhe: n.espera_max_s != null ? `mais antiga: ${duracao(n.espera_max_s)}` : null,
      abre: { marca: n.marca },
    });
  }
  for (const m of resumo.marcas) {
    for (const i of m.acima) {
      if (i === "resposta" && m.foraMeta) continue;
      itens.push({
        chave: `${m.chave}:curva:${i}`,
        severidade: m.tom === "critico" ? "critico" : "atencao",
        titulo: `${m.marca}: ${ROTULO_CURTO[i]} ${pct(m.valores[i])}`,
        detalhe: `mediana ${pct(resumo.medianas[i])}`,
        abre: { indicador: i },
      });
    }
  }
  for (const s of chat.sem_foto) {
    itens.push({ chave: `${s.marca}:sem-foto`, severidade: "info", titulo: `${rotuloMarca(s.marca)}: ${s.motivo}`, detalhe: null, abre: { marca: s.marca } });
  }
  return itens
    .map((x, idx) => ({ x, idx }))
    .sort((a, b) => ORDEM_SEVERIDADE[a.x.severidade] - ORDEM_SEVERIDADE[b.x.severidade] || a.idx - b.idx)
    .map(({ x }) => x)
    .slice(0, MAX_ITENS_ATENCAO);
}

// ---------------------------------------------------------------------------
// Drill-down de um tile (dialogo da Gerencial): marcas da pior para a melhor
// ---------------------------------------------------------------------------
export interface LinhaDrilldownCx {
  chave: string;
  marca: string;
  valor: string;
  detalhe: string | null;
  /** So' no cancelamento, quando ha historico. */
  antes: string | null;
  /** Por que nao ha valor ("—" nunca vira zero). */
  motivo: string | null;
  fora: boolean;
  /** 0-100, relativo ao maior valor medido (barra). */
  largura: number | null;
}

export function linhasDrilldownCx(r: ResumoCx, i: IndicadorCx): LinhaDrilldownCx[] {
  const menor = MENOR_E_PIOR.has(i);
  const medidas = r.todas.filter((m) => m.valores[i] != null);
  const maior = Math.max(0, ...medidas.map((m) => m.valores[i]!));
  const ordenadas = [
    ...medidas.sort(
      (a, b) => (menor ? a.valores[i]! - b.valores[i]! : b.valores[i]! - a.valores[i]!) || a.marca.localeCompare(b.marca),
    ),
    ...r.todas.filter((m) => m.valores[i] == null).sort((a, b) => a.marca.localeCompare(b.marca)),
  ];
  return ordenadas.map((m) => {
    const v = m.valores[i];
    return {
      chave: m.chave,
      marca: m.marca,
      valor: pct(v),
      detalhe: m.detalhes[i],
      antes: i === "cancelamento" && v != null && m.cancelamentoAnterior != null ? pct(m.cancelamentoAnterior) : null,
      motivo: v == null ? m.motivos[i] ?? "Sem medida no recorte." : null,
      fora: foraDaCurva(i, v, r.medianas[i]),
      largura: v == null ? null : maior > 0 ? Math.max(2, Math.round((v / maior) * 100)) : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Pedidos de um motivo do Pareto (CX-PEDIDOS-MOTIVO, 05/11/2026)
// `GET /api/v1/cx/shopee/pedidos?tipo=&motivo=&brands=&dias=` (ate' 500).
// ---------------------------------------------------------------------------
export type TipoPedidos = "cancelamento" | "devolucao";

export interface PedidoMotivo {
  marca: string;
  pedido: string | null;
  devolucao: string | null;
  dia: string | null;
  situacao: string | null;
  valor: number | null;
}

export interface PedidosMotivoResponse {
  gerado_em: string;
  tipo: TipoPedidos;
  codigo: string;
  rotulo: string | null;
  estado: "dado" | "vazio_legitimo" | "erro";
  motivo_indisponivel: string | null;
  total: number | null;
  truncado: boolean;
  parcial: boolean;
  numero_publico: boolean;
  pedidos: PedidoMotivo[];
}

export const ROTA_API_CX_PEDIDOS = "/api/v1/cx/shopee/pedidos";

export function tipoDoItem(i: Pick<ItemPareto, "tipo">): TipoPedidos {
  return i.tipo === "Devolução" ? "devolucao" : "cancelamento";
}

export function urlPedidosMotivo(base: string, f: FiltrosCx, tipo: TipoPedidos, codigo: string): string {
  const qs = new URLSearchParams({ tipo, motivo: codigo, dias: String(f.dias) });
  if (f.marca) qs.set("brands", f.marca);
  return `${base}${ROTA_API_CX_PEDIDOS}?${qs.toString()}`;
}

export type ResultadoPedidos = { ok: true; dados: PedidosMotivoResponse } | { ok: false; motivo: string };

/** Nunca lanca: falha volta como `{ ok: false }`. */
/** Com uma nova tentativa se estourar o tempo (`repetirSeEstourar`). */
export async function carregarPedidosMotivo(
  ...args: Parameters<typeof carregarPedidosMotivoUmaVez>
): ReturnType<typeof carregarPedidosMotivoUmaVez> {
  return repetirSeEstourar(() => carregarPedidosMotivoUmaVez(...args));
}

async function carregarPedidosMotivoUmaVez(
  f: FiltrosCx,
  tipo: TipoPedidos,
  codigo: string,
  fetchImpl: typeof fetch = fetch,
  base: string = API_URL,
  timeoutMs: number = TIMEOUT_API_MS,
): Promise<ResultadoPedidos> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), timeoutMs);
  try {
    const res = await fetchImpl(urlPedidosMotivo(base, f, tipo, codigo), { cache: "no-store", signal: controle.signal });
    if (!res.ok) return { ok: false, motivo: `A API respondeu ${res.status}.` };
    const json = (await res.json()) as PedidosMotivoResponse;
    if (!json || !Array.isArray(json.pedidos)) return { ok: false, motivo: "Resposta inválida da API." };
    return { ok: true, dados: json };
  } catch {
    return { ok: false, motivo: controle.signal.aborted ? MOTIVO_TIMEOUT : "Não foi possível contatar a API." };
  } finally {
    clearTimeout(timer);
  }
}

export interface LinhaPedidoCx {
  chave: string;
  pedido: string;
  marca: string;
  dia: string;
  situacao: string;
  valor: string;
}

function diaBr(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return d && m && a ? `${d}/${m}/${a}` : "—";
}

export function montarPedidosMotivo(dados: PedidosMotivoResponse, rotuloMarca: (m: string) => string) {
  const linhas: LinhaPedidoCx[] = dados.pedidos.map((p, i) => ({
    chave: `${p.marca}:${p.devolucao ?? p.pedido ?? i}`,
    pedido: p.pedido ?? "—",
    marca: rotuloMarca(p.marca),
    dia: diaBr(p.dia),
    situacao: p.situacao ?? "—",
    valor: p.valor == null ? "—" : reais(p.valor),
  }));
  const qtd = inteiro(dados.total);
  const resumo = dados.truncado
    ? `${qtd} pedidos · mostrando os ${inteiro(linhas.length)} mais recentes`
    : `${qtd} pedido(s)`;
  const avisos: string[] = [];
  if (dados.parcial) avisos.push("Uma das fontes não respondeu: a lista pode estar incompleta.");
  if (!dados.numero_publico) avisos.push("O número do pedido está retido nesta configuração da Torre.");
  return { linhas, resumo, avisos, comValor: dados.tipo === "devolucao" };
}

function celulaCsv(v: string): string {
  const seguro = /^[=+\-@]/.test(v) ? `'${v}` : v; // nunca vira formula no Excel
  return /[";\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** CSV com `;` (Excel pt-BR). Valor com virgula decimal. */
export function csvPedidosMotivo(dados: PedidosMotivoResponse, rotulo: string): string {
  const cab = ["pedido", "devolucao", "marca", "dia", "situacao", "valor_reembolsado", "motivo"];
  const linhas = dados.pedidos.map((p) =>
    [
      p.pedido ?? "",
      p.devolucao ?? "",
      p.marca,
      p.dia ?? "",
      p.situacao ?? "",
      p.valor == null ? "" : String(p.valor).replace(".", ","),
      rotulo,
    ]
      .map(celulaCsv)
      .join(";"),
  );
  return "﻿" + [cab.join(";"), ...linhas].join("\n");
}

export function nomeDoCsvPedidos(tipo: TipoPedidos, codigo: string, f: FiltrosCx, agora: Date): string {
  return `cx-${tipo}-${codigo}${f.marca ? `-${f.marca}` : ""}-${f.dias}d-${agora.toISOString().slice(0, 10)}.csv`;
}
