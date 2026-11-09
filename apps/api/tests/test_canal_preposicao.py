"""Preposicao do canal nos textos da API: "na Shopee", nunca "no Shopee".

Par do `apps/web/tests/canal-preposicao.test.ts`. O genero vem do ID do canal
e vale para os dois esquemas de ID ("ml"/"mercadolivre", "tiktok"/"tiktokshop").
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from app.services import torre_alertas as ta
from app.services.canal_preposicao import do_canal, no_canal

SERVICOS = Path(__file__).resolve().parents[1] / "app" / "services"


def test_no_canal_e_do_canal_pelo_id_nos_dois_esquemas():
    assert no_canal("shopee", "Shopee") == "na Shopee"
    assert do_canal("shopee", "Shopee") == "da Shopee"
    for canal, rotulo in (("ml", "Mercado Livre"), ("mercadolivre", "Mercado Livre"),
                          ("tiktok", "TikTok Shop"), ("tiktokshop", "TikTok Shop")):
        assert no_canal(canal, rotulo) == f"no {rotulo}"
        assert do_canal(canal, rotulo) == f"do {rotulo}"


def test_torre_no_canal_continua_o_mesmo_texto():
    assert ta.NO_CANAL == {"shopee": "na Shopee", "mercadolivre": "no Mercado Livre",
                           "tiktokshop": "no TikTok Shop"}


def test_botao_da_fila_de_vencidos_com_a_preposicao_do_canal():
    agora = datetime(2026, 11, 5, 14, tzinfo=timezone.utc)
    for canal, esperado in (("shopee", "Ver fila da Shopee"), ("mercadolivre", "Ver fila do Mercado Livre"),
                            ("tiktokshop", "Ver fila do TikTok Shop")):
        v = ta.LeituraVencidos(canal, agora, [ta.VencidosMarca("barbours", 100, 1000)], False)
        m = ta.montar_mensagem_criticos([ta.Item(f"vencidos:{canal}:d:09", "V1", v)], agora)
        (sec,) = [b for b in m.blocos if b["type"] == "section"]
        assert sec["accessory"]["text"]["text"] == esperado


def test_nenhum_texto_monta_a_preposicao_fixa_antes_do_canal():
    fontes = {n: (SERVICOS / n).read_text(encoding="utf-8") for n in
              ("executive_summary_service.py", "torre_alertas.py", "alerta_vencidos.py")}
    assert " no {display}" not in fontes["executive_summary_service.py"]
    assert "Ver fila do {canal}" not in fontes["torre_alertas.py"]
    assert "Ver fila da {canal}" not in fontes["alerta_vencidos.py"]
