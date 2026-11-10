"""Rotina que mantem o cache do Bling aquecido (marcas menores).

A cada ~15 min, em segundo plano no proprio processo:
  1. a lista de pedidos das 6 lojas: ontem e hoje a cada ciclo, os ultimos 90 dias a cada 6 h, e os
     pedidos ALTERADOS desde a ultima sincronizacao (pega cancelamentos de pedidos antigos);
  2. os itens dos pedidos novos (mes anterior em diante) que ainda nao foram lidos.
Assim o filtro de uma marca menor so' le o banco. Respeita ~3 req/s (cliente compartilhado), roda uma
vez por vez (advisory lock) e nunca loga token: so' contagens.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional

from app.config import settings
from app.services import marcas_menores_service as svc
from app.services.bling_cache import CacheBling
from app.services.bling_client import BlingCliente, cliente_com_sessao
from app.services.bling_token import BlingIndisponivel

logger = logging.getLogger(__name__)

HISTORICO_RENOVA_S = 6 * 3600
#: Itens lidos por ciclo (~85 s a 3 req/s): o resto fica para o proximo.
DETALHES_POR_CICLO = 250
MARGEM_ALTERACAO = timedelta(minutes=15)


def _primeiro_dia_do_mes_anterior(hoje: date) -> date:
    primeiro = hoje.replace(day=1)
    return (primeiro - timedelta(days=1)).replace(day=1)


def sincronizar(
    cli: BlingCliente,
    cache: CacheBling,
    hoje: date,
    agora_dt: Callable[[], datetime] = svc._agora_dt,
    limite_detalhes: int = DETALHES_POR_CICLO,
) -> dict:
    """Um ciclo. Devolve so' contagens (nada sensivel)."""
    with cache.trava() as ok:
        if not ok:
            return {"pulado": True}
        cancelado = svc.id_cancelado(cli, cache)
        agora = agora_dt()
        hist_ini = hoje - timedelta(days=svc.JANELA_HISTORICO_DIAS)
        recente_ini = hoje - timedelta(days=1)
        n_lista = 0
        for loja in svc.LOJAS:
            ant = cache.ler_sync(f"lista:{loja}")
            hist = cache.ler_sync(f"hist:{loja}")
            ultima = ant[1] if ant and ant[0] else None
            if ultima is not None and ultima.tzinfo is None:
                ultima = ultima.replace(tzinfo=timezone.utc)
            hist_velho = (
                hist is None
                or (agora - (hist[1] if hist[1].tzinfo else hist[1].replace(tzinfo=timezone.utc))).total_seconds() > HISTORICO_RENOVA_S
            )
            linhas: list[dict] = []
            if hist_velho:
                linhas += svc.listar_bruto(cli, loja, hist_ini, hoje)  # a janela toda: o que mudou de situacao tambem volta
            else:
                linhas += svc.listar_bruto(cli, loja, recente_ini, hoje)
                if ultima is not None:
                    desde = (ultima - MARGEM_ALTERACAO).strftime("%Y-%m-%d %H:%M:%S")
                    linhas += svc.listar_bruto(cli, loja, hist_ini, hoje, {"dataAlteracaoInicial": desde})
            cache.salvar_pedidos([{**l, "loja_id": loja} for l in linhas])
            n_lista += len(linhas)
            if hist_velho:
                cache.marcar_sync(f"hist:{loja}", hist_ini.isoformat())
                cache.marcar_sync(f"lista:{loja}", hist_ini.isoformat())
            else:
                cache.marcar_sync(f"lista:{loja}", ant[0] if ant and ant[0] else hist_ini.isoformat())
        faltam = cache.ids_sem_itens(svc.LOJAS.keys(), _primeiro_dia_do_mes_anterior(hoje), hoje, cancelado)
        lidos = 0
        for pid in faltam[:limite_detalhes]:
            svc._itens(cli, pid, cache)
            lidos += 1
        return {"pedidos": n_lista, "itens_lidos": lidos, "itens_faltando": max(0, len(faltam) - lidos)}


# ---------------------------------------------------------------------------
# Execucao em segundo plano no processo da API.

_ocupado = threading.Lock()
_ultimo_disparo = [0.0]
DISPARO_MIN_S = 60.0


def _ciclo() -> None:
    from app.database import SessionLocal
    from app.deps.period import today_brt
    from app.services.bling_cache import ArmazemCachePg

    if SessionLocal is None or not settings.bling_client_id:
        return
    if not _ocupado.acquire(blocking=False):
        return  # ja' ha um ciclo neste processo
    db = SessionLocal()
    try:
        stats = sincronizar(cliente_com_sessao(db), ArmazemCachePg(db), today_brt())
        logger.info("bling aquecido: %s", stats)
    except BlingIndisponivel as exc:
        logger.warning("bling aquecimento adiado: %s", exc)
    except Exception as exc:  # noqa: BLE001 — texto da fonte e token nunca saem
        logger.warning("bling aquecimento falhou: %s", type(exc).__name__)
    finally:
        db.close()
        _ocupado.release()


def disparar_em_segundo_plano() -> None:
    """Acionada quando uma leitura achou o cache frio/velho: aquece sem bloquear a resposta."""
    agora = time.monotonic()
    if agora - _ultimo_disparo[0] < DISPARO_MIN_S:
        return
    _ultimo_disparo[0] = agora
    threading.Thread(target=_ciclo, name="bling-aquecimento", daemon=True).start()


def iniciar_rotina() -> None:
    """Chamada no startup da API: um ciclo logo depois da subida e depois a cada `bling_warm_intervalo_s`."""
    if not settings.bling_warm_enabled or not settings.bling_client_id:
        return

    def laco() -> None:
        time.sleep(20)
        while True:
            _ciclo()
            time.sleep(max(60, settings.bling_warm_intervalo_s))

    threading.Thread(target=laco, name="bling-rotina", daemon=True).start()
