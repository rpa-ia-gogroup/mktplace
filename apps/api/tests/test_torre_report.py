"""Report diario das 8h (R1): regra pura sobre GMV, metas, LDR e Kokeshi."""
from __future__ import annotations

import re
from datetime import date, timedelta
from pathlib import Path

from app.services import metas_curva
from app.services import slack_blocks as sb
from app.services import torre_alertas as ta
from app.services import torre_report as tr

ONTEM = date(2026, 11, 4)  # quarta
SEMANA = ONTEM - timedelta(days=7)


def _dados(gmv=None, metas=None, ldr=None, saude=None):
    return tr.Dados(ONTEM, gmv or {}, metas or {}, ldr or ta.LeituraLdr(), saude or ta.LeituraSaude())


def test_meta_do_dia_usa_a_curva_do_canal():
    meta = 3_000_000.0
    alvo = meta * metas_curva.fracao_do_dia(ONTEM, "ml")
    gmv = {("kokeshi", "ml", ONTEM): alvo * 1.1, ("kokeshi", "shopee", ONTEM): 50_000.0}
    rep = tr.compor_report(_dados(gmv, {("kokeshi", "ml"): meta}))
    k = next(x for x in rep.linhas if x.marca == "kokeshi")
    assert abs(k.pct_meta_dia - 1.1) < 1e-9          # so' canal com meta
    assert k.gmv == alvo * 1.1 + 50_000.0            # GMV soma ML + Shopee
    assert tr.Achado("kokeshi", "meta do dia 110%") in rep.avancos


def test_abaixo_da_meta_do_dia_critico_e_atencao():
    meta = 1_000_000.0
    alvo = meta * metas_curva.fracao_do_dia(ONTEM, "shopee")
    gmv = {("apice", "shopee", ONTEM): alvo * 0.6, ("lescent", "shopee", ONTEM): alvo * 0.75}
    rep = tr.compor_report(_dados(gmv, {("apice", "shopee"): meta, ("lescent", "shopee"): meta}))
    assert tr.Achado("apice", "Meta do dia 60%", tr.CRIT) in rep.problemas
    assert tr.Achado("lescent", "Meta do dia 75%", tr.ATEN) in rep.problemas


def test_variacao_contra_a_semana_passada_com_piso():
    gmv = {("barbours", "ml", ONTEM): 130_000.0, ("barbours", "ml", SEMANA): 100_000.0,
           ("rituaria", "ml", ONTEM): 70_000.0, ("rituaria", "ml", SEMANA): 100_000.0,
           ("lescent", "ml", ONTEM): 9_000.0, ("lescent", "ml", SEMANA): 2_000.0}
    rep = tr.compor_report(_dados(gmv))
    assert tr.Achado("barbours", "+30% vs qua passada") in rep.avancos
    assert any(p.marca == "rituaria" and p.nivel == tr.ATEN and p.texto.startswith("Queda −30% vs qua passada")
               for p in rep.problemas)
    assert not any(a.marca == "lescent" for a in rep.avancos + rep.problemas)  # base < piso


def test_ritmo_do_mes():
    meta = 3_000_000.0
    esperado = meta * metas_curva.fracao_ate(ONTEM, "ml")
    gmv = {("kokeshi", "ml", ONTEM.replace(day=1)): esperado * 0.4,
           ("kokeshi", "ml", ONTEM.replace(day=2)): esperado * 0.4}
    rep = tr.compor_report(_dados(gmv, {("kokeshi", "ml"): meta}))
    assert rep.mes == (esperado * 0.8, esperado, meta)
    assert any(p.marca is None and p.texto.startswith("Mês abaixo do ritmo da meta (80%") for p in rep.problemas)


def test_canal_sem_gmv_ontem_e_carga_atrasada():
    rep = tr.compor_report(_dados({("kokeshi", "shopee", SEMANA): 100_000.0}))
    assert tr.Achado(None, "Shopee sem GMV ontem: a carga pode estar atrasada", tr.ATEN) in rep.problemas


def test_ldr_e_kokeshi_entram_em_problemas_e_avancos():
    ldr = ta.LeituraLdr(celulas=[
        ta.CelulaLdr("mercadolivre", "rituaria", 0.11, 9, 82, ta.CRITICO),
        ta.CelulaLdr("tiktokshop", "kokeshi", 0.03, 371, 12503, ta.ATENCAO),
        ta.CelulaLdr("shopee", "apice", 0.015, 18, 1187, ta.DENTRO),
    ], indisponiveis=["Mercado Livre"])
    saude = ta.LeituraSaude(sinais=[ta.SinalSaude("kokeshi", "mercadolivre", ta.ATENCAO, "x", "perto", ONTEM)])
    rep = tr.compor_report(_dados(ldr=ldr, saude=saude))
    assert (rep.problemas[0].marca, rep.problemas[0].nivel) == ("rituaria", tr.CRIT)
    assert rep.problemas[0].texto.startswith("Mercado Livre · LDR 11,0%")
    assert (rep.problemas[1].marca, rep.problemas[1].nivel) == ("kokeshi", tr.ATEN)
    assert rep.problemas[1].texto.startswith("TikTok Shop · LDR 3,0%")
    assert tr.Achado("kokeshi", "Mercado Livre · perto", tr.ATEN) in rep.problemas
    assert tr.Achado(None, "LDR na meta em 1 de 3 contas") in rep.avancos
    assert rep.notas == ["Sem LDR agora de: Mercado Livre."]


def test_kokeshi_em_ordem_e_avanco():
    rep = tr.compor_report(_dados(saude=ta.LeituraSaude(em_ordem=[("kokeshi", "mercadolivre")])))
    assert tr.Achado(None, "Performance oficial em ordem no Mercado Livre: Kokeshi") in rep.avancos


def test_performance_sem_fonte_e_indisponivel_viram_notas():
    saude = ta.LeituraSaude(indisponiveis=["Shopee"], sem_fonte=["TikTok Shop"])
    rep = tr.compor_report(_dados(saude=saude))
    assert "Performance oficial indisponível agora: Shopee." in rep.notas
    assert "Ainda sem nota oficial: TikTok Shop." in rep.notas


def test_mensagem_abre_com_o_resumo_e_tem_chave_do_dia():
    gmv = {("kokeshi", "ml", ONTEM): 1_234_567.0}
    rep = tr.compor_report(_dados(gmv, {("kokeshi", "ml"): 30_000_000.0}))
    texto = tr.montar_mensagem(rep)
    assert texto.splitlines()[0].startswith(
        ":sunrise: *Bom dia! Ontem (qua, 04/11): R$ 1,23 mi de GMV nas marcas "
        "(Shopee R$ 0 + Meli R$ 1,23 mi),")
    assert "Novembro até ontem:" in texto and "_GMV e meta contam Shopee e Mercado Livre._" in texto
    assert tr.chave_do_report(rep) == "report:2026-11-04"


def test_mensagem_sem_nada_diz_que_nao_ha_problema():
    texto = tr.montar_mensagem(tr.compor_report(_dados()))
    assert "0 avanços, 0 problemas" in texto and "Nenhum problema." in texto


def test_formatos_em_reais():
    assert tr.brl(375_700) == "R$ 375,7 mil"
    assert tr.brl(13_450_000) == "R$ 13,45 mi"
    assert tr.brl(950) == "R$ 950"


def test_curva_python_igual_a_do_web():
    """As duas copias da curva (web e API) precisam bater."""
    ts = Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "metas-curva.ts"
    src = ts.read_text(encoding="utf-8")
    for mes, dias in metas_curva.CURVAS.items():
        bloco = src[src.index(f'"{mes}": ['):]
        bloco = bloco[: bloco.index("],")]
        web = [(None if e == "null" else e.strip('"'), float(m), float(s)) for e, m, s in re.findall(
            r'\{ evento: (null|"[^"]*"), ml: ([\d.]+), shopee: ([\d.]+) \}', bloco)]
        assert web == [(e, float(m), float(s)) for e, m, s in dias]


def test_blocos_do_report_numeros_marcas_e_atalhos():
    meta = 3_000_000.0
    alvo = meta * metas_curva.fracao_do_dia(ONTEM, "ml")
    gmv = {("kokeshi", "ml", ONTEM): alvo * 0.75, ("kokeshi", "ml", SEMANA): alvo}
    m = tr.montar_blocos(tr.compor_report(_dados(gmv, {("kokeshi", "ml"): meta})))
    assert m.texto.startswith(":sunrise: Bom dia! R$ ")
    titulo, resumo, numeros = m.blocos[:3]
    assert titulo["text"]["text"] == ":sunrise: Bom dia! Resumo de ontem · qua, 04/11"
    rotulos = [f["text"].split("\n")[0] for f in numeros["fields"]]
    assert rotulos[:3] == ["*GMV de ontem*", "*Meta do dia*", "*vs qua passada*"]
    marcas = next(b for b in m.blocos if "GMV por marca" in b.get("text", {}).get("text", ""))
    assert ":large_orange_circle: *Kokeshi*" in marcas["text"]["text"]  # 75%: entre 70% e 80%
    assert marcas["accessory"]["url"].endswith("/metas")
    assert [b["text"]["text"] for b in m.blocos[-1]["elements"]] == ["Metas", "Expedição", "Performance"]


def test_bolas_da_meta():
    assert [tr._bola_meta(p) for p in (None, 1.0, 0.85, 0.72, 0.5)] == [
        ":white_circle:", ":large_green_circle:", ":large_yellow_circle:",
        ":large_orange_circle:", ":red_circle:"]


def test_gmv_dividido_entre_shopee_e_meli():
    gmv = {("kokeshi", "shopee", ONTEM): 200_000.0, ("kokeshi", "ml", ONTEM): 100_000.0,
           ("apice", "shopee", ONTEM): 50_000.0}
    rep = tr.compor_report(_dados(gmv))
    assert tr.divisao(rep.total) == "Shopee R$ 250,0 mil + Meli R$ 100,0 mil"
    k = next(x for x in rep.linhas if x.marca == "kokeshi")
    assert "R$ 300,0 mil (Shopee R$ 200,0 mil + Meli R$ 100,0 mil)" in tr.montar_mensagem(rep)
    m = tr.montar_blocos(rep)
    assert "(Shopee R$ 250,0 mil + Meli R$ 100,0 mil)" in m.texto
    assert tr.divisao(k) in str(m.blocos)


def test_tiktok_nao_entra_em_gmv_nem_meta():
    gmv = {("kokeshi", "ml", ONTEM): 100_000.0, ("kokeshi", "tiktok", ONTEM): 900_000.0}
    metas = {("kokeshi", "ml"): 3_000_000.0, ("kokeshi", "tiktok"): 9_000_000.0}
    base = tr.compor_report(_dados({k: v for k, v in gmv.items() if k[1] != "tiktok"},
                                   {("kokeshi", "ml"): 3_000_000.0}))
    rep = tr.compor_report(_dados(gmv, metas))
    assert rep.total.gmv == 100_000.0 and rep.mes == base.mes
    assert rep.total.pct_meta_dia == base.total.pct_meta_dia
    m = tr.montar_blocos(rep)
    for txt in (tr.montar_mensagem(rep), str(m.blocos), m.texto):
        assert "TikTok" not in txt and "900" not in txt
    assert "GMV e meta contam Shopee e Mercado Livre" in str(m.blocos)


# ---------------------------------------------------------------------------
# Report agrupado por marca (avancos e problemas)
# ---------------------------------------------------------------------------
def _exemplo() -> tr.Report:
    """Cinco marcas, LDR e saude da Shopee: o desenho do report real de um dia ruim."""
    metas = {(m, c): 3_000_000.0 for m in tr.MARCAS for c in ("ml", "shopee")}
    gmv = {}
    for m, pml, psh, sem in [("barbours", 1.3, 1.1, 150_000), ("kokeshi", 0.65, 0.7, 200_000),
                             ("apice", 0.6, 0.85, 90_000), ("lescent", 0.95, 0.75, 60_000),
                             ("rituaria", 0.9, 0.5, 120_000)]:
        for canal, p in (("ml", pml), ("shopee", psh)):
            gmv[(m, canal, ONTEM)] = metas[(m, canal)] * metas_curva.fracao_do_dia(ONTEM, canal) * p
        gmv[(m, "ml", SEMANA)] = sem
    ldr = ta.LeituraLdr(celulas=[
        ta.CelulaLdr("mercadolivre", "rituaria", 0.11, 9, 82, ta.CRITICO),
        ta.CelulaLdr("shopee", "kokeshi", 0.07, 80, 1100, ta.CRITICO),
        ta.CelulaLdr("tiktokshop", "kokeshi", 0.03, 371, 12503, ta.ATENCAO),
        ta.CelulaLdr("shopee", "apice", 0.015, 18, 1187, ta.DENTRO),
        ta.CelulaLdr("mercadolivre", "barbours", 0.02, 10, 500, ta.DENTRO),
    ])

    def sinal(m, nivel, codigo, texto):
        return ta.SinalSaude(m, "shopee", nivel, codigo, f"{ta.rotulo_marca(m)} na Shopee: {texto}", ONTEM)

    saude = ta.LeituraSaude(sinais=[
        sinal("kokeshi", ta.CRITICO, "envio", "Taxa de envio atrasado em 11,96%, fora da meta (máximo 5% da Shopee)."),
        sinal("kokeshi", ta.ATENCAO, "pontos", "2 ponto(s) de penalidade no trimestre."),
        sinal("apice", ta.CRITICO, "prep", "Tempo de preparação em 3,1 dias, fora da meta (máximo 2 dias da Shopee)."),
        sinal("lescent", ta.ATENCAO, "pontos", "1 ponto(s) de penalidade no trimestre."),
    ], em_ordem=[("barbours", "shopee"), ("barbours", "mercadolivre"), ("lescent", "mercadolivre")])
    return tr.compor_report(tr.Dados(ONTEM, gmv, metas, ldr, saude))


AVANCOS_ESPERADOS = """:white_check_mark: *Avanços (7)*
• *Barbours*: meta do dia 120% · +35% vs qua passada
• *Lescent*: +139% vs qua passada
• *Ápice*: +36% vs qua passada
• LDR na meta em 2 de 5 contas
• Performance oficial em ordem no Mercado Livre: Barbours, Lescent
• Performance oficial em ordem na Shopee: Barbours"""

PROBLEMAS_ESPERADOS = """:warning: *Problemas (12)*

*Kokeshi*
:red_circle: Meta do dia 68%
:red_circle: Shopee · LDR 7,0% (80 de 1.100 pedidos; meta 2,0%, teto 5,0%)
:red_circle: Shopee · Taxa de envio atrasado em 11,96%, fora da meta (máximo 5% da Shopee)
:warning: Queda −43% vs qua passada (R$ 114,2 mil × R$ 200,0 mil)
:warning: TikTok Shop · LDR 3,0% (371 de 12.503 pedidos; meta 2,0%, teto 4,0%)
:warning: Shopee · 2 ponto(s) de penalidade no trimestre

*Rituária*
:red_circle: Meta do dia 70%
:red_circle: Mercado Livre · LDR 11,0% (9 de 82 pedidos; meta 3,0%, teto 6,0%)

*Ápice*
:red_circle: Shopee · Tempo de preparação em 3,1 dias, fora da meta (máximo 2 dias da Shopee)
:warning: Meta do dia 73%

*Lescent*
:warning: Shopee · 1 ponto(s) de penalidade no trimestre

*Geral*
:warning: Mês abaixo do ritmo da meta (22% do esperado até ontem)"""


def _textos(m: sb.Mensagem) -> list[str]:
    return [b["text"]["text"] for b in m.blocos if b["type"] == "section" and "text" in b]


def test_snapshot_blocos_avancos_e_problemas_agrupados_por_marca():
    m = tr.montar_blocos(_exemplo())
    assert AVANCOS_ESPERADOS in _textos(m)
    assert PROBLEMAS_ESPERADOS in _textos(m)
    # resumo no topo (context logo apos o titulo) e divider entre Avancos e Problemas
    assert m.blocos[1] == sb.nota("*7 avanços · 12 problemas · 5 marcas*")
    tipos = [b["type"] for b in m.blocos]
    i = next(i for i, b in enumerate(m.blocos) if "Avanços" in b.get("text", {}).get("text", ""))
    assert tipos[i + 1] == "divider" and "Problemas" in m.blocos[i + 2]["text"]["text"]


def test_snapshot_do_texto_de_fallback_segue_o_mesmo_formato():
    texto = tr.montar_mensagem(_exemplo())
    assert AVANCOS_ESPERADOS.replace(":white_check_mark: *Avanços (7)*", "*:white_check_mark: Avanços (7)*") in texto
    assert PROBLEMAS_ESPERADOS.replace(":warning: *Problemas (12)*\n", "*:warning: Problemas (12)*") in texto
    assert "KOKESHI" not in texto and "ÁPICE" not in texto and "• Kokeshi:" in texto  # Title Case


def test_marcas_por_gravidade_e_vermelho_antes_de_amarelo():
    rep = _exemplo()
    grupos = tr._grupos_problemas(rep)
    assert [g.splitlines()[0] for g in grupos] == ["*Kokeshi*", "*Rituária*", "*Ápice*", "*Lescent*", "*Geral*"]
    for g in grupos:
        niveis = [l.split(" ")[0] for l in g.splitlines()[1:]]
        assert niveis == sorted(niveis, key=lambda n: n != tr.CRIT)
    # a marca nao se repete nas linhas
    assert not any("Kokeshi" in l for l in grupos[0].splitlines()[1:])


def test_avancos_uma_linha_por_marca_e_gerais_por_ultimo():
    linhas = tr._linhas_avancos(_exemplo())
    assert linhas[0] == "• *Barbours*: meta do dia 120% · +35% vs qua passada"
    marcas = [i for i, l in enumerate(linhas) if l.startswith("• *")]
    assert marcas == [0, 1, 2] and all(not l.startswith("• *") for l in linhas[3:])


def test_limites_do_slack_muitos_problemas_quebram_em_mais_sections():
    rep = _exemplo()
    for i in range(60):  # 60 problemas longos em cada uma das 5 marcas
        for marca in tr.MARCAS:
            rep.problemas.append(tr.Achado(marca, f"Shopee · métrica {i} " + "x" * 40, tr.ATEN if i % 2 else tr.CRIT))
    m = tr.montar_blocos(rep)
    secoes = _textos(m)
    assert all(len(s) <= sb.MAX_SECAO for s in secoes) and len(m.blocos) <= sb.MAX_BLOCOS
    prob = [s for s in secoes if "Problemas (" in s or s.startswith("*")]
    assert len(prob) > 1, "uma section so' nao comporta"
    todo = "\n".join(secoes)
    assert all(f"métrica {i} " in todo for i in range(60))  # nada se perdeu
    assert "(cont.)" in todo  # a marca que nao cabe numa section continua na seguinte, com o subtitulo
    assert all(f"*{tr.nome_marca(marca)}*" in todo for marca in tr.MARCAS)
    assert "Há mais itens" not in str(m.blocos)


def test_report_vazio_nao_tem_grupo_nem_contagem_de_marcas():
    m = tr.montar_blocos(tr.compor_report(_dados()))
    assert m.blocos[1] == sb.nota("*0 avanços · 0 problemas*")
    assert ":tada: Nenhum problema." in _textos(m)[-1]
