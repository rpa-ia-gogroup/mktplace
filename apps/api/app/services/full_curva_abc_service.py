"""CURVA-ABC-1 -- curva ABC dos produtos para o /full.

Fonte: planilha Google "Sortimento Gobeaute", aba "ABC Curve" (dinamica,
mantida pelo time de sortimento): Empresa | SKU Unico | Chave Auxiliar |
Curva (AA, A, B, C) | Faturamento | %.

Leitura (decisao do usuario, opcao A): a API le a aba com a service account
da variavel de ambiente `GOOGLE_SA_JSON_ABC` (o JSON inteiro; colado no Render
por quem tem acesso -- agente nao mexe em segredo), escopo
spreadsheets.readonly, sem biblioteca nova (JWT com pyjwt + httpx).

- Cache em memoria de 1 h. Vencido, devolve o que tem e atualiza em
  segundo plano: a rota so' espera o Google na PRIMEIRA leitura do processo
  (timeout curto).
- Sem a variavel, ou a leitura falhando: `unavailable` com motivo. O /full
  segue normal, so' sem curva. Nunca vira "C".

Chave: (marca, SKU Unico) -- o codigo se repete entre marcas. Os itens do Full
ligam por (marca, SKU do canal): direto quando o SKU do anuncio JA' e' o
codigo de produto; senao pela ponte de GTIN que ja' existe no banco (GTIN do
anuncio -> codigo de produto da referencia de preco sugerido). Kit e codigo
sem ponte ficam "sem curva" (o front decide o kit).

Duplicatas na fonte (mesmo SKU duas vezes na aba, com curvas diferentes):
vale a linha de MAIOR faturamento; a lista volta na resposta para o dono da
planilha corrigir.
"""
from __future__ import annotations

import json
import os
import threading
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Optional
from urllib.parse import quote

import httpx
import jwt
from sqlalchemy import text
from sqlalchemy.orm import Session

ENV_CREDENCIAL = "GOOGLE_SA_JSON_ABC"
PLANILHA_ID = "1_WdR8wQbGWYz15w_UneeXDXQ-nHKGpbwJLCU6afHdAk"
ABA = "ABC Curve"
FONTE = "Planilha 'Sortimento Gobeaute', aba 'ABC Curve'"
ESCOPO = "https://www.googleapis.com/auth/spreadsheets.readonly"
URL_TOKEN = "https://oauth2.googleapis.com/token"
CACHE_SEGUNDOS = 3600
TIMEOUT_SEGUNDOS = 5.0
CURVAS = ("AA", "A", "B", "C")

MOTIVO_SEM_CREDENCIAL = "Curva ABC indisponível agora: credencial da planilha não configurada."
MOTIVO_LEITURA = "Curva ABC indisponível agora: a planilha não respondeu."
MOTIVO_FORMATO = "Curva ABC indisponível agora: a aba 'ABC Curve' mudou de formato."

# Cabecalho esperado (normalizado: sem acento, minusculo, so' letras/numeros).
COL_EMPRESA, COL_SKU, COL_CURVA, COL_FATURAMENTO = "empresa", "skuunico", "curva", "faturamento"


def _norm(valor: object) -> str:
    s = unicodedata.normalize("NFKD", str(valor or "")).encode("ascii", "ignore").decode().lower()
    return "".join(ch for ch in s if ch.isalnum())


def _numero(valor: object) -> float:
    """'6.074.200,18' -> 6074200.18. Ilegivel = 0 (so' desempata duplicata)."""
    s = str(valor or "").strip().replace("R$", "").replace(".", "").replace(",", ".").strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


class FormatoInesperado(Exception):
    pass


@dataclass(frozen=True)
class Planilha:
    #: (marca normalizada, SKU Unico) -> curva
    curvas: dict[tuple[str, str], str]
    #: chaves que aparecem mais de uma vez na aba (vale a de maior faturamento)
    duplicadas: list[tuple[str, str]]
    lida_em: datetime


def interpretar(valores: list[list[str]], lida_em: datetime) -> Planilha:
    """Linhas da aba -> curva por (marca, SKU). Duplicata: maior faturamento."""
    if not valores:
        raise FormatoInesperado("aba vazia")
    cab = [_norm(c) for c in valores[0]]
    try:
        i_emp, i_sku, i_cv, i_fat = (cab.index(c) for c in (COL_EMPRESA, COL_SKU, COL_CURVA, COL_FATURAMENTO))
    except ValueError as exc:
        raise FormatoInesperado("cabecalho sem as colunas esperadas") from exc
    melhor: dict[tuple[str, str], tuple[float, str]] = {}
    vistas: dict[tuple[str, str], int] = {}
    for linha in valores[1:]:
        cel = lambda i: str(linha[i]).strip() if i < len(linha) else ""
        marca, sku, curva = _norm(cel(i_emp)), cel(i_sku), cel(i_cv).upper()
        if not marca or not sku or curva not in CURVAS:
            continue
        chave = (marca, sku)
        vistas[chave] = vistas.get(chave, 0) + 1
        fat = _numero(cel(i_fat))
        if chave not in melhor or fat > melhor[chave][0]:
            melhor[chave] = (fat, curva)
    return Planilha(
        curvas={k: v[1] for k, v in melhor.items()},
        duplicadas=sorted(k for k, n in vistas.items() if n > 1),
        lida_em=lida_em,
    )


# ---------------------------------------------------------------------------
# Leitura da aba (service account -> token -> valores)
# ---------------------------------------------------------------------------

def _credencial() -> Optional[dict]:
    bruto = os.environ.get(ENV_CREDENCIAL, "").strip()
    if not bruto:
        return None
    return json.loads(bruto)


def ler_aba(sa: dict, cliente: Optional[httpx.Client] = None) -> list[list[str]]:
    """Le a aba com a service account. So' leitura (escopo readonly)."""
    agora = int(time.time())
    afirmacao = jwt.encode(
        {"iss": sa["client_email"], "scope": ESCOPO, "aud": URL_TOKEN, "iat": agora, "exp": agora + 600},
        sa["private_key"], algorithm="RS256")
    c = cliente or httpx.Client(timeout=TIMEOUT_SEGUNDOS)
    try:
        tok = c.post(URL_TOKEN, data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": afirmacao})
        tok.raise_for_status()
        intervalo = quote(f"'{ABA}'!A1:F5000", safe="")
        r = c.get(f"https://sheets.googleapis.com/v4/spreadsheets/{PLANILHA_ID}/values/{intervalo}",
                  headers={"Authorization": f"Bearer {tok.json()['access_token']}"})
        r.raise_for_status()
        return r.json().get("values", [])
    finally:
        if cliente is None:
            c.close()


# ---------------------------------------------------------------------------
# Cache: 1 h; vencido, serve o que tem e atualiza em segundo plano
# ---------------------------------------------------------------------------

@dataclass
class _Cache:
    planilha: Optional[Planilha] = None
    motivo: Optional[str] = None
    lido_em_s: float = 0.0
    atualizando: bool = False
    trava: threading.Lock = field(default_factory=threading.Lock)


_cache = _Cache()


def _atualizar(cache: _Cache, ler: Callable[[], list[list[str]]], relogio: Callable[[], float]) -> None:
    try:
        cache.planilha = interpretar(ler(), datetime.now(timezone.utc))
        cache.motivo = None
    except FormatoInesperado:
        cache.motivo = MOTIVO_FORMATO
    except Exception:  # rede, token, cota: a mensagem do erro nao sai daqui
        cache.motivo = MOTIVO_LEITURA
    finally:
        cache.lido_em_s = relogio()
        cache.atualizando = False


def obter_planilha(*, cache: _Cache = _cache, ler: Optional[Callable[[], list[list[str]]]] = None,
                   relogio: Callable[[], float] = time.monotonic,
                   em_segundo_plano: bool = True) -> tuple[Optional[Planilha], Optional[str]]:
    """(planilha, motivo). Planilha antiga continua valendo enquanto a nova nao chega."""
    if ler is None:
        try:
            sa = _credencial()
        except ValueError:
            return cache.planilha, MOTIVO_SEM_CREDENCIAL
        if sa is None:
            return None, MOTIVO_SEM_CREDENCIAL
        ler = lambda: ler_aba(sa)  # noqa: E731
    vencido = relogio() - cache.lido_em_s >= CACHE_SEGUNDOS or cache.lido_em_s == 0.0
    if not vencido:
        return cache.planilha, cache.motivo if cache.planilha is None else None
    with cache.trava:
        if cache.atualizando:
            return cache.planilha, cache.motivo if cache.planilha is None else None
        cache.atualizando = True
    if cache.planilha is not None and em_segundo_plano:
        threading.Thread(target=_atualizar, args=(cache, ler, relogio), daemon=True).start()
        return cache.planilha, None
    _atualizar(cache, ler, relogio)  # primeira leitura do processo: espera (timeout curto)
    return cache.planilha, cache.motivo if cache.planilha is None else None


# ---------------------------------------------------------------------------
# Ponte de codigo: SKU do canal -> GTIN -> codigo de produto (so' leitura)
# ---------------------------------------------------------------------------

SQL_SOMENTE_LEITURA = text("SET TRANSACTION READ ONLY")

#: GTIN mais recente por (marca, SKU do canal) nos anuncios do ML e nas
#: ofertas observadas da Shopee; codigo de produto da referencia de preco
#: sugerido pelo mesmo (marca, GTIN). So' tabelas que ja' existem.
SQL_PONTE = text("""
    WITH gtin AS (
        SELECT DISTINCT ON (brand, seller_sku) brand, seller_sku, gtin
          FROM (
            SELECT brand, seller_sku, gtin, ref_date AS dia
              FROM marts.fact_marketplace_listing_price_daily
             WHERE marketplace = 'ml' AND seller_sku IS NOT NULL AND gtin IS NOT NULL
               AND ref_date >= CURRENT_DATE - 60
            UNION ALL
            SELECT brand, seller_sku, gtin, observed_date AS dia
              FROM marts.fact_channel_offer_observation
             WHERE marketplace = 'shopee' AND seller_sku IS NOT NULL AND gtin IS NOT NULL
               AND observed_date >= CURRENT_DATE - 60
          ) x
         ORDER BY brand, seller_sku, dia DESC
    ), ref AS (
        SELECT DISTINCT ON (brand, source_gtin) brand, source_gtin, source_sku
          FROM marts.fact_suggested_price_reference_snapshot
         WHERE source_gtin IS NOT NULL AND source_sku IS NOT NULL
         ORDER BY brand, source_gtin, captured_at DESC
    )
    SELECT g.brand, g.seller_sku, r.source_sku
      FROM gtin g JOIN ref r ON r.brand = g.brand AND r.source_gtin = g.gtin
""")


def _chave(marca: str, sku: str) -> str:
    return f"{marca}|{sku}"


def get_curva_abc(db: Optional[Session], *, obter=obter_planilha) -> dict:
    """Curva por 'marca|SKU do canal' (direto ou pela ponte de GTIN)."""
    planilha, motivo = obter()
    if planilha is None:
        return {"status": "unavailable", "motivo": motivo or MOTIVO_LEITURA, "fonte": FONTE}
    por_sku = {_chave(m, s): c for (m, s), c in planilha.curvas.items()}
    pela_ponte = 0
    linhas = []
    if db is not None:  # sem banco: so' a ligacao direta
        db.execute(SQL_SOMENTE_LEITURA)
        linhas = db.execute(SQL_PONTE).mappings().all()
    for r in linhas:
        k = _chave(_norm(r["brand"]), str(r["seller_sku"]).strip())
        c = planilha.curvas.get((_norm(r["brand"]), str(r["source_sku"]).strip()))
        if c and k not in por_sku:  # o direto vence
            por_sku[k] = c
            pela_ponte += 1
    return {
        "status": "ok",
        "fonte": FONTE,
        "lida_em": planilha.lida_em,
        "itens_planilha": len(planilha.curvas),
        "pela_ponte_gtin": pela_ponte,
        "duplicadas": [_chave(m, s) for m, s in planilha.duplicadas],
        "curva_por_sku": por_sku,
        "aviso": motivo,  # leitura nova falhou, mas a anterior segue valendo
    }


# ---------------------------------------------------------------------------
# PR3: curva por item nas listas de estoque do Full (Shopee e ML)
# ---------------------------------------------------------------------------

#: A ponte custa ~0,26 s no Neon (medido 09/11/2026) e as rotas de estoque a
#: pedem a cada carga: o mapa fica guardado junto com a planilha, por 1 h.
_mapa_cache: dict = {"lida_em": None, "em_s": 0.0, "mapa": None}


def _mapa_curvas(db: Optional[Session], obter, relogio: Callable[[], float]) -> dict:
    """`get_curva_abc` com o resultado guardado enquanto a planilha for a mesma (ate' 1 h)."""
    planilha, motivo = obter()
    c = _mapa_cache
    if (planilha is not None and c["mapa"] is not None and c["lida_em"] == planilha.lida_em
            and relogio() - c["em_s"] < CACHE_SEGUNDOS):
        return c["mapa"]
    mapa = get_curva_abc(db, obter=lambda: (planilha, motivo))
    if mapa["status"] == "ok":
        c.update(lida_em=planilha.lida_em, em_s=relogio(), mapa=mapa)
    return mapa


def _eh_kit(sku: Optional[str]) -> bool:
    """Mesma regra do front (`ehKit`): ML "Kit110"/"KIT005"."""
    return str(sku or "").strip().lower().startswith("kit")


def anotar_curva(itens: list, db: Optional[Session], *, sku_de: Callable, kit_de: Callable = lambda i: False,
                 obter=obter_planilha, relogio: Callable[[], float] = time.monotonic) -> dict:
    """Preenche `curva`/`curva_motivo` em cada item e devolve o `curva_meta`.

    Planilha nao lida: todos ficam None (nunca "C") e o motivo vai no meta.
    Erro inesperado aqui tambem vira "indisponivel": a lista de estoque nunca cai por causa da curva.
    """
    try:
        mapa = _mapa_curvas(db, obter, relogio)
    except Exception:  # noqa: BLE001 -- ponte/planilha nao derrubam o estoque
        mapa = {"status": "unavailable", "motivo": MOTIVO_LEITURA}
    if mapa["status"] != "ok":
        for i in itens:
            i.curva, i.curva_motivo = None, None
        return {"disponivel": False, "motivo": mapa.get("motivo") or MOTIVO_LEITURA, "lida_em": None,
                "itens_com_curva": 0, "itens_total": len(itens)}
    por_sku: dict = mapa["curva_por_sku"]
    marcas = {k.split("|", 1)[0] for k in por_sku}
    com_curva = 0
    for i in itens:
        marca, sku = _norm(i.brand), str(sku_de(i) or "").strip()
        curva = None if kit_de(i) or _eh_kit(sku) or not sku else por_sku.get(_chave(marca, sku))
        i.curva = curva
        if curva:
            i.curva_motivo = None
            com_curva += 1
        elif kit_de(i) or _eh_kit(sku):
            i.curva_motivo = "kit"
        elif marca not in marcas:
            i.curva_motivo = "marca_fora"
        else:
            i.curva_motivo = "sem_ponte"
    return {"disponivel": True, "motivo": mapa.get("aviso"), "lida_em": mapa.get("lida_em"),
            "itens_com_curva": com_curva, "itens_total": len(itens)}
