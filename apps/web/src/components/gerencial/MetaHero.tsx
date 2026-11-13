"use client";

/**
 * Bloco principal da Gerencial (GERENCIAL-METAS-1): a resposta em 5 segundos.
 *
 * Com meta definida para o mes do periodo, responde "vamos bater a meta?":
 * atingimento, projecao pelo ritmo, quanto falta por dia e um selo de status.
 * Sem meta (ou periodo que nao e' um mes), cai no GMV contra o periodo
 * anterior e aponta onde definir a meta — nunca inventa uma.
 *
 * O aviso de dado que pode estar distorcendo o total aparece aqui, colado no
 * numero, e nao numa faixa separada no topo: e' aqui que ele muda a leitura.
 *
 * METAS-DIARIAS-1: com o periodo num dia so' ("Hoje"), o bloco compara com a
 * META DO DIA (meta do mes distribuida pela curva). No mes com curva, a barra
 * mensal ganha a marca de onde o plano esperava estar ate' o ultimo dia com dado.
 */
import Link from "next/link";
import { Target, TriangleAlert } from "lucide-react";

import type { Marketplace } from "@/lib/mock-data";
import { CHANNEL_DOT as PONTO } from "@/lib/gerencial/channel-colors";
import { CHANNEL_LABEL } from "@/lib/gerencial/kpi-band";
import { SO_PAGOS } from "@/lib/base-vendas";
import { ROTULO_STATUS, type ProgressoMeta, type StatusMeta } from "@/lib/gerencial/meta-progress";
import { diaDaSemana, type ProgressoDia, type StatusDia } from "@/lib/metas-curva";
import { MARCAS, fmtCompacto, rotuloMes } from "@/lib/metas";
import { fmtPctBr } from "@/lib/formatters";
import InfoDica from "@/components/ui/InfoDica";
import type { TendenciaConsolidada } from "@/lib/gerencial/hoje-por-hora";
import NumeroAnimado from "@/components/ui/NumeroAnimado";

const SELO: Record<StatusMeta, string> = {
  atingida: "border-ok/40 bg-ok-soft text-ok-ink",
  no_caminho: "border-ok/40 bg-ok-soft text-ok-ink",
  atencao: "border-warn/40 bg-warn-soft text-warn-ink",
  abaixo: "border-crit/40 bg-crit-soft text-crit-ink",
  nao_atingida: "border-crit/40 bg-crit-soft text-crit-ink",
};

const SELO_DIA: Record<StatusDia, string> = {
  em_andamento: "border-line-strong bg-raised text-ink-muted",
  atingida: "border-ok/40 bg-ok-soft text-ok-ink",
  nao_atingida: "border-crit/40 bg-crit-soft text-crit-ink",
};

const ROTULO_DIA: Record<StatusDia, string> = {
  em_andamento: "Dia em andamento",
  atingida: "Meta do dia batida",
  nao_atingida: "Meta do dia não batida",
};

const pct0 = (f: number) => `${Math.round(f * 100)}%`;
const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

interface Props {
  periodLabel: string;
  loading: boolean;
  error: boolean;
  gmv: number | null;
  prevGmv: number | null;
  momPct: number | null;
  compareActive: boolean;
  channels: Marketplace[];
  gmvByChannel: Record<Marketplace, number | null>;
  /** Variacao % de cada canal contra a referencia; so' com a comparacao ligada. */
  varGmvByChannel?: Partial<Record<Marketplace, number | null>> | null;
  /** Texto da referencia sem valor "antes" (ex.: "vs ontem até 14h"). */
  rotuloComparacao?: string | null;
  /** (i) do rotulo quando os canais cortam em horas diferentes. */
  detalheComparacao?: string | null;
  /** Mes comparavel com a meta; `null` = periodo nao e' um mes. */
  mesMeta: string | null;
  /** Dia comparavel com a meta do dia; `null` = periodo nao e' um dia so'. */
  diaMeta: string | null;
  hoje: string;
  metasStatus: "loading" | "error" | "fresh";
  /** Nova tentativa de ler as metas (so' elas; os demais blocos tem a propria). */
  onRetryMetas: () => void;
  progresso: ProgressoMeta | null;
  /** O escopo tem curva no mes: o plano ate' a data segue os pesos dos dias. */
  comCurva: boolean;
  progressoDia: ProgressoDia | null;
  /** Marca x canal sem venda do dia ainda, em linhas curtas. */
  semDado: string[];
  /** Canais filtrados que nao tem meta (ficam fora do realizado comparado). */
  canaisForaDaMeta: Marketplace[];
  /** Ate' onde o realizado tem dado, para o rotulo ("até 28/10"). */
  ultimoDia: string | null;
  aviso: { texto: string; onOpen: () => void } | null;
  metasHref: string;
  /** Abre o detalhe do GMV (o mesmo drill-down que o card de GMV abria). Sem destino (marcas menores): sem botao. */
  onOpenGmv?: () => void;
  /** Proporcao Full (0..1) de cada canal; ausente = canal sem a medida. */
  shareFull?: Partial<Record<Marketplace, number | null>> | null;
  /** Marcas que nao tem meta (menores, Bling): a faixa da meta diz isso, sem convite a definir meta. */
  semMetaDaMarca?: boolean;
  /** (i) do GMV: marcas menores (Bling) somadas sem meta, ou indisponiveis. */
  notaMenores?: string | null;
  /** (i) do GMV: o que a venda conta (pagos ou realizados). */
  notaVendas?: string;
  /** Linha visivel sob o GMV (menores incluidas / indisponiveis / somando). */
  linhaMenores?: { texto: string; aviso: boolean } | null;
  /** So' no "Hoje": soma das tendencias de fechamento das marcas. */
  tendenciaDoDia?: TendenciaConsolidada | null;
}

export default function MetaHero(props: Props) {
  const { gmv, loading, error } = props;
  return (
    <section aria-labelledby="meta-hero-titulo" className="rounded-xl border border-line bg-surface">
      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(220px,1fr)_2fr] lg:items-center lg:gap-6">
        <Resultado {...props} />
        <div className="min-w-0">
          {loading && gmv == null ? (
            <div className="h-20 animate-pulse rounded-lg bg-raised motion-reduce:animate-none" aria-hidden="true" />
          ) : error ? null : props.diaMeta && props.progressoDia ? (
            <BarraDoDia {...props} progressoDia={props.progressoDia} />
          ) : !props.diaMeta && props.progresso ? (
            <BarraDaMeta {...props} progresso={props.progresso} />
          ) : (
            <SemMeta {...props} />
          )}
          <Divisao
            channels={props.channels}
            gmvByChannel={props.gmvByChannel}
            varGmvByChannel={props.compareActive ? props.varGmvByChannel ?? null : null}
            shareFull={props.shareFull ?? null}
            total={gmv}
          />
        </div>
      </div>
    </section>
  );
}

function Resultado({ periodLabel, gmv, prevGmv, momPct, compareActive, loading, error, ultimoDia, onOpenGmv, aviso, rotuloComparacao, detalheComparacao, notaMenores, linhaMenores, notaVendas = SO_PAGOS }: Props) {
  const ate = ultimoDia ? ` · até ${ultimoDia.slice(8, 10)}/${ultimoDia.slice(5, 7)}` : "";
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <h2 id="meta-hero-titulo" className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          GMV do período{ate}
        </h2>
        <InfoDica texto={notaMenores ? `${notaVendas} ${notaMenores}` : notaVendas} />
      </div>
      {error ? (
        <>
          <p className="mt-2 text-sm text-crit-ink">Indicadores do período indisponíveis.</p>
          {/* O aviso de dado nao depende do overview: aparece mesmo com ele em falha. */}
          {aviso && <div className="mt-2"><SeloAviso aviso={aviso} /></div>}
        </>
      ) : loading && gmv == null ? (
        <div className="mt-2 h-9 w-48 animate-pulse rounded bg-raised motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        <>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <NumeroAnimado texto={fmtCompacto(gmv)} className="text-[2rem] font-bold leading-tight tracking-tight text-ink tabular-nums" />
            {/* UI-DENSIDADE-1: o aviso de dado vira um SELO colado no numero,
                onde a duvida nasce; o texto inteiro esta' no detalhe. */}
            {aviso && <SeloAviso aviso={aviso} />}
          </p>
          {linhaMenores && (
            <p className={`mt-1 text-xs ${linhaMenores.aviso ? "font-semibold text-warn-ink" : "text-ink-muted"}`}>{linhaMenores.texto}</p>
          )}
          {compareActive && momPct != null && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
              <span
                title={prevGmv != null ? `Antes: ${fmtCompacto(prevGmv)}` : undefined}
                className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${
                  momPct >= 0 ? "bg-ok-soft text-ok-ink" : "bg-crit-soft text-crit-ink"
                }`}
              >
                {fmtPctBr(momPct)} {prevGmv != null ? "vs anterior" : rotuloComparacao ?? "vs anterior"}
              </span>
              {prevGmv == null && detalheComparacao && <InfoDica texto={detalheComparacao} />}
            </p>
          )}
          {onOpenGmv && (
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={onOpenGmv}
              title={`GMV de ${periodLabel}, por marca e canal`}
              className="mt-1 inline-flex min-h-11 items-center text-xs font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Detalhar →
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Canal sem meta (ex.: TikTok Shop): o GMV dele nao entra no atingimento. Regra fixa: vai no (i). */
function ForaDaMeta({ canais }: { canais: Marketplace[] }) {
  if (!canais.length) return null;
  const nomes = canais.map((c) => CHANNEL_LABEL[c]).join(" e ");
  return (
    <span className="ml-1 inline-flex align-middle normal-case tracking-normal">
      <InfoDica texto={`${nomes} não tem meta: o GMV fica fora do atingimento.`} />
    </span>
  );
}

function BarraDaMeta({ progresso: p, mesMeta, comCurva, canaisForaDaMeta, metasHref }: Props & { progresso: ProgressoMeta }) {
  // A escala vai ate' o maior entre meta, realizado e projecao: passar da meta
  // tem que aparecer como passar do traco, nao como barra cheia.
  const escala = Math.max(1, p.atingimento, p.projecaoSobreMeta ?? 0);
  const larg = (f: number) => `${(Math.min(f, escala) / escala) * 100}%`;
  const projecaoAlem = p.projecaoSobreMeta != null && p.projecaoSobreMeta > p.atingimento;
  // Com curva, "onde o plano esperava estar" nao e' dias/n: vale marcar.
  const mostraPlano = comCurva && !p.encerrado && p.diasComDado > 0 && mesMeta != null;
  const doPlano = Math.round(p.atingimentoDoPlano * 100);
  const fimDoMes = mesMeta ? `${mesMeta}-${String(p.diasNoMes).padStart(2, "0")}` : "";

  // Menos legendas: realizado, plano, projecao e ritmo necessario saem da vista e vao para o (i).
  const detalhe = [
    `Realizado ${fmtCompacto(p.realizado)}${
      p.encerrado ? " (mês encerrado)" : mostraPlano ? `, ${doPlano > 100 ? "acima do plano" : doPlano < 100 ? "abaixo do plano" : "no plano"} (${doPlano}%)` : ""
    }.`,
    !p.encerrado && p.projecao != null ? `Projeção pelo ritmo: ${fmtCompacto(p.projecao)} (${pct0(p.projecaoSobreMeta!)} da meta).` : null,
    p.porDiaNecessario != null
      ? `Faltam ${fmtCompacto(p.porDiaNecessario)} por dia${comCurva ? " normal" : ""}${fimDoMes ? ` até ${ddmm(fimDoMes)}` : ""}.`
      : null,
    canaisForaDaMeta.length ? `${canaisForaDaMeta.map((c) => CHANNEL_LABEL[c]).join(" e ")} não tem meta: o GMV fica fora do atingimento.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          <span>
            Meta de {mesMeta ? rotuloMes(mesMeta) : "o mês"} ·{" "}
            <span className="tabular-nums text-ink-muted">{fmtCompacto(p.meta)}</span>
          </span>
          <span className="normal-case tracking-normal">
            <InfoDica texto={detalhe} />
          </span>
        </p>
        <p className="flex items-center gap-2">
          <b className="text-base font-bold text-ink tabular-nums">
            {pct0(p.atingimento)}
            <span className="sr-only"> da meta atingidos</span>
          </b>
          <Link
            href={metasHref}
            title="Editar metas"
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${SELO[p.status]}`}
          >
            {ROTULO_STATUS[p.status]}
          </Link>
        </p>
      </div>
      <div
        className="relative h-3.5 rounded-full bg-raised"
        role="img"
        aria-label={`Realizado ${pct0(p.atingimento)} da meta${
          p.projecaoSobreMeta != null && !p.encerrado ? `; projeção ${pct0(p.projecaoSobreMeta)}` : ""
        }`}
      >
        {projecaoAlem && !p.encerrado && (
          <div
            className="tc-barra absolute inset-y-0 left-0 rounded-full"
            style={{
              width: larg(p.projecaoSobreMeta!),
              backgroundImage:
                "repeating-linear-gradient(135deg, rgb(var(--tc-accent) / 0.45) 0 5px, rgb(var(--tc-accent) / 0.12) 5px 10px)",
            }}
          />
        )}
        <div className="tc-barra absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: larg(p.atingimento) }} />
        {mostraPlano && (
          <div
            className="absolute -inset-y-0.5 w-1 rounded-full border border-surface bg-ink-muted"
            style={{ left: larg(p.planoAteData / p.meta) }}
            aria-hidden="true"
          />
        )}
        <div className="absolute -inset-y-1 w-0.5 bg-ink" style={{ left: larg(1) }} aria-hidden="true" />
      </div>
    </div>
  );
}

function BarraDoDia({ progressoDia: p, hoje, semDado, canaisForaDaMeta, tendenciaDoDia: t, metasHref }: Props & { progressoDia: ProgressoDia }) {
  const titulo = p.dia === hoje ? "Meta de hoje" : "Meta do dia";
  const escala = Math.max(1, p.atingimento ?? 0);
  const larg = (f: number) => `${(Math.min(f, escala) / escala) * 100}%`;

  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {titulo} · {diaDaSemana(p.dia)}, {ddmm(p.dia)} ·{" "}
          <span className="tabular-nums text-ink-muted">{fmtCompacto(p.metaDoDia)}</span>
          {p.evento && (
            <span className="ml-1.5 inline-flex rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold normal-case tracking-normal text-accent-ink">
              {p.evento}
            </span>
          )}
          <ForaDaMeta canais={canaisForaDaMeta} />
        </p>
        {p.atingimento != null && (
          <p className="flex items-center gap-2">
            <b className="text-base font-bold text-ink tabular-nums">
              {pct0(p.atingimento)}
              <span className="sr-only"> da meta do dia</span>
            </b>
            <Link
              href={metasHref}
              title="Meta por dia"
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${SELO_DIA[p.status]}`}
            >
              {ROTULO_DIA[p.status]}
            </Link>
          </p>
        )}
      </div>
      {p.atingimento != null ? (
        <>
          <div className="relative h-3.5 rounded-full bg-raised" role="img" aria-label={`Realizado ${pct0(p.atingimento)} da meta do dia`}>
            <div className="tc-barra absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: larg(p.atingimento) }} />
            <div className="absolute -inset-y-1 w-0.5 bg-ink" style={{ left: larg(1) }} aria-hidden="true" />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-ink-muted tabular-nums">
            <span>
              <b className="font-semibold text-ink">{fmtCompacto(p.realizado)}</b> de {fmtCompacto(p.metaComDado)}
              {p.semDado.length > 0 ? " com venda" : ""}
            </span>
            {p.falta > 0 && (
              <span>
                faltam <b className="font-semibold text-ink">{fmtCompacto(p.falta)}</b>
              </span>
            )}
          </div>
          {t && p.dia === hoje && <TendenciaTopo t={t} />}
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-line-strong px-3 py-3 text-sm text-ink-muted">
          Nenhuma venda {p.dia === hoje ? "de hoje" : "deste dia"} chegou ainda.
        </p>
      )}
      {semDado.length > 0 && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
          <span className="font-semibold text-ink-faint">Sem venda ainda:</span>
          {semDado.join(" · ")}
          <InfoDica texto="Cada canal chega num horário (o ML só no dia seguinte). O que não chegou fica fora da conta até chegar." />
        </p>
      )}
    </div>
  );
}

// "KOKESHI" gritando no meio da frase do (i): primeira maiuscula so'.
const NOME_MARCA = Object.fromEntries(MARCAS.map((m) => [m.id, m.label[0] + m.label.slice(1).toLowerCase()])) as Record<string, string>;
const NOME_CANAL = { tiktok: "TikTok", ml: "ML", shopee: "Shopee" } as const;

/** O que a tendência deixou de fora, para o ⓘ; a linha só mostra o valor. */
function foraDaTendencia(t: TendenciaConsolidada): string {
  const partes = [
    ...t.soParte.map((p) => `${NOME_MARCA[p.id] ?? p.id} na ${p.canais.map((c) => NOME_CANAL[c]).join(" e ")} (sem hora de pedido)`),
    ...t.semRitmo.map((id) => `${NOME_MARCA[id] ?? id} (sem venda ontem até esta hora)`),
  ];
  return partes.length ? ` Ficou de fora: ${partes.join("; ")}.` : "";
}

/** "Tendência R$ 1,2 mi · 98% da meta"; com algo de fora (marca ou canal, nunca somado como 0) mostra só o valor: o % seria sobre outra meta que a da barra. */
function TendenciaTopo({ t }: { t: TendenciaConsolidada }) {
  const parcial = t.somadas < t.total || t.soParte.length > 0;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted tabular-nums">
      <span>
        Tendência <b className="font-semibold text-ink">{fmtCompacto(t.projecao)}</b>
        {!parcial && t.meta != null && ` · ${pct0(t.projecao / t.meta)} da meta`}
      </span>
      <InfoDica texto={`Soma das tendências de cada marca: o GMV de hoje no ritmo de ontem até a mesma hora. O GMV do topo conta tudo; só a tendência deixa de fora o que não tem hora.${foraDaTendencia(t)}`} />
    </p>
  );
}

function SemMeta({ mesMeta, diaMeta, metasStatus, metasHref, onRetryMetas, semMetaDaMarca }: Props) {
  if (semMetaDaMarca) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-line-strong px-3 py-3 text-sm text-ink-muted">
        <Target aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-faint" />
        <span className="min-w-0 flex-1">Sem meta: as demais marcas não têm meta.</span>
      </div>
    );
  }
  const mes = mesMeta ?? diaMeta?.slice(0, 7) ?? null;
  let texto: string;
  if (!mes) texto = "Escolha “Hoje”, “Mês atual” ou um mês fechado no período para ver a meta.";
  else if (metasStatus === "loading") texto = diaMeta ? "Carregando a meta do dia…" : "Carregando a meta do mês…";
  else if (metasStatus === "error") texto = "Não foi possível ler as metas agora.";
  else texto = `Nenhuma meta definida para ${rotuloMes(mes)} neste recorte.`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed border-line-strong px-3 py-3 text-sm text-ink-muted">
      <Target aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-faint" />
      <span className="min-w-0 flex-1">{texto}</span>
      {metasStatus === "error" && (
        <button
          type="button"
          onClick={onRetryMetas}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Tentar novamente
        </button>
      )}
      {mes && metasStatus === "fresh" && (
        <Link
          href={metasHref}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Definir metas →
        </Link>
      )}
    </div>
  );
}

/**
 * Participacao de cada canal no GMV, numa linha (era uma rosca). O valor, a
 * variacao e a parte Full de cada canal ficam no title e no "Detalhar".
 */
function Divisao({
  channels,
  gmvByChannel,
  varGmvByChannel,
  shareFull,
  total,
}: {
  channels: Marketplace[];
  gmvByChannel: Record<Marketplace, number | null>;
  varGmvByChannel: Partial<Record<Marketplace, number | null>> | null;
  shareFull: Partial<Record<Marketplace, number | null>> | null;
  total: number | null;
}) {
  const partes = channels
    .map((c) => ({ c, v: gmvByChannel[c], s: c === "tiktok" ? null : shareFull?.[c] ?? null }))
    .filter((x): x is { c: Marketplace; v: number; s: number | null } => x.v != null && x.v > 0);
  if (!total || partes.length < 2) return null;
  const pct = (x: number) => Math.round(x * 100);
  return (
    <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted tabular-nums" aria-label="Participação de cada canal no GMV">
      {partes.map(({ c, v, s }) => {
        const variacao = varGmvByChannel?.[c];
        return (
          <li
            key={c}
            title={[fmtCompacto(v), variacao != null ? `${fmtPctBr(variacao)} vs anterior` : null, s != null ? `${pct(s)}% Full` : null]
              .filter(Boolean)
              .join(" · ")}
          >
            <span aria-hidden="true" className={`mr-1.5 inline-block h-2 w-2 rounded-full ${PONTO[c]}`} />
            {CHANNEL_LABEL[c]} <b className="font-semibold text-ink">{pct(v / total)}%</b>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Primeira oracao do aviso: corta em ";" ou "." SEGUIDOS de espaco (ou no
 * fim). Ponto decimal ("16.7%") e data ("12/10/2026") nao cortam.
 */
export function primeiraOracao(texto: string): string {
  return texto.split(/[;.](?=\s|$)/)[0].trim();
}

/** Selo "dado incompleto" colado no GMV; abre a confianca no dado. */
function SeloAviso({ aviso }: { aviso: { texto: string; onOpen: () => void } }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={aviso.onOpen}
      title={aviso.texto}
      aria-label={`Dado incompleto: ${primeiraOracao(aviso.texto)}. Ver confiança no dado`}
      className="inline-flex min-h-8 items-center gap-1 rounded-full border border-warn/40 bg-warn-soft px-2.5 text-xs font-semibold text-warn-ink transition-colors hover:bg-warn-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" />
      dado incompleto
    </button>
  );
}
