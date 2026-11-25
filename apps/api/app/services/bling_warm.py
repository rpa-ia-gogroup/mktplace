"""Rotina que mantem o cache do Bling aquecido (marcas menores).

A cada ~15 min, em segundo plano no proprio processo:
  1. a lista de pedidos das 6 lojas: ontem e hoje a cada ciclo, os ultimos 90 dias a cada 6 h, e os
     pedidos ALTERADOS desde a ultima sincronizacao (pega cancelamentos de pedidos antigos);
  2. os itens dos pedidos novos (mes anterior em diante) que ainda nao foram lidos;
  3. a Denavita (conta propria do Bling, so' com token): lista e itens de ML e Shopee dela, nas MESMAS tabelas, com
     id negativo (ver `svc._id_banco`). UM limite de itens por ciclo para as duas contas, Rituaria primeiro.
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
DETALHES_POR_CICLO = 600
MARGEM_ALTERACAO = timedelta(minutes=15)
#: Com itens ainda por ler, o ciclo seguinte comeca depois disto (em vez do intervalo normal).
PROXIMO_COM_BACKLOG_S = 60


def _primeiro_dia_do_mes_anterior(hoje: date) -> date:
    primeiro = hoje.replace(day=1)
    return (primeiro - timedelta(days=1)).replace(day=1)


def _sincronizar_lista(cli: BlingCliente, cache: CacheBling, loja: int, hoje: date, agora: datetime, sinal: int = 1) -> int:
    """Renova a lista de pedidos de UMA loja no banco e devolve quantas linhas leu. `sinal` -1 = loja da Denavita:
    o id vai ao banco NEGATIVO (ver `svc._id_banco`) e o `loja_id` e' a loja real dela."""
    hist_ini = hoje - timedelta(days=svc.JANELA_HISTORICO_DIAS)
    recente_ini = hoje - timedelta(days=1)
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
    cache.salvar_pedidos([{**l, "id": sinal * l["id"], "loja_id": loja} for l in linhas])
    if hist_velho:
        cache.marcar_sync(f"hist:{loja}", hist_ini.isoformat())
        cache.marcar_sync(f"lista:{loja}", hist_ini.isoformat())
    else:
        cache.marcar_sync(f"lista:{loja}", ant[0] if ant and ant[0] else hist_ini.isoformat())
    return len(linhas)


def sincronizar(
    cli: BlingCliente,
    cache: CacheBling,
    hoje: date,
    agora_dt: Callable[[], datetime] = svc._agora_dt,
    limite_detalhes: int = DETALHES_POR_CICLO,
    cli_denavita: Optional[BlingCliente] = None,
) -> dict:
    """Um ciclo. Devolve so' contagens (nada sensivel). `cli_denavita`: cliente do Bling da Denavita (com token);
    com ele o ciclo aquece tambem a conta dela (lista e itens, ML e Shopee), com UM limite de itens dividido entre as
    contas: Rituaria primeiro. O Bling dela fora do ar nunca derruba a parte da Rituaria."""
    with cache.trava() as ok:
        if not ok:
            return {"pulado": True}
        cancelado = svc.id_cancelado(cli, cache)
        agora = agora_dt()
        n_lista = 0
        for loja in svc.LOJAS:
            n_lista += _sincronizar_lista(cli, cache, loja, hoje, agora)
        lojas_den: dict[int, str] = {}
        cancelado_den = 0
        if cli_denavita is not None:
            try:
                cancelado_den = svc.id_cancelado(cli_denavita, cache, conta=svc.CONTA_DENAVITA)
                cache.marcar_sync("cancelado_id:denavita", str(cancelado_den))  # a leitura das requisicoes nao chama o Bling
                lojas_den = svc.lojas_denavita(cli_denavita, cache, atualizar=True)
                for loja in lojas_den:
                    n_lista += _sincronizar_lista(cli_denavita, cache, loja, hoje, agora, sinal=-1)
            except BlingIndisponivel as exc:  # motivo ja' sanitizado; a Rituaria segue
                logger.warning("bling aquecimento: lista da Denavita adiada (%s)", exc)
                lojas_den = {}
        mes_ini = _primeiro_dia_do_mes_anterior(hoje)
        faltam = cache.ids_sem_itens(svc.LOJAS.keys(), mes_ini, hoje, cancelado)
        lidos = 0
        for pid in faltam[:limite_detalhes]:
            svc._itens(cli, pid, cache)
            lidos += 1
        stats = {"pedidos": n_lista, "itens_lidos": lidos, "itens_faltando": max(0, len(faltam) - lidos)}
        if lojas_den:
            faltam_den = cache.ids_sem_itens(lojas_den.keys(), mes_ini, hoje, cancelado_den)  # ids negativos
            lidos_den = 0
            try:
                for pid in faltam_den[: max(0, limite_detalhes - lidos)]:
                    svc._itens(cli_denavita, -pid, cache, svc.CONTA_DENAVITA)
                    lidos_den += 1
            except BlingIndisponivel as exc:
                logger.warning("bling aquecimento: itens da Denavita adiados (%s)", exc)
            stats["denavita_itens_lidos"] = lidos_den
            stats["denavita_itens_faltando"] = max(0, len(faltam_den) - lidos_den)
            stats["itens_lidos"] += lidos_den
            stats["itens_faltando"] += stats["denavita_itens_faltando"]
        return stats


# ---------------------------------------------------------------------------
# Execucao em segundo plano no processo da API.

_ocupado = threading.Lock()
_ultimo_disparo = [0.0]
DISPARO_MIN_S = 60.0


def proxima_espera(stats: Optional[dict]) -> float:
    """Segundos ate' o proximo ciclo: logo se ainda ha itens por ler, senao o intervalo normal."""
    if stats and stats.get("itens_faltando"):
        return PROXIMO_COM_BACKLOG_S
    return max(60, settings.bling_warm_intervalo_s)


def _ciclo() -> Optional[dict]:
    """Um ciclo; devolve as contagens (None se pulado/falhou)."""
    from app.database import SessionLocal
    from app.deps.period import today_brt
    from app.services.bling_cache import ArmazemCachePg
    from app.services.bling_client import cliente_denavita

    if SessionLocal is None or not settings.bling_client_id:
        return None
    if not _ocupado.acquire(blocking=False):
        return None  # ja' ha um ciclo neste processo
    db = SessionLocal()
    stats: Optional[dict] = None
    try:
        stats = sincronizar(cliente_com_sessao(db), ArmazemCachePg(db), today_brt(), cli_denavita=cliente_denavita(db)[0])
        logger.info("bling aquecido: %s", stats)
    except BlingIndisponivel as exc:
        logger.warning("bling aquecimento adiado: %s", exc)
    except Exception as exc:  # noqa: BLE001 — texto da fonte e token nunca saem
        logger.warning("bling aquecimento falhou: %s", type(exc).__name__)
    finally:
        db.close()
        _ocupado.release()
    return stats


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
            stats = _ciclo()
            # Backlog de itens (pedidos novos ou primeira carga): o proximo ciclo vem logo, nao em 15 min.
            time.sleep(proxima_espera(stats))

    threading.Thread(target=laco, name="bling-rotina", daemon=True).start()
