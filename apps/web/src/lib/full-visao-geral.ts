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
  fmtDecimal,
  fotografiaEstaVelha,
  frescorLabel,
  nomeExibido,
  type EstoqueFullResponse,
} from "./estoque-full.ts";
import {
  fotografiaVelhaML,
  frescorLabelML,
  SEM_IDENTIFICACAO_ML,
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
  /** Nome para a vista: titulo; sem titulo, o SKU. Nunca "sku · titulo". */
  nome: string;
  /** SKU so' quando o nome e' o titulo (vai para title + sr-only); senao `null`. */
  sku: string | null;
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
      canal: "shopee" as const, marca: p.brand, nome: nomeExibido(p), sku: p.item_name?.trim() ? p.item_sku?.trim() || null : null,
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
    .map((v) => ({ canal: "ml" as const, marca: v.brand, ...nomeESku(v.sku, v.titulo, SEM_IDENTIFICACAO_ML), mediaDiaria: numero(v.media_diaria_28d) ?? 0 }));

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

/** Chip de frescor da linha do canal: "foto de 08/11, hoje" ou "foto de 04/11 · desatualizada". */
export function seloFrescor(c: ResumoOk): string {
  if (c.frescorVelho) return `foto de ${diaMes(c.refDate)} · desatualizada`;
  const d = c.diasFoto;
  const idade = d === null ? "" : d <= 0 ? ", hoje" : d === 1 ? ", 1 dia" : `, ${d} dias`;
  return `foto de ${diaMes(c.refDate)}${idade}`;
}

function plural(n: number, um: string, varios: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

/**
 * Heroi da visao geral: o % sem estoque (antes do absoluto), o total em uma
 * linha e o "x de y" para title + sr-only. Canal fora nao entra nem como zero.
 * `null` = nenhum canal medido (a tela mostra o estado de ausencia).
 */
export function heroiRuptura(canais: ResumoCanal[]): { valor: string; contexto: string; detalhe: string; critico: boolean } | null {
  const ok = oks(canais);
  if (!ok.length) return null;
  const n = ok.reduce((s, c) => s + c.ruptura, 0);
  const base = ok.reduce((s, c) => s + c.base, 0);
  const de = ok.length === 1 ? (ok[0].canal === "ml" ? " do ML" : " da Shopee") : "";
  return {
    valor: fmtPct(pct(n, base)),
    contexto: n === 0 ? `nenhum produto sem estoque${de}` : `${plural(n, "produto", "produtos")} do sortimento${de}`,
    detalhe: `${n.toLocaleString("pt-BR")} de ${base.toLocaleString("pt-BR")} itens no Full`,
    critico: n > 0,
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

/** Nome sem o codigo: titulo; sem titulo, o SKU. O SKU so' sobra quando o nome e' o titulo. */
export function nomeESku(sku: string | null | undefined, titulo: string | null | undefined, semNada: string): { nome: string; sku: string | null } {
  const s = sku?.trim() || null;
  const t = titulo?.trim() || null;
  return t ? { nome: t, sku: s } : { nome: s ?? semNada, sku: null };
}

/** Lista do top com mais de um canal: so' ai' o canal aparece na linha do produto. */
export function canaisMisturados(top: ItemRuptura[]): boolean {
  return new Set(top.map((t) => t.canal)).size > 1;
}

/** Linha 2 do produto no top: "Kokeshi · ML · 38,6 un./dia" (canal so' com lista mista; venda so' com impacto, senao ela e' a coluna). */
export function subtituloRuptura(t: ItemRuptura, o: { mostrarCanal: boolean; comImpacto: boolean }): string {
  return [tituloMarca(t.marca), o.mostrarCanal ? NOME_CANAL[t.canal] : null, o.comImpacto ? `${fmtDecimal(t.mediaDiaria)} un./dia` : null]
    .filter(Boolean).join(" · ");
}

/** Descricao do top: o que ordena, "todos do ML" quando a lista e' de um canal so', e se esta' incompleta. */
export function descricaoTop(top: ItemRuptura[], comImpacto: boolean, incompleta: boolean): string {
  const unico = top.length && !canaisMisturados(top) ? ` · todos ${top[0].canal === "ml" ? "do ML" : "da Shopee"}` : "";
  return `Rupturas ${comImpacto ? "de maior impacto potencial por dia" : "com mais venda por dia"}${unico}${incompleta ? " · lista incompleta" : ""}`;
}

/** Colunas da tabela por marca: canal fora, ou sem nenhuma marca medida nele, nao e' desenhado (seria so' "—"). */
export function colunasMarca(canais: ResumoCanal[], marcas: LinhaMarca[]): Canal[] {
  return oks(canais).map((c) => c.canal).filter((c) => marcas.some((l) => l.celulas[c]?.ruptura != null));
}

/** "12,6%" na vista e "59 de 468" para title + sr-only. `null` = ausencia. */
export function fracao(parte: number | null, base: number | null): { texto: string; detalhe: string } | null {
  const v = pct(parte, base);
  if (v === null || parte === null || base === null) return null;
  return { texto: fmtPct(v), detalhe: `${parte.toLocaleString("pt-BR")} de ${base.toLocaleString("pt-BR")}` };
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
  /** Janela do %: 28 dias ate' o ultimo dia com faturamento Full carregado (ate' a vespera da foto). */
  janela_gmv_inicio?: string | null;
  janela_gmv_fim?: string | null;
  pct_gmv_full: number | null;
  pct_gmv_full_sem_vendedor: number | null;
  motivo_pct: string | null;
  marcas: MarcaImpacto[];
  itens: ItemImpacto[];
  /** API-4 (so' com `?anterior=true`): os totais na foto anterior, mesmo recorte. */
  anterior?: ImpactoAnterior | null;
  motivo_anterior?: string | null;
}

export interface ImpactoAnterior {
  ref_date: string;
  rupturas: number;
  sem_estoque_vendedor: number | null;
  perda_dia: number | null;
  perda_dia_sem_vendedor: number | null;
  dias_gmv: number;
  pct_gmv_full: number | null;
  pct_gmv_full_sem_vendedor: number | null;
  motivo_pct: string | null;
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
  return {
    canal, marca: i.brand, ...nomeESku(i.sku, i.titulo, "sem identificação"), mediaDiaria: i.media_diaria_28d,
    estoqueVendedor: canal === "shopee" ? i.estoque_vendedor : undefined,
    perdaDia: canal === "shopee" ? perdaDestaqueShopee(i) : i.perda_dia,
    perdaBruta: i.perda_dia,
  };
}

/**
 * Cartao "Impacto potencial · canal": % do faturamento Full no valor, R$/dia
 * na comparacao. Impacto fora = "—" + "indisponível agora"; sem preco = "—";
 * nunca R$ 0 por ausencia. Shopee conta so' quem para a venda (sem estoque do
 * vendedor); com todas cobertas pelo vendedor, o destaque e' zero MEDIDO e diz
 * o porque.
 */
export function kpiImpacto(
  canal: Canal, impacto: ImpactoRuptura | null, semVendedor: number | null = null,
): { valor: string; comparacao: string; detalhe?: string } {
  if (canal === "shopee" && semVendedor === 0) return { valor: fmtPct(0), comparacao: "nenhum, o vendedor tem estoque" };
  const c = impactosOk(impacto).find((x) => x.canal === canal);
  if (!c) return { valor: "—", comparacao: "indisponível agora" };
  const v = perdaDestaque(canal, c);
  if (v === null) return { valor: "—", comparacao: "sem preço" };
  const p = pctDestaque(canal, c);
  // % nulo = faturamento Full da janela incompleto (a API so' calcula com os 28 dias): diz quantos.
  if (p === null) {
    const m = motivoSemPct(c, impacto!.janela_gmv_dias);
    return { valor: `${fmtReais(v)}/dia`, comparacao: m.texto, detalhe: m.detalhe };
  }
  const base = canal === "ml" ? `${fmtReais(v)}/dia do faturamento Full` : `${fmtReais(v)}/dia · só quem para a venda`;
  return { valor: fmtPct(p), comparacao: base + janelaDeslocada(c) };
}

/**
 * Motivo curto do % ausente no cartao de impacto (cabe em 1 linha); a conta
 * ("27 de 28 dias…") vai no `detalhe` (title + sr-only). A API so' divide
 * com a janela inteira de faturamento Full (28 dias ate' o ultimo dia carregado); faltando
 * dia, o % ficaria inflado. Ex.: foto do ML de hoje com o faturamento de
 * ontem ainda nao carregado. Janela completa com % nulo e' outro motivo: usa
 * o da API.
 */
export function motivoSemPct(
  c: Pick<CanalImpactoOk, "dias_gmv" | "motivo_pct">, janela: number,
): { texto: string; detalhe?: string } {
  if (c.dias_gmv >= janela) return { texto: c.motivo_pct ?? "% do faturamento indisponível" };
  const detalhe = `${c.dias_gmv} de ${janela} dias de faturamento Full na janela da foto`;
  if (c.dias_gmv <= 0) return { texto: "sem faturamento Full para o %", detalhe };
  const falta = janela - c.dias_gmv;
  return { texto: falta === 1 ? "falta 1 dia de faturamento Full para o %" : `faltam ${falta} dias de faturamento Full para o %`, detalhe };
}

/**
 * " · % de 11/10 a 07/11" quando a janela do % NAO termina na vespera da foto
 * (faturamento atrasado): o leitor precisa saber que o % e' de outro recorte.
 * Na vespera, nada: e' o caso de sempre.
 */
export function janelaDeslocada(c: Pick<CanalImpactoOk, "ref_date" | "janela_gmv_inicio" | "janela_gmv_fim">): string {
  if (!c.janela_gmv_inicio || !c.janela_gmv_fim) return "";
  const vespera = new Date(`${c.ref_date}T00:00:00Z`);
  vespera.setUTCDate(vespera.getUTCDate() - 1);
  if (c.janela_gmv_fim === vespera.toISOString().slice(0, 10)) return "";
  return ` · % de ${diaMes(c.janela_gmv_inicio)} a ${diaMes(c.janela_gmv_fim)}`;
}

/** Cartao "Param a venda · Shopee": % das rupturas sem estoque do vendedor; "x de y" no `detalhe`. */
export function kpiParamVenda(shopee: ResumoCanal | undefined): { valor: string; comparacao: string; detalhe?: string } {
  if (!shopee || shopee.status !== "ok") return { valor: "—", comparacao: "Shopee sem dado agora" };
  if (shopee.ruptura === 0) return { valor: "—", comparacao: "nenhuma ruptura na Shopee" };
  if (shopee.semVendedor === null) return { valor: "—", comparacao: "lista de rupturas incompleta" };
  if (shopee.semVendedor === 0) return { valor: fmtPct(0), comparacao: "todas têm estoque do vendedor" };
  const f = fracao(shopee.semVendedor, shopee.ruptura)!;
  return { valor: f.texto, comparacao: "sem estoque do vendedor", detalhe: f.detalhe };
}

export interface LinhaImpactoMarca {
  marca: string;
  /** % do Full da marca (o destaque do canal). `null` = sem GMV de 28 dias. */
  pct: number | null;
  /** R$/dia potencial (destaque do canal). `null` = sem preco. */
  perda: number | null;
  /** Shopee: tudo coberto pelo vendedor -- o zero e' explicado, nao "R$ 0". */
  vendedorTemEstoque: boolean;
}

/** Drilldown do cartao de impacto: marca | % do Full da marca | R$/dia, da maior perda para a menor. `null` = canal fora. */
export function impactoPorMarca(canal: Canal, impacto: ImpactoRuptura | null): LinhaImpactoMarca[] | null {
  const c = impactosOk(impacto).find((x) => x.canal === canal);
  if (!c) return null;
  return c.marcas
    .map((m) => {
      const perda = perdaDestaque(canal, m);
      return {
        marca: m.brand, pct: pctDestaque(canal, m), perda,
        vendedorTemEstoque: canal === "shopee" && perda === 0 && (m.perda_dia ?? 0) > 0,
      };
    })
    .sort((a, b) => (b.perda ?? -1) - (a.perda ?? -1) || a.marca.localeCompare(b.marca));
}

/** Texto do ⓘ de impacto do canal, com as ressalvas DAQUELE canal (sem preco, preco anunciado). */
export function dicaImpacto(canal: Canal, impacto: ImpactoRuptura | null): string {
  const c = impactosOk(impacto).find((x) => x.canal === canal);
  const fim = "% sobre o faturamento Full/dia dos 28 dias que terminam no último dia com faturamento carregado (até a véspera da foto). R$ não é somado entre canais.";
  const semPreco = c && c.sem_preco > 0 ? ` ${c.sem_preco.toLocaleString("pt-BR")} sem preço ficaram fora da soma.` : "";
  if (canal === "ml") {
    const fallback = c && c.preco_fallback > 0 ? ` ${c.preco_fallback.toLocaleString("pt-BR")} usam o preço anunciado (sem venda em 30 dias).` : "";
    return `Impacto POTENCIAL, não perda medida: venda média diária de 28 dias × preço do anúncio-âncora em 30 dias. ${fim}${fallback}${semPreco}`;
  }
  const bruto = c && c.perda_dia !== null ? ` Contando também os que têm estoque do vendedor: ${fmtReais(c.perda_dia)}/dia.` : "";
  return `Impacto POTENCIAL: venda média diária de 28 dias × preço médio do mês por SKU, só dos itens sem estoque do vendedor.${bruto} ${fim}${semPreco}`;
}

// ---------------------------------------------------------------------------
// API-4 -- o "antes" dos cartoes (foto anterior). Nada inventado: sem os dois
// lados medidos, sem pilula; variacao de taxa em p.p.; lower_is_better.
// ---------------------------------------------------------------------------

export interface Antes {
  /** Variacao em pontos percentuais (fracao 0..1 -> pontos). */
  pp: number;
  /** "antes 14,6% · foto de 07/11". */
  texto: string;
}

function antesDe(atual: number | null, antes: number | null, ref: string): Antes | null {
  if (atual === null || antes === null) return null;
  return { pp: (atual - antes) * 100, texto: `antes ${fmtPct(antes)} · foto de ${diaMes(ref)}` };
}

/**
 * Cartao de impacto: % de destaque (ML: perda; Shopee: so' quem para a venda)
 * agora contra a foto anterior. `comAnterior` e' a 2a chamada (`?anterior=true`):
 * so' vale se a foto atual dela for a MESMA ja' desenhada.
 */
export function antesImpacto(canal: Canal, atual: ImpactoRuptura | null, comAnterior: ImpactoRuptura | null): Antes | null {
  const c = impactosOk(atual).find((x) => x.canal === canal);
  const d = impactosOk(comAnterior).find((x) => x.canal === canal);
  if (!c || !d?.anterior || d.ref_date !== c.ref_date) return null;
  return antesDe(pctDestaque(canal, c), pctDestaque(canal, d.anterior), d.anterior.ref_date);
}

/** "Param a venda": % das rupturas sem estoque do vendedor, agora e na foto anterior da Shopee. */
export function antesParamVenda(atual: ResumoCanal | undefined, antes: ResumoCanal | null): Antes | null {
  if (atual?.status !== "ok" || antes?.status !== "ok") return null;
  return antesDe(pct(atual.semVendedor, atual.ruptura), pct(antes.semVendedor, antes.ruptura), antes.refDate);
}

/**
 * Heroi: so' com os DOIS canais medidos agora e na foto anterior (o total de
 * um canal so' nao e' o mesmo recorte). As fotos anteriores tem datas
 * diferentes por canal: o texto diz as duas.
 */
export function antesHeroi(canais: ResumoCanal[], antes: { ml: ResumoCanal | null; shopee: ResumoCanal | null } | null): Antes | null {
  const agora = oks(canais);
  const ml = antes?.ml, sh = antes?.shopee;
  if (agora.length !== 2 || ml?.status !== "ok" || sh?.status !== "ok") return null;
  const taxa = (cs: ResumoOk[]) => pct(cs.reduce((s, c) => s + c.ruptura, 0), cs.reduce((s, c) => s + c.base, 0));
  const a = taxa(agora), b = taxa([ml, sh]);
  if (a === null || b === null) return null;
  return { pp: (a - b) * 100, texto: `antes ${fmtPct(b)} · fotos de ${diaMes(ml.refDate)} (ML) e ${diaMes(sh.refDate)} (Shopee)` };
}

