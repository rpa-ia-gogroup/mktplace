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
  fmtInt,
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
import { doCanal } from "./canal-preposicao.ts";

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

export type Situacao = "brinde" | "descontinuado";

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
  /** ML: nao disponivel no Full (reservado, em transferencia etc.) e, dele, o que esta em transferencia. */
  naoDisponivel?: number | null;
  transferencia?: number | null;
  /** Impacto POTENCIAL em R$/dia. `null` = sem preco; `undefined` = impacto nao carregado. */
  perdaDia?: number | null;
  /** Perda bruta do item (Shopee com estoque do vendedor: so' como apoio). */
  perdaBruta?: number | null;
  /** CURVA-ABC: o SKU do canal cru (chave da curva) e se e' kit (kit nao tem curva). */
  codigo?: string | null;
  kit?: boolean;
  /** Brinde/descontinuado (aba BD). So' aparece em `foraDaFila`. */
  situacao?: Situacao | null;
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
  /** A API truncou a lista: brindes/descontinuados nao dao para contar (o N dos blocos vira "—"). */
  listaTruncada: boolean;
  /** Brindes e descontinuados em ruptura: fora da fila e dos numeros; so' aparecem nos blocos recolhidos. */
  foraDaFila: ItemRuptura[];
  /** A lista trouxe todas as rupturas que o indicador conta? */
  rupturasCompletas: boolean;
  /** Shopee: rupturas sem estoque do vendedor (a venda para de fato). `null` = nao se aplica ou lista incompleta. */
  semVendedor: number | null;
  aviso: string | null;
  /** Marcas (ML) ou contas (Shopee) sem foto no dia: vao para o chip da foto ("sem RITUÁRIA"). */
  semFoto: string[];
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
  const todos = r.produtos.filter((p) => p.classificacao_torre !== "KIT_NAO_CONCILIADO");
  // Brinde/descontinuado: fora das contagens. Lista truncada = nao da' para tirar do indicador, entao nada sai dele.
  const fora = completa ? todos.filter((p) => p.situacao) : [];
  const itens = completa ? todos.filter((p) => !p.situacao) : todos;
  // A API (situacao_aplicada) ja' descontou dos indicadores: o front so' separa a lista, sem descontar de novo.
  const sai = (c: string) => (i.situacao_aplicada ? 0 : fora.filter((p) => p.classificacao_torre === c).length);

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

  const itemShopee = (p: (typeof todos)[number]): ItemRuptura => ({
      canal: "shopee" as const, marca: p.brand, nome: nomeExibido(p), sku: p.item_name?.trim() ? p.item_sku?.trim() || null : null,
      codigo: p.item_sku?.trim() || null, kit: p.is_kit || ehKit(p.item_sku), situacao: p.situacao,
      mediaDiaria: numero(p.avg_daily_units_28d) ?? 0, estoqueVendedor: p.seller_stock_total,
  });
  const rupturas = itens.filter((p) => p.classificacao_torre === "RUPTURA_CANDIDATA").map(itemShopee);
  const foraDaFila = fora.filter((p) => p.classificacao_torre === "RUPTURA_CANDIDATA").map(itemShopee);
  const rupturasCompletas = rupturas.length + (i.situacao_aplicada ? 0 : foraDaFila.length) === i.produtos_ruptura;
  const faltam = contasAusentes(CONTAS_ESPERADAS_API, r.contas_cobertas);

  return {
    canal: "shopee",
    status: "ok",
    base: i.produtos_total - i.produtos_kit_nao_conciliado - (i.situacao_aplicada ? 0 : fora.length),
    ruptura: i.produtos_ruptura - sai("RUPTURA_CANDIDATA"),
    baixo: i.produtos_baixo - sai("BAIXO_CANDIDATO"),
    excesso: i.produtos_excesso - sai("EXCESSO_CANDIDATO"),
    coberturas: completa ? itens.map((p) => numero(p.cobertura_torre_dias)).filter((n): n is number => n !== null) : null,
    marcas,
    rupturas,
    foraDaFila,
    listaTruncada: !completa,
    rupturasCompletas,
    // `null` no estoque do vendedor e' "nao sabemos": so' conta o zero medido.
    semVendedor: rupturasCompletas ? rupturas.filter((p) => p.estoqueVendedor === 0).length : null,
    aviso: faltam.length ? `Sem fotografia para: ${faltam.map(tituloMarca).join(", ")}` : null,
    semFoto: faltam.map(tituloMarca),
    refDate: r.frescor.ref_date,
    diasFoto: r.frescor.dias_desde_a_fotografia,
    frescor: frescorLabel(r.frescor),
    frescorVelho: fotografiaEstaVelha(r.frescor),
  };
}

export function resumoML(r: MLFullEstoqueResponse): ResumoCanal {
  if (r.status === "unavailable") return { canal: "ml", status: "indisponivel", motivo: r.unavailable_reason };
  const i = r.indicadores;
  const todos = r.inventarios.filter((v) => v.classificacao_torre !== "FORA_DO_FULL" && v.classificacao_torre !== "SEM_LEITURA");
  // Brinde/descontinuado: fora das contagens. Lista truncada = nao da' para tirar do indicador, entao nada sai dele.
  const fora = r.truncado ? [] : todos.filter((v) => v.situacao);
  const itens = r.truncado ? todos : todos.filter((v) => !v.situacao);
  // A API (situacao_aplicada) ja' descontou dos indicadores e das marcas: o front so' separa a lista.
  const sai = (c: string, marca?: string) =>
    (i.situacao_aplicada ? 0 : fora.filter((v) => v.classificacao_torre === c && (!marca || v.brand === marca)).length);
  const foraBase = (marca?: string) => (i.situacao_aplicada ? 0 : fora.filter((v) => !marca || v.brand === marca).length);

  const marcas: MarcaCanal[] = r.marcas.map((m) => {
    if (m.estado === null) return { marca: m.brand, base: null, ruptura: null, motivo: "sem fotografia no dia" };
    return {
      marca: m.brand,
      base: m.inventarios_full_lidos === null ? null : m.inventarios_full_lidos - foraBase(m.brand),
      ruptura: (m.por_classificacao.RUPTURA_CANDIDATA ?? 0) - sai("RUPTURA_CANDIDATA", m.brand),
    };
  });

  const itemML = (v: (typeof todos)[number]): ItemRuptura => ({ canal: "ml" as const, marca: v.brand, ...nomeESku(v.sku, v.titulo, SEM_IDENTIFICACAO_ML), mediaDiaria: numero(v.media_diaria_28d) ?? 0,
      codigo: v.sku?.trim() || null, kit: ehKit(v.sku), situacao: v.situacao,
      naoDisponivel: v.nao_disponivel, transferencia: v.transfer });
  const rupturas = itens.filter((v) => v.classificacao_torre === "RUPTURA_CANDIDATA").map(itemML);
  const foraDaFila = fora.filter((v) => v.classificacao_torre === "RUPTURA_CANDIDATA").map(itemML);

  return {
    canal: "ml",
    status: "ok",
    base: i.inventarios_full_lidos - foraBase(),
    ruptura: i.inventarios_ruptura - sai("RUPTURA_CANDIDATA"),
    baixo: i.inventarios_baixo - sai("BAIXO_CANDIDATO"),
    excesso: i.inventarios_excesso - sai("EXCESSO_CANDIDATO"),
    coberturas: r.truncado ? null : itens.map((v) => numero(v.cobertura_torre_dias)).filter((n): n is number => n !== null),
    marcas,
    rupturas,
    foraDaFila,
    listaTruncada: r.truncado,
    rupturasCompletas: rupturas.length + (i.situacao_aplicada ? 0 : foraDaFila.length) === i.inventarios_ruptura,
    semVendedor: null,
    aviso: i.total_parcial ? `Total parcial: ${i.motivos_total_parcial.join("; ")}` : null,
    semFoto: r.marcas.filter((m) => m.estado === null).map((m) => tituloMarca(m.brand)),
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
export function topRupturas(
  canais: ResumoCanal[], n = 10, impacto: ImpactoRuptura | null = null,
  abc: CurvaAbc | null = null, filtro: FiltroCurva = "todas",
): ItemRuptura[] {
  return rankingRupturas(canais, impacto, abc).filter((t) => passaFiltro(curvaDe(t, abc), filtro)).slice(0, n);
}

/**
 * O ranking inteiro (o filtro de curva corta ANTES do top 10), em GRUPOS:
 * AA, depois A, depois "Demais" (B, C e sem curva JUNTOS -- sem curva e'
 * desconhecido, nao baixo, entao nunca vai para depois do C). Dentro de cada
 * grupo: impacto R$/dia desc; desempate pela venda/dia.
 */
/** Shopee com estoque do vendedor: o Full rompeu, mas a venda segue. */
export function vendedorTemEstoque(t: ItemRuptura): boolean {
  return t.canal === "shopee" && (t.estoqueVendedor ?? 0) > 0;
}

export function rankingRupturas(canais: ResumoCanal[], impacto: ImpactoRuptura | null, abc: CurvaAbc | null = null): ItemRuptura[] {
  const comImpacto = new Map(impactosOk(impacto).map((c) => [c.canal, c]));
  return oks(canais)
    .flatMap((c) => {
      const imp = comImpacto.get(c.canal);
      if (!imp) return c.rupturas;
      // A rota de impacto nao traz o estoque fora do Full: junta pelo SKU+marca da lista de estoque ja' carregada.
      // shortcut: ML com 2 inventarios no mesmo SKU usa o 1o; sem match, a celula diz "nao informado".
      const estoque = new Map(c.rupturas.filter((r) => r.codigo).map((r) => [`${r.marca}|${r.codigo}`, r]));
      return imp.itens.map((i) => {
        const sku = i.sku?.trim();
        const e = sku ? estoque.get(`${i.brand}|${sku}`) : undefined; // sem SKU nao junta: evita colisao 'marca|null'
        return { ...itemDoImpacto(c.canal, i), naoDisponivel: e?.naoDisponivel, transferencia: e?.transferencia };
      });
    })
    .sort((a, b) =>
      ORDEM_GRUPO[grupoDe(curvaDe(a, abc))] - ORDEM_GRUPO[grupoDe(curvaDe(b, abc))]
      // Shopee com estoque do vendedor (a venda segue): fim do grupo, abaixo de quem tem perda.
      || Number(vendedorTemEstoque(a)) - Number(vendedorTemEstoque(b))
      || (b.perdaDia ?? -1) - (a.perdaDia ?? -1)
      || b.mediaDiaria - a.mediaDiaria || a.nome.localeCompare(b.nome));
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
export function descricaoTop(_top: ItemRuptura[], _comImpacto: boolean, incompleta: boolean, _comCurva = false): string {
  // A ordem (curva, impacto) mora no ⓘ da fila; o subtitulo diz o que a lista E'. Canal unico nao se repete: o filtro ja' diz.
  return `Sem estoque no Full, com venda nos últimos 28 dias${incompleta ? " · lista incompleta" : ""}`;
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
  /** So' com recorte diferente: marcas (ML) ou contas (Shopee) que so' existem numa das fotos. */
  diferenca_recorte?: { ref_date_anterior: string; so_na_atual: string[]; so_na_anterior: string[] } | null;
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
    codigo: i.sku?.trim() || null, kit: ehKit(i.sku),
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
  const fim = "% sobre o faturamento Full/dia dos 28 dias que terminam no último dia com faturamento carregado (até a véspera da foto). R$ não é somado entre canais. Brindes e descontinuados não entram nas contagens nem no impacto.";
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

function antesDe(atual: number | null, antes: number | null, ref: string, curto = false): Antes | null {
  if (atual === null || antes === null) return null;
  return { pp: (atual - antes) * 100, texto: curto ? `antes ${fmtPct(antes)} em ${diaMes(ref)}` : `antes ${fmtPct(antes)} · foto de ${diaMes(ref)}` };
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
  return antesDe(pctDestaque(canal, c), pctDestaque(canal, d.anterior), d.anterior.ref_date, true);
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

/**
 * Por que o cartao ficou sem pilula, para title + sr-only (sem texto novo na
 * tela). So' depois da 2a chamada; `null` quando ha' comparacao.
 * Ex.: "sem comparação: a foto anterior do ML (04/11) tem RITUÁRIA e a atual não".
 */
export function semComparacao(canal: Canal, comAnterior: ImpactoRuptura | null): string | null {
  const c = impactosOk(comAnterior).find((x) => x.canal === canal);
  if (!c || c.anterior) return null;
  const d = c.diferenca_recorte;
  if (!d) return `sem comparação: não há foto anterior ${doCanal(canal, NOME_CANAL[canal])}`;
  const lista = (xs: string[]) => xs.map(tituloMarca).join(", ");
  const quando = diaMes(d.ref_date_anterior);
  const partes = [
    d.so_na_anterior.length ? `a foto anterior ${doCanal(canal, NOME_CANAL[canal])} (${quando}) tem ${lista(d.so_na_anterior)} e a atual não` : null,
    d.so_na_atual.length ? `a foto atual ${doCanal(canal, NOME_CANAL[canal])} tem ${lista(d.so_na_atual)} e a anterior (${quando}) não` : null,
  ].filter(Boolean);
  return `sem comparação: ${partes.join("; ")}`;
}

// ---------------------------------------------------------------------------
// CURVA-ABC -- curva ABC dos produtos (planilha "Sortimento Gobeaute", via
// /full-curva-abc). Kit, codigo sem ponte e marca fora da planilha = sem
// curva, nunca "C". Leitura em falha = sem curva agora (nunca 0).
// ---------------------------------------------------------------------------

export type Curva = "AA" | "A" | "B" | "C";
export type FiltroCurva = "todas" | "aa_a" | "b" | "c" | "sem";

export interface CurvaAbc {
  status: "ok" | "unavailable";
  motivo?: string | null;
  fonte: string;
  lida_em?: string | null;
  itens_planilha?: number | null;
  pela_ponte_gtin?: number | null;
  duplicadas: string[];
  curva_por_sku: Record<string, Curva>;
  aviso?: string | null;
}

export type GrupoCurva = "AA" | "A" | "demais";
const ORDEM_GRUPO: Record<GrupoCurva, number> = { AA: 0, A: 1, demais: 2 };

/** Grupo da fila: AA, A ou "Demais" (B, C e sem curva juntos). */
export function grupoDe(c: Curva | null): GrupoCurva {
  return c === "AA" || c === "A" ? c : "demais";
}

/** Rotulo do cabecalho de grupo na fila ("AA · 3 rupturas"). */
export function rotuloGrupo(g: GrupoCurva, n: number): string {
  const nome = g === "demais" ? "Demais (B, C, sem curva)" : g;
  return `${nome} · ${n.toLocaleString("pt-BR")} ${n === 1 ? "ruptura" : "rupturas"}`;
}

/** Contagem de cada grupo sobre o ranking inteiro (o cabecalho mostra o total, nao so' o top 10). */
export function contarGrupos(itens: ItemRuptura[], abc: CurvaAbc | null): Record<GrupoCurva, number> {
  const n: Record<GrupoCurva, number> = { AA: 0, A: 0, demais: 0 };
  for (const t of itens) n[grupoDe(curvaDe(t, abc))]++;
  return n;
}

export const DICA_ORDEM_FILA =
  "Ordem: produtos AA, depois A, depois os demais; dentro de cada grupo, pelo impacto potencial por dia. "
  + "'Sem curva' entra nos demais: não é C.";
export const CURVAS: Curva[] = ["AA", "A", "B", "C"];

/** Kit nao tem curva propria (ML "Kit110"/"KIT005"; a Shopee tambem traz `is_kit`). */
export function ehKit(sku: string | null | undefined): boolean {
  return /^kit/i.test(String(sku ?? "").trim());
}

export function curvaDe(t: Pick<ItemRuptura, "marca" | "codigo" | "kit">, abc: CurvaAbc | null): Curva | null {
  if (abc?.status !== "ok" || t.kit || !t.codigo) return null;
  return abc.curva_por_sku[`${t.marca}|${t.codigo}`] ?? null;
}

export function passaFiltro(c: Curva | null, f: FiltroCurva): boolean {
  if (f === "todas") return true;
  if (f === "sem") return c === null;
  if (f === "aa_a") return c === "AA" || c === "A";
  return c === f.toUpperCase();
}

/** Contagem de cada opcao do filtro, sobre o ranking inteiro. */
export function contarFiltros(itens: ItemRuptura[], abc: CurvaAbc | null): Record<FiltroCurva, number> {
  const n: Record<FiltroCurva, number> = { todas: itens.length, aa_a: 0, b: 0, c: 0, sem: 0 };
  for (const t of itens) {
    const c = curvaDe(t, abc);
    if (c === "AA" || c === "A") n.aa_a++;
    else if (c === "B") n.b++;
    else if (c === "C") n.c++;
    else n.sem++;
  }
  return n;
}

/** Rupturas de um canal com o impacto de destaque (Shopee: so' quem para a venda). */
function rupturasDoCanal(canal: Canal, impacto: ImpactoRuptura | null): ItemRuptura[] | null {
  const c = impactosOk(impacto).find((x) => x.canal === canal);
  return c ? c.itens.map((i) => itemDoImpacto(canal, i)) : null;
}

/** Limiar da spec: com menos de 50% do impacto com curva, o % de AA/A enganaria. */
export const COBERTURA_MINIMA = 0.5;

export type LinhaCurvaCanal =
  | { estado: "ok"; pct: number; itens: number; detalhe: string }
  | { estado: "pouca"; texto: string }
  | { estado: "ausente"; texto: string; motivo: string };

/** Linha do cartao "Rupturas da curva AA/A": % do impacto do canal nas rupturas AA/A. */
export function linhaCurvaCanal(canal: Canal, impacto: ImpactoRuptura | null, abc: CurvaAbc | null): LinhaCurvaCanal {
  if (abc?.status !== "ok") return { estado: "ausente", texto: "sem curva agora", motivo: abc?.motivo ?? "curva ABC não carregou" };
  const its = rupturasDoCanal(canal, impacto);
  if (!its) return { estado: "ausente", texto: "impacto indisponível agora", motivo: "impacto potencial do canal indisponível" };
  const valor = (t: ItemRuptura) => t.perdaDia ?? 0;
  const total = its.reduce((s, t) => s + valor(t), 0);
  const comCurva = its.filter((t) => curvaDe(t, abc) !== null);
  const aaA = comCurva.filter((t) => ["AA", "A"].includes(curvaDe(t, abc)!));
  const cobertura = total > 0 ? comCurva.reduce((s, t) => s + valor(t), 0) / total : 0;
  const quantas = `curva em ${comCurva.length} de ${its.length} rupturas`;
  if (total <= 0 || cobertura < COBERTURA_MINIMA) return { estado: "pouca", texto: quantas };
  return { estado: "ok", pct: aaA.reduce((s, t) => s + valor(t), 0) / total, itens: aaA.length, detalhe: `${quantas} · ${fmtPct(cobertura)} do impacto` };
}

export interface LinhaPorCurva {
  /** `perda` null = o grupo tem ruptura mas nenhuma com preco: ausencia nao vira R$ 0. */
  curva: Curva | "sem"; pct: number | null; perda: number | null; rupturas: number;
  /** Shopee: R$ 0 MEDIDO porque o vendedor tem estoque (a venda segue fora do Full). */
  vendedorCobre?: boolean;
}

/** Drilldown: R$/dia potencial por curva (AA, A, B, C, sem curva) e o total do canal. */
export function impactoPorCurva(canal: Canal, impacto: ImpactoRuptura | null, abc: CurvaAbc | null): { linhas: LinhaPorCurva[]; total: LinhaPorCurva } | null {
  const its = rupturasDoCanal(canal, impacto);
  if (!its || abc?.status !== "ok") return null;
  const valor = (t: ItemRuptura) => t.perdaDia ?? 0;
  const total = its.reduce((s, t) => s + valor(t), 0);
  const linhas = ([...CURVAS, "sem"] as const).map((cv) => {
    const g = its.filter((t) => (curvaDe(t, abc) ?? "sem") === cv);
    const perda = g.length > 0 && g.every((t) => t.perdaDia == null) ? null : g.reduce((s, t) => s + valor(t), 0);
    const vendedorCobre = canal === "shopee" && perda === 0 && g.length > 0 && g.every((t) => (t.estoqueVendedor ?? 0) > 0);
    return { curva: cv, pct: total > 0 && perda !== null ? perda / total : null, perda, rupturas: g.length, vendedorCobre };
  });
  return { linhas, total: { curva: "sem", pct: total > 0 ? 1 : null, perda: total, rupturas: its.length } };
}

/** ⓘ do cartao e do filtro: fonte, hora da leitura, cobertura por canal, regra do "sem curva" e duplicatas. */
export function dicaCurva(abc: CurvaAbc | null, impacto: ImpactoRuptura | null): string {
  if (abc?.status !== "ok") return `Curva ABC sem leitura agora${abc?.motivo ? `: ${abc.motivo}` : "."} O Full segue sem curva; nada vira "C".`;
  const hora = abc.lida_em ? new Date(abc.lida_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : null;
  const cobertura = (["ml", "shopee"] as const).map((canal) => {
    const its = rupturasDoCanal(canal, impacto);
    if (!its) return null;
    const n = its.filter((t) => curvaDe(t, abc) !== null).length;
    return `${NOME_CANAL[canal]}: curva em ${n} de ${its.length} rupturas`;
  }).filter(Boolean).join("; ");
  const dup = abc.duplicadas.length
    ? ` A fonte tem ${abc.duplicadas.length} SKUs repetidos (vale a linha de maior faturamento).`
    : "";
  return `Fonte: ${abc.fonte}${hora ? `, lida às ${hora}` : ""} (atualiza a cada 1 h). ${cobertura ? `${cobertura}. ` : ""}`
    + `Sem curva: kit, código sem ligação com a planilha ou marca fora dela; nunca vira "C". `
    + `O % é do impacto potencial R$/dia do canal; R$ não é somado entre canais.${dup}`;
}

/** % de uma fatia: nao nula que arredonda a 0 = "<0,1%"; abaixo de 100 que arredonda a 100 = ">99,9%" (regra do #279). */
export function fmtFatia(v: number): string {
  const t = fmtPct(v);
  if (v > 0 && t === fmtPct(0)) return "<0,1%";
  if (v < 1 && t === fmtPct(1)) return ">99,9%";
  return t;
}

/**
 * Chip da foto do canal: data + idade, e qualquer aviso de cobertura escrito
 * nele ("foto de 09/11 · sem RITUÁRIA"), em tom de atencao. O aviso inteiro
 * vai no title. Substitui a linha ambar solta embaixo do canal.
 */
export function chipFoto(c: ResumoOk): { texto: string; atencao: boolean; titulo: string } {
  const falta = c.semFoto.length ? ` · sem ${c.semFoto.join(", ")}` : c.aviso ? " · parcial" : "";
  return {
    texto: `${seloFrescor(c)}${falta}`,
    atencao: c.frescorVelho || Boolean(c.aviso),
    titulo: [c.frescor, c.aviso].filter(Boolean).join(" · "),
  };
}

/**
 * Heroi da curva: a CONTAGEM de produtos AA/A sem estoque no Full (decisao do
 * usuario), o contexto (rupturas e % do sortimento) e uma linha por canal.
 * Canal com curva cobrindo menos de 50% do impacto: sem %, a cobertura
 * escrita, e o heroi avisa que a contagem e' so' do que se sabe. Leitura em
 * falha: "—" (nunca 0) e o motivo no title.
 */
export function heroiCurva(canais: ResumoCanal[], impacto: ImpactoRuptura | null, abc: CurvaAbc | null): {
  valor: string; contexto: string; titulo: string | null;
  porCanal: Partial<Record<Canal, string>>; parcial: boolean; critico: boolean;
  blocos: Partial<Record<Canal, BlocoCanal>>;
} | null {
  const ok = oks(canais);
  if (!ok.length) return null;
  const n = ok.reduce((s, c) => s + c.ruptura, 0);
  // O % do sortimento fica no cartao "Sem estoque com demanda" logo abaixo (nada repetido).
  // "de N rupturas com demanda" e' metodologia: vai para o title do numero. Texto visivel so' se a curva falhar.
  const contexto = "";
  const deN = `de ${n.toLocaleString("pt-BR")} rupturas com demanda`;
  if (abc === null) return { valor: "—", contexto: "carregando a curva", titulo: deN, porCanal: {}, parcial: false, critico: false, blocos: {} };
  if (abc.status !== "ok") return { valor: "—", contexto: "sem curva agora", titulo: [abc.motivo ?? "curva ABC sem leitura", deN].join(" · "), porCanal: {}, parcial: false, critico: false, blocos: {} };
  const ranking = rankingRupturas(canais, impacto, abc);
  const aaA = (canal: Canal) => ranking.filter((t) => t.canal === canal && grupoDe(curvaDe(t, abc)) !== "demais").length;
  const porCanal: Partial<Record<Canal, string>> = {};
  const blocos: Partial<Record<Canal, BlocoCanal>> = {};
  let parcial = false;
  let total = 0;
  for (const c of ok) {
    const k = aaA(c.canal);
    total += k;
    const l = linhaCurvaCanal(c.canal, impacto, abc);
    if (!ranking.some((t) => t.canal === c.canal)) blocos[c.canal] = { n: k, apoio: null, detalhe: "nenhuma ruptura", poucaCobertura: false };
    else if (l.estado === "ok") blocos[c.canal] = { n: k, apoio: null, detalhe: `${fmtPct(l.pct)} do impacto potencial`, poucaCobertura: false };
    else if (l.estado === "pouca") { blocos[c.canal] = { n: k, apoio: l.texto, poucaCobertura: true }; parcial = true; }
    else blocos[c.canal] = { n: k, apoio: null, poucaCobertura: false };
    const b = blocos[c.canal]!;
    porCanal[c.canal] = [b.apoio, b.detalhe].filter(Boolean).length ? `${k} AA/A · ${b.apoio ?? b.detalhe}` : `${k} AA/A`;
  }
  return { valor: total.toLocaleString("pt-BR"), contexto, titulo: deN, porCanal, parcial, critico: total > 0, blocos };
}

export const DICA_HEROI_PARCIAL = "AA/A conhecidos: a curva cobre só parte do ML (kits e códigos sem ligação com a planilha ficam sem curva).";


/** Quantos itens cada grupo mostra na visao "Todas" antes do "ver todos (N)". */
export const POR_GRUPO = 5;

/**
 * Fila "Todas" em grupos: ate' 5 por grupo (AA, A, Demais), os 3 sempre
 * visiveis quando tem item -- senao 17 AA/A enchem o top 10 e o maior
 * impacto sem curva some. Grupo em `abertos` mostra a lista inteira.
 */
export function filaPorGrupo(ranking: ItemRuptura[], abc: CurvaAbc | null, abertos: ReadonlySet<GrupoCurva> = new Set(), n = POR_GRUPO): { grupo: GrupoCurva; total: number; itens: ItemRuptura[] }[] {
  return (["AA", "A", "demais"] as const)
    .map((grupo) => {
      const todos = ranking.filter((t) => grupoDe(curvaDe(t, abc)) === grupo);
      return { grupo, total: todos.length, itens: abertos.has(grupo) ? todos : todos.slice(0, n) };
    })
    .filter((g) => g.total > 0);
}

// ---------------------------------------------------------------------------
// FULL-CARINHO -- blocos de canal no heroi, aviso so' com problema, filtro de
// canal combinavel com o de curva (na URL) e a celula de impacto da fila.
// ---------------------------------------------------------------------------

/** Bloco de canal do heroi: "6 AA/A" e uma linha de apoio (% do impacto ou a cobertura). */
export interface BlocoCanal { n: number; apoio: string | null; poucaCobertura: boolean; /** title/aria: % do impacto ou 'nenhuma ruptura' (nao e' texto da vista) */ detalhe?: string }

export type FiltroCanal = "todos" | Canal;
export const FILTROS_CANAL: FiltroCanal[] = ["todos", "ml", "shopee"];
export const NOME_CANAL_LONGO: Record<Canal, string> = { ml: "Mercado Livre", shopee: "Shopee" };

/** Selo de canal (identidade, nao status): mesma cor da Gerencial. Classes literais para o Tailwind. */
export const SELO_CANAL: Record<Canal, { ponto: string; pilula: string }> = {
  ml: { ponto: "bg-canal-ml", pilula: "bg-canal-ml/10 border-canal-ml/30" },
  shopee: { ponto: "bg-canal-shopee", pilula: "bg-canal-shopee/10 border-canal-shopee/30" },
};

/**
 * Aviso do canal SO' quando ha' problema: foto com mais de 1 dia, ou marca
 * faltando na foto. Foto em dia nao aparece na vista (vai para o ⓘ).
 */
export function avisoCanal(c: Pick<ResumoOk, "diasFoto" | "refDate" | "semFoto">): string | null {
  const partes = [
    c.semFoto.length ? `Sem ${c.semFoto.join(", ")} nesta foto` : null,
    (c.diasFoto ?? 0) > 1 ? `Foto de ${diaMes(c.refDate)} · desatualizada` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

/** ⓘ do heroi: a data de cada foto ("Fotos: ML 09/11, Shopee 09/11"). */
export function fotosHeroi(canais: ResumoCanal[]): string | null {
  const ok = oks(canais);
  return ok.length ? `Fotos: ${ok.map((c) => `${NOME_CANAL[c.canal]} ${diaMes(c.refDate)}`).join(", ")}.` : null;
}

export function filtrarCanal(itens: ItemRuptura[], canal: FiltroCanal): ItemRuptura[] {
  return canal === "todos" ? itens : itens.filter((t) => t.canal === canal);
}

/** Contagem do filtro de canal respeitando o filtro de curva aplicado (e vice-versa via contarFiltros). */
export function contarCanais(itens: ItemRuptura[], abc: CurvaAbc | null, curva: FiltroCurva): Record<FiltroCanal, number> {
  const f = itens.filter((t) => passaFiltro(curvaDe(t, abc), curva));
  return { todos: f.length, ml: f.filter((t) => t.canal === "ml").length, shopee: f.filter((t) => t.canal === "shopee").length };
}

/** O bloco do heroi fala de AA/A: o clique leva a fila com o canal E a curva AA/A. */
export function filtroDoBloco(canal: Canal): { canal: FiltroCanal; curva: FiltroCurva } {
  return { canal, curva: "aa_a" };
}

const CURVAS_URL: FiltroCurva[] = ["todas", "aa_a", "b", "c", "sem"];

/** Filtros da fila a partir da URL (?canal=ml&curva=aa_a). Valor estranho = o padrao. */
export function lerFiltrosUrl(params: { get(chave: string): string | null }): { canal: FiltroCanal; curva: FiltroCurva } {
  const canal = params.get("canal") as FiltroCanal | null;
  const curva = params.get("curva") as FiltroCurva | null;
  return {
    canal: canal && FILTROS_CANAL.includes(canal) ? canal : "todos",
    curva: curva && CURVAS_URL.includes(curva) ? curva : "todas",
  };
}

/** Os filtros na URL, mantendo os outros parametros (a aba do Full); o padrao sai da URL. */
export function filtrosNaUrl(atual: string, canal: FiltroCanal, curva: FiltroCurva): string {
  const q = new URLSearchParams(atual);
  if (canal === "todos") q.delete("canal"); else q.set("canal", canal);
  if (curva === "todas") q.delete("curva"); else q.set("curva", curva);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * Celula de impacto da fila. Shopee com estoque do vendedor: "R$ 0" MEDIDO e
 * explicado ("vendedor tem estoque · a venda segue"), com o bruto no title;
 * sem preco/sem impacto: ausencia com motivo, nunca zero.
 */
export function celulaImpacto(t: ItemRuptura): { texto: string; apoio?: string; titulo?: string; ausente?: string; zeroMedido?: boolean } {
  if (t.perdaDia === undefined) return { texto: "—", ausente: "impacto do canal indisponível" };
  if (t.perdaDia === null) return { texto: "—", ausente: t.canal === "shopee" && t.estoqueVendedor === null ? "estoque do vendedor não informado" : "sem preço" };
  if (vendedorTemEstoque(t)) {
    return { texto: "sem perda", apoio: "vendedor tem estoque · a venda segue", titulo: `${fmtReais(t.perdaBruta)}/dia se contar só o Full`, zeroMedido: true };
  }
  return { texto: fmtReais(t.perdaDia) };
}

/**
 * Celula "Estoque" da fila. Todo item da fila esta' nela por estar SEM estoque
 * no Full (a definicao da lista), entao o Full e' 0 por definicao: "0" fixo.
 * Apoio so' quando existe: ML "N não disponível · M em transferência";
 * Shopee "N com o vendedor". Fora do Full ausente = motivo no title, nunca 0.
 */
export function celulaEstoque(t: ItemRuptura): { texto: string; apoio?: string; ausente?: string } {
  const texto = "0";
  if (t.canal === "shopee") {
    return t.estoqueVendedor == null
      ? { texto, ausente: "estoque do vendedor não informado" }
      : { texto, apoio: `${fmtInt(t.estoqueVendedor)} com o vendedor` };
  }
  if (t.naoDisponivel == null) return { texto, ausente: "estoque fora do Full não informado" };
  const transf = t.transferencia ? ` · ${fmtInt(t.transferencia)} em transferência` : "";
  return { texto, apoio: `${fmtInt(t.naoDisponivel)} não disponível${transf}` };
}

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  brinde: "Brindes sem estoque no Full",
  descontinuado: "Descontinuados sem estoque no Full",
};

export const RESUMO_BLOCO_FORA = "não entram nas contagens nem no impacto";
export const AVISO_LISTA_INCOMPLETA = "lista incompleta: brindes ainda contados";

/**
 * Blocos recolhidos do fim da pagina (ordem estavel: canal, nome). Com a lista truncada o N nao e'
 * conhecido: os dois blocos aparecem com "(—)" e o aviso, mesmo sem item.
 * Precedencia brinde > descontinuado ja' vem resolvida da API (um SKU, uma situacao).
 */
export function blocosForaDaFila(canais: ResumoCanal[]): { situacao: Situacao; titulo: string; itens: ItemRuptura[]; aviso: string | null }[] {
  const ok = oks(canais);
  const todos = ok.flatMap((c) => c.foraDaFila);
  const truncada = ok.some((c) => c.listaTruncada);
  return (["brinde", "descontinuado"] as const)
    .map((situacao) => ({
      situacao,
      itens: todos.filter((t) => t.situacao === situacao).sort((x, y) => x.canal.localeCompare(y.canal) || x.nome.localeCompare(y.nome)),
    }))
    .filter((b) => b.itens.length > 0 || truncada)
    .map((b) => ({
      ...b,
      titulo: `${ROTULO_SITUACAO[b.situacao]} (${truncada ? "—" : fmtInt(b.itens.length)})`,
      aviso: truncada ? AVISO_LISTA_INCOMPLETA : null,
    }));
}

export const DICA_IMPACTO_FILA =
  "Quanto se deixa de vender por dia enquanto o produto está sem estoque no Full: venda média diária dos últimos 28 dias × preço médio. "
  + "É potencial: no ML, outros anúncios podem seguir vendendo; na Shopee, só conta quem também está sem estoque do vendedor. Brindes e descontinuados não entram nas contagens nem no impacto.";

