/**
 * Contratos MINIMOS do CX / Atendimento (`/api/v1/cx/mercadolivre`, `/cx/shopee`, `/cx/tiktok`).
 *
 * Mesma regra de `upstream.ts`: so' os campos que a tool le + os estruturais;
 * contrato quebrado = INVALID_UPSTREAM_RESPONSE. Enums que mudam a leitura do
 * numero (estado do bloco, estado da marca no TikTok, unidade) sao FECHADOS.
 *
 * DE PROPOSITO NAO LIDOS (dado pessoal ou fora do escopo): `destaques`, `resumo`,
 * `skus`/`produto` do TikTok, `serie_diaria`, `*_anterior`. As rotas
 * `/cx/*\/pedidos` (numero de pedido) nem existem no adapter.
 */
import { z } from "zod";

const optInt = z.number().int().nonnegative().nullish();
const optNum = z.number().finite().nullish();
const optStamp = z.string().nullish();
const marca = z.string().min(1);

const janela = z.object({ inicio: z.string(), fim: z.string(), dias: z.number().int().nonnegative() });

/** Estado de bloco (Shopee/ML): so' `dado` carrega numero. */
export const ESTADO_BLOCO = ["dado", "vazio_legitimo", "sem_fonte", "erro"] as const;
const estadoBloco = z.enum(ESTADO_BLOCO);
const estadoCanal = z.enum(["dado", "sem_fonte", "erro"]);

const cobertura = z.object({
  marcas: z.array(z.string()),
  fora: z.array(z.object({ marca: z.string(), motivo: z.string() })),
});

const motivos = z.object({
  estado: estadoBloco,
  total: optInt,
  itens: z.array(
    z.object({
      rotulo: z.string(),
      natureza: z.string().nullish(),
      quantidade: z.number().int().nonnegative(),
      pct: optNum,
    }),
  ),
  excluidos: optInt,
  rotulo_excluidos: z.string().nullish(),
  motivo_indisponivel: z.string().nullish(),
});

const metricaOficial = z.object({
  codigo: z.string(),
  rotulo: z.string(),
  valor: optNum,
  unidade: z.enum(["pct", "contagem", "dias", "horas", "segundos", "nota"]),
  anterior: optNum,
  meta: optNum,
  comparador: z.string().nullish(),
  situacao: z.enum(["ok", "fora", "sem_meta"]),
});

// ---------------------------------------------------------------------------
// Mercado Livre
// ---------------------------------------------------------------------------

export const cxMlContract = z.object({
  gerado_em: z.string(),
  janela,
  cobertura,
  diario_estado: z.enum(["dado", "erro"]),
  reclamacoes_estado: z.enum(["dado", "erro"]),
  motivo_indisponivel: z.string().nullish(),
  marcas: z.array(
    z.object({
      marca,
      pedidos: optInt,
      reclamacoes: optInt,
      cancelamentos: optInt,
      reembolsos: optInt,
      valor_reembolsado: optNum,
      mediacoes: optInt,
      devolucoes: optInt,
      perguntas: optInt,
      perguntas_respondidas: optInt,
      aguardando_nos: optInt,
      vencidas: optInt,
      vencem_24h: optInt,
      prazo_mais_antigo: optStamp,
      perguntas_sem_resposta: optInt,
      perguntas_sem_resposta_24h: optInt,
      pergunta_mais_antiga: optStamp,
      tempo_resposta_min: optNum,
      mensagens_pendentes: optInt,
      resposta_mediana_h: optNum,
      reclamacoes_com_historico: optInt,
      reclamacoes_respondidas: optInt,
      conta_dia: optStamp,
    }),
  ),
  reclamacoes_motivos: motivos.nullish(),
  cancelamentos_motivos: motivos.nullish(),
  atualizado_em: optStamp,
  aviso_frescor: z.string().nullish(),
  coleta_desde: optStamp,
});

// ---------------------------------------------------------------------------
// Shopee
// ---------------------------------------------------------------------------

export const cxShopeeContract = z.object({
  gerado_em: z.string(),
  janela,
  chat: z.object({
    estado: estadoCanal,
    motivo: z.string().nullish(),
    contas: z.array(
      z.object({
        marca,
        dia: z.string(),
        capturado_em: optStamp,
        nivel: z.string().nullish(),
        metricas: z.array(metricaOficial),
        avisos: z.array(z.string()).nullish(),
      }),
    ),
    sem_foto: z.array(z.object({ marca: z.string(), motivo: z.string() })),
    nao_lidas_estado: estadoBloco,
    nao_lidas: z.array(
      z.object({
        marca,
        valor: optInt,
        capturado_em: optStamp,
        conversas_7d: optInt,
        conversas_30d: optInt,
        aguardando_resposta: optInt,
        conversas_truncado: z.boolean().nullish(),
        aguardando_ate_1h: optInt,
        aguardando_1a4h: optInt,
        aguardando_4a24h: optInt,
        aguardando_mais_24h: optInt,
        espera_max_s: optInt,
        tempo_resposta_s: optInt,
        tempo_resposta_p90_s: optInt,
        respostas: optInt,
        respostas_ate_1h_pct: optNum,
        respostas_mais_1d: optInt,
        respostas_desde: optStamp,
        tempo_resposta_fonte: z.enum(["mediana", "media_seller_centre"]).nullish(),
      }),
    ),
  }),
  atendimento: z.object({
    cobertura,
    indicadores: z.array(
      z.object({
        codigo: z.string(),
        rotulo: z.string(),
        estado: z.enum(["dado", "vazio_legitimo", "sem_fonte", "nao_comprovado", "erro"]),
        valor: optNum,
        unidade: z.enum(["pct", "contagem"]).nullish(),
        motivo_indisponivel: z.string().nullish(),
      }),
    ),
    motivos: motivos.nullish(),
    marcas: z.array(
      z.object({
        marca,
        pedidos: optInt,
        taxa_cancelamento_pct: optNum,
        cancelamentos: optInt,
        cancelamentos_comprador: optInt,
        em_devolucao: optInt,
      }),
    ),
    atualizado_em: optStamp,
  }),
  devolucoes: z.object({
    estado: estadoBloco,
    motivo_indisponivel: z.string().nullish(),
    total: optInt,
    aceitas: optInt,
    em_andamento: optInt,
    canceladas: optInt,
    reembolsado: optNum,
    motivos: motivos.nullish(),
    marcas: z.array(
      z.object({
        marca,
        devolucoes: optInt,
        aceitas: optInt,
        em_andamento: optInt,
        canceladas: optInt,
        reembolsado: optNum,
      }),
    ),
  }),
});

// ---------------------------------------------------------------------------
// TikTok Shop (direto da Open API; a rota nao tem response_model)
// ---------------------------------------------------------------------------

export const cxTiktokContract = z.object({
  /** true = a Torre ainda le o TikTok em 2o plano: o dado e' AUSENTE, nao zero. */
  carregando: z.boolean().nullish(),
  gerado_em: optStamp,
  dias: z.number().int().nonnegative(),
  inicio: optStamp,
  fim: optStamp,
  marcas: z.array(
    z.object({
      marca,
      estado: z.enum(["dado", "sem_permissao", "erro", "nao_autorizada", "lendo"]),
      motivo: z.string().nullish(),
      truncado: z.boolean().nullish(),
      dias_faltando: optInt,
      devolucoes: optInt,
      reembolsado: optNum,
      cancelamentos: optInt,
      nao_pagos: optInt,
      cancelamentos_comprador: optInt,
      pedidos: optInt,
    }),
  ),
  motivos: z.array(
    z.object({
      tipo: z.enum(["Devolução", "Cancelamento"]),
      motivo: z.string(),
      quantidade: z.number().int().nonnegative(),
      autor: z.string().nullish(),
      marcas: z.array(z.object({ marca, quantidade: z.number().int().nonnegative() })),
    }),
  ),
});

export type CxMl = z.infer<typeof cxMlContract>;
export type CxShopee = z.infer<typeof cxShopeeContract>;
export type CxTiktok = z.infer<typeof cxTiktokContract>;
export type CxMotivos = z.infer<typeof motivos>;
