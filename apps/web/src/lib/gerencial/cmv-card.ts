/**
 * Cartao de CMV da Gerencial (pedido do Planejamento, 26/11/2026).
 *
 * O numero e' EXATAMENTE o da DRE: `componentes.cmv.pct_receita` do `total` de
 * `GET /api/v1/dre` (CMV / receita da DRE), no mesmo recorte de canal e marca.
 * Nada e' recalculado aqui. CMV e' mensal: o cartao le um mes e diz qual.
 */
import { ORIGEM_CHIP, STATUS_CHIP, fmtPctDre, rotuloMes, textoPrevia, type DreResponse } from "../dre.ts";
import type { Tom } from "../../components/ui/tone";

/** Mesmo texto de `dre_service.AVISO_CMV_EXTRAPOLADO` (sem o espaco inicial). */
export const AVISO_CMV_EXTRAPOLADO =
  "O CMV foi estendido proporcionalmente à receita onde a NF ou o custo não cobre o mês inteiro.";

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
  /** "Competência 10/2026". */
  competencia: string;
  /** Selo da DRE (origem extrapolado/parcial ou status), com o tom da DRE. */
  selo: { rotulo: string; tom: Tom } | null;
  /** "Prévia · fecha em 31/12/2026" quando o mes ainda nao fechou. */
  previa: string | null;
  /** Motivo da ausencia ("Insumo não publicado"); so' sem valor. */
  semDado: string | null;
  /** Texto do ⓘ. */
  dica: string;
}

export function cartaoCmv(resp: DreResponse, mes: string): CartaoCmv {
  const t = resp.total;
  const competencia = `Competência ${rotuloMes(resp.periodo.meses[0] ?? mes)}`;
  const base = "CMV ÷ receita da DRE, o mesmo número da aba DRE, no recorte de canal e marca do filtro.";
  if (!t) return { valor: null, competencia, selo: null, previa: null, semDado: "Sem dado", dica: base };
  const cmv = t.componentes.cmv;
  const valor = cmv.valor == null ? null : fmtPctDre(cmv.pct_receita);
  const previa = textoPrevia(t);
  if (valor == null) {
    const motivo = STATUS_CHIP[cmv.status]?.rotulo ?? "Sem dado";
    return { valor: null, competencia, selo: null, previa, semDado: motivo, dica: [base, previa].filter(Boolean).join(" ") };
  }
  const origem = cmv.origem && cmv.origem !== "realizado" ? ORIGEM_CHIP[cmv.origem] : null;
  const selo = origem ?? STATUS_CHIP[cmv.status];
  const dica = [
    base,
    previa ? `${previa}.` : null,
    cmv.cobertura_rotulo ? `Cobertura: ${cmv.cobertura_rotulo}.` : null,
    cmv.origem === "extrapolado" ? AVISO_CMV_EXTRAPOLADO : null,
  ]
    .filter(Boolean)
    .join(" ");
  return { valor, competencia, selo, previa, semDado: null, dica };
}
