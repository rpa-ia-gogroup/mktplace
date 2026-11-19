"""Performance de atendimento da loja no TikTok Shop, direto da Open API (app da Torre).

Rota `GET /customer_service/202407/performance` (escopo que o app ja' tem): taxa de resposta,
tempo de resposta, satisfacao, atendimentos e GMV guiado pelo atendimento, nos ultimos 7 dias
fechados e nos 7 anteriores (para a comparacao). A nota oficial (SPS) segue sem API para lojas BR.
Vira `ContaOficial`, o mesmo formato de ML e Shopee no card "Performance". Cache de 10 min.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional

from app.schemas.performance_oficial import ContaOficial, ContaSemFoto, Destaque, MetricaOficial

logger = logging.getLogger(__name__)
CAMINHO = "/customer_service/202407/performance"
DIAS = 7
CACHE_S = 600
_cache: dict[tuple, tuple[float, tuple]] = {}
_trava = threading.Lock()


def _num(v) -> Optional[float]:
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None


def ler(cli, ini: date, fim_exclusivo: date) -> dict:
    d = cli.chamar("GET", CAMINHO, {"support_date_ge": ini.isoformat(), "support_date_lt": fim_exclusivo.isoformat()})
    return d.get("performance") or {}


def conta_tiktok(marca: str, atual: dict, anterior: dict, hoje: date, agora: datetime) -> ContaOficial:
    """Uma loja no formato do card Performance (sem nota oficial: o TikTok nao da' SPS para BR)."""
    resp, resp_ant = _num(atual.get("response_percentage")), _num(anterior.get("response_percentage"))
    tempo = _num(atual.get("response_time_mins"))
    tempo_ant = _num(anterior.get("response_time_mins"))
    sat, sat_ant = _num(atual.get("satisfaction_percentage")), _num(anterior.get("satisfaction_percentage"))
    conv = _num(atual.get("conversion_rate"))
    sessoes = atual.get("support_session_count")
    h = lambda m: None if m is None else round(m / 60, 1)  # noqa: E731
    metricas = [
        MetricaOficial(codigo="tt_resposta", rotulo="Taxa de resposta", grupo="Atendimento", valor=resp, unidade="pct",
                       anterior=resp_ant, situacao="sem_meta", ajuda="Conversas respondidas ÷ conversas recebidas, últimos 7 dias fechados."),
        MetricaOficial(codigo="tt_tempo", rotulo="Tempo de resposta", grupo="Atendimento", valor=h(tempo), unidade="horas",
                       anterior=h(tempo_ant), situacao="sem_meta", ajuda="Tempo médio até a primeira resposta da loja."),
        MetricaOficial(codigo="tt_satisfacao", rotulo="Satisfação", grupo="Atendimento", valor=sat, unidade="pct",
                       anterior=sat_ant, situacao="sem_meta", ajuda="Avaliações positivas do atendimento ÷ avaliações."),
        MetricaOficial(codigo="tt_conversao", rotulo="Conversão no atendimento", grupo="Atendimento", valor=conv, unidade="pct",
                       situacao="sem_meta", ajuda="Conversas que viraram pedido, segundo o TikTok."),
    ]
    metricas = [m for m in metricas if m.valor is not None]  # o que a plataforma nao devolveu nao aparece (nunca zero)
    destaques = []
    if sessoes is not None:
        destaques.append(Destaque(rotulo="Atendimentos em 7 dias", valor=f"{int(sessoes):,}".replace(",", ".")))
    gmv = _num(atual.get("cs_guided_gmv"))
    if gmv:
        destaques.append(Destaque(rotulo="GMV guiado pelo atendimento", valor=f"R$ {gmv:,.0f}".replace(",", ".")))
    tom = "neutro" if resp is None else ("bom" if resp >= 90 else "atencao" if resp >= 70 else "critico")
    return ContaOficial(
        marca=marca, dia=hoje - timedelta(days=1), capturado_em=agora,
        nivel=f"Resposta {resp:.0f}%".replace(".", ",") if resp is not None else "Atendimento",
        tom=tom, resumo="Atendimento dos últimos 7 dias fechados (a nota oficial da loja não tem API no Brasil)",
        destaques=destaques, metricas=metricas,
    )


def obter_contas(marcas: list[str], agora: Optional[datetime] = None,
                 criar_cliente: Optional[Callable[[str], object]] = None) -> tuple[list[ContaOficial], list[ContaSemFoto]]:
    """Contas por marca (com cache de 10 min). Marca sem token ou com erro vai para `sem_foto`."""
    agora = agora or datetime.now(timezone.utc)
    chave = tuple(sorted(marcas))
    with _trava:
        hit = _cache.get(chave)
    if hit and time.time() - hit[0] < CACHE_S:
        return hit[1]
    from app.services.cx_tiktok_service import TZ

    hoje = agora.astimezone(TZ).date()
    fim = hoje  # exclusivo: ate' ontem
    ini, ini_ant = fim - timedelta(days=DIAS), fim - timedelta(days=2 * DIAS)
    criar = criar_cliente or _cliente_padrao()
    contas, sem = [], []
    for m in marcas:
        try:
            cli = criar(m)
            contas.append(conta_tiktok(m, ler(cli, ini, fim), ler(cli, ini_ant, ini), hoje, agora))
        except Exception as e:  # noqa: BLE001 -- uma loja fora nao derruba as outras
            logger.warning("tiktok performance %s: %s", m, type(e).__name__)
            sem.append(ContaSemFoto(marca=m, motivo="Loja sem autorização do app da Torre no TikTok ou TikTok indisponível agora."))
    res = (contas, sem)
    with _trava:
        _cache[chave] = (time.time(), res)
    return res


def _cliente_padrao() -> Callable[[str], object]:
    """Token da marca (renova se precisar) + cipher da loja, como a CX do TikTok."""
    from app.database import SessionLocal
    from app.services import tiktok_token
    from app.services.cx_tiktok_service import _cliente_da_marca
    from app.services.tiktok_client import Cliente

    def criar(marca: str):
        with SessionLocal() as db:
            tok = tiktok_token.obter_access_token(tiktok_token.ArmazemPg(db), marca)
        return _cliente_da_marca(marca, tok, Cliente)

    return criar
