/**
 * Acoes ML + TikTok (/inteligencia) no padrao da Gerencial: os 3 cartoes de
 * prioridade viram KpiTile gerencial; o detalhe herda icone e cor; estados via
 * StateBlock; formato da casa. Os modais de detalhe ja' estavam no padrao.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

test("cartoes de prioridade: CartaoIndicador (ALVO-GRADE) com as 7 identidades existentes (nao cor de estado)", () => {
  const src = ler("src/components/inteligencia/PriorityCards.tsx");
  assert.ok(src.includes("<CartaoIndicador") && src.includes("rotulo={p.title}") && src.includes("cor={`rgb(var(--tc-kpi-${identidade}))`}"));
  assert.ok(src.includes('parar: { icone: OctagonX, identidade: "ads" }'));
  assert.ok(src.includes('escalar: { icone: Rocket, identidade: "roas" }'));
  assert.ok(src.includes('testar: { icone: FlaskConical, identidade: "gmv" }'));
  const usadas = [...src.matchAll(/identidade: "([a-z]+)"/g)].map((m) => m[1]);
  for (const id of usadas) assert.ok(["gmv", "pedidos", "ticket", "ads", "roas", "prazo", "atendimento"].includes(id), id);
  assert.ok(!/bg-rose|bg-emerald|bg-amber|Sai agora|Retorno alto|Sem mídia/.test(src), "sem as cores/chips de estado antigos");
});

test("cartoes: valor no formato da casa, contagem de registros recebidos e limitacao no ⓘ; sem clique enquanto atualiza", () => {
  const src = ler("src/components/inteligencia/PriorityCards.tsx");
  assert.ok(src.includes("valor={fmtBrlCurto(p.amount)}") && !src.includes("fmtBrl("));
  assert.ok(src.includes("registro${p.received === 1") && src.includes("<InfoDica texto={p.limitation} emControle />"));
  assert.ok(src.includes("onAbrir={disabled ? undefined : () => onOpen(p)}"));
  // ALVO-GRADE: a faixa de 4 (3 prioridades ML + TikTok como irmao na mesma grade).
  assert.ok(src.includes("xl:grid-cols-4") && src.includes("{extra}"));
});

test("pagina: o detalhe de uma prioridade herda icone e cor; os outros 5 detalhes seguem como estavam", () => {
  const pag = ler("app/inteligencia/page.tsx");
  assert.equal((pag.match(/<KpiDrilldownDialog/g) ?? []).length, 1, "um shell so'");
  assert.ok(pag.includes('icone={dialog?.kind === "priority" ? VISUAL_PRIORIDADE[dialog.priority.kind].icone : undefined}'));
  assert.ok(pag.includes('identidade={dialog?.kind === "priority" ? VISUAL_PRIORIDADE[dialog.priority.kind].identidade : undefined}'));
  assert.ok(pag.includes("focusResetKey={dialogFocusKey}"), "troca de conteudo sem fechar continua devolvendo o foco");
});

test("pagina: estados via StateBlock com os mesmos textos; esqueleto no formato do cartao; formato da casa", () => {
  const pag = ler("app/inteligencia/page.tsx");
  for (const t of [
    'titulo="Não foi possível carregar os dados de inteligência."',
    'titulo="Dados de inteligência indisponíveis no momento."',
    "Nenhuma prioridade nas listas recebidas para ${scope}.",
  ]) assert.ok(pag.includes(t), t);
  assert.ok(pag.includes('tipo="erro"') && pag.includes('tipo="indisponivel"') && pag.includes('tipo="vazio"'));
  assert.ok(!pag.includes("bg-rose-50 border border-rose-200") && !pag.includes("SkeletonKpiCard"), "sem a caixa rosa a mao nem o esqueleto legado");
  assert.equal((pag.match(/<KpiCardSkeleton anunciar=\{false\} \/>/g) ?? []).length, 3, "3 esqueletos mudos; o contenedor ja' anuncia");
  assert.ok(!/\bfmtBrl\(/.test(pag) && !/\bfmtNumber\(/.test(pag) && !/\.toFixed\(/.test(pag), "sem K/M com ponto nem ponto decimal");
  assert.ok(pag.includes("contagemExata("), "contagens auditaveis seguem exatas (V3F)");
});
