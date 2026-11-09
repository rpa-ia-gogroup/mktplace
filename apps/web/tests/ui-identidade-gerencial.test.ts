// IDENTIDADE-GERENCIAL — PR base: KpiTile aditivo, Heroi, MaisDetalhes,
// FilaAtencao. A Gerencial nao muda: a faixa padrao do KpiTile fica igual e
// os originais (MetaHero, AttentionQueue, app/page.tsx) nao usam os novos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");
const KPI = ler("src/components/ui/KpiTile.tsx");

test("KpiTile: sem `variante`, o render da faixa padrao e' o mesmo de antes", () => {
  // o bloco do render padrao, do `return (` da faixa ate' o fim da funcao, copiado da versao anterior
  const padrao = `  return (
    <div
      title={contexto}
      className={\`flex min-w-0 flex-col justify-between rounded-xl border px-3.5 py-3 \${TOM_SUPERFICIE[tom]}\`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {rotulo}
          {ajuda}
        </p>
        {tom !== "neutro" && (
          <span
            aria-hidden="true"
            className={\`mt-1 h-2 w-2 shrink-0 rounded-full \${TOM_PONTO[tom]}\`}
          />
        )}
      </div>
      <p
        className={\`mt-1.5 font-semibold leading-none tabular-nums \${
          destaque ? "text-[28px]" : "text-xl"
        } \${TOM_TINTA[tom]}\`}
      >
        {valor}
      </p>
      {comparacao && (
        <p className="mt-1.5 text-xs leading-snug text-ink-muted">{comparacao}</p>
      )}
    </div>
  );
}`;
  assert.ok(KPI.includes(padrao), "render padrao alterado");
  assert.match(KPI, /variante = "faixa"/, "padrao continua sendo a faixa");
});

test("KpiTile gerencial: vidro neutro, ladrilho de icone e botao acessivel so' com onAbrir", () => {
  const g = KPI.slice(KPI.indexOf("function KpiGerencial"));
  assert.ok(!g.includes("TOM_SUPERFICIE"), "tom nunca no fundo do cartao");
  assert.ok(g.includes("border-line bg-surface") && g.includes("h-7 w-7") && g.includes("rounded-lg bg-accent/10 text-accent") && g.includes("text-2xl"));
  assert.ok(g.includes('aria-haspopup="dialog"') && g.includes("focus-visible:ring-2 focus-visible:ring-accent") && g.includes("min-h-11"));
});

test("os originais da Gerencial nao passam a usar os componentes novos", () => {
  for (const f of ["app/page.tsx", "src/components/gerencial/MetaHero.tsx", "src/components/gerencial/AttentionQueue.tsx", "src/components/gerencial/KpiBand.tsx"]) {
    const src = ler(f);
    assert.ok(!/ui\/(Heroi|MaisDetalhes|FilaAtencao)/.test(src), f);
  }
});

test("componentes novos reproduzem as classes dos originais", () => {
  const heroi = ler("src/components/ui/Heroi.tsx");
  assert.ok(heroi.includes("grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(220px,1fr)_2fr_auto] lg:items-center lg:gap-6"));
  assert.ok(heroi.includes("rounded-full border px-3 py-1.5 text-xs font-bold uppercase"));
  assert.ok(heroi.includes("text-3xl font-bold tracking-tight tabular-nums"));
  const md = ler("src/components/ui/MaisDetalhes.tsx");
  assert.ok(md.includes("group rounded-xl border border-line bg-surface") && md.includes("group-open:rotate-180") && md.includes("min-h-11"));
  const fila = ler("src/components/ui/FilaAtencao.tsx");
  assert.ok(fila.includes("text-crit-ink bg-crit-soft border-crit/35") && fila.includes('"Crítico"') && fila.includes('"Informativo"'));
});

test("so' acrescimos: nenhum arquivo congelado mudou neste PR", () => {
  let base: string;
  try {
    base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf-8" }).trim();
  } catch {
    return; // sem git (ex.: CI sem historico): a asserção de classes acima cobre o KpiTile
  }
  const mudou = execFileSync("git", ["diff", "--name-only", base, "--", "src/components/gerencial", ":(exclude)src/components/gerencial/CxResumo.tsx", ":(exclude)src/components/gerencial/CxDrilldown.tsx", ":(exclude)src/components/gerencial/KpiBand.tsx", ":(exclude)src/components/gerencial/MarcasMeta.tsx", ":(exclude)src/components/gerencial/TopProdutosMarca.tsx", ":(exclude)src/components/gerencial/TopProdutosComparar.tsx", "src/components/KpiDrilldownDialog.tsx", "src/components/ui/Panel.tsx", "src/components/ui/Chip.tsx", "src/components/ui/InfoDica.tsx", "src/components/ui/StateBlock.tsx"], { encoding: "utf-8" }).trim();
  // CxResumo e CxDrilldown: do PR da CX (spec do Prumo), so' aditivos com padrao igual ao de antes
  // MarcasMeta e app/page.tsx: tendencia do mes por marca (pedido da operacao), mudanca de produto intencional
  assert.equal(mudou, "", mudou);
});

// ---------------------------------------------------------------------------
// CARD-KPI-GERENCIAL — KpiTile "gerencial" com `identidade` = card da KpiBand.
// DeltaBadge e Sparkline sairam da KpiBand para ui/ sem mudar o markup.
// ---------------------------------------------------------------------------

/**
 * Baseline FIXO: a main logo antes do #265 (a extracao do DeltaBadge/Sparkline).
 * Comparar com `origin/main` quebrava depois do merge, porque a main ja' nao
 * tem o trecho extraido. Sem git (CI raso, commit ausente): `null` e o teste se
 * apoia nas classes.
 */
const BASELINE_ANTES_DO_265 = "b41ad80";
function naBaseline(rel: string): string | null {
  try {
    return execFileSync("git", ["show", `${BASELINE_ANTES_DO_265}:apps/web/${rel}`], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}
const trecho = (src: string, de: string, ate: string) => src.slice(src.indexOf(de), src.indexOf(ate, src.indexOf(de)));

test("KpiBand: o card, o DeltaBadge e a Sparkline tem o mesmo markup de antes da extracao", () => {
  const band = ler("src/components/gerencial/KpiBand.tsx");
  const delta = ler("src/components/ui/DeltaBadge.tsx");
  const spark = ler("src/components/ui/Sparkline.tsx");
  assert.ok(band.includes('import DeltaBadge from "@/components/ui/DeltaBadge"') && band.includes('import { LinhaDeTendencia } from "@/components/ui/Sparkline"'));
  assert.ok(!band.includes("function DeltaBadge") && !band.includes("function Sparkline") && !band.includes("function LinhaDeTendencia"));
  assert.ok(delta.includes("inline-flex w-fit items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${pele}"));
  for (const pele of ['"bg-raised text-ink-muted"', '"bg-ok-soft text-ok-ink"', '"bg-crit-soft text-crit-ink"']) assert.ok(delta.includes(pele), pele);
  const antes = naBaseline("src/components/gerencial/KpiBand.tsx");
  if (!antes) return;
  // o corpo da Sparkline e da LinhaDeTendencia, texto a texto
  assert.equal(trecho(spark, "  // `useId` traz", "\n}\n"), trecho(antes, "  // `useId` traz", "\n}\n"));
  assert.equal(trecho(spark, "export function LinhaDeTendencia", "\n}\n").replace("export ", ""), trecho(antes, "function LinhaDeTendencia", "\n}\n"));
  // o KpiCard, a faixa e o resto do arquivo nao mudaram
  assert.equal(trecho(band, "function KpiCard(", "\nexport default"), trecho(antes, "function KpiCard(", "\nexport default"));
  assert.equal(trecho(band, "export default function KpiBand", "\n}\n"), trecho(antes, "export default function KpiBand", "\n}\n"));
});

test("KpiTile 'gerencial' sem identidade: o render de antes, texto a texto", () => {
  const antes = naBaseline("src/components/ui/KpiTile.tsx");
  if (!antes) return;
  assert.equal(trecho(KPI, "function KpiGerencial(", "\n}\n"), trecho(antes, "function KpiGerencial(", "\n}\n"));
});

test("KpiTile com identidade: as classes do card da KpiBand e a cor do token", () => {
  const c = KPI.slice(KPI.indexOf("function KpiCardIdentidade"));
  for (const cls of [
    "card-hover group",
    "bg-surface border rounded-xl p-3.5 flex flex-col gap-1",
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
    "text-lg md:text-xl lg:text-2xl xl:text-lg min-[1440px]:text-2xl font-semibold tracking-tight tabular-nums leading-tight",
    "mt-auto flex items-end justify-between gap-3 pt-1",
    "text-xs text-ink-faint tabular-nums",
    "t.pontos.length >= 4",
  ]) assert.ok(c.includes(cls), cls);
  for (const id of ["gmv", "pedidos", "ticket", "ads", "roas", "prazo", "atendimento"]) {
    assert.match(KPI, new RegExp(`${id}: \{ tinta: "text-kpi-${id}", borda: "border-kpi-${id}/3[05]", ladrilho: "bg-kpi-${id}/10" \}`), id);
  }
});

test("tokens novos kpi-prazo e kpi-atendimento nos dois temas, no brilho e no Tailwind", () => {
  const css = ler("app/globals.css");
  for (const t of ["--tc-kpi-prazo: 37 99 235;", "--tc-kpi-atendimento: 15 118 110;", "--tc-kpi-prazo: 96 165 250;", "--tc-kpi-atendimento: 45 212 191;",
    '[class*="border-kpi-prazo"] { --kpi-cor: var(--tc-kpi-prazo); }', '[class*="border-kpi-atendimento"] { --kpi-cor: var(--tc-kpi-atendimento); }']) {
    assert.ok(css.includes(t), t);
  }
  const tw = ler("tailwind.config.ts");
  assert.ok(tw.includes('prazo: token("kpi-prazo")') && tw.includes('atendimento: token("kpi-atendimento")'));
});

test("DeltaBadge: 'pct' igual ao da Gerencial; 'pp' para taxa; 'pts' para NPS", async () => {
  const { fmtDelta, fmtPctBr } = await import("../src/lib/formatters.ts");
  for (const v of [3.6, -11.1, 0]) assert.equal(fmtDelta(v), fmtPctBr(v), "padrao = o texto de antes");
  assert.equal(fmtDelta(0.6, "pp"), "+0,6 p.p.");
  assert.equal(fmtDelta(-1.25, "pp"), "−1,3 p.p.");
  assert.equal(fmtDelta(3, "pts"), "+3 pts");
  assert.equal(fmtDelta(-2.5, "pts"), "−2,5 pts");
  assert.equal(fmtDelta(0, "pts"), "0 pts");
  assert.ok(ler("src/components/ui/DeltaBadge.tsx").includes("{fmtDelta(pct, unidade)}"));
});
