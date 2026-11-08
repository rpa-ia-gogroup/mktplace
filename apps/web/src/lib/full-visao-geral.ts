/**
 * FULL-UNIFICADO-1 — regras da "Visão geral" do Full (ML + Shopee).
 *
 * Junta as DUAS rotas de estoque que ja' existem; nao ha' endpoint novo.
 * A classificacao (ruptura, baixo, excesso) e a cobertura de cada item vem
 * prontas da API: aqui so' se conta, divide e ordena.
 *
 * AUSENCIA NAO E' ZERO: canal indisponivel, marca sem fotografia ou lista
 * truncada viram `null` com motivo, e a tela desenha "—" -- nunca 0.
 *
 * GRAOS DIFERENTES: a Shopee conta PRODUTO (kits fora, como nos indicadores
 * da tela de estoque); o ML conta INVENTARIO Full lido. A soma do "Total" e'
 * de itens no Full, e a tela diz isso no ⓘ.
 */
import {
  CONTAS_ESPERADAS_API,
  contasAusentes,
  fotografiaEstaVelha,
  frescorLabel,
  nomeExibido,
  type EstoqueFullResponse,
} from "./estoque-full.ts";
import {
  fotografiaVelhaML,
  frescorLabelML,
  identificacaoML,
  tituloMarca,
  type MLFullEstoqueResponse,
} from "./ml-full-estoque.ts";

export type Canal = "ml" | "shopee";

export const NOME_CANAL: Record<Canal, string> = { ml: "ML", shopee: "Shopee" };

/** Limites maximos aceitos pelas rotas: a lista inteira cabe numa chamada. */
export const QUERY_SHOPEE = "limite=1000";
export const QUERY_ML = "limite=2000";

export interface MarcaCanal {
  marca: string;
  /** `null` = nao medido (motivo diz por que). */
  base: number | null;
  ruptura: number | null;
  motivo?: string;
}

export interface ItemRuptura {
  canal: Canal;
  marca: string;
  nome: string;
  mediaDiaria: number;
  /** Shopee: estoque do vendedor (fora do Full). `undefined` no ML: nao se aplica. */
  estoqueVendedor?: number | null;
  /** Impacto POTENCIAL em R$/dia. `null` = sem preco; `undefined` = impacto nao carregado. */
  perdaDia?: number | null;
  /** Perda bruta do item (Shopee com estoque do vendedor: so' como apoio). */
  perdaBruta?: number | null;
}

export interface ResumoOk {
  canal: Canal;
  status: "ok";
  base: number;
  ruptura: number;
  baixo: number;
  excesso: number;
  /** Cobertura (dias) de cada item com venda; `null` se a lista veio truncada. */
  coberturas: number[] | null;
  marcas: MarcaCanal[];
  rupturas: ItemRuptura[];
  /** A lista trouxe todas as rupturas que o indicador conta? */
  rupturasCompletas: boolean;
  /** Shopee: rupturas sem estoque do vendedor (a venda para de fato). `null` = nao se aplica ou lista incompleta. */
  semVendedor: number | null;
  aviso: string | null;
  refDate: string;
  diasFoto: number | null;
  frescor: string;
  frescorVelho: boolean;
}

export interface ResumoAusente {
  canal: Canal;
  status: "indisponivel" | "erro";
  motivo: string;
}

export type ResumoCanal = ResumoOk | ResumoAusente;

const MOTIVO_TRUNCADA = "a API devolveu a lista truncada";

function numero(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

export function resumoShopee(r: EstoqueFullResponse): ResumoCanal {
  if (r.status === "unavailable") return { canal: "shopee", status: "indisponivel", motivo: r.unavailable_reason };
  const i = r.indicadores;
  const completa = !r.truncado;
  const itens = r.produtos.filter((p) => p.classificacao_torre !== "KIT_NAO_CONCILIADO");

  const porMarca = new Map<string, { base: number; ruptura: number }>();
  for (const p of itens) {
    const m = porMarca.get(p.brand) ?? { base: 0, ruptura: 0 };
    m.base++;
    if (p.classificacao_torre === "RUPTURA_CANDIDATA") m.ruptura++;
    porMarca.set(p.brand, m);
  }
  const marcas: MarcaCanal[] = completa
    ? [...porMarca].map(([marca, m]) => ({ marca, ...m }))
    : [...new Set(r.produtos.map((p) => p.brand))].map((marca) => ({
        marca, base: null, ruptura: null, motivo: MOTIVO_TRUNCADA,
      }));
  for (const marca of r.marcas_nao_cobertas) {
    marcas.push({ marca, base: null, ruptura: null, motivo: "sem conta Shopee na esteira de estoque" });
  }

  const rupturas = itens
    .filter((p) => p.classificacao_torre === "RUPTURA_CANDIDATA")
    .map((p) => ({
      canal: "shopee" as const, marca: p.brand, nome: nomeExibido(p),
      mediaDiaria: numero(p.avg_daily_units_28d) ?? 0, estoqueVendedor: p.seller_stock_total,
    }));
  const rupturasCompletas = rupturas.length === i.produtos_ruptura;
  const faltam = contasAusentes(CONTAS_ESPERADAS_API, r.contas_cobertas);

  return {
    canal: "shopee",
    status: "ok",
    base: i.produtos_total - i.produtos_kit_nao_conciliado,
    ruptura: i.produtos_ruptura,
    baixo: i.produtos_baixo,
    excesso: i.produtos_excesso,
    coberturas: completa ? itens.map((p) => numero(p.cobertura_torre_dias)).filter((n): n is number => n !== null) : null,
    marcas,
    rupturas,
    rupturasCompletas,
    // `null` no estoque do vendedor e' "nao sabemos": so' conta o zero medido.
    semVendedor: rupturasCompletas ? rupturas.filter((p) => p.estoqueVendedor === 0).length : null,
    aviso: faltam.length ? `Sem fotografia para: ${faltam.map(tituloMarca).join(", ")}` : null,
    refDate: r.frescor.ref_date,
    diasFoto: r.frescor.dias_desde_a_fotografia,
    frescor: frescorLabel(r.frescor),
    frescorVelho: fotografiaEstaVelha(r.frescor),
  };
}

export function resumoML(r: MLFullEstoqueResponse): ResumoCanal {
  if (r.status === "unavailable") return { canal: "ml", status: "indisponivel", motivo: r.unavailable_reason };
  const i = r.indicadores;
  const itens = r.inventarios.filter((v) => v.classificacao_torre !== "FORA_DO_FULL" && v.classificacao_torre !== "SEM_LEITURA");

  const marcas: MarcaCanal[] = r.marcas.map((m) => {
    if (m.estado === null) return { marca: m.brand, base: null, ruptura: null, motivo: "sem fotografia no dia" };
    return { marca: m.brand, base: m.inventarios_full_lidos, ruptura: m.por_classificacao.RUPTURA_CANDIDATA ?? 0 };
  });

  const rupturas = itens
    .filter((v) => v.classificacao_torre === "RUPTURA_CANDIDATA")
    .map((v) => ({ canal: "ml" as const, marca: v.brand, nome: identificacaoML(v).texto, mediaDiaria: numero(v.media_diaria_28d) ?? 0 }));

  return {
    canal: "ml",
    status: "ok",
    base: i.inventarios_full_lidos,
    ruptura: i.inventarios_ruptura,
    baixo: i.inventarios_baixo,
    excesso: i.inventarios_excesso,
    coberturas: r.truncado ? null : itens.map((v) => numero(v.cobertura_torre_dias)).filter((n): n is number => n !== null),
    marcas,
    rupturas,
    rupturasCompletas: rupturas.length === i.inventarios_ruptura,
    semVendedor: null,
    aviso: i.total_parcial ? `Total parcial: ${i.motivos_total_parcial.join("; ")}` : null,
    refDate: r.frescor.ref_date,
    diasFoto: r.frescor.dias_desde_a_fotografia,
    frescor: frescorLabelML(r.frescor),
    frescorVelho: fotografiaVelhaML(r.frescor),
  };
}

// ---------------------------------------------------------------------------
// Contas
// ---------------------------------------------------------------------------

export function pct(parte: number | null, base: number | null): number | null {
  if (parte === null || base === null || base <= 0) return null;
  return parte / base;
}

export function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function mediana(valores: number[] | null): number | null {
  if (!valores?.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

export function oks(canais: ResumoCanal[]): ResumoOk[] {
  return canais.filter((c): c is ResumoOk => c.status === "ok");
}

/** Total so' quando os dois canais mediram: soma parcial pareceria o todo. */
export type Totais = Pick<ResumoOk, "base" | "ruptura" | "baixo" | "excesso" | "coberturas">;

export function total(canais: ResumoCanal[]): Totais | null {
  const ok = oks(canais);
  if (ok.length !== canais.length || !ok.length) return null;
  const soma = (k: "base" | "ruptura" | "baixo" | "excesso") => ok.reduce((s, c) => s + c[k], 0);
  return {
    base: soma("base"),
    ruptura: soma("ruptura"),
    baixo: soma("baixo"),
    excesso: soma("excesso"),
    coberturas: ok.every((c) => c.coberturas) ? ok.flatMap((c) => c.coberturas!) : null,
  };
}

/** "2026-11-04" -> "04/11". */
export function diaMes(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}/${m[1]}` : iso;
}

/** Selo de frescor do topo: "ML: foto de 04/11, 4 dias". */
export function seloFrescor(c: ResumoOk): string {
  const d = c.diasFoto;
  const idade = d === null ? "" : d <= 0 ? ", hoje" : d === 1 ? ", 1 dia" : `, ${d} dias`;
  return `${NOME_CANAL[c.canal]}: foto de ${diaMes(c.refDate)}${idade}`;
}

function plural(n: number, um: string, varios: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

/** A frase do topo: o numero que mais importa, com o recorte por canal. */
export function manchete(canais: ResumoCanal[]): { texto: string; critico: boolean } {
  const ok = oks(canais);
  const fora = canais.filter((c) => c.status !== "ok").map((c) => NOME_CANAL[c.canal]);
  const sufixo = fora.length ? `. ${fora.join(" e ")}: sem dado de estoque agora` : "";
  if (!ok.length) return { texto: "Estoque Full sem dado agora nos dois canais", critico: false };
  const n = ok.reduce((s, c) => s + c.ruptura, 0);
  const base = ok.reduce((s, c) => s + c.base, 0);
  const onde = ok.length === 1 ? (ok[0].canal === "ml" ? " do ML" : " da Shopee") : "";
  // Fotos de dias diferentes: cada parcela diz a sua data, para a soma nao parecer uma foto so'.
  const datasDiferentes = new Set(ok.map((c) => c.refDate)).size > 1;
  const foto = (c: ResumoOk) => (datasDiferentes ? ` (foto de ${diaMes(c.refDate)})` : "");
  if (n === 0) return { texto: `Nenhum produto sem saldo no Full com demanda${onde}${sufixo}`, critico: false };
  const recorte = ok.length > 1
    ? `: ${ok.map((c) => `${c.ruptura.toLocaleString("pt-BR")} ${c.canal === "ml" ? "no ML" : "na Shopee"}${foto(c)}`).join(" e ")}`
    : foto(ok[0]);
  return {
    texto: `${plural(n, "produto", "produtos")} sem saldo no Full com demanda${onde} (${fmtPct(pct(n, base))} do sortimento)${recorte}${sufixo}`,
    critico: true,
  };
}

export interface LinhaMarca {
  marca: string;
  celulas: Partial<Record<Canal, MarcaCanal>>;
  base: number;
  ruptura: number;
  taxa: number | null;
  impacto: Partial<Record<Canal, MarcaImpacto>>;
  /** Maior perda de destaque entre os canais (R$ nunca somado entre canais). */
  maiorPerda: number | null;
  /** Shopee com ruptura em que TODOS os itens tem estoque do vendedor: R$ 0 explicado, nao "0,0%". */
  vendedorTemEstoque: boolean;
}

/**
 * Ruptura por marca. Com impacto: da maior perda de destaque (ML: perda;
 * Shopee: so' os sem estoque do vendedor) para a menor -- o MAIOR entre os
 * canais, nunca a soma. Sem impacto: pela taxa de ruptura. Sem medicao no fim.
 */
export function rupturaPorMarca(canais: ResumoCanal[], impacto: ImpactoRuptura | null = null): LinhaMarca[] {
  const linhas = new Map<string, LinhaMarca>();
  for (const c of oks(canais)) {
    for (const m of c.marcas) {
      const l = linhas.get(m.marca) ?? { marca: m.marca, celulas: {}, base: 0, ruptura: 0, taxa: null, impacto: {}, maiorPerda: null, vendedorTemEstoque: false };
      l.celulas[c.canal] = m;
      if (m.base !== null && m.ruptura !== null) {
        l.base += m.base;
        l.ruptura += m.ruptura;
      }
      l.taxa = pct(l.ruptura, l.base);
      linhas.set(m.marca, l);
    }
  }
  for (const c of impactosOk(impacto)) {
    for (const m of c.marcas) {
      const l = linhas.get(m.brand);
      if (!l) continue;
      l.impacto[c.canal] = m;
      if (c.canal === "shopee") {
        const its = c.itens.filter((i) => i.brand === m.brand);
        l.vendedorTemEstoque = its.length > 0 && its.every((i) => (i.estoque_vendedor ?? 0) > 0);
      }
      const v = perdaDestaque(c.canal, m);
      if (v !== null) l.maiorPerda = Math.max(l.maiorPerda ?? 0, v);
    }
  }
  return [...linhas.values()].sort(
    (a, b) => (b.maiorPerda ?? -1) - (a.maiorPerda ?? -1)
      || (b.taxa ?? -1) - (a.taxa ?? -1) || b.ruptura - a.ruptura || a.marca.localeCompare(b.marca),
  );
}

/**
 * Top N rupturas. Canal com impacto: itens da rota de impacto, por perda R$/dia
 * (sem preco no fim). Canal sem impacto: itens do estoque, depois, por venda/dia.
 */
export function topRupturas(canais: ResumoCanal[], n = 10, impacto: ImpactoRuptura | null = null): ItemRuptura[] {
  const comImpacto = new Map(impactosOk(impacto).map((c) => [c.canal, c]));
  return oks(canais)
    .flatMap((c) => comImpacto.get(c.canal)?.itens.map((i) => itemDoImpacto(c.canal, i)) ?? c.rupturas)
    .sort((a, b) =>
      (b.perdaDia ?? -1) - (a.perdaDia ?? -1) || b.mediaDiaria - a.mediaDiaria || a.nome.localeCompare(b.nome))
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// Impacto POTENCIAL no faturamento (rota /performance/full-impacto-ruptura)
// ---------------------------------------------------------------------------

export interface ItemImpacto {
  brand: string;
  sku: string | null;
  titulo: string | null;
  media_diaria_28d: number;
  preco_medio: number | null;
  fonte_preco: "vendas_30d" | "anuncio" | "mes" | null;
  mes_preco: string | null;
  estoque_vendedor: number | null;
  perda_dia: number | null;
}

export interface MarcaImpacto {
  brand: string;
  rupturas: number;
  sem_preco: number;
  perda_dia: number | null;
  perda_dia_sem_vendedor: number | null;
  gmv_full_dia: number | null;
  pct_gmv_full: number | null;
  pct_gmv_full_sem_vendedor: number | null;
}

export interface CanalImpactoOk {
  canal: Canal;
  status: "ok";
  ref_date: string;
  rupturas: number;
  sem_preco: number;
  preco_fallback: number;
  sem_estoque_vendedor: number | null;
  perda_dia: number | null;
  perda_dia_sem_vendedor: number | null;
  gmv_full_dia: number | null;
  dias_gmv: number;
  pct_gmv_full: number | null;
  pct_gmv_full_sem_vendedor: number | null;
  motivo_pct: string | null;
  marcas: MarcaImpacto[];
  itens: ItemImpacto[];
}

export type CanalImpacto = CanalImpactoOk | { canal: Canal; status: "unavailable"; motivo: string };

export interface ImpactoRuptura {
  ml: CanalImpacto;
  shopee: CanalImpacto;
  janela_gmv_dias: number;
  limitacoes: string[];
}

export function impactosOk(i: ImpactoRuptura | null): CanalImpactoOk[] {
  if (!i) return [];
  return [i.ml, i.shopee].filter((c): c is CanalImpactoOk => c.status === "ok");
}

/** O numero de destaque: no ML a perda; na Shopee so' os sem estoque do vendedor (os que param a venda). */
export function perdaDestaque(canal: Canal, m: { perda_dia: number | null; perda_dia_sem_vendedor: number | null }): number | null {
  return canal === "shopee" ? m.perda_dia_sem_vendedor : m.perda_dia;
}

export function pctDestaque(canal: Canal, m: { pct_gmv_full: number | null; pct_gmv_full_sem_vendedor: number | null }): number | null {
  return canal === "shopee" ? m.pct_gmv_full_sem_vendedor : m.pct_gmv_full;
}

/** "R$ 13,3 mil" / "R$ 950". `null` vira travessao, nunca R$ 0. */
export function fmtReais(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `R$ ${v.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 })}`;
}

/**
 * A MESMA regra da manchete e da tabela por marca: na Shopee so' perde quem
 * esta' sem estoque do vendedor. Com estoque do vendedor o destaque e' R$ 0
 * (segue vendendo fora do Full); estoque do vendedor nao informado e' ausencia.
 */
export function perdaDestaqueShopee(i: Pick<ItemImpacto, "perda_dia" | "estoque_vendedor">): number | null {
  if (i.estoque_vendedor === null) return null;
  return i.estoque_vendedor > 0 ? 0 : i.perda_dia;
}

function itemDoImpacto(canal: Canal, i: ItemImpacto): ItemRuptura {
  const nome = canal === "ml"
    ? identificacaoML({ sku: i.sku, titulo: i.titulo, ancora_e_variacao: null }).texto
    : i.titulo?.trim() || i.sku?.trim() || "sem identificação";
  return {
    canal, marca: i.brand, nome, mediaDiaria: i.media_diaria_28d,
    estoqueVendedor: canal === "shopee" ? i.estoque_vendedor : undefined,
    perdaDia: canal === "shopee" ? perdaDestaqueShopee(i) : i.perda_dia,
    perdaBruta: i.perda_dia,
  };
}

/**
 * Trecho de impacto da manchete, por canal e SEM somar R$ entre canais:
 * "impacto potencial de R$ 13,3 mil/dia no ML (10,3% do Full) e R$ 1,5 mil/dia na Shopee (2,8%)".
 */
export function mancheteImpacto(impacto: ImpactoRuptura | null): string | null {
  const partes = impactosOk(impacto)
    .filter((c) => perdaDestaque(c.canal, c) !== null)
    .map((c, idx) => {
      const p = pctDestaque(c.canal, c);
      const pctTxt = p === null ? "" : ` (${fmtPct(p)}${idx === 0 ? " do Full" : ""})`;
      return `${fmtReais(perdaDestaque(c.canal, c))}/dia ${c.canal === "ml" ? "no ML" : "na Shopee"}${pctTxt}`;
    });
  return partes.length ? `impacto potencial de ${partes.join(" e ")}` : null;
}
