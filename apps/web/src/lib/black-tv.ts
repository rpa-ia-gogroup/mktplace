/**
 * BLACK-TV — a receita de hoje na MESMA fonte do GMV de hoje da Gerencial (fato diária, com a hora em
 * andamento): `overview` por canal (GMV, pedidos, carga) e `brands` (GMV de cada marca por canal).
 * Meta pela mesma conta da /black (`resumoBlack` com a hora em andamento pró-rata).
 * Sem React: testável com `node --test`.
 */
import { linhasComParcial, resumoBlack, type RespostaBlack } from "./black-hora.ts";

export type CanalTv = "tiktok" | "ml" | "shopee";

/** `overview` de hoje de UM canal: `current.gmv`/`orders` e a carga (`refreshed_at`). */
export interface OverviewTv {
  current?: { gmv?: number | null; orders?: number | null } | null;
  refreshed_at?: string | null;
}

/** Linha do `brands` de hoje (todos os canais). */
export interface MarcaTvApi {
  brand: string;
  tiktok_gmv?: number | null;
  ml_gmv?: number | null;
  shopee_gmv?: number | null;
}

export interface CanalHojeTv {
  id: CanalTv;
  /** null = sem dado (nunca 0). */
  gmv: number | null;
  pedidos: number;
  /** Carga da fato diária do canal (ISO); null sem dado. */
  ate: string | null;
}

export interface MarcaHojeTv {
  brand: string;
  porCanal: Partial<Record<CanalTv, number>>;
}

export function canalDoOverview(id: CanalTv, o: OverviewTv | null | undefined): CanalHojeTv {
  const gmv = o?.current?.gmv;
  return { id, gmv: gmv == null ? null : gmv, pedidos: o?.current?.orders ?? 0, ate: gmv == null ? null : o?.refreshed_at ?? null };
}

export function marcasDoBrands(rows: readonly MarcaTvApi[] | null | undefined): MarcaHojeTv[] {
  return (rows ?? []).map((r) => {
    const porCanal: Partial<Record<CanalTv, number>> = {};
    for (const c of ["tiktok", "ml", "shopee"] as const) {
      const v = r[`${c}_gmv`];
      if (v != null) porCanal[c] = v;
    }
    return { brand: r.brand, porCanal };
  });
}

/** Meta da TV (só Shopee + ML, aba 'Meta hora Black') pela regra da /black: realizado com a hora em andamento ÷
 *  (meta até a hora fechada + meta da hora em andamento × fração). `null` sem meta. */
export function metaDe(black: RespostaBlack | null | undefined, marca?: string) {
  const ls = black ? linhasComParcial(black).filter((l) => !marca || l.marca === marca) : [];
  if (!ls.length || ls.some((l) => l.meta_dia === null)) return null;
  const r = resumoBlack(ls);
  return { dia: r.metaDia ?? 0, ate: r.metaAteAgora ?? 0, real: r.realizado, atingido: r.pct, doDia: r.metaDia ? r.realizado / r.metaDia : null, rotulo: r.ate };
}
