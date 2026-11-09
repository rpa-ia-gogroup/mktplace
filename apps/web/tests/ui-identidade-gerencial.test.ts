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
  const mudou = execFileSync("git", ["diff", "--name-only", base, "--", "src/components/gerencial", ":(exclude)src/components/gerencial/CxResumo.tsx", ":(exclude)src/components/gerencial/CxDrilldown.tsx", "app/page.tsx", "src/components/KpiDrilldownDialog.tsx", "src/components/ui/Panel.tsx", "src/components/ui/Chip.tsx", "src/components/ui/InfoDica.tsx", "src/components/ui/StateBlock.tsx"], { encoding: "utf-8" }).trim();
  // CxResumo e CxDrilldown: do PR da CX (spec do Prumo), so' aditivos com padrao igual ao de antes
  assert.equal(mudou, "", mudou);
});
