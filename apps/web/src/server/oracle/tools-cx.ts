/**
 * torre_cx — atendimento / CX dos marketplaces (MCP-AMPLIADO).
 *
 * Taxa de resposta, nota, fila "aguardando nossa resposta" e Pareto de motivos
 * (cancelamento, devolucao, reclamacao) por canal e por marca.
 *
 * O QUE ESTA TOOL NUNCA DEVOLVE: numero de pedido (`/cx/*\/pedidos` nem esta no
 * adapter), nome de comprador, texto de avaliacao ou mensagem. Do Pareto sai so'
 * rotulo do motivo + contagem (+ pct quando a API entrega). A nota por produto
 * das avaliacoes da Shopee (`/cx/shopee/avaliacoes`) fica de fora.
 *
 * REGRAS DE LEITURA, todas derivadas do payload:
 * 1. Cada canal e' UMA chamada e falha sozinho: o bloco do canal sai
 *    `indisponivel` com a classe do erro. So' se TODOS os canais pedidos falham
 *    o erro sobe como erro da tool.
 * 2. Estado por bloco: disponivel / sem_fonte / indisponivel. `vazio_legitimo`
 *    da API (nenhuma ocorrencia no recorte) vira `disponivel` com total 0 e
 *    `observacao`; ausencia vira null + motivo, NUNCA 0.
 * 3. TikTok e' lido direto da Open API, sem cache: `carregando=true` = dado
 *    ausente (bloco indisponivel, sem numero e sem retry).
 * 4. O ML nao entrega taxa pronta: a tool devolve as contagens e a base
 *    (pedidos, perguntas) e NAO calcula percentual.
 */
import { z } from "zod";

import { buildEnvelope, CURRENT_DAY_WARNING } from "./envelope.ts";
import { OracleToolError } from "./errors.ts";
import type { Limitation } from "./limitations.ts";
import { BRANDS, noDuplicates } from "./schemas.ts";
import {
  envelopeSchema, limitationSchema, ok, safeText, safeTexts, type OracleTool, type ToolDeps,
} from "./tool-kit.ts";
import { parseUpstream } from "./upstream.ts";
import {
  cxMlContract, cxShopeeContract, cxTiktokContract,
  type CxMl, type CxMotivos, type CxShopee, type CxTiktok,
} from "./upstream-cx.ts";

export const CX_CANAIS = ["ml", "shopee", "tiktok"] as const;
type CxCanal = (typeof CX_CANAIS)[number];

/** Itens do Pareto por bloco (a API pode mandar dezenas de motivos). */
export const CX_PARETO_TOP = 10;

export const cxInput = z
  .object({
    canais: noDuplicates(z.array(z.enum(CX_CANAIS)).min(1).max(3), "canais").optional(),
    marcas: noDuplicates(z.array(z.enum(BRANDS)).min(1).max(5), "marcas").optional(),
    /** 0 = hoje ate' agora (parcial); 7/30/90 = dias fechados ate' ontem. */
    dias: z.literal([0, 7, 30, 90]).default(30),
  })
  .strict();

// ---------------------------------------------------------------------------
// Limitacoes (definidas aqui: limitations.ts e' arquivo compartilhado)
// ---------------------------------------------------------------------------

export const CX_SCOPE: Limitation = {
  topic: "escopo_cx",
  scope: "CX — marketplaces",
  description:
    "Cobre so' Mercado Livre, Shopee e TikTok Shop, em agregados por canal e marca. NAO cobre o CX do site/DTC, nem pedido individual (numero de pedido, comprador, texto de avaliacao ou mensagem), nem a nota por produto das avaliacoes da Shopee.",
};
export const CX_ML_SEM_TAXA: Limitation = {
  topic: "taxa_ml",
  scope: "CX — Mercado Livre",
  description:
    "O Mercado Livre nao tem taxa de resposta nem nota de loja prontas nesta fonte: ha contagens (perguntas, perguntas_respondidas, fila 'aguardando nossa resposta'). Cite as contagens; nao invente percentual. A reputacao oficial do ML esta na aba Performance.",
};
export const CX_ML_SEM_MOTIVO_DEVOLUCAO: Limitation = {
  topic: "motivo_devolucao_ml",
  scope: "CX — Mercado Livre",
  description: "O ML so' tem a CONTAGEM de devolucoes por marca; nao ha motivo de devolucao nesta fonte.",
};
export const CX_SHOPEE_SEM_RECLAMACAO: Limitation = {
  topic: "reclamacao_shopee",
  scope: "CX — Shopee",
  description: "A Shopee nao tem reclamacao separada: o que chega ao CX sao cancelamentos e devolucoes/reembolsos, cada um com seu motivo.",
};
export const CX_TIKTOK_DIRETO: Limitation = {
  topic: "tiktok_direto",
  scope: "CX — TikTok Shop",
  description:
    "O TikTok e' lido direto da API do TikTok, sem cache: no primeiro acesso a Torre ainda esta lendo ('carregando') e o bloco sai indisponivel — sem numero, nao trate como zero; repita em alguns minutos. Nao ha taxa de resposta nem nota de loja do TikTok nesta fonte, nem motivo de reclamacao.",
};

// ---------------------------------------------------------------------------
// Saida
// ---------------------------------------------------------------------------

const estadoOut = z.enum(["disponivel", "sem_fonte", "indisponivel"]);
type Estado = z.infer<typeof estadoOut>;

const nn = z.number().nullable();
const ns = z.string().nullable();

const janelaOut = z.object({ inicio: z.string(), fim: z.string(), dias: z.number() }).nullable();
const semCoberturaOut = z.array(z.object({ marca: z.string(), motivo: z.string() }));

const paretoOut = z.object({
  estado: estadoOut,
  motivo_indisponivel: ns,
  /** Ex.: "Nenhum cancelamento no recorte" (vazio legitimo, total 0). */
  observacao: ns,
  /** Ocorrencias do bloco (soma dos motivos). null = ausente. */
  total: nn,
  total_motivos: nn,
  /** true = ha mais motivos do que os `CX_PARETO_TOP` devolvidos. */
  truncated: z.boolean(),
  /** Volume deixado de fora de proposito pela fonte (ex.: pedido nao pago). */
  excluidos: z.object({ quantidade: z.number(), rotulo: ns }).nullable(),
  itens: z.array(
    z.object({
      rotulo: z.string(),
      natureza: ns,
      quantidade: z.number(),
      /** 0-100, so' quando a API entrega. */
      pct: nn,
      por_marca: z.array(z.object({ marca: z.string(), quantidade: z.number() })),
    }),
  ),
});
type Pareto = z.infer<typeof paretoOut>;

const paretoTresOut = z
  .object({ cancelamento: paretoOut, devolucao: paretoOut, reclamacao: paretoOut })
  .nullable();

const mlRowOut = z.object({
  marca: z.string(),
  pedidos: nn, reclamacoes: nn, cancelamentos: nn, devolucoes: nn, reembolsos: nn,
  valor_reembolsado: nn, mediacoes: nn,
  perguntas: nn, perguntas_respondidas: nn,
  /** AGORA (nao segue a janela): reclamacoes com acao pendente do vendedor. */
  aguardando_nos: nn, vencidas: nn, vencem_24h: nn, prazo_mais_antigo: ns,
  perguntas_sem_resposta: nn, perguntas_sem_resposta_24h: nn, pergunta_mais_antiga: ns,
  tempo_resposta_min: nn, mensagens_pendentes: nn,
  /** PARCIAL: o historico de acoes so' cobre as reclamacoes mais recentes de cada conta. */
  resposta_mediana_h: nn, reclamacoes_com_historico: nn, reclamacoes_respondidas: nn,
});

const mlBlock = z.object({
  canal: z.literal("ml"),
  estado: estadoOut,
  motivo_indisponivel: ns,
  janela: janelaOut,
  atualizado_em: ns,
  aviso_frescor: ns,
  coleta_desde: ns,
  fontes: z.object({ diario: estadoOut, reclamacoes: estadoOut }).nullable(),
  marcas_sem_cobertura: semCoberturaOut,
  /** Soma das marcas; null se QUALQUER marca vier sem o numero. */
  totais: z
    .object({
      pedidos: nn, reclamacoes: nn, cancelamentos: nn, devolucoes: nn,
      perguntas: nn, perguntas_respondidas: nn, aguardando_nos: nn, perguntas_sem_resposta: nn,
    })
    .nullable(),
  marcas: z.array(mlRowOut),
  pareto: paretoTresOut,
});

const shopeeBlock = z.object({
  canal: z.literal("shopee"),
  estado: estadoOut,
  motivo_indisponivel: ns,
  janela: janelaOut,
  atualizado_em: ns,
  marcas_sem_cobertura: semCoberturaOut,
  chat: z
    .object({
      estado: estadoOut,
      motivo_indisponivel: ns,
      /** Metricas de Atendimento da Saude da Conta: taxa de resposta, nota da loja etc., com a meta da Shopee. */
      contas: z.array(
        z.object({
          marca: z.string(),
          dia: z.string(),
          capturado_em: ns,
          nivel: ns,
          metricas: z.array(
            z.object({
              codigo: z.string(), rotulo: z.string(), valor: nn,
              unidade: z.string(), anterior: nn, meta: nn, comparador: ns, situacao: z.string(),
            }),
          ),
          avisos: z.array(z.string()),
        }),
      ),
      sem_foto: semCoberturaOut,
      fila: z.object({
        estado: estadoOut,
        marcas: z.array(
          z.object({
            marca: z.string(),
            nao_lidas: nn, capturado_em: ns,
            conversas_7d: nn, conversas_30d: nn,
            /** true = bateu o teto de paginas: o numero e' um PISO. */
            conversas_truncado: z.boolean().nullable(),
            aguardando_resposta: nn, aguardando_ate_1h: nn, aguardando_1a4h: nn,
            aguardando_4a24h: nn, aguardando_mais_24h: nn, espera_max_s: nn,
            tempo_resposta_s: nn, tempo_resposta_p90_s: nn, tempo_resposta_fonte: ns,
            respostas: nn, respostas_ate_1h_pct: nn, respostas_mais_1d: nn, respostas_desde: ns,
          }),
        ),
      }),
    })
    .nullable(),
  cancelamentos: z
    .object({
      indicadores: z.array(
        z.object({
          codigo: z.string(), rotulo: z.string(), estado: estadoOut, valor: nn,
          unidade: ns, motivo_indisponivel: ns,
        }),
      ),
      totais: z.object({ pedidos: nn, cancelamentos: nn }).nullable(),
      marcas: z.array(
        z.object({
          marca: z.string(),
          pedidos: nn, taxa_cancelamento_pct: nn, cancelamentos: nn,
          cancelamentos_comprador: nn, em_devolucao: nn,
        }),
      ),
    })
    .nullable(),
  devolucoes: z
    .object({
      estado: estadoOut,
      motivo_indisponivel: ns,
      total: nn, aceitas: nn, em_andamento: nn, canceladas: nn, reembolsado: nn,
      marcas: z.array(
        z.object({
          marca: z.string(),
          devolucoes: nn, aceitas: nn, em_andamento: nn, canceladas: nn, reembolsado: nn,
        }),
      ),
    })
    .nullable(),
  pareto: paretoTresOut,
});

const tiktokBlock = z.object({
  canal: z.literal("tiktok"),
  estado: estadoOut,
  motivo_indisponivel: ns,
  janela: janelaOut,
  atualizado_em: ns,
  /** Marcas pedidas sem leitura no TikTok (sem token): ausencia, nao zero. */
  marcas_sem_conta: z.array(z.string()),
  totais: z.object({ devolucoes: nn, cancelamentos: nn }).nullable(),
  marcas: z.array(
    z.object({
      marca: z.string(),
      estado: estadoOut,
      motivo_indisponivel: ns,
      /** true = leitura incompleta (dias faltando ou teto): os numeros sao um PISO. */
      parcial: z.boolean(),
      pedidos: nn, devolucoes: nn, reembolsado: nn, cancelamentos: nn,
      cancelamentos_comprador: nn,
      /** Cancelados por falta de pagamento: o TikTok cancela sozinho; fora do Pareto. */
      nao_pagos: nn,
    }),
  ),
  pareto: paretoTresOut,
});

const cxOutput = envelopeSchema(
  z.object({
    ml: mlBlock.nullable(),
    shopee: shopeeBlock.nullable(),
    tiktok: tiktokBlock.nullable(),
    limitations: z.array(limitationSchema),
  }),
);

type MlBlock = z.infer<typeof mlBlock>;
type ShopeeBlock = z.infer<typeof shopeeBlock>;
type TiktokBlock = z.infer<typeof tiktokBlock>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EstadoApi = "dado" | "vazio_legitimo" | "sem_fonte" | "nao_comprovado" | "erro";

/** `vazio_legitimo` e' "nenhuma ocorrencia" (leitura valida), nao ausencia. */
function estadoDe(e: EstadoApi): Estado {
  if (e === "dado" || e === "vazio_legitimo") return "disponivel";
  return e === "erro" ? "indisponivel" : "sem_fonte";
}

/** nullish -> null, preservando 0. As chaves ficam; so' o `undefined` some. */
function nulls<T extends object>(o: T): { [K in keyof T]-?: undefined extends T[K] ? NonNullable<T[K]> | null : T[K] } {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v ?? null])) as never;
}

/** Soma das marcas; qualquer marca sem o numero => null (nunca soma parcial). */
function somar<T extends Record<string, unknown>>(rows: readonly T[], key: keyof T): number | null {
  if (rows.length === 0) return null;
  let s = 0;
  for (const r of rows) {
    const v = r[key];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    s += v;
  }
  return s;
}

const SEM_PARETO = (estado: Estado, motivo: string): Pareto => ({
  estado, motivo_indisponivel: motivo, observacao: null, total: null, total_motivos: null,
  truncated: false, excluidos: null, itens: [],
});

function pareto(b: CxMotivos | null | undefined, semFonte: string): Pareto {
  if (!b) return SEM_PARETO("sem_fonte", semFonte);
  const estado = estadoDe(b.estado);
  const motivo = safeText(b.motivo_indisponivel);
  if (estado !== "disponivel") {
    return SEM_PARETO(estado, motivo ?? (estado === "indisponivel" ? "fonte_com_erro" : semFonte));
  }
  const itens = [...b.itens].sort((a, c) => c.quantidade - a.quantidade);
  return {
    estado,
    motivo_indisponivel: null,
    observacao: b.estado === "vazio_legitimo" ? motivo ?? "Nenhuma ocorrencia no recorte." : null,
    total: b.estado === "vazio_legitimo" ? 0 : (b.total ?? null),
    total_motivos: itens.length,
    truncated: itens.length > CX_PARETO_TOP,
    excluidos: b.excluidos ? { quantidade: b.excluidos, rotulo: safeText(b.rotulo_excluidos) } : null,
    itens: itens.slice(0, CX_PARETO_TOP).map((i) => ({
      rotulo: safeText(i.rotulo, 120) ?? "(sem rotulo)",
      natureza: safeText(i.natureza, 40),
      quantidade: i.quantidade,
      pct: i.pct ?? null,
      por_marca: [],
    })),
  };
}

const semCobertura = (fora: readonly { marca: string; motivo: string }[]) =>
  fora.map((f) => ({ marca: f.marca, motivo: safeText(f.motivo) ?? "sem_motivo_informado" }));

const janelaDe = (j: { inicio: string; fim: string; dias: number }) => ({ inicio: j.inicio, fim: j.fim, dias: j.dias });

// ---------------------------------------------------------------------------
// Mercado Livre
// ---------------------------------------------------------------------------

function blocoMl(p: CxMl): MlBlock {
  const diario = p.diario_estado === "dado" ? "disponivel" : "indisponivel";
  const recl = p.reclamacoes_estado === "dado" ? "disponivel" : "indisponivel";
  const semConta = p.cobertura.marcas.length === 0;
  const tudoCaiu = diario === "indisponivel" && recl === "indisponivel";
  const marcas = p.marcas.map(({ conta_dia: _dia, ...r }) => nulls(r));
  const motivoCobertura = semCobertura(p.cobertura.fora).map((f) => `${f.marca}: ${f.motivo}`).join("; ");
  return {
    canal: "ml",
    estado: semConta ? "sem_fonte" : tudoCaiu ? "indisponivel" : "disponivel",
    motivo_indisponivel: semConta
      ? motivoCobertura || "sem_conta_no_escopo"
      : tudoCaiu ? safeText(p.motivo_indisponivel) ?? "fonte_com_erro" : null,
    janela: janelaDe(p.janela),
    atualizado_em: p.atualizado_em ?? null,
    aviso_frescor: safeText(p.aviso_frescor),
    coleta_desde: p.coleta_desde ?? null,
    fontes: { diario, reclamacoes: recl },
    marcas_sem_cobertura: semCobertura(p.cobertura.fora),
    totais: marcas.length === 0 ? null : {
      pedidos: somar(marcas, "pedidos"), reclamacoes: somar(marcas, "reclamacoes"),
      cancelamentos: somar(marcas, "cancelamentos"), devolucoes: somar(marcas, "devolucoes"),
      perguntas: somar(marcas, "perguntas"), perguntas_respondidas: somar(marcas, "perguntas_respondidas"),
      aguardando_nos: somar(marcas, "aguardando_nos"), perguntas_sem_resposta: somar(marcas, "perguntas_sem_resposta"),
    },
    marcas,
    pareto: {
      reclamacao: recl === "indisponivel"
        ? SEM_PARETO("indisponivel", "reclamacoes_indisponiveis_nesta_carga")
        : pareto(p.reclamacoes_motivos, "sem_motivo_de_reclamacao_na_fonte"),
      cancelamento: diario === "indisponivel"
        ? SEM_PARETO("indisponivel", "cancelamentos_indisponiveis_nesta_carga")
        : pareto(p.cancelamentos_motivos, "sem_motivo_de_cancelamento_na_fonte"),
      devolucao: SEM_PARETO("sem_fonte", "O ML so' tem a contagem de devolucoes por marca, sem motivo."),
    },
  };
}

// ---------------------------------------------------------------------------
// Shopee
// ---------------------------------------------------------------------------

function blocoShopee(p: CxShopee): ShopeeBlock {
  const at = p.atendimento;
  const dev = p.devolucoes;
  const chatEstado = estadoDe(p.chat.estado);
  const semConta = at.cobertura.marcas.length === 0;
  return {
    canal: "shopee",
    estado: semConta ? "sem_fonte" : "disponivel",
    motivo_indisponivel: semConta
      ? semCobertura(at.cobertura.fora).map((f) => `${f.marca}: ${f.motivo}`).join("; ") || "sem_conta_no_escopo"
      : null,
    janela: janelaDe(p.janela),
    atualizado_em: at.atualizado_em ?? null,
    marcas_sem_cobertura: semCobertura(at.cobertura.fora),
    chat: {
      estado: chatEstado,
      motivo_indisponivel: chatEstado === "disponivel" ? null : safeText(p.chat.motivo) ?? "fonte_com_erro",
      contas: p.chat.contas.map((c) => ({
        marca: c.marca,
        dia: c.dia,
        capturado_em: c.capturado_em ?? null,
        nivel: safeText(c.nivel, 60),
        metricas: c.metricas.map((m) => ({
          codigo: m.codigo, rotulo: safeText(m.rotulo, 80) ?? m.codigo, valor: m.valor ?? null,
          unidade: m.unidade, anterior: m.anterior ?? null, meta: m.meta ?? null,
          comparador: m.comparador ?? null, situacao: m.situacao,
        })),
        avisos: safeTexts(c.avisos),
      })),
      sem_foto: semCobertura(p.chat.sem_foto),
      fila: {
        estado: estadoDe(p.chat.nao_lidas_estado),
        marcas: p.chat.nao_lidas.map(({ valor, ...r }) => ({ ...nulls(r), nao_lidas: valor ?? null })),
      },
    },
    cancelamentos: {
      indicadores: at.indicadores.map((i) => ({
        codigo: i.codigo, rotulo: safeText(i.rotulo, 80) ?? i.codigo, estado: estadoDe(i.estado),
        valor: i.valor ?? null, unidade: i.unidade ?? null, motivo_indisponivel: safeText(i.motivo_indisponivel),
      })),
      totais: at.marcas.length === 0 ? null : {
        pedidos: somar(at.marcas.map(nulls), "pedidos"), cancelamentos: somar(at.marcas.map(nulls), "cancelamentos"),
      },
      marcas: at.marcas.map(nulls),
    },
    devolucoes: {
      estado: estadoDe(dev.estado),
      motivo_indisponivel: dev.estado === "dado" || dev.estado === "vazio_legitimo"
        ? null : safeText(dev.motivo_indisponivel) ?? "fonte_com_erro",
      total: dev.total ?? null, aceitas: dev.aceitas ?? null, em_andamento: dev.em_andamento ?? null,
      canceladas: dev.canceladas ?? null, reembolsado: dev.reembolsado ?? null,
      marcas: dev.marcas.map(nulls),
    },
    pareto: {
      cancelamento: pareto(at.motivos, "sem_motivo_de_cancelamento_na_fonte"),
      devolucao: pareto(dev.motivos, "sem_motivo_de_devolucao_na_fonte"),
      reclamacao: SEM_PARETO("sem_fonte", "A Shopee nao tem reclamacao separada: veja cancelamento e devolucao."),
    },
  };
}

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

function estadoMarcaTiktok(e: CxTiktok["marcas"][number]["estado"]): Estado {
  if (e === "dado") return "disponivel";
  return e === "sem_permissao" || e === "nao_autorizada" ? "sem_fonte" : "indisponivel";
}

function paretoTiktok(tipo: "Devolução" | "Cancelamento", p: CxTiktok): Pareto {
  const itens = p.motivos.filter((m) => m.tipo === tipo).sort((a, b) => b.quantidade - a.quantidade);
  if (itens.length === 0) {
    return {
      ...SEM_PARETO("disponivel", ""), motivo_indisponivel: null, total: 0, total_motivos: 0,
      observacao: "Nenhum motivo registrado no recorte lido.",
    };
  }
  return {
    estado: "disponivel",
    motivo_indisponivel: null,
    observacao: null,
    // A API nao entrega total nem pct no TikTok: o total e' a soma dos motivos devolvidos por ela.
    total: itens.reduce((s, i) => s + i.quantidade, 0),
    total_motivos: itens.length,
    truncated: itens.length > CX_PARETO_TOP,
    excluidos: null,
    itens: itens.slice(0, CX_PARETO_TOP).map((i) => ({
      rotulo: safeText(i.motivo, 120) ?? "(sem rotulo)",
      natureza: safeText(i.autor, 40),
      quantidade: i.quantidade,
      pct: null,
      por_marca: i.marcas.map((m) => ({ marca: m.marca, quantidade: m.quantidade })),
    })),
  };
}

const TIKTOK_CARREGANDO =
  "carregando: a Torre ainda le o TikTok (sem cache). Dado ausente, nao zero — tente de novo em alguns minutos.";

function blocoTiktok(p: CxTiktok, pedidas: readonly string[] | undefined): TiktokBlock {
  const janela = p.inicio && p.fim ? { inicio: p.inicio, fim: p.fim, dias: p.dias } : null;
  const base = { canal: "tiktok" as const, janela, atualizado_em: p.gerado_em ?? null };
  if (p.carregando) {
    // Leitura em 2o plano: mesmo o parcial que a API manda e' descartado (marcas/dias faltando).
    return {
      ...base, estado: "indisponivel", motivo_indisponivel: TIKTOK_CARREGANDO,
      marcas_sem_conta: [], totais: null, marcas: [],
      pareto: { cancelamento: SEM_PARETO("indisponivel", TIKTOK_CARREGANDO), devolucao: SEM_PARETO("indisponivel", TIKTOK_CARREGANDO), reclamacao: SEM_PARETO("sem_fonte", "O TikTok nao tem reclamacao nesta fonte.") },
    };
  }
  const lidas = new Set(p.marcas.map((m) => m.marca));
  const marcas = p.marcas.map((m) => {
    const estado = estadoMarcaTiktok(m.estado);
    const dado = estado === "disponivel";
    const n = (v: number | null | undefined) => (dado ? v ?? null : null);
    return {
      marca: m.marca, estado,
      motivo_indisponivel: dado ? null : safeText(m.motivo) ?? "sem_motivo_informado",
      parcial: dado && (m.truncado === true || (m.dias_faltando ?? 0) > 0),
      pedidos: n(m.pedidos), devolucoes: n(m.devolucoes), reembolsado: n(m.reembolsado),
      cancelamentos: n(m.cancelamentos), cancelamentos_comprador: n(m.cancelamentos_comprador),
      nao_pagos: n(m.nao_pagos),
    };
  });
  const lidasOk = marcas.filter((m) => m.estado === "disponivel");
  const sem = marcas.length === 0;
  const tudoFora = !sem && lidasOk.length === 0;
  return {
    ...base,
    estado: sem ? "sem_fonte" : tudoFora ? "indisponivel" : "disponivel",
    motivo_indisponivel: sem
      ? "Nenhuma marca do recorte tem conta TikTok conectada."
      : tudoFora ? marcas[0]?.motivo_indisponivel ?? "sem_motivo_informado" : null,
    marcas_sem_conta: (pedidas ?? []).filter((b) => !lidas.has(b)),
    totais: lidasOk.length === 0 || lidasOk.length < marcas.length ? null : {
      devolucoes: somar(lidasOk, "devolucoes"), cancelamentos: somar(lidasOk, "cancelamentos"),
    },
    marcas,
    pareto: {
      cancelamento: sem || tudoFora ? SEM_PARETO(sem ? "sem_fonte" : "indisponivel", "sem_marca_lida") : paretoTiktok("Cancelamento", p),
      devolucao: sem || tudoFora ? SEM_PARETO(sem ? "sem_fonte" : "indisponivel", "sem_marca_lida") : paretoTiktok("Devolução", p),
      reclamacao: SEM_PARETO("sem_fonte", "O TikTok nao tem reclamacao nesta fonte."),
    },
  };
}

// ---------------------------------------------------------------------------
// Execucao
// ---------------------------------------------------------------------------

type Resultado<T> = { ok: true; bloco: T } | { ok: false; erro: OracleToolError };

/** Falha de UM canal vira resultado, nao excecao: os outros canais seguem. */
async function tentar<T>(fn: () => Promise<T>): Promise<Resultado<T>> {
  try {
    return { ok: true, bloco: await fn() };
  } catch (e) {
    return { ok: false, erro: e instanceof OracleToolError ? e : new OracleToolError("SOURCE_UNAVAILABLE", "") };
  }
}

type QueryCx = { brands: string[] | undefined; dias: number };

const NOME: Record<CxCanal, string> = { ml: "Mercado Livre", shopee: "Shopee", tiktok: "TikTok Shop" };

export const cxTool: OracleTool = {
  name: "torre_cx",
  config: {
    title: "Atendimento e CX dos marketplaces",
    description: [
      "Use para atendimento/CX dos marketplaces: 'qual a taxa de resposta', 'qual a nota da loja', 'por que cancelam ou devolvem' (Pareto de motivos), 'quantas reclamacoes, cancelamentos e devolucoes', 'quantas perguntas sem resposta' e a fila 'aguardando nossa resposta'.",
      "Canais: Mercado Livre (reclamacoes, cancelamentos, devolucoes, perguntas, fila e prazo), Shopee (chat da Saude da Conta: taxa de resposta, nota da loja e tempo de resposta; cancelamentos e devolucoes com motivo) e TikTok Shop (cancelamentos e devolucoes por motivo).",
      "Pareto: so' o rotulo do motivo e a contagem (top 10 por bloco; leia 'truncated'). Para o Pareto de UMA marca passe marcas=[marca]. dias: 0 = hoje ate' agora (parcial), 7/30/90 = dias fechados ate' ontem; padrao 30.",
      "Cada bloco tem 'estado': disponivel, sem_fonte ou indisponivel com motivo — NUNCA trate sem_fonte/indisponivel como zero; 'vazio legitimo' vem como total 0 com observacao.",
      "O ML nao tem taxa pronta: use as contagens (perguntas_respondidas de perguntas; reclamacoes de pedidos) e nao invente percentual. O TikTok e' lido direto da API do TikTok, sem cache: pode vir indisponivel 'carregando' — diga que falta o dado e que e' para tentar de novo em alguns minutos.",
      "NAO cobre o CX do site/DTC, pedido individual (numero de pedido, comprador, texto de avaliacao ou mensagem) nem a nota por produto das avaliacoes da Shopee. NAO use para LDR/expedicao (torre_expedicao_operacional) nem para GMV.",
    ].join(" "),
    inputSchema: cxInput,
    outputSchema: cxOutput,
  },
  async run(args, deps: ToolDeps) {
    const input = cxInput.parse(args);
    const canais: readonly CxCanal[] = input.canais ?? CX_CANAIS;
    const pede = (c: CxCanal) => canais.includes(c);
    const q: QueryCx = { brands: input.marcas ? [...input.marcas].sort() : undefined, dias: input.dias };

    const [ml, shopee, tk] = await Promise.all([
      pede("ml")
        ? tentar(async () => blocoMl(parseUpstream(cxMlContract, await deps.client.get("cxMercadoLivre", q))))
        : null,
      pede("shopee")
        ? tentar(async () => blocoShopee(parseUpstream(cxShopeeContract, await deps.client.get("cxShopee", q))))
        : null,
      // Sem retry: `carregando` e' resposta valida, e repetir so' empilha leitura no TikTok.
      pede("tiktok")
        ? tentar(async () => blocoTiktok(parseUpstream(cxTiktokContract, await deps.client.get("cxTiktok", q)), input.marcas))
        : null,
    ]);

    const pedidos = [ml, shopee, tk].filter((r): r is NonNullable<typeof r> => r !== null);
    const falhas = pedidos.filter((r): r is Extract<typeof r, { ok: false }> => !r.ok);
    // Todos falharam: nao ha nada a dizer — erro da tool (com a categoria sanitizada).
    if (falhas.length === pedidos.length) throw falhas[0].erro;

    const caiu = (canal: CxCanal, r: Resultado<unknown> | null, vazio: object) =>
      r && !r.ok
        ? { canal, estado: "indisponivel" as const, motivo_indisponivel: r.erro.category, janela: null, atualizado_em: null, ...vazio }
        : null;
    const semDados = { marcas_sem_cobertura: [], marcas: [], pareto: null };
    const blocoMlFinal: MlBlock | null = ml?.ok ? ml.bloco : (caiu("ml", ml, {
      aviso_frescor: null, coleta_desde: null, fontes: null, totais: null, ...semDados,
    }) as MlBlock | null);
    const blocoShopeeFinal: ShopeeBlock | null = shopee?.ok ? shopee.bloco : (caiu("shopee", shopee, {
      marcas_sem_cobertura: [], chat: null, cancelamentos: null, devolucoes: null, pareto: null,
    }) as ShopeeBlock | null);
    const blocoTiktokFinal: TiktokBlock | null = tk?.ok ? tk.bloco : (caiu("tiktok", tk, {
      marcas_sem_conta: [], totais: null, marcas: [], pareto: null,
    }) as TiktokBlock | null);

    const blocos = [blocoMlFinal, blocoShopeeFinal, blocoTiktokFinal].filter(
      (b): b is MlBlock | ShopeeBlock | TiktokBlock => b !== null,
    );

    // Limitacoes DERIVADAS do que voltou.
    const limitations: Limitation[] = [CX_SCOPE];
    if (blocoMlFinal) limitations.push(CX_ML_SEM_TAXA, CX_ML_SEM_MOTIVO_DEVOLUCAO);
    if (blocoShopeeFinal) limitations.push(CX_SHOPEE_SEM_RECLAMACAO);
    if (blocoTiktokFinal) limitations.push(CX_TIKTOK_DIRETO);

    const warnings: string[] = [];
    if (input.dias === 0) warnings.push(CURRENT_DAY_WARNING);
    for (const b of blocos) {
      const nome = NOME[b.canal];
      if (b.estado !== "disponivel") {
        warnings.push(`${nome}: ${b.estado} (${b.motivo_indisponivel ?? "sem motivo informado"}) — nenhum numero, nao trate como zero.`);
        continue;
      }
      if (b.pareto && Object.values(b.pareto).some((p) => p.truncated)) {
        warnings.push(`${nome}: o Pareto mostra so' os ${CX_PARETO_TOP} maiores motivos; leia total_motivos.`);
      }
      if (b.canal === "ml") {
        if (b.aviso_frescor) warnings.push(`Mercado Livre: ${b.aviso_frescor}`);
        if (b.fontes?.diario === "indisponivel") warnings.push("Mercado Livre: leitura diaria (pedidos, cancelamentos, perguntas) indisponivel nesta carga — campos nulos, nao zero.");
        if (b.fontes?.reclamacoes === "indisponivel") warnings.push("Mercado Livre: fila e motivos de reclamacao indisponiveis nesta carga — campos nulos, nao zero.");
        if (b.marcas_sem_cobertura.length > 0) warnings.push(`Mercado Livre: sem conta para ${b.marcas_sem_cobertura.map((m) => m.marca).join(", ")} — ausencia, nao zero.`);
        warnings.push("Mercado Livre: 'aguardando_nos', 'vencidas' e as perguntas sem resposta sao de AGORA e nao seguem a janela; 'resposta_mediana_h' e' parcial (so' as reclamacoes mais recentes de cada conta).");
      }
      if (b.canal === "shopee") {
        if (b.chat?.estado !== "disponivel") warnings.push(`Shopee: chat ${b.chat?.estado ?? "indisponivel"} (${b.chat?.motivo_indisponivel ?? "sem motivo informado"}) — sem taxa de resposta nem nota.`);
        if (b.chat?.sem_foto.length) warnings.push(`Shopee: sem fotografia da Saude da Conta para ${b.chat.sem_foto.map((m) => m.marca).join(", ")} — ausencia, nao zero.`);
        if (b.chat?.fila.marcas.some((m) => m.conversas_truncado === true)) warnings.push("Shopee: a contagem de conversas bateu o teto de paginas — e' um PISO.");
        if (b.devolucoes && b.devolucoes.estado !== "disponivel") warnings.push(`Shopee: devolucoes ${b.devolucoes.estado} (${b.devolucoes.motivo_indisponivel ?? "sem motivo informado"}).`);
        if (b.marcas_sem_cobertura.length > 0) warnings.push(`Shopee: sem conta para ${b.marcas_sem_cobertura.map((m) => m.marca).join(", ")} — ausencia, nao zero.`);
      }
      if (b.canal === "tiktok") {
        const parciais = b.marcas.filter((m) => m.parcial).map((m) => m.marca);
        if (parciais.length > 0) warnings.push(`TikTok: leitura incompleta para ${parciais.join(", ")} — os numeros sao um PISO.`);
        const fora = b.marcas.filter((m) => m.estado !== "disponivel").map((m) => `${m.marca} (${m.motivo_indisponivel})`);
        if (fora.length > 0) warnings.push(`TikTok: sem leitura para ${fora.join(", ")} — ausencia, nao zero.`);
        if (b.marcas_sem_conta.length > 0) warnings.push(`TikTok: sem conta para ${b.marcas_sem_conta.join(", ")} — ausencia, nao zero.`);
      }
    }

    const janela = blocos.find((b) => b.janela)?.janela ?? null;
    const stamps = blocos.map((b) => b.atualizado_em).filter((s): s is string => typeof s === "string").sort();

    const env = buildEnvelope({
      period: janela ? { start: janela.inicio, end: janela.fim, inclusive: true } : null,
      filtersApplied: { canais: [...canais], marcas: input.marcas ?? null, dias: input.dias },
      metricDefinition:
        "Contagens e Pareto de motivos de cancelamento, devolucao e reclamacao por canal e marca na janela; taxa de resposta e nota vem da Saude da Conta da Shopee (meta da propria Shopee); no ML, perguntas respondidas / perguntas e a fila de reclamacoes aguardando o vendedor. Percentuais so' os que a fonte entrega.",
      // Carimbo conservador: a leitura MAIS ANTIGA entre os canais servidos.
      refreshedAt: stamps[0] ?? null,
      coverage: "agregados por canal e marca; nenhum pedido, comprador ou texto de cliente",
      returnedCount: blocos.length,
      warnings,
      data: { ml: blocoMlFinal, shopee: blocoShopeeFinal, tiktok: blocoTiktokFinal, limitations },
    });

    const partes = blocos.map((b) => `${NOME[b.canal]}: ${b.estado === "disponivel" ? "disponivel" : `${b.estado} (${b.motivo_indisponivel ?? "sem motivo"})`}`);
    return ok(`Atendimento/CX, ${input.dias === 0 ? "hoje ate' agora" : `${input.dias} dias`}. ${partes.join(". ")}.`, env);
  },
};
