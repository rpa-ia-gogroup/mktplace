/**
 * Contrato MINIMO de `GET /api/v1/expedicao/performance` (Performance OFICIAL
 * das contas). Espelha `apps/api/app/schemas/performance_oficial.py`.
 *
 * Mesma regra de `upstream.ts`: enums que mudam a leitura (estado, tom,
 * unidade, situacao) sao FECHADOS; contrato quebrado vira
 * `INVALID_UPSTREAM_RESPONSE`. O texto de ajuda (`ajuda`) nao e' lido.
 */
import { z } from "zod";

const optNum = z.number().finite().nullish();

export const performanceContasContract = z.object({
  gerado_em: z.string().min(1),
  canal: z.enum(["mercadolivre", "shopee", "tiktokshop"]),
  estado: z.enum(["dado", "sem_fonte", "erro"]),
  motivo: z.string().nullish(),
  fonte: z.string(),
  cobertura: z.object({
    marcas: z.array(z.string()),
    fora: z.array(z.object({ marca: z.string(), motivo: z.string() })),
  }),
  contas: z
    .array(
      z.object({
        marca: z.string().min(1),
        dia: z.string().min(1),
        capturado_em: z.string().min(1),
        nivel: z.string().nullish(),
        tom: z.enum(["bom", "atencao", "critico", "neutro"]),
        termometro: optNum,
        termometro_max: optNum,
        resumo: z.string().nullish(),
        destaques: z
          .array(
            z.object({
              rotulo: z.string(),
              valor: z.string(),
              tom: z.enum(["bom", "atencao", "critico", "neutro"]).nullish(),
            }),
          )
          .nullish(),
        metricas: z
          .array(
            z.object({
              codigo: z.string().min(1),
              rotulo: z.string(),
              grupo: z.string().nullish(),
              valor: optNum,
              unidade: z.enum(["pct", "contagem", "dias", "horas", "segundos", "nota"]),
              quantidade: optNum,
              anterior: optNum,
              meta: optNum,
              comparador: z.string().nullish(),
              rotulo_meta: z.string().nullish(),
              situacao: z.enum(["ok", "fora", "sem_meta"]),
            }),
          )
          .nullish(),
        avisos: z.array(z.string()).nullish(),
      }),
    )
    .nullish(),
  sem_foto: z.array(z.object({ marca: z.string(), motivo: z.string() })).nullish(),
});
