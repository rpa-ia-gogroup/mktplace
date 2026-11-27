/**
 * BLACK-HORA — contas da tela da Black Friday (27/11) hora a hora.
 *
 * A API (`/api/v1/performance/black-hora`) devolve, por marca × canal, a meta
 * de cada hora (planilha 'Meta hora Black') e o realizado de cada hora, com
 * `null` nas horas que o canal ainda não fechou. Aqui:
 * - cada canal compara com a meta até a SUA última hora fechada (a Shopee
 *   atrasada não puxa o ML para baixo);
 * - GMV soma entre marcas e canais (é venda, não impacto potencial);
 * - ausência nunca vira 0: sem meta lida, % e diferença ficam `null`;
 * - a hora em andamento (`realizado_parcial`, o que a fato diária já tem além
 *   das horas fechadas) soma no realizado, e a meta dela entra pró-rata
 *   (`meta_hora[corte] × fracao`): o total bate com o GMV de hoje da Gerencial.
 * Sem React: testável com `node --test`.
 */

export type CanalBlack = "shopee" | "ml";
export type FiltroCanalBlack = "todos" | CanalBlack;

export interface LinhaBlack {
  marca: string;
  canal: CanalBlack;
  meta_dia: number | null;
  meta_hora: (number | null)[];
  realizado_hora: (number | null)[];
  /** Hora em andamento (diária − horas fechadas); null/ausente = sem parcial no canal. */
  realizado_parcial?: number | null;
  /** Preenchido pelo front (`linhasComParcial`): a hora em andamento do canal desta linha. */
  parcial?: ParcialBlack | null;
}

export interface ParcialBlack {
  hora: number;
  /** ISO da carga da fato diária (o "até 09:47"). */
  ate: string;
  /** Fração da hora `hora` já decorrida em `ate` (0..1). */
  fracao: number;
}

export interface RespostaBlack {
  dia: string;
  disponivel: boolean;
  motivo: string | null;
  meta: { disponivel: boolean; motivo: string | null; fonte: string; lida_em: string | null };
  cortes: Partial<Record<CanalBlack, number>>;
  /** Hora em andamento por canal (API nova); ausente na antiga = só horas fechadas. */
  parcial?: Partial<Record<CanalBlack, ParcialBlack | null>>;
  linhas: LinhaBlack[];
  /** Hoje: "datamart" = lido direto do Data Mart; "torre" = ele falhou e a Torre respondeu (selo). Ausente = dia passado. */
  fonte?: "datamart" | "torre" | null;
}

export const DICA_DATAMART =
  "Lido direto do Data Mart: inclui pedidos pagos depois da última carga da Torre, por isso pode ficar um pouco acima da Gerencial e da TV.";

/** O "até HH:MM" do topo, com a fonte quando é o Data Mart. */
export const rotuloAte = (ate: string | null, fonte: RespostaBlack["fonte"]) =>
  ate && fonte === "datamart" ? `${ate} (Data Mart)` : ate;

/** As linhas com a hora em andamento do canal (`parcial`) ao lado; sem parcial, a linha como veio. */
export function linhasComParcial(d: Pick<RespostaBlack, "linhas" | "parcial">): LinhaBlack[] {
  return d.linhas.map((l) => {
    const p = d.parcial?.[l.canal];
    return p && l.realizado_parcial != null ? { ...l, parcial: p } : { ...l, parcial: null };
  });
}

const parcialDe = (l: LinhaBlack) => (l.parcial && l.realizado_parcial != null ? l.realizado_parcial : 0);
/** Meta pró-rata do que a diária tem além das horas fechadas: da hora do corte até `ate` (meta da hora × fração
 *  decorrida). Na mesma hora é `meta_hora[corte] × fracao`; carga já na hora seguinte soma a do corte inteira. */
const metaParcialDe = (l: LinhaBlack) => {
  const p = l.parcial;
  if (!p) return 0;
  const brt = new Date(new Date(p.ate).getTime() - 3 * 3600_000);
  const fim = brt.getUTCHours() + brt.getUTCMinutes() / 60 + brt.getUTCSeconds() / 3600;
  if (!Number.isFinite(fim)) return (l.meta_hora[p.hora] ?? 0) * p.fracao;
  let m = 0;
  for (let h = p.hora; h < 24 && h < fim; h++) m += (l.meta_hora[h] ?? 0) * Math.min(1, fim - h);
  return m;
};
/** "09:47" (BRT) de um ISO. */
export const horaMinuto = (iso: string) => {
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

export const NOME_CANAL_BLACK: Record<CanalBlack, string> = { shopee: "Shopee", ml: "Mercado Livre" };
export const HORAS = Array.from({ length: 24 }, (_, h) => h);
export const rotuloHora = (h: number) => `${String(h).padStart(2, "0")}h`;
/** A hora fechada como intervalo: "21h–22h" (o herói diz "até 22h": a mesma hora). */
export const intervaloHora = (h: number) => `${rotuloHora(h)}–${rotuloHora(h + 1)}`;

/** Semana da Black no menu: de segunda 24/11 até domingo 30/11 (BRT). */
export const SEMANA_BLACK = { de: "2026-11-24", ate: "2026-11-30" } as const;
export function naSemanaDaBlack(agora: Date = new Date()): boolean {
  const dia = new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  return dia >= SEMANA_BLACK.de && dia <= SEMANA_BLACK.ate;
}

export function filtrarBlack(linhas: LinhaBlack[], marcas: readonly string[], canal: FiltroCanalBlack): LinhaBlack[] {
  return linhas.filter((l) => (canal === "todos" || l.canal === canal) && (!marcas.length || marcas.includes(l.marca)));
}

/** Horas fechadas da linha = quantas horas têm realizado. */
export const corteDaLinha = (l: LinhaBlack) => l.realizado_hora.filter((v) => v !== null).length;

const soma = (xs: (number | null)[]) => xs.reduce<number>((s, v) => s + (v ?? 0), 0);
const temMeta = (ls: LinhaBlack[]) => ls.length > 0 && ls.every((l) => l.meta_dia !== null);

export interface ResumoBlack {
  realizado: number;
  /** Meta somada até a última hora fechada de cada linha (o justo para comparar). `null` = sem meta. */
  metaAteAgora: number | null;
  pct: number | null;
  metaDia: number | null;
  /** Ritmo da curva da meta: realizado ÷ fração da meta que já devia ter saído. */
  projecao: number | null;
  /** Última hora fechada comum às linhas do filtro (−1 = nenhuma). */
  ultimaHora: number;
  /** Até quando o realizado vai com a hora em andamento ("09:47", o canal mais atrasado); null = só horas fechadas. */
  ate: string | null;
}

export function resumoBlack(ls: LinhaBlack[]): ResumoBlack {
  const realizado = soma(ls.flatMap((l) => l.realizado_hora)) + ls.reduce((s, l) => s + parcialDe(l), 0);
  const comMeta = temMeta(ls);
  const metaAteAgora = comMeta ? ls.reduce((s, l) => s + soma(l.meta_hora.slice(0, corteDaLinha(l))) + metaParcialDe(l), 0) : null;
  const ates = ls.length && ls.every((l) => l.parcial) ? ls.map((l) => l.parcial!.ate).sort() : [];
  const metaDia = comMeta ? ls.reduce((s, l) => s + (l.meta_dia ?? 0), 0) : null;
  return {
    realizado,
    metaAteAgora,
    pct: metaAteAgora ? realizado / metaAteAgora : null,
    metaDia,
    projecao: metaAteAgora && metaDia ? (realizado * metaDia) / metaAteAgora : null,
    ultimaHora: ls.length ? Math.min(...ls.map(corteDaLinha)) - 1 : -1,
    ate: ates.length ? horaMinuto(ates[0]) : null,
  };
}

export interface HoraBlack {
  hora: number;
  meta: number | null;
  /** `null` = hora ainda não fechada em alguma linha do filtro. */
  realizado: number | null;
  diferenca: number | null;
  metaAcum: number | null;
  realizadoAcum: number | null;
  /** Realizado acumulado ÷ meta acumulada até a hora. */
  pctAcum: number | null;
  /** Ponto da hora em andamento no gráfico: acumulado fechado + parcial (na hora do corte) e o fechado na hora
   *  anterior, para o trecho tracejado ligar os dois. null fora disso. */
  parcialAcum: number | null;
}

export function horaAHora(ls: LinhaBlack[]): HoraBlack[] {
  const comMeta = temMeta(ls);
  let metaAcum = 0;
  let realAcum = 0;
  const corte = ls.length && ls.every((l) => l.parcial) ? Math.min(...ls.map((l) => l.parcial!.hora)) : null;
  const parcial = corte !== null && ls.every((l) => l.parcial!.hora === corte) ? ls.reduce((s, l) => s + parcialDe(l), 0) : null;
  const linhas = HORAS.map((h) => {
    const meta = comMeta ? soma(ls.map((l) => l.meta_hora[h])) : null;
    const fechada = ls.length > 0 && ls.every((l) => l.realizado_hora[h] !== null);
    const realizado = fechada ? soma(ls.map((l) => l.realizado_hora[h])) : null;
    metaAcum += meta ?? 0;
    if (realizado !== null) realAcum += realizado;
    return {
      hora: h, meta, realizado,
      diferenca: realizado !== null && meta !== null ? realizado - meta : null,
      metaAcum: comMeta ? metaAcum : null,
      realizadoAcum: realizado !== null ? realAcum : null,
      pctAcum: realizado !== null && comMeta && metaAcum > 0 ? realAcum / metaAcum : null,
      parcialAcum: null as number | null,
    };
  });
  if (parcial !== null && corte !== null && corte < 24) {
    const antes = corte > 0 ? linhas[corte - 1].realizadoAcum : 0;
    if (antes !== null) {
      linhas[corte].parcialAcum = antes + parcial;
      if (corte > 0) linhas[corte - 1].parcialAcum = antes;
    }
  }
  return linhas;
}

/** Última hora fechada do canal: meta x realizado daquela hora (todas as marcas do filtro no canal). */
export function ultimaHoraDoCanal(ls: LinhaBlack[], canal: CanalBlack): { hora: number; meta: number | null; realizado: number } | null {
  const doCanal = ls.filter((l) => l.canal === canal);
  if (!doCanal.length) return null;
  const hora = Math.min(...doCanal.map(corteDaLinha)) - 1;
  if (hora < 0) return null;
  return {
    hora,
    meta: temMeta(doCanal) ? soma(doCanal.map((l) => l.meta_hora[hora])) : null,
    realizado: soma(doCanal.map((l) => l.realizado_hora[hora])),
  };
}

/** Tom do desvio: no ritmo (≥ 100%), perto (≥ 90%), abaixo. */
export function tomDesvio(pct: number | null): "ok" | "warn" | "crit" | null {
  if (pct === null) return null;
  return pct >= 1 ? "ok" : pct >= 0.9 ? "warn" : "crit";
}

export interface CelulaMarcaCanal {
  metaDia: number | null; realizado: number; pct: number | null;
  /** Meta somada até a última hora fechada da linha (a base do herói). */
  metaAteAgora: number | null;
  /** Realizado ÷ meta até a última hora fechada: o número E a cor do quadro (mesma base do herói). */
  ritmo: number | null;
}

/** Quadro marca × canal: meta do dia, realizado até agora e % da meta do dia. */
export function quadroMarcaCanal(ls: LinhaBlack[]): { marcas: string[]; canais: CanalBlack[]; celula: (m: string, c: CanalBlack) => CelulaMarcaCanal | null } {
  const marcas = [...new Set(ls.map((l) => l.marca))];
  const canais = (["shopee", "ml"] as CanalBlack[]).filter((c) => ls.some((l) => l.canal === c));
  return {
    marcas, canais,
    celula: (m, c) => {
      const l = ls.find((x) => x.marca === m && x.canal === c);
      if (!l) return null;
      const realizado = soma(l.realizado_hora) + parcialDe(l);
      const ateAgora = l.meta_dia !== null ? soma(l.meta_hora.slice(0, corteDaLinha(l))) + metaParcialDe(l) : 0;
      return { metaDia: l.meta_dia, realizado, pct: l.meta_dia ? realizado / l.meta_dia : null, metaAteAgora: l.meta_dia !== null ? ateAgora : null, ritmo: ateAgora > 0 ? realizado / ateAgora : null };
    },
  };
}
