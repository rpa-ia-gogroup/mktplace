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
    const motivo = STATUS_CHIP[cmv.status]?.rotulo ?? "Sem dado";
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
