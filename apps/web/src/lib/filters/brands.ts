/** Marcas no escopo GoBeauté — espelha BRAND_LABELS em performance_service.py. */
export const ALL_BRAND_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "apice", label: "ÁPICE" },
  { value: "barbours", label: "BARBOURS" },
  { value: "kokeshi", label: "KOKESHI" },
  { value: "lescent", label: "LESCENT" },
  { value: "rituaria", label: "RITUÁRIA" },
];

export const ALL_BRAND_KEYS: readonly string[] = ALL_BRAND_OPTIONS.map((b) => b.value);

/**
 * Marcas menores: o dado vem do Bling (`/marcas-menores`), nao do Data Mart. Vivem no
 * filtro de marca global, mas as APIs do Data Mart nunca as recebem (ver `semMarcasMenores`).
 * A Denavita entra aqui quando a conta dela no Bling for autorizada.
 */
export const MARCAS_MENORES_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "yenzah", label: "YENZAH" },
  { value: "aua", label: "AUÁ" },
  { value: "by-samia", label: "BY SAMIA" },
];

export const MARCAS_MENORES_KEYS: readonly string[] = MARCAS_MENORES_OPTIONS.map((b) => b.value);

/** O que o filtro de marca lista: as grandes e depois as menores. */
export const FILTER_BRAND_OPTIONS = [...ALL_BRAND_OPTIONS, ...MARCAS_MENORES_OPTIONS];
export const FILTER_BRAND_KEYS: readonly string[] = FILTER_BRAND_OPTIONS.map((b) => b.value);

export function brandLabel(brandKey: string): string {
  return FILTER_BRAND_OPTIONS.find((b) => b.value === brandKey)?.label ?? brandKey.toUpperCase();
}

export interface EscopoDeMarcas {
  /** Marcas grandes (Data Mart) selecionadas; `[]` com `temGrandes` = todas. */
  grandes: string[];
  temGrandes: boolean;
  /** Marcas menores (Bling) selecionadas; todas quando a selecao esta vazia. */
  menores: string[];
  temMenores: boolean;
  /** So' menores: nada do Data Mart se aplica (um filtro de marca vazio la' significaria "todas"). */
  soMenores: boolean;
}

/**
 * Le a selecao do filtro de marca. Vazio = Todas (grandes e menores). Com selecao, cada grupo
 * so' existe se algo dele foi marcado: so' grandes = sem menores; so' menores = sem grandes.
 */
export function escopoDeMarcas(brands: readonly string[]): EscopoDeMarcas {
  if (brands.length === 0) {
    return { grandes: [], temGrandes: true, menores: [...MARCAS_MENORES_KEYS], temMenores: true, soMenores: false };
  }
  const grandes = brands.filter((b) => !MARCAS_MENORES_KEYS.includes(b));
  const menores = brands.filter((b) => MARCAS_MENORES_KEYS.includes(b));
  return {
    grandes,
    temGrandes: grandes.length > 0,
    menores,
    temMenores: menores.length > 0,
    soMenores: grandes.length === 0 && menores.length > 0,
  };
}

/** Tira as marcas menores de uma lista (as APIs do Data Mart so' conhecem as grandes). */
export function semMarcasMenores(brands: readonly string[]): string[] {
  return brands.filter((b) => !MARCAS_MENORES_KEYS.includes(b));
}

/**
 * Tira as marcas menores do `brands=` de uma URL de API. Sem marca restante, o parametro some
 * (o que, para a API, e' "todas as grandes": quem so' tem menores nao chega a chamar a API).
 */
export function urlSemMarcasMenores(url: string): string {
  const m = /([?&])brands=([^&#]*)/.exec(url);
  if (!m) return url;
  const lista = decodeURIComponent(m[2]).split(",").map((b) => b.trim()).filter(Boolean);
  const grandes = semMarcasMenores(lista);
  if (grandes.length === lista.length) return url;
  if (grandes.length > 0) return url.replace(m[0], `${m[1]}brands=${encodeURIComponent(grandes.join(","))}`);
  // Remove o parametro, mantendo o separador certo.
  return m[1] === "?" ? url.replace(/\?brands=[^&#]*&?/, "?").replace(/\?$/, "") : url.replace(m[0], "");
}
