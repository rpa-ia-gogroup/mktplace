import type { ScopeBrandCoverage, ScopeBrandStatus, ScopeQuality, ScopeQualityWarning } from "@/lib/api-client";
import InfoDica from "@/components/ui/InfoDica";

interface Props {
  quality: ScopeQuality | null | undefined;
  loading?: boolean;
}

/**
 * Gate SH-API-2D — selo de confiabilidade do escopo (marca x competencia).
 *
 * Por que existe: ate aqui a tela de Produtos mostrava QUALQUER competencia
 * com o mesmo peso visual. Julho/2026 aparecia com R$ 5,5 mi e nenhum sinal de
 * que o mart estava materialmente atras da diaria; agosto/2026 aparecia vazio
 * sem dizer que havia 188 linhas carregadas, todas com GMV zero. Quem olhava
 * tirava a conclusao errada com o numero certo.
 *
 * Quatro regras de honestidade que esta faixa nao pode quebrar:
 *
 *  1. `quality == null` NAO e sinal verde. Significa "nao medido" (canal que
 *     ainda nao publica o selo, ou janela sem competencia unica) e por isso
 *     nao renderiza nada — em vez de renderizar um "ok" que ninguem apurou.
 *  2. Os eixos sao ORTOGONAIS e todos os avisos aparecem. Mostrar so o mais
 *     grave esconderia, por exemplo, a carga atras da diaria atras da
 *     maturacao — que e exatamente o defeito que este contrato veio corrigir.
 *  3. DOIS RELOGIOS, sempre nomeados. `loaded_at` e a publicacao NO MART,
 *     nunca a atualizacao do dado na Shopee. Um mart publicado ha 34 dias
 *     pode conter um mes fechado perfeito — e tambem pode nao ter visto a
 *     venda de ontem. A faixa diz qual relogio esta lendo, sempre.
 *  4. O indice operacional de maturacao NUNCA aparece sozinho. Ele chega
 *     dentro da mensagem do backend, que ja carrega a explicacao de que nao e
 *     percentual de conclusao (`maturation_index_note`). Esta faixa nao
 *     formata o numero por conta propria, justamente para nao poder exibi-lo
 *     como "%".
 */
export default function ScopeQualityBanner({ quality, loading }: Props) {
  if (loading && !quality) {
    return <div className="mx-6 mt-3 h-4 w-56 rounded bg-raised animate-pulse" aria-hidden />;
  }
  if (!quality) return null;

  const publicacao = publicationLine(quality);
  const pior = severityRank(quality.warnings);

  // Competencia definitiva NAO vira caixa de alerta. Achado do QA em Chromium:
  // junho/2026 — madura, definitiva, com um unico aviso `info` de 9 linhas em
  // 470 fora da exibicao por GMV = 0 — saia com a caixa ambar e o titulo
  // generico "Atencao ao escopo". Isso e o erro espelhado do que este contrato
  // veio corrigir: alarmar um mes bom gasta a credibilidade do sinal, e quem ve
  // alarme em todo mes para de ler o alarme no mes que importa. O aviso `info`
  // continua visivel, em tom calmo, porque ele explica a diferenca entre
  // `total_count` e `eligible_count` nos cards.
  // Total parcial NUNCA e calmo: o numero exibido nao e o consolidado.
  const parcial = quality.brand_coverage?.total_is_partial === true;
  const calmo = quality.definitive && pior === "info" && !parcial;

  // Menos legendas: a tela leva UMA linha curta; avisos, indice de maturacao,
  // fonte e data de publicacao por marca ficam no ⓘ ao lado dela.
  const dica = <InfoDica texto={detalheTexto(quality)} nota={detalheNota(quality, publicacao)} />;

  if (calmo || (quality.warnings.length === 0 && !parcial)) {
    return (
      <div className="flex items-center gap-1.5 px-6 pt-2 text-xs text-ink-muted" data-testid="scope-quality-ok">
        <span>Competência madura nos seis eixos.</span>
        {dica}
      </div>
    );
  }

  const tom = pior === "critical" ? "text-crit-ink" : pior === "warning" ? "text-warn-ink" : "text-ink-muted";

  return (
    <div
      className={`mx-6 mt-3 flex items-center gap-1.5 text-xs font-medium ${tom}`}
      role={pior === "critical" ? "alert" : "status"}
      data-testid="scope-quality-banner"
      data-severity={pior}
    >
      <span>{headline(quality)}</span>
      {dica}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { api: "API Shopee", manual_export: "Export manual" };
const STATUS_LABEL: Record<ScopeBrandStatus["status"], string> = {
  with_data: "com dados",
  zero_value: "sem valor confiável (só GMV zero)",
  absent: "sem dado nesta competência",
};

/** Frase de abertura do balao. O detalhe longo (avisos do backend) vai na parte menor. */
function detalheTexto(q: ScopeQuality): string {
  return q.brand_coverage?.total_is_partial && !q.brand
    ? "O número exibido não é o consolidado da Shopee: falta ao menos uma marca esperada."
    : headline(q);
}

/**
 * Quem esta e quem falta no total, de que fonte cada marca e lida e quando foi
 * publicada. Sem isto, "todas as marcas" parece o consolidado mesmo quando a
 * maior marca ficou de fora.
 */
function detalheNota(q: ScopeQuality, publicacao: string | null): string {
  // Avisos do backend (o indice de maturacao chega aqui, ja com a nota de que nao e %).
  const linhas: string[] = q.warnings.map((w) => `${w.severity === "critical" ? "•" : "·"} ${w.message}`);
  const bc: ScopeBrandCoverage | null | undefined = q.brand_coverage;
  if (bc && bc.brands.length > 0) {
    linhas.push("");
    const ausentes = bc.missing.length > 0 ? bc.missing.join(", ") : "nenhuma";
    linhas.push(`Marcas com dados: ${bc.with_data.length} · esperadas: ${bc.expected.length} · ausentes: ${ausentes}`);
    for (const b of bc.brands) {
      const situacao = b.expected || b.status === "with_data" ? STATUS_LABEL[b.status] : "sem venda na diária";
      const pub = `${dia(b.published_at) ?? "—"}${b.published_at && !b.published_in_scope ? " (última, em outra competência)" : ""}`;
      linhas.push(`${b.brand}: fonte ativa ${SOURCE_LABEL[b.active_source] ?? b.active_source} · ${situacao} · publicação no mart ${pub}`);
    }
  }
  if (publicacao) linhas.push("", publicacao);
  return linhas.join("\n");
}

function dia(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
}

/** Titulo curto: diz o que FAZER com o numero, nao o nome tecnico do estado. */
function headline(q: ScopeQuality): string {
  if (q.load_status === "load_absent") return "Sem dados de produto nesta competência";
  if (q.eligibility_status === "no_eligible_rows") return "Nenhum produto concluído nesta competência";
  if (q.brand_coverage?.total_is_partial && !q.brand) {
    const faltam = q.brand_coverage.missing.map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join(", ");
    // Outros avisos de dado nao podem ficar so' no ⓘ: o parcial nao os esconde.
    // ("nunca carregada" fica de fora: e' a causa da marca ausente, ja' dita na linha.)
    const outros = [
      q.maturity_status === "materially_immature" ? "mês em andamento" : null,
      q.load_status === "load_behind_daily" ? "mart atrás da diária" : null,
    ].filter(Boolean).map((o) => ` · ${o}`).join("");
    return `Parcial: sem ${faltam} na Shopee${outros}`;
  }
  if (q.maturity_status === "materially_immature") return "Competência ainda em maturação — números vão subir";
  if (q.source_status === "source_never_loaded") return "Esta competência nunca foi carregada da fonte";
  if (q.load_status === "load_behind_daily") return "O mart está atrás da diária nesta competência";
  if (q.maturity_status === "maturity_unknown") return "Maturação não verificada nesta competência";
  return "Atenção ao escopo";
}

/**
 * Linha da publicacao. Nomeia o relogio de forma explicita: nunca diz
 * "atualizado", que seria lido como frescor da fonte.
 */
function publicationLine(q: ScopeQuality): string | null {
  // Com o detalhe por marca, a data unica (MAX) esconderia a marca publicada
  // ha mais tempo — a kokeshi de 05/08 sumia atras do 13/10 das outras.
  const bc = q.brand_coverage;
  const antiga = dia(bc?.oldest_published_at);
  const recente = dia(bc?.newest_published_at);
  if (bc && antiga && recente && antiga !== recente) {
    return `Publicado no mart entre ${antiga} (mais antiga: ${bc.oldest_published_brands.join(", ")}) e ${recente} (mais recente) — datas da publicação no mart, não da última atualização do dado na Shopee.`;
  }
  if (!q.loaded_at) return null;
  const data = new Date(q.loaded_at);
  if (Number.isNaN(data.getTime())) return null;
  const quando = data.toLocaleDateString("pt-BR");
  const idade = q.load_age_days;
  // "há 0 dias" e ruido; "hoje" e informacao.
  const sufixo = idade === null || idade === undefined
    ? ""
    : idade === 0 ? ", hoje" : idade === 1 ? ", há 1 dia" : `, há ${idade} dias`;
  return `Publicado no mart em ${quando}${sufixo} — esta é a data da publicação no mart, não da última atualização do dado na Shopee.`;
}

function severityRank(warnings: ScopeQualityWarning[]): "critical" | "warning" | "info" {
  if (warnings.some((w) => w.severity === "critical")) return "critical";
  if (warnings.some((w) => w.severity === "warning")) return "warning";
  return "info";
}
