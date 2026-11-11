/**
 * DRE no padrao da Gerencial: os 8 cartoes (Conhecida e Estimada) adotam o visual do
 * padrao com valores, tons e textos EXATOS de antes; Margem e Classificacao da visao
 * Conhecida abrem o detalhe "o que falta na conta". A DRE vertical nao e' repetida.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");
const RESUMO = ler("src/components/dre/DreResumo.tsx");
const ESTIMADA = ler("src/components/dre/DreEstimada.tsx");
const DETALHE = ler("src/components/dre/DreDetalheConta.tsx");
const PAG = ler("app/dre/DreClient.tsx");

test("DreResumo: 4 cartoes gerenciais, so' as 7 identidades; so' Margem e Classificacao abrem detalhe", () => {
  assert.equal((RESUMO.match(/<KpiTile/g) ?? []).length, 4);
  assert.equal((RESUMO.match(/variante="gerencial"/g) ?? []).length, 4);
  const usadas = [...RESUMO.matchAll(/identidade="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(usadas, ["gmv", "roas", "ticket", "atendimento"]);
  assert.equal((RESUMO.match(/onAbrir=/g) ?? []).length, 2);
  assert.ok(RESUMO.includes('onAbrir("margem")') && RESUMO.includes('onAbrir("classificacao")'));
  assert.ok(!RESUMO.includes("destaque="), "a escala do numero e' a do padrao, nao o destaque da faixa");
});

test("DreResumo: valores, tons e textos de ausencia exatamente como antes (margem ausente nao vira R$ 0 nem travessao)", () => {
  for (const t of [
    "textoMargem(total)", "textoMargemPct(total)", 'tom={sem ? "ausente" : "neutro"}', 'tom={receita.valor === null ? "ausente" : "neutro"}',
    "STATUS_CHIP[receita.status]?.rotulo", '"Depende da margem ao lado"', '"Margem conhecida ÷ receita"', "Bloqueado por ", "Todos os custos aplicáveis presentes",
  ]) assert.ok(RESUMO.includes(t), t);
});

test("ResumoEstimado: mesmo visual, sem clique; premissas e estado do cenario preservados", () => {
  const corpo = ESTIMADA.slice(ESTIMADA.indexOf("export function ResumoEstimado"), ESTIMADA.indexOf("// Conhecida x Estimada"));
  assert.equal((corpo.match(/variante="gerencial"/g) ?? []).length, 4);
  assert.deepEqual([...corpo.matchAll(/identidade="([a-z]+)"/g)].map((m) => m[1]), ["gmv", "roas", "ticket", "prazo"]);
  assert.ok(!corpo.includes("onAbrir"), "a visao Estimada nao abre detalhe");
  for (const t of ["textoMargemEstimada(cenario)", "<EstadoCenarioChip cenario={cenario} />", "cenario.fonte_premissas.rotulo", "Receita realizada; a mesma da visão Conhecida"]) assert.ok(corpo.includes(t), t);
});

test("detalhe: so' dados que a resposta ja' traz; ausencia mostra o status; sem 'lucro'; a DRE vertical nao e' repetida", () => {
  for (const t of ["total.componentes_ausentes", "total.motivos_classificacao", "total.avisos_qualidade", "STATUS_CHIP[a.status]?.rotulo", "ROTULO_COMPONENTE["]) assert.ok(DETALHE.includes(t), t);
  assert.ok(!/linhasDre|DreVertical|fmtCusto/.test(DETALHE), "a conta linha a linha segue na DRE vertical");
  const codigo = DETALHE.replace(/\/\*[\s\S]*?\*\//g, ""); // o comentario do arquivo cita "R$ 0" e "lucro" justamente para negá-los
  assert.ok(!/R\$ 0/.test(codigo) && !/lucro|margem l[ií]quida/i.test(codigo), "nunca R$ 0, nunca lucro");
  assert.ok(DETALHE.includes("DrilldownContextLine") && DETALHE.includes("DataQualityNote") && DETALHE.includes("EvidenceRow"));
});

test("pagina da DRE: dialogo unico, gated pelo total, icone e cor do cartao; sem title nativo", () => {
  assert.equal((PAG.match(/<KpiDrilldownDialog/g) ?? []).length, 1);
  assert.ok(PAG.includes("open={detalhe != null && resp?.total != null}") && PAG.includes("{detalhe && resp?.total && ("));
  assert.ok(PAG.includes('identidade={detalhe === "classificacao" ? "atendimento" : "roas"}'));
  assert.ok(PAG.includes("onAbrir={setDetalhe}") && PAG.includes("Não é lucro nem margem líquida"));
});
