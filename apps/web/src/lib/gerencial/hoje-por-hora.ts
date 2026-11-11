/**
 * VENDAS-POR-HORA-1 — o "Hoje" padronizado da Gerencial.
 *
 * Contrato de `GET /api/v1/performance/hoje-por-hora` e a leitura pura dele.
 * Cada canal tem o PROPRIO corte (a ultima hora que a fonte dele fechou); hoje
 * e ontem do mesmo canal somam ate' o mesmo corte — por isso a comparacao e'
 * justa. O total e' a soma dos canais. Ver `hoje_por_hora_service.py` na API.
 */
import type { Marketplace } from "../mock-data.ts";

export interface BlocoVendas {
  gmv: number;
  pedidos: number;
  ticket: number | null;
}

export interface CanalFonte {
  channel: Marketplace;
  fonte_ate: string | null;
  horas_fechadas_hoje: number;
  /** Corte do canal (hoje e ontem dele somam ate' H:00); ausente em respostas antigas. */
  corte_hora?: number;
}

export interface CanalVendas {
  channel: Marketplace;
  hoje: BlocoVendas;
  ontem: BlocoVendas;
  semana_passada: BlocoVendas;
}

/** Tendencia de fechamento do dia (ritmo de ontem ate' a mesma hora). */
export interface Tendencia {
  hoje: number;
  ontem_mesma_hora: number;
  ontem_dia: number;
  projecao: number | null;
}

export interface MarcaTendencia extends Tendencia {
  brand: string;
  /** A mesma conta por canal; ausente em respostas antigas da API. */
  por_canal?: (Tendencia & { channel: Marketplace })[];
  /** Canais da marca fora da conta (sem hora de pedido: Kokeshi na Shopee); ausente em respostas antigas. */
  canais_fora?: Marketplace[];
}

/**
 * Tendencia de fechamento somando SO' os canais que o card mostra ao lado
 * (ex.: so' os que tem meta): hoje ate' HHh x (ontem inteiro / ontem ate' HHh).
 * Sem venda ontem ate' o corte nesses canais, `null`: sem ritmo, sem palpite.
 * Se algum desses canais ficou fora da conta da marca (`canais_fora`), a tendencia
 * seria menor que o que ela ja' vendeu: `null`, salvo `soParte` (o total do topo,
 * que soma o que tem hora e diz o que ficou de fora).
 */
export function tendenciaNosCanais(
  m: MarcaTendencia,
  canais: readonly Marketplace[],
  soParte = false,
): { projecao: number; ontemDia: number } | null {
  if (!soParte && (m.canais_fora ?? []).some((c) => canais.includes(c))) return null;
  const partes = (m.por_canal ?? []).filter((p) => canais.includes(p.channel));
  const soma = (k: keyof Tendencia) => partes.reduce((a, p) => a + (p[k] ?? 0), 0);
  const ate = soma("ontem_mesma_hora");
  const dia = soma("ontem_dia");
  if (ate <= 0 || dia <= 0) return null;
  return { projecao: (soma("hoje") * dia) / ate, ontemDia: dia };
}

export interface HojePorHora {
  disponivel: boolean;
  motivo?: string | null;
  dia: string;
  corte_hora: number | null;
  canais: CanalFonte[];
  limitacoes: string[];
  hoje?: BlocoVendas | null;
  ontem?: BlocoVendas | null;
  semana_passada?: BlocoVendas | null;
  por_canal: CanalVendas[];
  /** Ausente em respostas antigas da API. */
  por_marca?: MarcaTendencia[];
}

/** "até 13h"; `null` quando ainda nao fechou nenhuma hora. */
export function rotuloDoCorte(corte: number | null): string | null {
  if (corte == null || corte <= 0) return null;
  return `até ${corte}h`;
}

const NOME_CURTO: Record<Marketplace, string> = { tiktok: "TikTok", ml: "ML", shopee: "Shopee" };

/**
 * Corte de cada canal, curto: "ML e TikTok até 8h · Shopee até 6h" (mais fresco
 * primeiro). Canais com o mesmo corte se juntam; com um corte so', "até 8h".
 * Canal sem hora fechada fica de fora (ele soma 0 dos dois lados). Respostas
 * antigas, sem corte por canal, caem no `corte_hora` do topo.
 */
export function rotuloDosCortes(d: Pick<HojePorHora, "canais" | "corte_hora">): string | null {
  const grupos = new Map<number, string[]>();
  for (const c of d.canais) {
    if ((c.corte_hora ?? 0) > 0) grupos.set(c.corte_hora!, [...(grupos.get(c.corte_hora!) ?? []), NOME_CURTO[c.channel]]);
  }
  if (grupos.size === 0) return rotuloDoCorte(d.corte_hora);
  const ordem = [...grupos].sort((a, b) => b[0] - a[0]);
  if (ordem.length === 1) return rotuloDoCorte(ordem[0][0]);
  return ordem.map(([h, nomes]) => `${nomes.sort().join(" e ")} ${rotuloDoCorte(h)}`).join(" · ");
}

/** Variacao percentual contra a base; `null` sem base (nao inventa 100%). */
export function variacao(atual: number, base: number): number | null {
  if (!base) return null;
  return ((atual - base) / base) * 100;
}

/** A comparacao de "Hoje" que os cards de sempre mostram, no lugar do "vs anterior". */
export interface ComparacaoDeHoje {
  /** "vs ontem até 14h" (ou o corte de cada canal), com o aviso quando um recorte fica de fora. */
  rotulo: string;
  /** Versao para cartoes estreitos: igual ao `rotulo`, ou "vs ontem, mesma hora" se os cortes diferem. */
  rotuloCurto: string;
  /** Explicacao para o (i), quando os canais cortam em horas diferentes ou algum ficou de fora. */
  detalhe: string | null;
  gmvPct: number | null;
  pedidosPct: number | null;
  ticketPct: number | null;
  ontem: BlocoVendas;
  porCanal: Partial<Record<Marketplace, number | null>>;
}

/**
 * Hoje x ontem ATE' A MESMA HORA, canal a canal: cada canal vai ate' a sua
 * ultima hora fechada e e' comparado com ontem ate' essa mesma hora. `null`
 * sem a tabela por hora ou antes de fechar a primeira hora: sem comparacao,
 * nunca uma injusta (dia parcial contra dia inteiro).
 */
export function comparacaoDeHoje(d: HojePorHora | null): ComparacaoDeHoje | null {
  const rotulo = d ? rotuloDosCortes(d) : null;
  if (!d?.disponivel || !rotulo || !d.hoje || !d.ontem) return null;
  // Canal sem hora fechada soma 0 dos dois lados: diz que ficou de fora, nunca some calado.
  const semHora = d.canais.filter((c) => c.corte_hora === 0).map((c) => NOME_CURTO[c.channel]);
  const kokeshi = d.limitacoes.some((l) => l.startsWith("Kokeshi na Shopee")) && !semHora.includes("Shopee");
  const fora = [...(semHora.length ? [semHora.join(" e ")] : []), ...(kokeshi ? ["Kokeshi Shopee"] : [])];
  const aviso = fora.length ? ` (sem ${fora.join(" e ")})` : "";
  const cortesDiferem = rotulo.includes("·");
  return {
    rotulo: `vs ontem ${rotulo}${aviso}`,
    rotuloCurto: `vs ontem ${cortesDiferem ? ", mesma hora" : rotulo}${aviso}`.replace("ontem ,", "ontem,"),
    detalhe: cortesDiferem || semHora.length
      ? "Cada canal conta até a última hora que já chegou e é comparado com ontem até essa mesma hora. Por isso a hora muda de um canal para outro."
      : null,
    gmvPct: variacao(d.hoje.gmv, d.ontem.gmv),
    pedidosPct: variacao(d.hoje.pedidos, d.ontem.pedidos),
    ticketPct: d.hoje.ticket != null && d.ontem.ticket != null ? variacao(d.hoje.ticket, d.ontem.ticket) : null,
    ontem: d.ontem,
    porCanal: Object.fromEntries(d.por_canal.map((c) => [c.channel, variacao(c.hoje.gmv, c.ontem.gmv)])),
  };
}

export interface TendenciaConsolidada {
  /** Soma das tendencias das marcas que TEM projecao. */
  projecao: number;
  /** Meta (do dia) so' das marcas somadas; `null` sem meta. */
  meta: number | null;
  /** Marcas somadas / marcas esperadas; parcial quando `somadas < total`. */
  somadas: number;
  total: number;
  /** Marcas somadas so' nos canais com hora de pedido, e os canais que ficaram de fora delas. */
  soParte: { id: string; canais: Marketplace[] }[];
  /** Marcas esperadas que nao entraram (sem ritmo ainda). */
  semRitmo: string[];
}

/**
 * Tendencia do dia do topo da Gerencial = SOMA das tendencias dos cards, cada
 * marca nos canais que o card dela mostra. Marca sem projecao nao entra como 0:
 * fica de fora e o resultado diz que e' parcial. Nenhuma com projecao: `null`.
 */
export function tendenciaConsolidada(
  marcas: Record<string, MarcaTendencia> | null,
  esperadas: Record<string, { meta: number; canais: readonly Marketplace[] } | null>,
): TendenciaConsolidada | null {
  const ids = Object.keys(esperadas).filter((id) => esperadas[id]);
  let projecao = 0;
  let meta = 0;
  let somadas = 0;
  const soParte: TendenciaConsolidada["soParte"] = [];
  const semRitmo: string[] = [];
  for (const id of ids) {
    const e = esperadas[id]!;
    const t = marcas?.[id] ? tendenciaNosCanais(marcas[id], e.canais, true) : null;
    if (!t) {
      semRitmo.push(id);
      continue;
    }
    projecao += t.projecao;
    meta += e.meta;
    somadas++;
    const fora = (marcas![id].canais_fora ?? []).filter((c) => e.canais.includes(c));
    if (fora.length) soParte.push({ id, canais: fora });
  }
  return somadas ? { projecao, meta: meta > 0 ? meta : null, somadas, total: ids.length, soParte, semRitmo } : null;
}
