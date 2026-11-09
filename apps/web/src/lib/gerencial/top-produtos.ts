/**
 * Top produtos por marca (Gerencial): tipos da API e as contas puras do
 * detalhe — agrupar a serie diaria em dia/semana/mes e a variacao.
 */
import { torreFetch } from "../torre-fetch.ts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type CanalTop = "tiktok" | "ml" | "shopee";

export interface ProdutoTop {
  posicao: number;
  canal: CanalTop;
  sku: string;
  produto: string;
  kit: boolean;
  pecas: number;
  receita: number;
  preco_medio: number | null;
  share_marca: number | null;
  pecas_ant: number | null;
  receita_ant: number | null;
}
export interface ExtraCanal {
  rotulo: string;
  valor: number;
  formato: "brl" | "num" | "vezes";
}
/** Faixa "por canal" da marca: TikTok traz a origem do GMV; ML, os ads; Shopee, so' a receita. */
export interface ResumoCanal {
  canal: CanalTop;
  receita: number;
  extras: ExtraCanal[];
  aviso_extras: string | null;
}
export interface MarcaTop {
  marca: string;
  receita_marca: number;
  receita_marca_ant: number | null;
  produtos: ProdutoTop[];
  canais: ResumoCanal[];
}
export interface TopProdutosResponse {
  inicio: string;
  fim: string;
  comparacao_inicio: string | null;
  comparacao_fim: string | null;
  canais: CanalTop[];
  marcas: MarcaTop[];
}
export interface PontoDiario {
  dia: string;
  pecas: number;
  receita: number;
}
export interface DetalheProduto {
  canal: CanalTop;
  marca: string;
  sku: string;
  produto: string;
  kit: boolean;
  serie: PontoDiario[];
  extras: ExtraCanal[];
  aviso_extras: string | null;
}

/** "05/11" ou "26/10–31/10": diz contra o que a variacao compara. */
export function rotuloPeriodo(inicio: string, fim: string): string {
  return inicio === fim ? ddmm(fim) : `${ddmm(inicio)}–${ddmm(fim)}`;
}

/**
 * Variacao so' quando os dois lados sao comparaveis: so' "hoje" (dia em
 * andamento) contra o dia anterior INTEIRO daria quedas falsas de 40-70%.
 */
export function comparacaoValida(r: Pick<TopProdutosResponse, "inicio" | "fim" | "comparacao_inicio">, hoje: string): boolean {
  return Boolean(r.comparacao_inicio) && !(r.inicio === hoje && r.fim === hoje);
}

async function pedir<T>(caminho: string, signal: AbortSignal): Promise<T> {
  const r = await torreFetch(`${API_URL}${caminho}`, { signal });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

export function buscarTopProdutos(q: URLSearchParams, signal: AbortSignal) {
  return pedir<TopProdutosResponse>(`/api/v1/gerencial/top-produtos?${q}`, signal);
}

export function buscarDetalhe(p: { canal: CanalTop; marca: string; sku: string; dateFrom: string; dateTo: string }, signal: AbortSignal) {
  const q = new URLSearchParams({ canal: p.canal, marca: p.marca, sku: p.sku, date_from: p.dateFrom, date_to: p.dateTo });
  return pedir<DetalheProduto>(`/api/v1/gerencial/top-produtos/detalhe?${q}`, signal);
}

/** Variacao em %; sem base (nula ou zero) nao inventa 100%. */
export function variacao(atual: number, base: number | null): number | null {
  return base ? ((atual - base) / base) * 100 : null;
}

export type Grao = "dia" | "semana" | "mes";
export interface Barra {
  chave: string;
  rotulo: string;
  pecas: number;
  receita: number;
}

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DIA_MS = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * Agrupa a serie ate `fim`: 30 dias, 12 semanas (blocos de 7 dias terminando
 * em `fim`) ou 12 meses de calendario. Dia sem venda vira barra zero, nunca
 * some — um buraco no eixo seria lido como falta de dado.
 */
export function agrupar(serie: PontoDiario[], fim: string, grao: Grao): Barra[] {
  const porDia = new Map(serie.map((p) => [p.dia, p]));
  const fimMs = utc(fim);
  const barras: Barra[] = [];
  if (grao === "mes") {
    const [a, m] = [Number(fim.slice(0, 4)), Number(fim.slice(5, 7))];
    for (let k = 11; k >= 0; k--) {
      const t = a * 12 + (m - 1) - k;
      const chave = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
      barras.push({ chave, rotulo: `${MES[t % 12]}/${String(Math.floor(t / 12)).slice(2)}`, pecas: 0, receita: 0 });
    }
    for (const p of serie) {
      const b = barras.find((x) => x.chave === p.dia.slice(0, 7));
      if (b && p.dia <= fim) { b.pecas += p.pecas; b.receita += p.receita; }
    }
    return barras;
  }
  const passo = grao === "dia" ? 1 : 7;
  const n = grao === "dia" ? 30 : 12;
  for (let k = n - 1; k >= 0; k--) {
    const ultimo = fimMs - k * passo * DIA_MS;
    const b: Barra = { chave: iso(ultimo), rotulo: ddmm(iso(ultimo - (passo - 1) * DIA_MS)), pecas: 0, receita: 0 };
    for (let d = 0; d < passo; d++) {
      const p = porDia.get(iso(ultimo - d * DIA_MS));
      if (p) { b.pecas += p.pecas; b.receita += p.receita; }
    }
    barras.push(b);
  }
  return barras;
}

/**
 * Ticket medio da barra em R$ por peca (o mesmo conceito do "Preco medio" do
 * card). Barra sem venda devolve `null`: a linha quebra ali, nunca cai a zero.
 */
export function ticketMedio(b: Pick<Barra, "pecas" | "receita">): number | null {
  return b.pecas > 0 ? b.receita / b.pecas : null;
}

/**
 * Dominio do eixo do ticket. Preco constante (ou quase) faz o "auto" do recharts
 * repetir o mesmo rotulo ("R$ 99,90" cinco vezes): ai abre folga de 5% (minimo
 * R$ 1) em 4 passos redondos (ex.: 95 a 105 de 2,50 em 2,50), com os ticks. Serie que varia
 * de verdade fica no "auto".
 */
export function eixoTicket(valores: readonly (number | null)[]): { domain: [number, number] | ["auto", "auto"]; ticks?: number[] } {
  const v = valores.filter((x): x is number => x !== null);
  if (!v.length) return { domain: ["auto", "auto"] };
  const min = Math.min(...v), max = Math.max(...v);
  const folga = Math.max(max * 0.05, 1);
  if (max - min >= folga) return { domain: ["auto", "auto"] };
  // passo redondo >= folga/2: 4 passos cobrem a folga dos dois lados
  const ordem = 10 ** Math.floor(Math.log10(folga / 2));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * ordem).find((p) => p >= folga / 2)!;
  const lo = Math.max(0, Math.round((min + max) / 2 / passo) * passo - 2 * passo);
  // ticks explicitos: com dominio fixo o recharts arredonda o passo (2,5 vira 3)
  const ticks = [0, 1, 2, 3, 4].map((k) => lo + k * passo);
  return { domain: [lo, ticks[4]], ticks };
}

// ---------------------------------------------------------------------------
// COMPARAR-CANAIS (pedido da operacao, 09/11/2026): o mesmo produto em cada
// canal, pela FATIA da receita da marca no canal. Regras da spec do Prumo.
// ---------------------------------------------------------------------------
export interface CelulaCanal {
  canal: CanalTop;
  /** Receita do produto / receita da marca neste canal (0-1). Nunca R$. */
  fatia: number;
  /** Codigo do anuncio para o detalhe do canal. */
  sku: string;
}
export interface ProdutoComparado {
  chave: string;
  produto: string;
  kit: boolean;
  /** So' os canais onde vende: ausencia nunca vira 0. */
  celulas: CelulaCanal[];
}
export interface CanalComparado {
  canal: CanalTop;
  /** Parte da receita do canal com seller SKU (casavel), 0-1. */
  cobertura: number;
}
export interface MarcaComparada {
  marca: string;
  canais: CanalComparado[];
  produtos: ProdutoComparado[];
}
export interface CompararCanaisResponse {
  inicio: string;
  fim: string;
  marcas: MarcaComparada[];
}

/**
 * Como o `repetirSeEstourar` (#296): busca de novo UMA vez se a primeira falhar
 * (a frio a API pode estourar o tempo; o que ela ja' leu fica no cache e a 2a
 * volta rapido). Cancelamento (troca de filtro) nao repete. GET de leitura.
 */
export async function buscarComparacao(
  q: URLSearchParams, signal: AbortSignal,
  buscar: typeof pedir<CompararCanaisResponse> = pedir,
): Promise<CompararCanaisResponse> {
  const url = `/api/v1/gerencial/top-produtos/comparar-canais?${q}`;
  try {
    return await buscar(url, signal);
  } catch (e) {
    if (signal.aborted) throw e;
    return buscar(url, signal);
  }
}

/** Selo so' acima do piso (produto pequeno nao gera ruido), 2x e 3 p.p. */
export const PISO_FATIA = 0.03;
export const VEZES_FORTE = 2;
export const DIFERENCA_MINIMA = 0.03;
/** Abaixo disso a cobertura do SKU vira chip visivel ("cobertura parcial"). */
export const COBERTURA_MINIMA = 0.9;

export const CANAL_CURTO: Record<CanalTop, string> = { tiktok: "TikTok", ml: "ML", shopee: "Shopee" };
const PREP: Record<CanalTop, string> = { tiktok: "no", ml: "no", shopee: "na" };

export type Selo =
  | { tipo: "forte"; canal: CanalTop; diferenca: number }
  | { tipo: "sem_venda"; canal: CanalTop; forte: CanalTop };

/** "15%", "2,3%", "<0,1%" — nunca "0%" para quem vendeu. */
export function fmtFatia(f: number): string {
  const n = f * 100;
  const t = n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return n > 0 && t === "0" ? "<0,1%" : `${t}%`;
}

/** "no ML", "na Shopee", "no TikTok". */
export const noCanal = (c: CanalTop) => `${PREP[c]} ${CANAL_CURTO[c]}`;

/**
 * - "sem venda no Y": fatia >= 3% em algum canal e nenhuma venda num outro
 *   canal que a marca tem (vem antes: e' a maior oportunidade);
 * - "forte no X": a maior fatia e' >= 2x a maior dos outros canais, com
 *   diferenca >= 3 p.p. e ela mesma >= 3%.
 */
export function seloDoProduto(p: ProdutoComparado, canaisMarca: readonly CanalTop[]): Selo | null {
  const topo = [...p.celulas].sort((a, b) => b.fatia - a.fatia)[0];
  if (!topo || topo.fatia < PISO_FATIA) return null;
  const vende = new Set(p.celulas.map((c) => c.canal));
  const ausente = canaisMarca.find((c) => !vende.has(c));
  if (ausente) return { tipo: "sem_venda", canal: ausente, forte: topo.canal };
  const maxOutro = Math.max(0, ...p.celulas.filter((c) => c.canal !== topo.canal).map((c) => c.fatia));
  const diferenca = topo.fatia - maxOutro;
  return topo.fatia >= VEZES_FORTE * maxOutro && diferenca >= DIFERENCA_MINIMA
    ? { tipo: "forte", canal: topo.canal, diferenca }
    : null;
}

export function textoDoSelo(s: Selo): string {
  return s.tipo === "forte" ? `forte ${noCanal(s.canal)}` : `sem venda ${noCanal(s.canal)}`;
}

/**
 * Ate' 3 achados por marca: "sem venda" primeiro (pela maior fatia), depois
 * "forte" pela diferenca em p.p. Percentual primeiro:
 * "Kit X: 15% da receita no ML · 2% na Shopee · sem venda no TikTok".
 */
export function achadosDaMarca(m: MarcaComparada, max = 3): { chave: string; texto: string }[] {
  const canais = m.canais.map((c) => c.canal);
  const comSelo = m.produtos
    .map((p) => ({ p, s: seloDoProduto(p, canais) }))
    .filter((x): x is { p: ProdutoComparado; s: Selo } => x.s !== null);
  const fatiaMax = (p: ProdutoComparado) => Math.max(...p.celulas.map((c) => c.fatia));
  const ordem = [
    ...comSelo.filter((x) => x.s.tipo === "sem_venda").sort((a, b) => fatiaMax(b.p) - fatiaMax(a.p)),
    ...comSelo
      .filter((x) => x.s.tipo === "forte")
      .sort((a, b) => (b.s.tipo === "forte" ? b.s.diferenca : 0) - (a.s.tipo === "forte" ? a.s.diferenca : 0)),
  ].slice(0, max);
  return ordem.map(({ p }) => {
    const topo = [...p.celulas].sort((a, b) => b.fatia - a.fatia)[0];
    const fatia = new Map(p.celulas.map((c) => [c.canal, c.fatia]));
    const resto = canais
      .filter((c) => c !== topo.canal)
      .map((c) => (fatia.has(c) ? `${fmtFatia(fatia.get(c)!)} ${noCanal(c)}` : `sem venda ${noCanal(c)}`));
    return { chave: p.chave, texto: [`${p.produto}: ${fmtFatia(topo.fatia)} da receita ${noCanal(topo.canal)}`, ...resto].join(" · ") };
  });
}
