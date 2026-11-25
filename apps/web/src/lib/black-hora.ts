/**
 * BLACK-HORA — contas da tela da Black Friday (27/11) hora a hora.
 *
 * A API (`/api/v1/performance/black-hora`) devolve, por marca × canal, a meta
 * de cada hora (planilha 'Meta hora Black') e o realizado de cada hora, com
 * `null` nas horas que o canal ainda não fechou. Aqui:
 * - cada canal compara com a meta até a SUA última hora fechada (a Shopee
 *   atrasada não puxa o ML para baixo);
 * - GMV soma entre marcas e canais (é venda, não impacto potencial);
 * - ausência nunca vira 0: sem meta lida, % e diferença ficam `null`.
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
}

export interface RespostaBlack {
  dia: string;
  disponivel: boolean;
  motivo: string | null;
  meta: { disponivel: boolean; motivo: string | null; fonte: string; lida_em: string | null };
  cortes: Partial<Record<CanalBlack, number>>;
  linhas: LinhaBlack[];
}

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
}

export function resumoBlack(ls: LinhaBlack[]): ResumoBlack {
  const realizado = soma(ls.flatMap((l) => l.realizado_hora));
  const comMeta = temMeta(ls);
  const metaAteAgora = comMeta ? ls.reduce((s, l) => s + soma(l.meta_hora.slice(0, corteDaLinha(l))), 0) : null;
  const metaDia = comMeta ? ls.reduce((s, l) => s + (l.meta_dia ?? 0), 0) : null;
  return {
    realizado,
    metaAteAgora,
    pct: metaAteAgora ? realizado / metaAteAgora : null,
    metaDia,
    projecao: metaAteAgora && metaDia ? (realizado * metaDia) / metaAteAgora : null,
    ultimaHora: ls.length ? Math.min(...ls.map(corteDaLinha)) - 1 : -1,
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
}

export function horaAHora(ls: LinhaBlack[]): HoraBlack[] {
  const comMeta = temMeta(ls);
  let metaAcum = 0;
  let realAcum = 0;
  return HORAS.map((h) => {
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
    };
  });
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
      const realizado = soma(l.realizado_hora);
      const ateAgora = l.meta_dia !== null ? soma(l.meta_hora.slice(0, corteDaLinha(l))) : 0;
      return { metaDia: l.meta_dia, realizado, pct: l.meta_dia ? realizado / l.meta_dia : null, metaAteAgora: l.meta_dia !== null ? ateAgora : null, ritmo: ateAgora > 0 ? realizado / ateAgora : null };
    },
  };
}
