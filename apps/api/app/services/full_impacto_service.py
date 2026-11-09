"""Impacto POTENCIAL da ruptura no Full — FULL-IMPACTO-1. ESTRITAMENTE READ-ONLY.

Regra (levantada e provada no banco em 08/11/2026):
    perda/dia do item em ruptura = venda media diaria de 28d x preco medio do item

    ML      media: `media_diaria_28d` da fato de inventario (029)
            preco: sum(paid_gmv)/sum(paid_units) do anuncio-ancora em
                   `fact_ml_fulfillment_listing_daily`, 30 dias, todos os tipos
                   de envio. Sem venda na janela: `advertised_price` da 014
                   (fallback, contado a' parte).
    Shopee  media: `avg_daily_units_28d` da fato de estoque FBS
            preco: `avg_price` MENSAL por SKU de `fact_shopee_product_monthly`
                   (o mes mais recente ate' a foto). E' a media do mes.

Denominador (% do GMV Full): GMV/dia dos 28 dias completos antes da foto,
`fulfillment_class = 'full'` (ML) e `fbs_class = 'fbs'`, `gross_gmv` (Shopee).

SERVICE PROPRIO, E NAO DENTRO DOS DE ESTOQUE
---------------------------------------------
`ml_full_stock_service` e `shopee_fbs_stock_service` sao pinados por teste a
ler SO' as suas fatos (nada de `ml_fulfillment`, um JOIN so'). O impacto
cruza estoque com venda e preco; mora aqui para nao afrouxar aquelas guardas.

AUSENCIA NUNCA E' ZERO
-----------------------
Flag do estoque desligada ou tabela faltando -> canal `unavailable` com motivo.
Item sem preco -> `perda_dia = None`, fora da soma, contado em `sem_preco`.
GMV com menos de 28 dias na janela -> % `None` com motivo.
R$ NUNCA e' somado entre canais: datas de foto e graos diferentes.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import ml_full_stock_service as ml_stock_svc
from app.services import shopee_fbs_stock_service as fbs_stock_svc

ML_LISTING_SALES_TABLE = "marts.fact_ml_fulfillment_listing_daily"
ML_GMV_TABLE = "marts.fact_ml_fulfillment_daily"
SHOPEE_PRICE_TABLE = "marts.fact_shopee_product_monthly"
SHOPEE_GMV_TABLE = "marts.fact_shopee_fbs_daily"

JANELA_GMV_DIAS = 28
JANELA_PRECO_ML_DIAS = 30

MOTIVO_FLAG_ML = "Estoque Full do Mercado Livre desligado neste ambiente."
MOTIVO_FLAG_SHOPEE = "Estoque Full da Shopee desligado neste ambiente."
MOTIVO_TABELA = "Fonte de estoque, venda ou preço ainda não existe neste ambiente."
MOTIVO_SEM_FOTO = "Nenhuma foto de estoque publicada ainda."
MOTIVO_SEM_ANCORA = (
    "Sem anúncio-âncora por inventário (migration 038) ou sem a tabela de "
    "preços: não há como achar o preço do item.")
#: API-4 -- por que nao ha' "antes" (o front nao mostra delta).
MOTIVO_SEM_FOTO_ANTERIOR = "Sem foto anterior publicada."
MOTIVO_RECORTE_DIFERENTE = (
    "A foto anterior tem outro recorte (marcas ou contas diferentes): "
    "comparar daria variação falsa.")

MOTIVO_GMV_INCOMPLETO = (
    f"GMV Full com menos de {JANELA_GMV_DIAS} dias na janela: o % ficaria inflado.")

LIMITACOES = [
    "Impacto POTENCIAL: venda média diária de 28 dias × preço médio do item. "
    "Não é perda medida.",
    "ML: preço de 30 dias do anúncio-âncora; sem venda no período, usa o preço "
    "anunciado. Anúncios do inventário fora do Full podem seguir vendendo.",
    "Shopee: preço é a média do mês (a fonte é mensal, por SKU). Item com "
    "estoque do vendedor pode seguir vendendo fora do Full.",
    "R$ não é somado entre canais: as fotos têm datas e grãos diferentes.",
]

# ---------------------------------------------------------------------------
# SQL — allowlist de colunas, parametros nomeados, so' leitura
# ---------------------------------------------------------------------------

SQL_SOMENTE_LEITURA = text(
    "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")

SQL_TABELAS_EXISTEM = text("""
    SELECT to_regclass(:a) IS NOT NULL AND to_regclass(:b) IS NOT NULL
       AND to_regclass(:c) IS NOT NULL AS existem
""")

SQL_ML_ULTIMA_FOTO = text(f"""
    SELECT MAX(ref_date) FROM {ml_stock_svc.INVENTORY_TABLE}
     WHERE brand = ANY(CAST(:brands AS text[]))
""")

#: Uma linha por inventario em ruptura. As duas CTEs tem UMA linha por
#: (marca, item): os LEFT JOIN nunca multiplicam inventario.
SQL_ML_RUPTURAS = text(f"""
    WITH vendas AS (
        SELECT brand, item_id,
               SUM(paid_gmv) / NULLIF(SUM(paid_units), 0) AS preco
          FROM {ML_LISTING_SALES_TABLE}
         WHERE brand = ANY(CAST(:brands AS text[]))
           AND ref_date >= CAST(:ref_date AS date) - {JANELA_PRECO_ML_DIAS}
           AND ref_date < :ref_date
         GROUP BY brand, item_id
    ), anuncio AS (
        SELECT DISTINCT ON (brand, item_id)
               brand, item_id, advertised_price, seller_sku, listing_title
          FROM {ml_stock_svc.PRICE_TABLE}
         WHERE marketplace = 'ml'
           AND brand = ANY(CAST(:brands AS text[]))
           AND ref_date <= :ref_date
         ORDER BY brand, item_id, ref_date DESC, seller_id
    )
    SELECT i.brand, i.media_diaria_28d AS media,
           a.seller_sku AS sku, a.listing_title AS titulo,
           v.preco AS preco_vendas, a.advertised_price AS preco_anuncio
      FROM {ml_stock_svc.INVENTORY_TABLE} i
      LEFT JOIN vendas v
        ON v.brand = i.brand AND v.item_id = i.anuncio_ancora_item_id
      LEFT JOIN anuncio a
        ON a.brand = i.brand AND a.item_id = i.anuncio_ancora_item_id
     WHERE i.ref_date = :ref_date
       AND i.brand = ANY(CAST(:brands AS text[]))
       AND i.classificacao_torre = 'RUPTURA_CANDIDATA'
""")

#: Janela do %: os 28 dias que TERMINAM no ultimo dia com faturamento Full
#: carregado, ate' a vespera da foto. O Data Mart chega com D-1: com a foto do
#: dia, a janela "28 dias antes da foto" ficava sem ontem e o % sumia toda
#: manha. Deslocar a janela nao infla: continuam 28 dias completos ou nada.
SQL_ML_GMV = text(f"""
    WITH fim AS (
        SELECT MAX(ref_date) AS d FROM {ML_GMV_TABLE}
         WHERE fulfillment_class = 'full'
           AND brand = ANY(CAST(:brands AS text[]))
           AND ref_date < :ref_date
    )
    SELECT brand, SUM(paid_gmv) AS gmv, COUNT(DISTINCT ref_date) AS dias, MAX(fim.d) AS fim
      FROM {ML_GMV_TABLE}, fim
     WHERE fulfillment_class = 'full'
       AND brand = ANY(CAST(:brands AS text[]))
       AND ref_date > fim.d - {JANELA_GMV_DIAS}
       AND ref_date <= fim.d
     GROUP BY brand
""")

SQL_SHOPEE_ULTIMA_FOTO = text(
    f"SELECT MAX(ref_date) FROM {fbs_stock_svc.FACT_TABLE}")

# API-4 -- foto ANTERIOR (a ultima antes da atual) e o recorte de cada foto.
# O "antes" so' existe com o MESMO recorte (marcas no ML, contas na Shopee):
# foto parcial dos dois lados daria variacao falsa.
SQL_ML_FOTO_ANTERIOR = text(f"""
    SELECT MAX(ref_date) FROM {ml_stock_svc.INVENTORY_TABLE}
     WHERE brand = ANY(CAST(:brands AS text[])) AND ref_date < :ref_date
""")
SQL_ML_RECORTE = text(f"""
    SELECT ARRAY_AGG(DISTINCT brand ORDER BY brand) FROM {ml_stock_svc.INVENTORY_TABLE}
     WHERE brand = ANY(CAST(:brands AS text[])) AND ref_date = :ref_date
""")
SQL_SHOPEE_FOTO_ANTERIOR = text(
    f"SELECT MAX(ref_date) FROM {fbs_stock_svc.FACT_TABLE} WHERE ref_date < :ref_date")
SQL_SHOPEE_RECORTE = text(f"""
    SELECT ARRAY_AGG(DISTINCT shop_account ORDER BY shop_account)
      FROM {fbs_stock_svc.FACT_TABLE} WHERE ref_date = :ref_date
""")

#: Preco mensal por (marca, SKU): o mes mais recente ate' a foto. AVG porque
#: a fonte pode ter mais de uma linha por SKU no mes (variacoes).
SQL_SHOPEE_RUPTURAS = text(f"""
    WITH preco AS (
        SELECT DISTINCT ON (brand, sku_ref) brand, sku_ref, ref_month, preco
          FROM (SELECT brand, sku_ref, ref_month, AVG(avg_price) AS preco
                  FROM {SHOPEE_PRICE_TABLE}
                 WHERE ref_month <= :ref_date
                 GROUP BY brand, sku_ref, ref_month) m
         WHERE preco IS NOT NULL
         ORDER BY brand, sku_ref, ref_month DESC
    )
    SELECT s.brand, s.item_sku AS sku, s.item_name AS titulo,
           s.avg_daily_units_28d AS media,
           s.seller_stock_total AS estoque_vendedor,
           p.preco, p.ref_month AS mes_preco
      FROM {fbs_stock_svc.FACT_TABLE} s
      LEFT JOIN preco p ON p.brand = s.brand AND p.sku_ref = s.item_sku
     WHERE s.ref_date = :ref_date
       AND s.classificacao_torre = 'RUPTURA_CANDIDATA'
""")

SQL_SHOPEE_GMV = text(f"""
    WITH fim AS (
        SELECT MAX(ref_date) AS d FROM {SHOPEE_GMV_TABLE}
         WHERE fbs_class = 'fbs' AND ref_date < :ref_date
    )
    SELECT brand, SUM(gross_gmv) AS gmv, COUNT(DISTINCT ref_date) AS dias, MAX(fim.d) AS fim
      FROM {SHOPEE_GMV_TABLE}, fim
     WHERE fbs_class = 'fbs'
       AND ref_date > fim.d - {JANELA_GMV_DIAS}
       AND ref_date <= fim.d
     GROUP BY brand
""")


# ---------------------------------------------------------------------------
# Contas
# ---------------------------------------------------------------------------

def _dec(v) -> Optional[Decimal]:
    return None if v is None else Decimal(str(v))


def _dinheiro(v: Optional[Decimal]) -> Optional[float]:
    return None if v is None else float(round(v, 2))


def _fracao(parte: Optional[Decimal], base: Optional[Decimal]) -> Optional[float]:
    if parte is None or base is None or base <= 0:
        return None
    return float(round(parte / base, 4))


def _soma(valores) -> Decimal:
    return sum((v for v in valores if v is not None), Decimal(0))


def _montar_canal(canal: str, ref: date, itens: list[dict],
                  gmv_rows: list[dict], fallback: int) -> dict:
    """Agrega por marca e no canal. `itens` ja' tem `perda_dia` (ou None)."""
    gmv = {r["brand"]: (_dec(r["gmv"]) or Decimal(0), int(r["dias"])) for r in gmv_rows}
    dias = max((d for _, d in gmv.values()), default=0)
    gmv_ok = dias >= JANELA_GMV_DIAS
    # Ultimo dia da janela do % (o mesmo para todas as marcas do canal); None = sem faturamento.
    fim = max((r["fim"] for r in gmv_rows if r.get("fim") is not None), default=None)

    def gmv_dia(total: Optional[Decimal]) -> Optional[Decimal]:
        return None if total is None or not gmv_ok else total / JANELA_GMV_DIAS

    por_marca: dict[str, list[dict]] = defaultdict(list)
    for i in itens:
        por_marca[i["brand"]].append(i)
    marcas = []
    for brand in sorted(set(por_marca) | set(gmv)):
        its = por_marca.get(brand, [])
        perda = _soma(i["perda_dia"] for i in its)
        sem_vend = (_soma(i["perda_dia"] for i in its if i.get("estoque_vendedor") == 0)
                    if canal == "shopee" else None)
        base = gmv_dia(gmv[brand][0]) if brand in gmv else None
        marcas.append({
            "brand": brand,
            "rupturas": len(its),
            "sem_preco": sum(1 for i in its if i["perda_dia"] is None),
            "perda_dia": _dinheiro(perda),
            "perda_dia_sem_vendedor": _dinheiro(sem_vend),
            "gmv_full_dia": _dinheiro(base),
            "pct_gmv_full": _fracao(perda, base),
            "pct_gmv_full_sem_vendedor": _fracao(sem_vend, base),
        })

    perda = _soma(i["perda_dia"] for i in itens)
    sem_vend = (_soma(i["perda_dia"] for i in itens if i.get("estoque_vendedor") == 0)
                if canal == "shopee" else None)
    base = gmv_dia(_soma(g for g, _ in gmv.values())) if gmv else None
    ordenados = sorted(itens, key=lambda i: (i["perda_dia"] is None, -(i["perda_dia"] or 0)))
    return {
        "canal": canal,
        "status": "ok",
        "ref_date": ref,
        "rupturas": len(itens),
        "sem_preco": sum(1 for i in itens if i["perda_dia"] is None),
        "preco_fallback": fallback,
        "sem_estoque_vendedor": (sum(1 for i in itens if i.get("estoque_vendedor") == 0)
                                 if canal == "shopee" else None),
        "perda_dia": _dinheiro(perda),
        "perda_dia_sem_vendedor": _dinheiro(sem_vend),
        "gmv_full_dia": _dinheiro(base),
        "dias_gmv": dias,
        "janela_gmv_inicio": fim - timedelta(days=JANELA_GMV_DIAS - 1) if fim else None,
        "janela_gmv_fim": fim,
        "pct_gmv_full": _fracao(perda, base),
        "pct_gmv_full_sem_vendedor": _fracao(sem_vend, base),
        "motivo_pct": None if gmv_ok else MOTIVO_GMV_INCOMPLETO,
        "marcas": marcas,
        "itens": [{**i, "perda_dia": _dinheiro(i["perda_dia"]),
                   "preco_medio": _dinheiro(i["preco_medio"])} for i in ordenados],
    }


def _ausente(canal: str, motivo: str) -> dict:
    return {"canal": canal, "status": "unavailable", "motivo": motivo}


def _ml(db: Session, com_anterior: bool = False) -> dict:
    tabelas = db.execute(SQL_TABELAS_EXISTEM, {
        "a": ml_stock_svc.INVENTORY_TABLE, "b": ML_LISTING_SALES_TABLE,
        "c": ML_GMV_TABLE}).scalar()
    if not tabelas:
        return _ausente("ml", MOTIVO_TABELA)
    if not ml_stock_svc.identificacao_disponivel(db):
        return _ausente("ml", MOTIVO_SEM_ANCORA)
    marcas = list(ml_stock_svc.EXPECTED_BRANDS)
    ref = db.execute(SQL_ML_ULTIMA_FOTO, {"brands": marcas}).scalar()
    if ref is None:
        return _ausente("ml", MOTIVO_SEM_FOTO)
    atual = _ml_na_foto(db, marcas, ref)
    if not com_anterior:
        return atual
    ant = db.execute(SQL_ML_FOTO_ANTERIOR, {"brands": marcas, "ref_date": ref}).scalar()
    return _com_anterior(db, atual, ant, SQL_ML_RECORTE, {"brands": marcas},
                         lambda d: _ml_na_foto(db, marcas, d))


def _ml_na_foto(db: Session, marcas: list[str], ref: date) -> dict:
    p = {"brands": marcas, "ref_date": ref}
    itens, fallback = [], 0
    for r in db.execute(SQL_ML_RUPTURAS, p).mappings().all():
        media, vendas, anuncio = _dec(r["media"]), _dec(r["preco_vendas"]), _dec(r["preco_anuncio"])
        preco = vendas if vendas is not None else anuncio
        if vendas is None and anuncio is not None:
            fallback += 1
        itens.append({
            "brand": r["brand"], "sku": r["sku"], "titulo": r["titulo"],
            "media_diaria_28d": float(media or 0), "preco_medio": preco,
            "fonte_preco": None if preco is None else ("vendas_30d" if vendas is not None else "anuncio"),
            "mes_preco": None, "estoque_vendedor": None,
            "perda_dia": None if preco is None or media is None else media * preco,
        })
    gmv = db.execute(SQL_ML_GMV, p).mappings().all()
    return _montar_canal("ml", ref, itens, gmv, fallback)


def _shopee(db: Session, com_anterior: bool = False) -> dict:
    tabelas = db.execute(SQL_TABELAS_EXISTEM, {
        "a": fbs_stock_svc.FACT_TABLE, "b": SHOPEE_PRICE_TABLE,
        "c": SHOPEE_GMV_TABLE}).scalar()
    if not tabelas:
        return _ausente("shopee", MOTIVO_TABELA)
    ref = db.execute(SQL_SHOPEE_ULTIMA_FOTO).scalar()
    if ref is None:
        return _ausente("shopee", MOTIVO_SEM_FOTO)
    atual = _shopee_na_foto(db, ref)
    if not com_anterior:
        return atual
    ant = db.execute(SQL_SHOPEE_FOTO_ANTERIOR, {"ref_date": ref}).scalar()
    return _com_anterior(db, atual, ant, SQL_SHOPEE_RECORTE, {},
                         lambda d: _shopee_na_foto(db, d))


def _shopee_na_foto(db: Session, ref: date) -> dict:
    p = {"ref_date": ref}
    itens = []
    for r in db.execute(SQL_SHOPEE_RUPTURAS, p).mappings().all():
        media, preco = _dec(r["media"]), _dec(r["preco"])
        itens.append({
            "brand": r["brand"], "sku": r["sku"], "titulo": r["titulo"],
            "media_diaria_28d": float(media or 0), "preco_medio": preco,
            "fonte_preco": None if preco is None else "mes",
            "mes_preco": r["mes_preco"],
            "estoque_vendedor": None if r["estoque_vendedor"] is None else int(r["estoque_vendedor"]),
            "perda_dia": None if preco is None or media is None else media * preco,
        })
    gmv = db.execute(SQL_SHOPEE_GMV, p).mappings().all()
    return _montar_canal("shopee", ref, itens, gmv, 0)


#: O que a foto anterior devolve: so' os totais do canal (o "antes" dos cartoes).
CAMPOS_ANTERIOR = ("ref_date", "rupturas", "sem_estoque_vendedor", "perda_dia",
                   "perda_dia_sem_vendedor", "dias_gmv", "pct_gmv_full",
                   "pct_gmv_full_sem_vendedor", "motivo_pct")


def _com_anterior(db: Session, atual: dict, ant: Optional[date], sql_recorte,
                  params: dict, calcular) -> dict:
    """Anexa a foto anterior ao canal, so' com o MESMO recorte; senao `None` + motivo."""
    if ant is None:
        return {**atual, "anterior": None, "motivo_anterior": MOTIVO_SEM_FOTO_ANTERIOR}
    recorte = lambda d: db.execute(sql_recorte, {**params, "ref_date": d}).scalar() or []
    if list(recorte(atual["ref_date"])) != list(recorte(ant)):
        return {**atual, "anterior": None, "motivo_anterior": MOTIVO_RECORTE_DIFERENTE}
    antes = calcular(ant)
    return {**atual, "anterior": {k: antes[k] for k in CAMPOS_ANTERIOR}, "motivo_anterior": None}


def get_impacto_ruptura(db: Session, *, ml_ligado: bool, shopee_ligado: bool,
                        com_anterior: bool = False) -> dict:
    """Bloco dos dois canais. Um canal ausente nao derruba o outro.

    `com_anterior` (API-4, `?anterior=true`): soma a foto anterior de cada
    canal. Opcional porque custa ~50% a mais na rota: a tela desenha com a
    chamada padrao e pede o "antes" depois, numa segunda chamada.
    """
    if ml_ligado or shopee_ligado:
        db.execute(SQL_SOMENTE_LEITURA)
    return {
        "ml": _ml(db, com_anterior) if ml_ligado else _ausente("ml", MOTIVO_FLAG_ML),
        "shopee": _shopee(db, com_anterior) if shopee_ligado else _ausente("shopee", MOTIVO_FLAG_SHOPEE),
        "janela_gmv_dias": JANELA_GMV_DIAS,
        "limitacoes": LIMITACOES,
    }

