/** CURVA-ABC nas abas Estoque Shopee e Estoque ML (PR4). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  avisoCoberturaCurva, avisoCurvaIndisponivel, curvaNaTela, motivoSemCurva, ordenarPorCurva, passaCurva, resumoAcao,
  type CurvaMeta,
} from "../src/lib/estoque-curva.ts";

type Item = { id: string; curva: "AA" | "A" | "B" | "C" | null; cob: number | string | null; acao?: boolean };
const it = (id: string, curva: Item["curva"], cob: Item["cob"], acao = false): Item => ({ id, curva, cob, acao });
const meta = (m: Partial<CurvaMeta>): CurvaMeta => ({
  disponivel: true, motivo: null, lida_em: null, itens_com_curva: 0, itens_total: 0, ...m,
});

test("ordem: AA -> A -> demais; no grupo, menos dias primeiro e sem cobertura no fim", () => {
  const itens = [
    it("c-5", "C", 5), it("sem-1", null, 1), it("a-null", "A", null), it("aa-30", "AA", 30),
    it("a-2", "A", "2.5"), it("b-0", "B", 0), it("aa-3", "AA", 3), it("aa-null", "AA", null),
  ];
  assert.deepEqual(
    ordenarPorCurva(itens, (t) => t.cob).map((t) => t.id),
    ["aa-3", "aa-30", "aa-null", "a-2", "a-null", "b-0", "sem-1", "c-5"],
  );
  // empate: a ordem da API (urgencia) fica
  assert.deepEqual(ordenarPorCurva([it("x", "B", 4), it("y", "C", 4)], (t) => t.cob).map((t) => t.id), ["x", "y"]);
});

test("filtro: vazio = todas; AA/A junto; sem curva nunca cai em C; combina com o recorte da API", () => {
  assert.equal(passaCurva("C", []), true);
  assert.equal(passaCurva("AA", ["aa_a"]), true);
  assert.equal(passaCurva("A", ["aa_a"]), true);
  assert.equal(passaCurva(null, ["c"]), false);
  assert.equal(passaCurva(null, ["sem"]), true);
  assert.equal(passaCurva(undefined, ["sem"]), true);
  assert.equal(passaCurva("B", ["aa_a", "c"]), false);
  // a lista ja' chega filtrada por Classificação/"exigem ação" (API); a curva corta em cima
  const daApi = [it("1", "AA", 0, true), it("2", "B", 3, true), it("3", null, 1, true), it("4", "A", 9, false)];
  const recorte = daApi.filter((t) => passaCurva(t.curva, ["aa_a", "sem"]));
  assert.deepEqual(recorte.map((t) => t.id), ["1", "3", "4"]);
  assert.equal(resumoAcao(recorte, (t) => !!t.acao), "Por curva: 1 AA · 0 A · 1 demais");
});

test("aviso do ML com o % real da curva; nada quando nao ha' itens", () => {
  assert.equal(
    avisoCoberturaCurva(meta({ itens_com_curva: 41, itens_total: 205 })),
    "A curva cobre ~20% dos itens: “sem curva” não é C.",
  );
  assert.equal(avisoCoberturaCurva(meta({ itens_total: 0 })), null);
  assert.equal(avisoCoberturaCurva(meta({ disponivel: false, itens_com_curva: 1, itens_total: 2 })), null);
});

test("leitura indisponivel: coluna e filtro somem e entra o aviso com o motivo; nunca C nem 0", () => {
  const fora = meta({ disponivel: false, motivo: "credencial da planilha ausente" });
  assert.equal(curvaNaTela(fora), false);
  assert.equal(curvaNaTela(null), false, "API sem a anotacao: sem coluna e sem aviso");
  assert.equal(avisoCurvaIndisponivel(null), null);
  assert.equal(avisoCurvaIndisponivel(fora), "Curva indisponível agora: credencial da planilha ausente.");
  assert.equal(avisoCurvaIndisponivel(meta({ disponivel: false })), "Curva indisponível agora: a planilha de curva não foi lida.");
  assert.equal(curvaNaTela(meta({})), true);
  assert.equal(motivoSemCurva("kit"), "kit não tem curva própria");
  assert.equal(motivoSemCurva("sem_ponte"), "código sem ponte com a planilha de curva");
  assert.equal(motivoSemCurva("marca_fora"), "marca fora da planilha de curva");
});

test("as duas abas: coluna, filtro e ordem so' com a curva lida; resumo de ação acima da tabela", () => {
  for (const f of ["app/estoque-full/EstoqueFullClient.tsx", "app/estoque-ml-full/MLFullEstoqueClient.tsx"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.match(src, /const comCurva = curvaNaTela\(metaCurva\)/, f);
    assert.match(src, /\{comCurva && <th scope="col" className="(hidden )?px-4 py-3( sm:table-cell)?">Curva<\/th>\}/, f);
    assert.match(src, /\{comCurva && <FiltroCurvaChips/, f);
    assert.match(src, /ordenarPorCurva\(/, f);
    // o resumo e' o panorama: sem o filtro de curva
    assert.match(src, /resumoAcao\(payload\.(produtos|inventarios)[,.]/, f);
    assert.doesNotMatch(src, /resumoAcao\(lista,/, f);
    assert.match(src, /avisoCurvaIndisponivel\(metaCurva\)/, f);
    assert.match(src, /setCurvas\(\[\]\)/, `${f}: Limpar filtros limpa a curva`);
  }
  const ml = readFileSync(new URL("../app/estoque-ml-full/MLFullEstoqueClient.tsx", import.meta.url), "utf8");
  assert.match(ml, /avisoCoberturaCurva\(metaCurva\)/);
  // ML abaixo de sm: chip na linha 1 da Identificacao e coluna escondida
  assert.match(ml, /className="hidden px-4 py-3 sm:table-cell">Curva<\/th>/);
  assert.equal((ml.match(/sm:hidden"><CelulaCurva item=\{i\} \/>/g) ?? []).length, 2);
});
