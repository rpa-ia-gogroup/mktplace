/**
 * Cartao de CMV da Gerencial (pedido do Planejamento, 26/11/2026).
 *
 * O numero e' EXATAMENTE o da DRE: `componentes.cmv.pct_receita` do `total` de
 * `GET /api/v1/dre` (CMV / receita da DRE), no mesmo recorte de canal e marca.
 * Nada e' recalculado aqui. CMV e' mensal: o cartao le um mes e diz qual.
 */
import { ORIGEM_CHIP, STATUS_CHIP, ehPrevia, fmtInstanteBrt, fmtPctDre, type DreResponse } from "../dre.ts";
import type { Tom } from "../../components/ui/tone";

/** Mesmo texto de `dre_service.AVISO_CMV_EXTRAPOLADO` (sem o espaco inicial). */
export const AVISO_CMV_EXTRAPOLADO =
  "O CMV foi estendido proporcionalmente à receita onde a NF ou o custo não cobre o mês inteiro.";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** "2026-10" -> "Outubro/2026". Fora do formato, devolve como veio. */
export function mesPorExtenso(mes: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  const nome = m ? MESES[Number(m[2]) - 1] : undefined;
  return m && nome ? `${nome}/${m[1]}` : mes;
}

/**
 * Mes do CMV para o periodo da Gerencial: o mes do fim do periodo; se ele
 * ainda nao terminou (mes corrente ou futuro), o mes anterior ao corrente,
 * porque mes aberto nao tem CMV publicado.
 */
export function mesDoCmv(dateTo: string, hojeIso: string): string {
  const fim = dateTo.slice(0, 7);
  const atual = hojeIso.slice(0, 7);
  if (fim < atual) return fim;
  const [a, m] = atual.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

export interface CartaoCmv {
  /** "25,3%" ou `null` = sem dado (nunca 0). */
  valor: string | null;
  /** Subtitulo: "Outubro/2026 · último mês com custo", "Setembro/2026" ou "Novembro/2026 · Insumo não publicado". */
  legenda: string;
  /** Selo da DRE (origem extrapolado/parcial ou status), com o tom da DRE. */
  selo: { rotulo: string; tom: Tom } | null;
  /** Texto do ⓘ. */
  dica: string;
}

/**
 * `ultimoComCusto`: o mes nao e' o do filtro (o periodo esta' num mes aberto e o
 * cartao caiu no ultimo mes fechado). So' entao o subtitulo diz "último mês com custo".
 */
export function cartaoCmv(resp: DreResponse, mes: string, ultimoComCusto = false): CartaoCmv {
  const t = resp.total;
  const nomeMes = mesPorExtenso(resp.periodo.meses[0] ?? mes);
  const base = "CMV ÷ receita da DRE, o mesmo número da aba DRE, no recorte de canal e marca do filtro.";
  if (!t) return { valor: null, legenda: `${nomeMes} · sem receita no recorte`, selo: null, dica: base };
  const cmv = t.componentes.cmv;
  const valor = cmv.valor == null ? null : fmtPctDre(cmv.pct_receita);
  // Mes imaturo: a data de fechamento vem da DRE; sem ela, a frase sai sem data (nada inventado).
  const aberto = ehPrevia(t)
    ? `Mês ainda aberto na DRE${t.fecha_em ? `: fecha em ${fmtInstanteBrt(t.fecha_em)}` : ""}; o valor pode mudar com devoluções.`
    : null;
  if (valor == null) {
    // Depois do "·" vai em minuscula: "Novembro/2026 · insumo não publicado".
    const rotulo = STATUS_CHIP[cmv.status]?.rotulo ?? "Sem dado";
    const motivo = rotulo.charAt(0).toLowerCase() + rotulo.slice(1);
    return { valor: null, legenda: `${nomeMes} · ${motivo}`, selo: null, dica: [base, aberto].filter(Boolean).join(" ") };
  }
  // "Extrapolado" so' com cobertura abaixo do minimo da API (regras.cmv_cobertura_minima).
  // Cobertura ou minimo ausentes: o selo fica (nao ha' como afirmar que cobre).
  const minimo = typeof resp.regras?.cmv_cobertura_minima === "number" ? resp.regras.cmv_cobertura_minima : null;
  const cobre = cmv.cobertura != null && minimo != null && cmv.cobertura >= minimo;
  let selo = cmv.origem && cmv.origem !== "realizado" ? ORIGEM_CHIP[cmv.origem] : STATUS_CHIP[cmv.status];
  if (cmv.origem === "extrapolado" && cobre) selo = null;
  const dica = [
    base,
    aberto,
    cmv.cobertura_rotulo ? `Cobertura: ${cmv.cobertura_rotulo}.` : null,
    cmv.origem === "extrapolado" ? AVISO_CMV_EXTRAPOLADO : null,
  ]
    .filter(Boolean)
    .join(" ");
  return { valor, legenda: ultimoComCusto ? `${nomeMes} · último mês com custo` : nomeMes, selo, dica };
}

// ---------------------------------------------------------------------------
// CMV do mes ate ontem pelas notas (GET /api/v1/performance/cmv-notas)
// ---------------------------------------------------------------------------

export interface CmvNotasBloco {
  cmv: number | null;
  receita_com_custo: number | null;
  receita: number | null;
  cmv_pct: number | null;
  cobertura: number | null;
  parcial: boolean;
}

export interface CmvNotas extends CmvNotasBloco {
  mes: string;
  ate: string | null;
  carregado_em: string | null;
  cobertura_minima: number;
  por_canal: (CmvNotasBloco & { canal: string })[];
}

const CANAL_CURTO: Record<string, string> = { tiktok: "TikTok", ml: "ML", shopee: "Shopee" };
const pct1 = (v: number | null) => fmtPctDre(v, 1);

/** O mes fechado da DRE, para o ⓘ: "DRE (Outubro/2026): 25,3%. Mês ainda aberto na DRE: fecha em …". */
export function textoDre(resp: DreResponse | null, mes: string): string | null {
  if (!resp) return null;
  const c = cartaoCmv(resp, mes);
  const t = resp.total;
  const aberto = t && ehPrevia(t)
    ? `Mês ainda aberto na DRE${t.fecha_em ? `: fecha em ${fmtInstanteBrt(t.fecha_em)}` : ""}; o valor pode mudar com devoluções.`
    : null;
  const nome = mesPorExtenso(resp.periodo.meses[0] ?? mes);
  return [`Mês fechado na DRE (${nome}): ${c.valor ?? "sem dado"}.`, aberto].filter(Boolean).join(" ");
}

/** 2a linha visivel do cartao: "Outubro fechado (DRE): 25,3%". Sem DRE ou sem valor, `null` (a linha some). */
export function linhaDre(resp: DreResponse | null, mes: string): string | null {
  if (!resp) return null;
  const valor = cartaoCmv(resp, mes).valor;
  if (!valor) return null;
  return `${mesPorExtenso(resp.periodo.meses[0] ?? mes).split("/")[0]} fechado (DRE): ${valor}`;
}

/**
 * Cartao pelas notas. O numero vem pronto da API (CMV ÷ receita com custo);
 * aqui so' texto: subtitulo "Novembro até 25/11 (pelas notas)", selo "Parcial"
 * quando a API marca cobertura abaixo do minimo, cobertura e DRE no ⓘ.
 */
export function cartaoCmvNotas(nf: CmvNotas, dre: string | null): CartaoCmv {
  const nomeMes = mesPorExtenso(nf.mes).split("/")[0];
  const valor = pct1(nf.cmv_pct);
  const base = "CMV pelas notas fiscais do mês = CMV ÷ receita com custo (só as linhas com custo).";
  if (valor == null || !nf.ate) {
    // O motivo real: nenhuma nota no recorte, ou notas sem custo cadastrado.
    const motivo = !nf.ate || !nf.receita ? "sem notas no recorte" : "sem notas com custo";
    return { valor: null, legenda: `${nomeMes} · ${motivo}`, selo: null, dica: [base, dre].filter(Boolean).join(" ") };
  }
  const [, m, d] = nf.ate.split("-");
  const semCusto = nf.cobertura != null ? pct1((1 - nf.cobertura) * 100) : null;
  const canais = nf.por_canal.length > 1
    ? nf.por_canal
        .map((c) => `${CANAL_CURTO[c.canal] ?? c.canal} ${pct1(c.cmv_pct) ?? "sem dado"}${c.parcial && c.cobertura != null ? ` (sem custo ${pct1((1 - c.cobertura) * 100)})` : ""}`)
        .join(" · ")
    : null;
  const dica = [
    base,
    semCusto ? `Receita sem custo: ${semCusto} (fica fora da conta, não vira custo zero).` : null,
    canais ? `${canais}.` : null,
    dre,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    valor,
    legenda: `${nomeMes} até ${d}/${m} (pelas notas)`,
    selo: nf.parcial ? { rotulo: "Parcial", tom: "atencao" } : null,
    dica,
  };
}
