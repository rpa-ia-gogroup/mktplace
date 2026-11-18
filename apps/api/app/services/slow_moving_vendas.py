"""SLOW-MOVING-3 -- venda diaria por SKU Unico, por canal (ML, Shopee, TikTok; Full ou normal).

Mesma logica do dash Mix Marketplace (Nath), para os numeros baterem:
- pedidos: a "Base de Vendas Marketplace" (Metabase 19829) -- ML, Shopee e TikTok
  nas tabelas silver que a Torre ja' le';
- de-para (codigo do canal -> SKU Unico) e kits: planilha DreamBase (abas
  "Depara" e "Depara (kits)", exportacao publica em CSV), com a lista fixa de
  kits do dash dela (`data/mix_kits_base.json`) na frente, como no dash;
- brinde nao conta; kit vira N pecas de cada componente, receita rateada por peca.

O Supply Intelligence so' separa TikTok do resto; por isso o canal vem dos pedidos.
A consulta devolve UMA linha por (marca, codigo, envio) com os dias numa lista, uma
consulta por canal: o Metabase corta em 2.000 linhas, e uma linha por dia passaria disso.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import re
import time
import unicodedata
from datetime import date, timedelta
from pathlib import Path
from typing import Callable, Optional

import httpx

logger = logging.getLogger(__name__)

DREAMBASE_ID = "1bSEMw3fpo56DfCGoQiQwOW09FDXCrryh"
GID_DEPARA, GID_KITS = "1857478807", "360725636"
CACHE_S = 3600.0
DIAS = 60
#: Mesmo ajuste do dash: anuncio que ainda sai com o codigo velho do produto.
SKU_OVERRIDES = {"apice": {"20499": "20670"}, "rituaria": {"105031": "RT01038"}}
#: Canal + envio: ML/SP/TT e F (Full) ou N (normal).
CANAIS = ("ML-F", "ML-N", "SP-F", "SP-N", "TT-F", "TT-N")

_BASE = {
    "ML": """
  SELECT o.date_created::date AS dia, i.brand AS marca, i.seller_sku AS sku,
         CASE WHEN s.logistic_type = 'fulfillment' THEN 'F' ELSE 'N' END AS envio,
         i.quantity AS q, i.unit_price * i.quantity AS r
    FROM silver.stg_ml_order_items i
    JOIN silver.stg_ml_orders o ON o.order_id = i.order_id
    LEFT JOIN (SELECT DISTINCT ON (order_id) order_id, logistic_type
                 FROM silver.stg_ml_shipments ORDER BY order_id, updated_at DESC) s ON s.order_id = i.order_id
   WHERE o.status IN ('paid','partially_refunded') AND o.date_created::date BETWEEN :ini AND :fim""",
    "SP": """
  SELECT o.created_date_brt AS dia, i.brand AS marca, COALESCE(NULLIF(i.model_sku,''), i.item_sku) AS sku,
         CASE WHEN o.is_fbs THEN 'F' ELSE 'N' END AS envio,
         i.quantity AS q, i.discounted_price * i.quantity AS r
    FROM silver.stg_shopee_order_items i
    JOIN silver.stg_shopee_orders o ON o.order_sn = i.order_sn
   WHERE o.order_status NOT IN ('cancelled','unpaid','to_return') AND NOT COALESCE(i.is_freebie, FALSE)
     AND o.created_date_brt BETWEEN :ini AND :fim""",
    "TT": """
  SELECT o.created_at::date AS dia, i.brand AS marca, i.seller_sku AS sku,
         CASE WHEN o.fulfillment_type = 'FULFILLMENT_BY_TIKTOK' THEN 'F' ELSE 'N' END AS envio,
         1 AS q, i.sale_price + COALESCE(i.platform_discount, 0) AS r
    FROM silver.stg_tiktok_line_items i
    JOIN silver.stg_tiktok_orders o ON o.order_id = i.order_id
   WHERE o.order_status NOT IN ('CANCELLED','UNPAID') AND i.brand <> 'gocase' AND NOT COALESCE(i.is_gift, FALSE)
     AND o.created_at::date BETWEEN :ini AND :fim""",
}


def sql_canal(canal: str) -> str:
    return f"""
WITH v AS ({_BASE[canal]}
), a AS (
  SELECT dia, marca, sku, envio, SUM(q) AS q, SUM(r) AS r FROM v GROUP BY 1, 2, 3, 4
), d AS (
  SELECT generate_series(:ini, :fim, INTERVAL '1 day')::date AS dia
), k AS (
  SELECT DISTINCT marca, sku, envio FROM a
)
SELECT k.marca, k.sku, k.envio,
       array_to_string(array_agg(COALESCE(a.q, 0) ORDER BY d.dia), ',') AS q,
       array_to_string(array_agg(ROUND(COALESCE(a.r, 0)::numeric, 2) ORDER BY d.dia), ',') AS r
  FROM k CROSS JOIN d
  LEFT JOIN a ON a.marca = k.marca AND a.sku IS NOT DISTINCT FROM k.sku AND a.envio = k.envio AND a.dia = d.dia
 GROUP BY 1, 2, 3
"""


def ncode(c) -> str:
    """Igual ao dash: maiusculas, sem ".0" no fim, sem espaco / - ."""
    s = re.sub(r"\.0$", "", str(c if c is not None else "").strip().upper())
    return re.sub(r"[\s/\-.]", "", s)


def nbrand(s) -> str:
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z]", "", s)
    return {"barboursbeauty": "barbours"}.get(s, s)


def montar_lookups(depara_csv: str, kits_csv: str, base: dict) -> tuple[dict, dict]:
    """(depara[marca][codigo] = SKU Unico, kits[marca][kit] = {SKU Unico: pecas})."""
    depara: dict[str, dict[str, str]] = {}
    linhas = list(csv.reader(io.StringIO(depara_csv)))
    if linhas:
        hdr = [h.strip() for h in linhas[0]]
        cols = [i for i, h in enumerate(hdr) if h.startswith("SKU VENDAS") or h.startswith("SKU ESTOQUE")]
        for r in linhas[1:]:
            if len(r) < 2 or not r[0] or not ncode(r[1]):
                continue
            dm = depara.setdefault(nbrand(r[0]), {})
            for i in [1, *cols]:
                c = ncode(r[i]) if i < len(r) else ""
                if c and c not in dm:
                    dm[c] = ncode(r[1])

    def resolve(m: str, c) -> Optional[str]:
        c = ncode(c)
        return depara.get(m, {}).get(c) if c else None

    kits: dict[str, dict[str, dict[str, int]]] = {}
    for mb, kit, comp, ean in base.get("kitRows", []):
        m, k = nbrand(mb), ncode(kit)
        su = resolve(m, comp) or resolve(m, ean) or ncode(comp)
        e = kits.setdefault(m, {}).setdefault(k, {})
        e[su] = e.get(su, 0) + 1
    for r in list(csv.reader(io.StringIO(kits_csv)))[1:]:
        if len(r) < 2 or not r[0] or not ncode(r[1]):
            continue
        m, k = nbrand(r[0]), ncode(r[1])
        if k in kits.get(m, {}):
            continue
        comp: dict[str, int] = {}
        for c in r[3:13]:
            if c.strip():
                su = resolve(m, c) or ncode(c)
                comp[su] = comp.get(su, 0) + 1  # SKU repetido nas colunas = 2 pecas
        if comp:
            kits.setdefault(m, {})[k] = comp
    inf = base.get("inferidos", {})
    for d in inf.get("depara", []):
        c = ncode(d["code"])
        if c and c not in depara.setdefault(d["b"], {}):
            depara[d["b"]][c] = ncode(d["sku"])
    for k in inf.get("kits", []):
        kc = ncode(k["kit"])
        if kc not in kits.setdefault(k["b"], {}):
            comp = {}
            for s in k["comp"]:
                comp[ncode(s)] = comp.get(ncode(s), 0) + 1
            kits[k["b"]][kc] = comp
    for m, mapa in SKU_OVERRIDES.items():
        dm = depara.setdefault(m, {})
        for c in list(dm):
            dm[c] = mapa.get(dm[c], dm[c])
        dm.update(mapa)
        for k, comp in kits.get(m, {}).items():
            novo: dict[str, int] = {}
            for s, n in comp.items():
                novo[mapa.get(s, s)] = novo.get(mapa.get(s, s), 0) + n
            kits[m][k] = novo
    return depara, kits


_cache: dict = {"em": 0.0, "lookups": None}


def _csv(gid: str) -> str:
    r = httpx.get(f"https://docs.google.com/spreadsheets/d/{DREAMBASE_ID}/export?format=csv&gid={gid}",
                  follow_redirects=True, timeout=10.0)
    r.raise_for_status()
    if r.text.lstrip().startswith("<"):
        raise RuntimeError("DreamBase nao devolveu CSV")
    return r.content.decode("utf-8")


def obter_lookups(relogio: Callable[[], float] = time.monotonic) -> Optional[tuple[dict, dict]]:
    """De-para e kits, 1 h em cache. Falha da planilha: usa o ultimo lido; nunca lido = None."""
    if _cache["lookups"] and relogio() - _cache["em"] < CACHE_S:
        return _cache["lookups"]
    try:
        base = json.loads((Path(__file__).parent.parent / "data" / "mix_kits_base.json").read_text(encoding="utf-8"))
        _cache.update(em=relogio(), lookups=montar_lookups(_csv(GID_DEPARA), _csv(GID_KITS), base))
    except Exception:  # noqa: BLE001 -- sem planilha, a aba segue sem a venda por canal
        logger.exception("slow moving: DreamBase nao lida")
    return _cache["lookups"]


def janela(ate: date, n: int = DIAS) -> list[date]:
    return [ate - timedelta(days=n - 1 - i) for i in range(n)]


def series_por_sku(linhas_por_canal: dict[str, list[dict]], n: int, depara: dict, kits: dict) -> dict:
    """{(marca, SKU Unico): {"q": {"ML-F": [pecas/dia]...}, "r": {...}}}; kit aberto em pecas."""
    out: dict = {}
    for canal, linhas in linhas_por_canal.items():
        for x in linhas:
            q = [float(v) for v in str(x["q"]).split(",")]
            r = [float(v) for v in str(x["r"]).split(",")]
            if len(q) != n or len(r) != n:
                continue
            ch = f"{canal}-{x['envio']}"
            m, code = nbrand(x["marca"]), ncode(x["sku"])
            kit = kits.get(m, {}).get(code)
            if kit:
                total = sum(kit.values()) or 1
                partes = [(s, k, k / total) for s, k in kit.items()]  # (SKU, pecas por kit, fatia da receita)
            else:
                su = depara.get(m, {}).get(code)
                if not su:
                    continue
                partes = [(su, 1, 1.0)]
            for su, pecas, fatia in partes:
                e = out.setdefault((m, su), {"q": {}, "r": {}})
                eq = e["q"].setdefault(ch, [0.0] * n)
                er = e["r"].setdefault(ch, [0.0] * n)
                for i in range(n):
                    eq[i] += q[i] * pecas
                    er[i] += r[i] * fatia
    return out
