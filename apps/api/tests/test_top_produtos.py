"""Top produtos por marca (Gerencial): ranking por anuncio vendido entre canais,
totais da marca, comparacao, escopo e detalhe."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.services.gold_service import BRANDS_IN_SCOPE
from app.services.top_produtos_service import canais_do_filtro, eh_kit, get_detalhe, get_top_produtos


def _linha(marca, sku, nome, pecas, receita, total, ant=None, total_ant=None):
    return {"marca": marca, "sku": sku, "nome": nome, "pecas": pecas, "receita": receita,
            "pecas_ant": None, "receita_ant": ant, "receita_marca": total, "receita_marca_ant": total_ant}


def test_kit_pelo_nome():
    assert eh_kit("Kit Facial Kokeshi Completo 3 Passos")
    assert eh_kit("COMBO Body Splash")
    assert not eh_kit("Creme Gota de Colágeno - Kitsune")  # palavra inteira
    assert canais_do_filtro([3, 1]) == ["tiktok", "shopee"]


def test_ranqueia_entre_canais_e_soma_total_uma_vez_por_canal():
    por_canal = {
        "gold.fct_tiktok_product_daily": [
            _linha("kokeshi", "1735", "Kit Facial Kokeshi", Decimal("10"), Decimal("500"), Decimal("1000"), 400, 900),
            _linha("kokeshi", "1736", "Gota de Colágeno", 20, 300, 1000, None, 900),
        ],
        "silver.stg_ml_orders": [
            _linha("kokeshi", "KS03016", "Olhos de Gueixa", 5, 400, 600, 100, 100),
        ],
    }
    chamadas = []

    def consultar(sql, params):
        if "GROUP BY brand" in sql:  # resumo por canal da marca
            if "gmv_video" in sql:
                return [{"marca": "kokeshi", "video": 600, "live": 100, "card": 100}]
            return [{"marca": "kokeshi", "investimento": 50, "receita_ads": 200, "ads_ate": "2026-11-04"}]
        chamadas.append(params)
        return next(v for k, v in por_canal.items() if k in sql)

    r = get_top_produtos(consultar, date(2026, 11, 1), date(2026, 11, 5),
                         (date(2026, 10, 27), date(2026, 10, 31)), ["kokeshi", "denavita"], ["tiktok", "ml"])

    assert chamadas[0]["marcas"] == ["kokeshi"]  # fora do escopo da Torre nao entra
    assert chamadas[0]["de"] == date(2026, 10, 27)
    [k] = r.marcas
    assert k.receita_marca == 1600 and k.receita_marca_ant == 1000
    assert [(p.posicao, p.canal, p.sku) for p in k.produtos] == [
        (1, "tiktok", "1735"), (2, "ml", "KS03016"), (3, "tiktok", "1736")]
    top1 = k.produtos[0]
    assert top1.kit and top1.preco_medio == 50 and top1.share_marca == 500 / 1600 and top1.receita_ant == 400
    # Faixa por canal: receita do canal + o que cada um oferece.
    tt, ml = k.canais
    assert (tt.canal, tt.receita) == ("tiktok", 1000) and [e.valor for e in tt.extras] == [600, 100, 100]
    assert (ml.canal, ml.receita) == ("ml", 600) and ml.extras[-1].valor == 4.0
    assert ml.aviso_extras.startswith("Ads até 04/11")


def test_sem_comparacao_nao_devolve_anterior():
    def consultar(sql, params):
        assert params["ini_ant"] > params["fim_ant"]  # janela anterior vazia
        return [_linha("barbours", "BB1", "Body Splash", 1, 10, 10, 99, 99)]

    r = get_top_produtos(consultar, date(2026, 11, 1), date(2026, 11, 5), None, None, ["shopee"])
    assert r.marcas[0].produtos[0].receita_ant is None and r.marcas[0].receita_marca_ant is None


def test_sem_marca_no_escopo_nao_consulta():
    def consultar(sql, params):
        raise AssertionError("nao deveria consultar")

    assert get_top_produtos(consultar, date(2026, 11, 1), date(2026, 11, 5), None, ["denavita"], ["ml"]).marcas == []


def test_detalhe_serie_e_roas_do_ml():
    def consultar(sql, params):
        if "stg_ml_ads_items" in sql:
            return [{"investimento": Decimal("50"), "receita_ads": Decimal("200"), "ads_ate": date(2026, 11, 5)}]
        return [{"dia": "2026-11-01", "nome": "Kit Prebiotica", "pecas": 2, "receita": Decimal("100")},
                {"dia": date(2026, 11, 2), "nome": None, "pecas": 1, "receita": 50}]

    d = get_detalhe(consultar, "ml", "rituaria", "MLKIT", date(2026, 11, 1), date(2026, 11, 5))
    assert d.kit and d.produto == "Kit Prebiotica"
    assert [p.dia for p in d.serie] == [date(2026, 11, 1), date(2026, 11, 2)]
    assert [(e.rotulo, e.valor) for e in d.extras][-1] == ("ROAS", 4.0)
    assert d.aviso_extras is None


def test_ads_do_ml_que_nao_chegaram_nao_viram_zero():
    def consultar(ads_ate):
        def c(sql, params):
            if "stg_ml_ads_items" in sql:
                return [{"investimento": 0, "receita_ads": 0, "ads_ate": ads_ate}]
            return [{"dia": "2026-11-06", "nome": "Kit110", "pecas": 39, "receita": 4733}]
        return c

    # Periodo = hoje; ultimo dia com ads = ontem -> sem ads, com aviso.
    hoje = get_detalhe(consultar("2026-11-05"), "ml", "barbours", "Kit110", date(2026, 11, 6), date(2026, 11, 6))
    assert hoje.extras == [] and "dia seguinte" in hoje.aviso_extras
    # Mes ate hoje: ads ate ontem -> mostra, avisando ate quando.
    mes = get_detalhe(consultar("2026-11-05"), "ml", "barbours", "Kit110", date(2026, 11, 1), date(2026, 11, 6))
    assert len(mes.extras) == 2 and mes.aviso_extras.startswith("Ads até 05/11")


def test_detalhe_sem_venda_e_none():
    assert get_detalhe(lambda s, p: [], "shopee", "apice", "X", date(2026, 11, 1), date(2026, 11, 5)) is None


# ---------------------------------------------------------------------------
# COMPARAR-CANAIS — o mesmo produto em cada canal, pela fatia da marca
# ---------------------------------------------------------------------------
from app.services.top_produtos_service import get_comparar_canais, montar_comparacao, normalizar_sku  # noqa: E402


def _l(marca, sku, chave, nome, receita):
    return {"marca": marca, "sku": sku, "chave": chave, "nome": nome, "receita": receita}


def test_sku_normalizado_casa_lescent_e_kits():
    assert normalizar_sku("V10008") == normalizar_sku("10008") == "10008"
    assert normalizar_sku("kit-130") == normalizar_sku("KIT130") == "KIT130"
    assert normalizar_sku("VELA01") == "VELA01"  # 'V' so' sai antes de numero
    assert normalizar_sku("") is None and normalizar_sku(None) is None


def test_fatia_por_canal_apelidos_do_tiktok_e_canal_sem_venda():
    linhas = {
        "ml": [_l("kokeshi", "20002", "20002", "Kit Facial", 150), _l("kokeshi", "KS999", "KS999", "Sérum", 850)],
        "tiktok": [_l("kokeshi", "KS03043", "P1", "Kit Facial TT", 20), _l("kokeshi", "KS999", "P2", "Sérum TT", 980)],
        "shopee": [],
    }
    # O TikTok liga o codigo antigo (20002) ao novo (KS03043) no mesmo product_id.
    apelidos = [{"produto": "P1", "sku": "KS03043"}, {"produto": "P1", "sku": "20002"}]
    [m] = montar_comparacao(linhas, apelidos, ["kokeshi"])
    assert [c.canal for c in m.canais] == ["tiktok", "ml"]  # Shopee sem venda: sem coluna
    kit = next(p for p in m.produtos if p.chave == "20002")
    fatias = {c.canal: c.fatia for c in kit.celulas}
    assert fatias["ml"] == 0.15 and fatias["tiktok"] == 0.02
    assert {c.canal: c.sku for c in kit.celulas} == {"tiktok": "P1", "ml": "20002"}  # chave do detalhe


def test_produto_so_num_canal_nao_tem_celula_no_outro_nunca_zero():
    linhas = {"ml": [_l("barbours", "KIT122", "KIT122", "Kit 122", 100), _l("barbours", "A1", "A1", "Body", 900)],
              "shopee": [_l("barbours", "A1", "i9", "Body", 1000)], "tiktok": []}
    [m] = montar_comparacao(linhas, [], ["barbours"])
    kit = next(p for p in m.produtos if p.chave == "KIT122")
    assert [c.canal for c in kit.celulas] == ["ml"]


def test_ordem_pela_maior_fatia_e_empate_pela_soma():
    linhas = {
        "ml": [_l("lescent", "A", "A", "A", 30), _l("lescent", "B", "B", "B", 30), _l("lescent", "C", "C", "C", 40)],
        "shopee": [_l("lescent", "A", "A", "A", 10), _l("lescent", "B", "B", "B", 50), _l("lescent", "C", "C", "C", 40)],
        "tiktok": [],
    }
    [m] = montar_comparacao(linhas, [], ["lescent"])
    # B: max 0,5 (Shopee). C: max 0,4, soma 0,8. A: max 0,3. Nunca pela soma primeiro.
    assert [p.chave for p in m.produtos] == ["B", "C", "A"]


def test_sem_seller_sku_fica_fora_e_baixa_a_cobertura():
    linhas = {"ml": [_l("rituaria", None, "MLB1", "Sem SKU", 200), _l("rituaria", "R1", "R1", "Sérum", 800)],
              "shopee": [], "tiktok": []}
    [m] = montar_comparacao(linhas, [], ["rituaria"])
    assert m.canais[0].cobertura == 0.8
    assert [p.chave for p in m.produtos] == ["R1"]


def test_rota_periodo_numa_consulta_so_e_pares_com_parametros_fixos_no_dia():
    """Em producao cada consulta entra na fila do Metabase: os 3 canais vao numa
    so'; os pares do TikTok nao dependem do periodo nem da marca (cache comum)."""
    vistos = []

    def consultar(sql, params):
        vistos.append((sql, params))
        if "parte" not in sql:  # pares product_id <-> seller SKU
            assert params == {"marcas": list(BRANDS_IN_SCOPE), "desde": date(2026, 5, 13)}  # hoje - 180 dias
            return [{"produto": "P1", "sku": "20002"}, {"produto": "P1", "sku": "KS03043"},
                    {"produto": "P2", "sku": "40100"}]
        return [
            {"parte": "ml", "marca": "kokeshi", "sku": "KS03043", "chave": "KS03043", "nome": "Gota ML", "receita": 10.0},
            {"parte": "ml", "marca": "kokeshi", "sku": "40100", "chave": "40100", "nome": "Kit", "receita": 90.0},
            # TikTok pelo gold: por produto, sem seller SKU
            {"parte": "tiktok", "marca": "kokeshi", "sku": None, "chave": "P1", "nome": "Gota", "receita": 50.0},
            {"parte": "tiktok", "marca": "kokeshi", "sku": None, "chave": "P2", "nome": "Kit", "receita": 40.0},
            {"parte": "tiktok", "marca": "kokeshi", "sku": None, "chave": "P9", "nome": "Sem par", "receita": 10.0},
        ]

    [m] = get_comparar_canais(consultar, date(2026, 10, 10), date(2026, 11, 8), ["kokeshi"], hoje=date(2026, 11, 9)).marcas
    periodo = [sql for sql, _ in vistos if "parte" in sql]
    assert len(vistos) == 2 and len(periodo) == 1 and periodo[0].count("UNION ALL") == 2
    assert "gold.fct_tiktok_product_daily" in periodo[0] and "stg_tiktok_orders" not in periodo[0]
    gota = next(p for p in m.produtos if p.produto == "Gota")
    assert {c.canal: (c.fatia, c.sku) for c in gota.celulas} == {"tiktok": (0.5, "P1"), "ml": (0.1, "KS03043")}
    assert [c.canal for c in m.canais] == ["tiktok", "ml"]  # Shopee sem venda: sem coluna
    assert {c.canal: c.cobertura for c in m.canais}["tiktok"] == 0.9  # produto sem par so' entra na cobertura
    assert get_comparar_canais(consultar, date(2026, 10, 10), date(2026, 11, 8), ["fora"]).marcas == []
