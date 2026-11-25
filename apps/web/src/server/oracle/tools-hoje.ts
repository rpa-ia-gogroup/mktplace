/**
 * torre_hoje — vendas de HOJE ate' a ultima hora fechada (VENDAS-POR-HORA-1).
 *
 * REGRAS DE LEITURA, todas derivadas do payload:
 * 1. Cada canal tem o PROPRIO corte (`corte_hora`): hoje, ontem e semana passada
 *    do canal somam de 00:00 ate' esse mesmo H:00. Canais com cortes diferentes
 *    NUNCA sao apresentados como um instante unico: o total vem com aviso.
 * 2. Canal sem hora fechada (corte 0) nao vendeu zero: ainda nao ha' recorte.
 *    Seus blocos saem nulos.
 * 3. `projecao` null = sem venda ontem ate' o corte (sem ritmo). Nunca 0.
 * 4. `canais_fora` da marca: a tendencia dela so' vale para os outros canais.
 * 5. Nada e' calculado aqui: variacao e projecao NAO sao derivadas — so' o que
 *    a API entrega. O periodo e' sempre o dia corrente (BRT); a API ignora outro.
 */
import { z } from "zod";

import { buildEnvelope, fmtMoney } from "./envelope.ts";
import type { Limitation } from "./limitations.ts";
import { BRANDS, CHANNELS, CHANNEL_LABELS, noDuplicates, type Channel } from "./schemas.ts";
import {
  envelopeSchema, limitationSchema, ok, safeText, safeTexts, type OracleTool,
} from "./tool-kit.ts";
import { parseUpstream } from "./upstream.ts";
import { hojePorHoraContract } from "./upstream-hoje.ts";

/** Marcas devolvidas no maximo; acima disso `truncated` + `total_count`. */
export const HOJE_MAX_MARCAS = 20;

export const hojeInput = z
  .object({
    canais: noDuplicates(z.array(z.enum(CHANNELS)).min(1).max(3), "canais").optional(),
    marcas: noDuplicates(z.array(z.enum(BRANDS)).min(1).max(5), "marcas").optional(),
    base: z.enum(["pagos", "realizados"]).default("pagos"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Limitacoes proprias (nao editamos limitations.ts)
// ---------------------------------------------------------------------------

const HOJE_PARCIAL: Limitation = {
  topic: "hoje_parcial",
  scope: "Hoje por hora",
  description:
    "E' o dia corrente ATE' a ultima hora fechada de cada canal, nao o dia fechado. Comparar com ontem/semana passada so' vale na mesma hora (a API ja' corta os tres no mesmo corte do canal). Para periodos fechados use torre_desempenho_marketplaces.",
};

const PROJECAO_RITMO: Limitation = {
  topic: "hoje_projecao_ritmo_de_ontem",
  scope: "Hoje por hora — projecao",
  description:
    "Projecao = onde o dia tende a fechar pelo RITMO DE ONTEM (hoje ate' o corte x ontem inteiro / ontem ate' o corte). E' estimativa da Torre, nao meta nem garantia. Projecao nula = sem venda ontem ate' o corte, sem base de ritmo: diga 'sem projecao', nunca R$ 0. Existe por marca e por marca x canal; nao ha projecao de canal isolado.",
};

const BASE_REALIZADOS: Limitation = {
  topic: "hoje_base_realizados",
  scope: "Hoje por hora — base realizados",
  description:
    "base=realizados SOMA os pedidos nao pagos a pedidos, GMV e tendencia (pagos e' o padrao). So' canais com fonte de nao pago entram assim; em nao_pago_disponivel, false = o canal segue so' com pagos (o Mercado Livre nunca tem fonte de nao pago). Nao compare numeros das duas bases.",
};

const CORTES_DIFERENTES: Limitation = {
  topic: "hoje_cortes_diferentes",
  scope: "Hoje por hora — total entre canais",
  description:
    "Os canais estao em cortes diferentes (cada um fechou numa hora distinta). O total soma cada canal no SEU corte; nao e' 'o total ate' as HH'. Cite o corte de cada canal (canais[].vendas_ate) ao dar o total.",
};

// ---------------------------------------------------------------------------
// Saida
// ---------------------------------------------------------------------------

const canalEnum = z.enum(CHANNELS);

const bloco = z.object({
  gmv: z.number(),
  pedidos: z.number(),
  /** null = sem pedido no recorte. */
  ticket: z.number().nullable(),
});

const tendencia = {
  /** null = canal sem hora fechada (nao e' venda zero). */
  hoje: z.number().nullable(),
  ontem_mesma_hora: z.number().nullable(),
  ontem_dia: z.number(),
  projecao: z.number().nullable(),
};

const hojeOutput = envelopeSchema(
  z.object({
    disponivel: z.boolean(),
    motivo_indisponivel: z.string().nullable(),
    dia: z.string(),
    base: z.enum(["pagos", "realizados"]),
    /** Cada canal no seu corte: vendas de 00:00 ate' `vendas_ate`. */
    canais: z.array(
      z.object({
        canal: canalEnum,
        fonte_ate: z.string().nullable(),
        horas_fechadas_hoje: z.number(),
        corte_hora: z.number(),
        /** Ultima hora FECHADA (0-23); null = nenhuma hora fechada ainda. */
        ultima_hora_fechada: z.number().nullable(),
        /** "HH:00" ate' onde o canal soma; null = nenhuma hora fechada. */
        vendas_ate: z.string().nullable(),
      }),
    ),
    cortes_diferentes: z.boolean(),
    /** Soma dos canais que ja' tem hora fechada, cada um no seu corte. null = nenhum tem. */
    total: z
      .object({
        canais_no_total: z.array(canalEnum),
        hoje: bloco,
        ontem: bloco,
        semana_passada: bloco,
      })
      .nullable(),
    por_canal: z.array(
      z.object({
        canal: canalEnum,
        corte_hora: z.number(),
        hoje: bloco.nullable(),
        ontem: bloco.nullable(),
        semana_passada: bloco.nullable(),
      }),
    ),
    por_marca: z.array(
      z.object({
        brand: z.string(),
        ...tendencia,
        /** false = a marca tem canal fora da conta: nao use como total dela. */
        tendencia_vale_como_total: z.boolean(),
        canais_fora: z.array(canalEnum),
        por_canal: z.array(z.object({ canal: canalEnum, ...tendencia })),
      }),
    ),
    /** Marcas pedidas sem nenhuma linha hoje/ontem: ausencia, nao venda zero. */
    marcas_sem_linha: z.array(z.string()),
    /** So' com base=realizados: por canal, ha' fonte de nao pago? */
    nao_pago_disponivel: z.record(canalEnum, z.boolean()).nullable(),
    limitations: z.array(limitationSchema),
  }),
);

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const nomeCanal = (c: Channel) => CHANNEL_LABELS[c];
const bl = (b: { gmv: number; pedidos: number; ticket?: number | null }) =>
  ({ gmv: b.gmv, pedidos: b.pedidos, ticket: b.ticket ?? null });

export const hojeTool: OracleTool = {
  name: "torre_hoje",
  config: {
    title: "Vendas de hoje por hora",
    description: [
      "Use para 'quanto vendemos hoje', 'como estamos hoje vs ontem', 'vs a mesma hora da semana passada' e 'qual a projecao do dia' — por canal e por marca.",
      "NAO use para periodos fechados (ontem inteiro, semana, mes): use torre_desempenho_marketplaces. O periodo aqui e' sempre o dia corrente (BRT).",
      "GMV em reais, de 00:00 ate' a ULTIMA HORA FECHADA de cada canal (canais[].vendas_ate); ontem e semana passada vem cortados na mesma hora. Cada canal tem corte proprio: ao dar o total, diga os cortes (cortes_diferentes) — nunca fale 'ate' as HH' para todos.",
      "Canal sem hora fechada vem com nulos: nao vendeu zero, ainda nao ha' recorte.",
      "Projecao = ritmo de ontem, por marca e por marca x canal; nula = sem base (diga 'sem projecao', nunca zero). Se a marca tem canais_fora, a tendencia dela NAO vale como total da marca.",
      "base='pagos' (padrao) ou 'realizados' (soma nao pagos; o Mercado Livre nao tem fonte de nao pago — ver nao_pago_disponivel). disponivel=false: nenhum numero, conte o motivo.",
    ].join(" "),
    inputSchema: hojeInput,
    outputSchema: hojeOutput,
  },
  async run(args, deps) {
    const input = hojeInput.parse(args);
    const csv = (v: readonly string[] | undefined) => (v && v.length > 0 ? [...v].sort().join(",") : undefined);
    const p = parseUpstream(
      hojePorHoraContract,
      await deps.client.get("hojePorHora", {
        channels: csv(input.canais),
        brands: csv(input.marcas),
        base: input.base,
      }),
    );

    const warnings: string[] = [];
    const limitations: Limitation[] = [HOJE_PARCIAL];
    const diaPeriodo = { start: p.dia, end: p.dia, inclusive: true as const };

    // Texto livre da fonte: saneado e visivel ao modelo (limitations e warnings).
    for (const t of safeTexts(p.limitacoes)) {
      limitations.push({ topic: "hoje_limitacao_da_fonte", scope: "Hoje por hora — API", description: t });
      warnings.push(`Fonte: ${t}`);
    }

    const filtersApplied = {
      canais: input.canais ?? "todos",
      marcas: input.marcas ?? null,
      base: input.base,
      periodo: "dia corrente (BRT); o periodo do filtro e' ignorado pela fonte",
    };
    const metricDefinition =
      "GMV (R$, reais) e pedidos de hoje de 00:00 ate' a ultima hora fechada de cada canal (corte_hora); ontem e a mesma hora da semana passada no mesmo corte do canal. Projecao = fechamento do dia pelo ritmo de ontem. base=pagos soma so' pagos; base=realizados soma tambem os nao pagos.";

    if (!p.disponivel) {
      const motivo = safeText(p.motivo);
      warnings.unshift(`Vendas de hoje indisponiveis (${motivo ?? "sem motivo informado"}) — nenhum numero, nao trate como zero.`);
      const env = buildEnvelope({
        period: diaPeriodo, filtersApplied, metricDefinition, refreshedAt: null,
        coverage: "indisponivel: nenhuma venda por hora servida", returnedCount: 0, warnings,
        data: {
          disponivel: false, motivo_indisponivel: motivo ?? "sem_motivo_informado", dia: p.dia, base: p.base,
          canais: [], cortes_diferentes: false, total: null, por_canal: [], por_marca: [],
          marcas_sem_linha: [], nao_pago_disponivel: null, limitations,
        },
      });
      return ok(`Vendas de hoje (${p.dia}): indisponiveis${motivo ? ` — ${motivo}` : ""}. Nenhum numero; nao e' zero.`, env);
    }

    const cortePorCanal = new Map<Channel, number>(p.canais.map((c) => [c.channel, c.corte_hora]));
    const comHora = p.canais.filter((c) => c.corte_hora > 0);
    const semHora = p.canais.filter((c) => c.corte_hora === 0);
    const cortesDiferentes = new Set(comHora.map((c) => c.corte_hora)).size > 1;

    const canais = p.canais.map((c) => ({
      canal: c.channel,
      fonte_ate: safeText(c.fonte_ate),
      horas_fechadas_hoje: c.horas_fechadas_hoje,
      corte_hora: c.corte_hora,
      ultima_hora_fechada: c.corte_hora > 0 ? c.corte_hora - 1 : null,
      vendas_ate: c.corte_hora > 0 ? hh(c.corte_hora) : null,
    }));

    warnings.push("Dia corrente parcial: valores ate' a ultima hora fechada de cada canal, nao o dia fechado.");
    if (cortesDiferentes) {
      limitations.push(CORTES_DIFERENTES);
      warnings.push(
        `Canais com cortes diferentes (${comHora.map((c) => `${nomeCanal(c.channel)} ate' ${hh(c.corte_hora)}`).join("; ")}): o total soma cada canal no seu corte — nao diga 'ate' as HH' para todos.`,
      );
    }
    if (semHora.length > 0) {
      warnings.push(
        `${semHora.map((c) => nomeCanal(c.channel)).join(", ")}: nenhuma hora fechada hoje na fonte — sem recorte (nulos), nao e' venda zero; ${comHora.length > 0 ? "o total e' PARCIAL (nao inclui esse canal)" : "nao ha' total"}.`,
      );
    }

    // Total e por canal: so' canais com hora fechada; corte 0 => ausencia (null).
    const total =
      comHora.length === 0 || !p.hoje || !p.ontem || !p.semana_passada
        ? null
        : {
            canais_no_total: comHora.map((c) => c.channel),
            hoje: bl(p.hoje), ontem: bl(p.ontem), semana_passada: bl(p.semana_passada),
          };
    const porCanal = p.por_canal.map((c) => {
      const tem = (cortePorCanal.get(c.channel) ?? 0) > 0;
      return {
        canal: c.channel,
        corte_hora: cortePorCanal.get(c.channel) ?? 0,
        hoje: tem ? bl(c.hoje) : null,
        ontem: tem ? bl(c.ontem) : null,
        semana_passada: tem ? bl(c.semana_passada) : null,
      };
    });

    // Marcas: teto, canais_fora e projecao nula viram aviso.
    const marcasTotal = p.por_marca.length;
    const marcas = p.por_marca.slice(0, HOJE_MAX_MARCAS).map((m) => ({
      brand: m.brand,
      hoje: m.hoje,
      ontem_mesma_hora: m.ontem_mesma_hora,
      ontem_dia: m.ontem_dia,
      projecao: m.projecao ?? null,
      tendencia_vale_como_total: m.canais_fora.length === 0,
      canais_fora: m.canais_fora,
      por_canal: m.por_canal.map((c) => {
        const semCorte = (cortePorCanal.get(c.channel) ?? 0) === 0;
        return {
          canal: c.channel,
          hoje: semCorte ? null : c.hoje,
          ontem_mesma_hora: semCorte ? null : c.ontem_mesma_hora,
          ontem_dia: c.ontem_dia,
          projecao: semCorte ? null : (c.projecao ?? null),
        };
      }),
    }));
    for (const m of marcas) {
      if (m.canais_fora.length > 0) {
        warnings.push(
          `${m.brand}: ${m.canais_fora.map(nomeCanal).join(", ")} ficou FORA da tendencia (sem hora de pedido) — a tendencia/projecao dela vale so' para os outros canais, nao como total da marca.`,
        );
      }
    }
    const semProjecao = marcas.filter((m) => m.projecao === null).map((m) => m.brand);
    if (semProjecao.length > 0) {
      warnings.push(`Sem projecao (sem venda ontem ate' o corte) para: ${semProjecao.join(", ")} — diga 'sem projecao', nao zero.`);
    }
    limitations.push(PROJECAO_RITMO);

    // Marca pedida sem linha: ausencia (pode nao operar no canal), nunca zero.
    const comLinha = new Set(p.por_marca.map((m) => m.brand));
    const marcasSemLinha = (input.marcas ?? []).filter((b) => !comLinha.has(b));
    if (marcasSemLinha.length > 0) {
      warnings.push(
        `Sem nenhuma linha de venda por hora para ${marcasSemLinha.join(", ")} (marca sem operacao nos canais pedidos ou sem hora de pedido): ausencia de dado, nao venda zero.`,
      );
    }
    if (marcasTotal > marcas.length) {
      warnings.push(`Lista de marcas cortada em ${marcas.length} de ${marcasTotal}.`);
    }

    // base=realizados: explica e avisa canal sem fonte de nao pago.
    let naoPago: Record<Channel, boolean> | null = null;
    if (p.base === "realizados") {
      limitations.push(BASE_REALIZADOS);
      const np = p.nao_pago_disponivel;
      naoPago = np ? { tiktok: np.tiktok, ml: np.ml, shopee: np.shopee } : null;
      if (!naoPago) {
        warnings.push("base=realizados, mas a fonte nao informou nao_pago_disponivel: nao ha' como saber quais canais somaram nao pagos.");
      } else {
        const sem = p.canais.map((c) => c.channel).filter((c) => !naoPago![c]);
        if (sem.length > 0) {
          warnings.push(
            `base=realizados: ${sem.map(nomeCanal).join(", ")} sem fonte de nao pago — entra so' com pagos (o Mercado Livre nunca tem), entao o total NAO e' totalmente 'realizados'.`,
          );
        }
      }
    }

    // refreshed_at conservador: a fonte MAIS ANTIGA entre os canais.
    const fontes = canais.map((c) => c.fonte_ate).filter((s): s is string => s !== null).sort();

    const env = buildEnvelope({
      period: diaPeriodo,
      filtersApplied,
      metricDefinition,
      refreshedAt: fontes[0] ?? null,
      coverage: `${p.canais.length} canal(is), cada um no proprio corte; ${marcasTotal} marca(s) com venda por hora`,
      limit: HOJE_MAX_MARCAS,
      returnedCount: marcas.length,
      totalCount: marcasTotal,
      warnings,
      data: {
        disponivel: true, motivo_indisponivel: null, dia: p.dia, base: p.base, canais,
        cortes_diferentes: cortesDiferentes, total, por_canal: porCanal, por_marca: marcas,
        marcas_sem_linha: marcasSemLinha, nao_pago_disponivel: naoPago, limitations,
      },
    });

    const cortesTxt = comHora.map((c) => `${nomeCanal(c.channel)} ate' ${hh(c.corte_hora)}`).join(", ");
    const headline = total
      ? `Hoje (${p.dia}): ${fmtMoney(total.hoje.gmv)} em ${total.hoje.pedidos} pedidos (base ${p.base}), cada canal no seu corte (${cortesTxt}); mesma hora de ontem ${fmtMoney(total.ontem.gmv)}.`
      : `Hoje (${p.dia}): nenhuma hora fechada ainda nos canais pedidos — sem recorte (nao e' zero).`;
    return ok(headline, env);
  },
};
