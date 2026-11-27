"""BLACK-HORA — acompanhamento da Black Friday (27/11) hora a hora.

Meta: planilha 'Meta diária Marketplace — nov/26 (validação)', aba 'Meta hora
Black' (bloco com cabeçalho "Hora": linhas 00h..23h, uma coluna por marca ×
canal; "Total ..." e "Acumulado" são calculados aqui, não lidos). Lida com a
mesma service account da curva ABC (`GOOGLE_SA_JSON_ABC`, readonly), cache de
10 min; a leitura falhando devolve a última meta lida, ou `meta.disponivel =
False` com o motivo (a tela segue com o realizado, sem inventar meta).

Realizado: `marts.fact_marketplace_hourly_sales` (o mesmo do Hoje por hora),
só ML e Shopee (a meta não tem TikTok), só as marca × canal que a meta tem
(sem isso o realizado teria marcas que a meta não cobre). Cada canal corta na
sua última hora fechada: hora sem dado fechado volta `None`, nunca 0.
A hora em andamento vem à parte em `realizado_parcial`, com `parcial[canal] =
{hora, ate, fracao}`. A tabela por hora só recebe hora inteira (a hora do corte
fica vazia mesmo com `fonte_ate` dentro dela); o que já entrou nela está na fato
DIÁRIA, a mesma do GMV de hoje da Gerencial. Então parcial = diária de hoje −
horas fechadas (por marca × canal) e `ate` = a carga da diária (`ingested_at`):
fechado + parcial = o GMV de hoje da Gerencial (Shopee + ML). Em dia fechado,
as duas fatos batem ao centavo (conferido em 25 e 26/11).
"""
from __future__ import annotations

import re
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as EsperaEsgotada
from datetime import date, datetime, timedelta
from typing import Callable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.deps.period import APP_TIMEZONE
from app.services import full_curva_abc_service as abc
from app.services.hoje_por_hora_service import FONTES, TABELA, hora_fechada_do_canal

DIARIA = "marts.fact_marketplace_daily_performance"

# ---------------------------------------------------------------------------
# HOJE direto do Data Mart (só a /black): ~20-25 min à frente da Torre. As
# MESMAS regras de `pipelines/sync_vendas_por_hora.py` (quem grava a
# fact_marketplace_hourly_sales), só para o dia de hoje e só ML + Shopee:
#   ML      api.ml_orders, status = 'paid', GMV = total_amount; date_created
#           está em UTC-4: +1 h antes de tirar a hora (BRT).
#   Shopee  silver.stg_shopee_orders + _order_items, fora cancelled e unpaid,
#           GMV = soma de item_total, hora = create_time em BRT.
#   Corte   ML = pedido mais recente (+1 h); Shopee = última carga
#           (max ingested_at) − 10 min (FOLGA_SHOPEE do pipeline).
# UMA consulta para os dois canais, cache de 2,5 min. Falha ou > 15 s: a Torre.
# ---------------------------------------------------------------------------

#: Marcas de cada canal: as do pipeline (BRANDS_IN_SCOPE do ML e CONTAS_API da Shopee).
DM_MARCAS_ML = ["barbours", "kokeshi", "lescent", "rituaria"]
DM_MARCAS_SHOPEE = ["apice", "barbours", "kokeshi", "lescent", "rituaria"]
FOLGA_SHOPEE = timedelta(minutes=10)
DM_CACHE_S = 150.0
DM_ESPERA_S = 15.0

SQL_HOJE_DM = """
WITH ml AS (
    SELECT 'ml' AS canal, brand,
           extract(hour FROM date_created + interval '1 hour')::int AS hora,
           SUM(total_amount) AS gmv
    FROM api.ml_orders
    WHERE status = 'paid'
      AND brand = ANY(:marcas_ml)
      AND date_created >= CAST(:inicio AS timestamp) - interval '1 hour'
      AND date_created <  CAST(:fim AS timestamp) - interval '1 hour'
    GROUP BY 2, 3
),
o AS (
    SELECT order_sn, brand, create_time AT TIME ZONE 'America/Sao_Paulo' AS criado_brt
    FROM silver.stg_shopee_orders
    WHERE brand = ANY(:marcas_shopee)
      AND create_time >= CAST(:inicio AS timestamp) AT TIME ZONE 'America/Sao_Paulo'
      AND create_time <  CAST(:fim AS timestamp) AT TIME ZONE 'America/Sao_Paulo'
      AND lower(order_status) NOT IN ('cancelled', 'unpaid')
),
i AS (
    SELECT order_sn, SUM(item_total) AS total
    FROM silver.stg_shopee_order_items
    WHERE order_sn IN (SELECT order_sn FROM o)
    GROUP BY 1
),
sh AS (
    SELECT 'shopee' AS canal, o.brand, extract(hour FROM o.criado_brt)::int AS hora,
           COALESCE(SUM(i.total), 0) AS gmv
    FROM o LEFT JOIN i USING (order_sn)
    GROUP BY 2, 3
),
f AS (
    SELECT (SELECT max(date_created) + interval '1 hour' FROM api.ml_orders
             WHERE brand = ANY(:marcas_ml)
               AND date_created >= CAST(:inicio AS timestamp) - interval '1 hour') AS ml_fonte_at,
           (SELECT max(ingested_at) FROM silver.stg_shopee_orders
             WHERE brand = ANY(:marcas_shopee)) AS shopee_fonte_at
)
SELECT d.canal, d.brand, d.hora, d.gmv, f.ml_fonte_at, f.shopee_fonte_at
FROM f LEFT JOIN (SELECT * FROM ml UNION ALL SELECT * FROM sh) d ON true
"""


def _brt(momento, folga: timedelta = timedelta(0)) -> Optional[datetime]:
    """Como `para_brt` do pipeline: sem fuso = já em BRT; com fuso = convertido. Menos a folga."""
    if momento is None:
        return None
    if isinstance(momento, str):
        momento = datetime.fromisoformat(momento.replace("Z", "+00:00"))
    if momento.tzinfo is None:
        momento = momento.replace(tzinfo=APP_TIMEZONE)
    return momento.astimezone(APP_TIMEZONE) - folga


def ler_hoje_datamart(dia: date, consultar: Optional[Callable] = None) -> tuple[dict, dict]:
    """({(marca, canal): [24 GMV]}, {canal: fonte_ate BRT}). Levanta se a fonte não respondeu."""
    if consultar is None:
        from app.services import datamart_leitura

        def consultar(sql, params):
            return datamart_leitura.consultar(sql, params, timeout_metabase=DM_ESPERA_S, ttl_s=DM_CACHE_S)
    linhas = consultar(SQL_HOJE_DM, {"inicio": dia, "fim": dia + timedelta(days=1),
                                     "marcas_ml": DM_MARCAS_ML, "marcas_shopee": DM_MARCAS_SHOPEE})
    if not linhas:
        raise RuntimeError("Data Mart sem resposta")
    fontes = {"ml": _brt(linhas[0].get("ml_fonte_at")),
              "shopee": _brt(linhas[0].get("shopee_fonte_at"), FOLGA_SHOPEE)}
    real: dict[tuple[str, str], list[float]] = {}
    for x in linhas:
        if x.get("canal") is None or x.get("hora") is None or not 0 <= int(x["hora"]) < 24:
            continue
        real.setdefault((_norm(x["brand"]), x["canal"]), [0.0] * 24)[int(x["hora"])] += float(x["gmv"] or 0)
    return real, fontes


_dm_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="black-dm")


def hoje_do_datamart(dia: date, ler: Callable = ler_hoje_datamart, espera_s: float = DM_ESPERA_S):
    """A leitura do Data Mart com teto de espera; None = falhou ou demorou (a tela cai para a Torre).
    Quem demorou segue em segundo plano e deixa o cache quente para a próxima chamada."""
    try:
        return _dm_pool.submit(ler, dia).result(timeout=espera_s)
    except EsperaEsgotada:
        return None
    except Exception:  # noqa: BLE001 — qualquer falha do Data Mart: a Torre responde
        import logging
        logging.getLogger(__name__).warning("black-hora: Data Mart falhou; usando a Torre", exc_info=True)
        return None

PLANILHA_ID = "1LHKwXuSzZqjPV6tCtuF-WEAZWOL0s5A2E-Fxe4TMKEw"
ABA = "Meta hora Black"
FONTE = "Planilha 'Meta diária Marketplace — nov/26', aba 'Meta hora Black'"
CACHE_SEGUNDOS = 600
RETENTAR_SEGUNDOS = 60

CANAIS = {"shopee": 3, "meli": 2}
NOME_CANAL = {"shopee": "shopee", "meli": "ml"}

MOTIVO_SEM_CREDENCIAL = "Meta indisponível agora: credencial da planilha não configurada."
MOTIVO_LEITURA = "Meta indisponível agora: a planilha não respondeu (confira se está compartilhada com a conta de serviço)."
MOTIVO_FORMATO = "Meta indisponível agora: a aba 'Meta hora Black' mudou de formato."


class FormatoInesperado(Exception):
    pass


def _norm(v: object) -> str:
    s = unicodedata.normalize("NFKD", str(v or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]", "", s).strip()


def _reais(v: object) -> Optional[float]:
    """'R$ 9.275' / 'R$ 9.275,50' -> 9275.0 / 9275.5. Vazio = None (nunca 0)."""
    s = str(v or "").replace("R$", "").replace(" ", "").strip()
    if not s:
        return None
    try:
        return float(s.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def interpretar(valores: list[list[str]]) -> list[dict]:
    """O bloco "Hora": [{marca, canal, meta_dia, meta_hora[24]}] para cada coluna 'Marca Canal'."""
    i = next((n for n, l in enumerate(valores) if l and _norm(l[0]) == "hora"), None)
    if i is None:
        raise FormatoInesperado("sem a linha de cabecalho 'Hora'")
    cab = valores[i]
    colunas: list[tuple[int, str, str]] = []
    for j, nome in enumerate(cab[1:], start=1):
        partes = _norm(nome).split()
        if len(partes) == 2 and partes[0] != "total" and partes[1] in CANAIS:
            colunas.append((j, partes[0], NOME_CANAL[partes[1]]))
    if not colunas:
        raise FormatoInesperado("sem colunas 'Marca Shopee/Meli'")
    linhas = {c: {"marca": m, "canal": k, "meta_dia": None, "meta_hora": [None] * 24} for c, m, k in colunas}
    horas = 0
    for l in valores[i + 1:]:
        if not l:
            continue
        rot = _norm(l[0])
        if rot in ("total", "hora"):  # fim do bloco: a aba tem outros blocos "Hora" abaixo (base do 11/11)
            break
        hora = re.fullmatch(r"(\d{1,2})h", rot)
        if rot == "meta do dia":
            for c in linhas:
                linhas[c]["meta_dia"] = _reais(l[c]) if c < len(l) else None
        elif hora and int(hora.group(1)) < 24:
            horas += 1
            for c in linhas:
                linhas[c]["meta_hora"][int(hora.group(1))] = _reais(l[c]) if c < len(l) else None
    if horas != 24:
        raise FormatoInesperado(f"{horas} linhas de hora (esperadas 24)")
    for x in linhas.values():
        # Sem a linha "Meta do dia": a soma das horas (mesma conta da planilha).
        if x["meta_dia"] is None:
            x["meta_dia"] = round(sum(v or 0 for v in x["meta_hora"]), 2)
    return list(linhas.values())


_cache: dict = {"meta": None, "lida_em": None, "em_s": 0.0, "motivo": None}
_trava = threading.Lock()


def obter_meta(*, ler: Optional[Callable[[], list[list[str]]]] = None,
               relogio: Callable[[], float] = time.monotonic, cache: dict = _cache) -> tuple[Optional[list[dict]], Optional[str], Optional[str]]:
    """(meta, motivo, lida_em). Cache de 10 min; falha devolve a última meta boa."""
    if ler is None:
        sa = abc._credencial()
        if sa is None:
            return cache["meta"], (None if cache["meta"] else MOTIVO_SEM_CREDENCIAL), cache["lida_em"]
        ler = lambda: abc.ler_aba(sa, aba=ABA, planilha=PLANILHA_ID, faixa="A1:Z80")  # noqa: E731
    with _trava:
        validade = CACHE_SEGUNDOS if cache["meta"] is not None else RETENTAR_SEGUNDOS
        if cache["em_s"] and relogio() - cache["em_s"] < validade:
            return cache["meta"], cache["motivo"], cache["lida_em"]
        try:
            cache["meta"], cache["motivo"] = interpretar(ler()), None
            cache["lida_em"] = datetime.now(APP_TIMEZONE).isoformat()
        except FormatoInesperado:
            cache["motivo"] = MOTIVO_FORMATO
        except Exception:  # noqa: BLE001 — rede/credencial: a tela segue sem meta
            cache["motivo"] = MOTIVO_LEITURA
        cache["em_s"] = relogio()
        return cache["meta"], (None if cache["meta"] else cache["motivo"]), cache["lida_em"]


def corte_do_dia(fonte_ate: Optional[datetime], dia: date, agora: datetime) -> int:
    """Horas fechadas do canal NAQUELE dia (0..24), nunca além do relógio."""
    local = agora.astimezone(APP_TIMEZONE)
    if dia > local.date():
        return 0
    teto = local.hour if dia == local.date() else 24
    return min(hora_fechada_do_canal(fonte_ate, dia), teto)


def parcial_do_canal(ate: Optional[datetime], corte: int, dia: date) -> Optional[dict]:
    """A hora em andamento do canal: {hora, ate, fracao} (tempo de `ate` dentro da hora do corte ÷ 60 min, 0..1).
    `ate` = carga da fato diária. None quando ela é de outro dia, mais velha que o corte, ou o dia fechou."""
    if ate is None or corte >= 24:
        return None
    local = ate.astimezone(APP_TIMEZONE)
    if local.date() != dia or local.hour < corte:
        return None
    fracao = (local - local.replace(hour=corte, minute=0, second=0, microsecond=0)).total_seconds() / 3600
    return {"hora": corte, "ate": local.isoformat(), "fracao": round(min(max(fracao, 0.0), 1.0), 4)}


def get_black_hora(db: Session, dia: Optional[date] = None, agora: Optional[datetime] = None,
                   obter: Callable = obter_meta, datamart: Optional[Callable] | str = "padrao") -> dict:
    """`datamart`: leitor de HOJE no Data Mart (None = só a Torre). Dia passado: sempre a Torre."""
    if datamart == "padrao":
        datamart = hoje_do_datamart
    agora = (agora or datetime.now(APP_TIMEZONE)).astimezone(APP_TIMEZONE)
    dia = dia or agora.date()
    meta, motivo_meta, lida_em = obter()
    base = {"dia": dia.isoformat(), "meta": {"disponivel": meta is not None, "motivo": motivo_meta,
                                             "fonte": FONTE, "lida_em": lida_em}}
    existe = db.execute(text("SELECT to_regclass(:t) IS NOT NULL AND to_regclass(:f) IS NOT NULL"),
                        {"t": TABELA, "f": FONTES}).scalar()
    if not existe:
        return {**base, "disponivel": False, "motivo": "As vendas por hora ainda não estão publicadas no banco.",
                "cortes": {}, "parcial": {}, "linhas": []}
    ids = list(CANAIS.values())
    fontes = {r[0]: r[1] for r in db.execute(
        text(f"SELECT marketplace_id, fonte_ate FROM {FONTES} WHERE marketplace_id = ANY(:m)"), {"m": ids})}
    cortes = {NOME_CANAL[k]: corte_do_dia(fontes.get(m), dia, agora) for k, m in CANAIS.items()}
    por_id = {m: NOME_CANAL[k] for k, m in CANAIS.items()}
    vendas = db.execute(text(f"""
        SELECT l.brand_key AS brand, h.marketplace_id, h.hora, SUM(h.gmv) AS gmv
        FROM {TABELA} h
        JOIN marts.dim_loja l ON l.loja_id = h.loja_id
        WHERE h.dia = :dia AND h.marketplace_id = ANY(:m)
        GROUP BY 1, 2, 3
    """), {"dia": dia, "m": ids}).mappings().all()
    # O que já entrou hoje (inclui a hora em andamento): fato diária, a mesma do GMV da Gerencial.
    diaria = db.execute(text(f"""
        SELECT l.brand_key AS brand, f.marketplace_id, SUM(f.gmv) AS gmv, MAX(f.ingested_at) AS ate
        FROM {DIARIA} f
        JOIN marts.dim_loja l ON l.loja_id = f.loja_id
        WHERE f.date = :dia AND f.marketplace_id = ANY(:m)
        GROUP BY 1, 2
    """), {"dia": dia, "m": ids}).mappings().all()
    dia_total: dict[tuple[str, str], float] = {}
    ate: dict[str, datetime] = {}
    for r in diaria:
        canal = por_id.get(r["marketplace_id"])
        if canal is None:
            continue
        chave = (_norm(r["brand"]), canal)
        dia_total[chave] = dia_total.get(chave, 0.0) + float(r["gmv"] or 0)
        if r["ate"] is not None and (canal not in ate or r["ate"] > ate[canal]):
            ate[canal] = r["ate"]
    parcial = {c: parcial_do_canal(ate.get(c), cortes[c], dia) for c in cortes}
    real: dict[tuple[str, str], list[float]] = {}
    for r in vendas:
        canal = por_id.get(r["marketplace_id"])
        if canal is None or r["hora"] is None or not 0 <= int(r["hora"]) < 24:
            continue
        real.setdefault((_norm(r["brand"]), canal), [0.0] * 24)[int(r["hora"])] += float(r["gmv"] or 0)

    # Hora em andamento: diária de hoje − horas fechadas (nunca negativo).
    parcial_valor = {k: max(v - sum(real.get(k, [0.0] * 24)[:cortes[k[1]]]), 0.0) for k, v in dia_total.items()}
    fonte = None
    dm = datamart(dia) if datamart is not None and dia == agora.date() else None
    if dm is not None:
        real, fontes_dm = dm
        cortes = {c: corte_do_dia(fontes_dm.get(c), dia, agora) for c in cortes}
        # Hora em andamento = o que o Data Mart já tem do corte em diante; `ate` = o corte da fonte.
        parcial = {c: parcial_do_canal(fontes_dm.get(c), cortes[c], dia) for c in cortes}
        parcial_valor = {k: sum(v[cortes[k[1]]:]) for k, v in real.items()}
        fonte = "datamart"
    elif datamart is not None and dia == agora.date():
        fonte = "torre"  # o Data Mart falhou ou demorou: a tela mostra o selo

    # As marca × canal da meta; sem meta lida, as que venderam no dia (só o realizado).
    pares = [(x["marca"], x["canal"]) for x in meta] if meta else sorted(real)
    por_par = {(x["marca"], x["canal"]): x for x in meta or []}
    linhas = []
    for marca, canal in pares:
        r = real.get((marca, canal), [0.0] * 24)
        m = por_par.get((marca, canal))
        linhas.append({
            "marca": marca, "canal": canal,
            "meta_dia": m["meta_dia"] if m else None,
            "meta_hora": m["meta_hora"] if m else [None] * 24,
            # Hora ainda não fechada no canal: None (nunca 0).
            "realizado_hora": [round(v, 2) if h < cortes[canal] else None for h, v in enumerate(r)],
            # Hora em andamento (Torre: diária − horas fechadas; Data Mart: do corte em diante). None sem parcial.
            "realizado_parcial": round(parcial_valor.get((marca, canal), 0.0), 2) if parcial[canal] else None,
        })
    return {**base, "disponivel": True, "motivo": None, "cortes": cortes, "parcial": parcial, "linhas": linhas,
            # "datamart" = hoje direto do Data Mart; "torre" = ele falhou (selo); None = dia passado (Torre, normal).
            "fonte": fonte}
