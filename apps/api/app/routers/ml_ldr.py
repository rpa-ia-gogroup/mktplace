"""CX-MKT-3 — rota read-only do LDR do Mercado Livre para a faixa do topo da Expedicao.

Mesma flag da secao Performance (`expedicao_performance_api_enabled`): desligada,
404 antes de qualquer consulta. Entrada fora da allowlist = 422 sem eco.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import settings
from app.services import expedicao_atrasados_dia_service as atrasados
from app.services import ml_ldr_service as svc
from app.services import shopee_ldr_dm_service as shopee_dm
from app.services.gold_service import ML_BRANDS


def exigir_flag() -> None:
    if not settings.expedicao_performance_api_enabled:
        raise HTTPException(404, "Not Found")


router = APIRouter(prefix="/api/v1/expedicao/ml", tags=["expedicao"], dependencies=[Depends(exigir_flag)])

_MSG_BRANDS = "Marca invalida. Valores aceitos: " + ", ".join(ML_BRANDS)


def brands_query(brands: Optional[list[str]] = Query(None)) -> Optional[list[str]]:
    if brands is None:
        return None
    itens = [x.strip().lower() for valor in brands for x in valor.split(",") if x.strip()]
    # Marca sem conta ML (ex.: apice) e' valida na Torre: devolve lista vazia, nao 422.
    from app.services.gold_service import BRANDS_IN_SCOPE
    if not itens or len(itens) > 20 or any(x not in BRANDS_IN_SCOPE for x in itens):
        raise HTTPException(422, _MSG_BRANDS)
    return sorted(set(itens))


@router.get("/ldr")
def ldr_ml(
    days: int = Query(7, description="Dias fechados ate' ontem (1 a 30)."),
    brands: Optional[list[str]] = Depends(brands_query),
):
    if days < 1 or days > svc.JANELA_MAX_DIAS:
        raise HTTPException(422, f"Janela invalida. Informe entre 1 e {svc.JANELA_MAX_DIAS} dias.")
    return svc.obter_ldr_ml(dias=days, brands=brands)


def _pedidos_do_dia(canal: str, vencimento: str, brands: Optional[list[str]], page: int) -> dict:
    """Clique na barra da evolucao: os atrasados daquele dia de vencimento."""
    try:
        dia = date.fromisoformat(vencimento)
        atrasados.validar_dia(canal, dia)
    except ValueError:
        raise HTTPException(422, "Vencimento invalido. Informe um dia fechado da janela (AAAA-MM-DD).")
    if page < 1 or page > atrasados.PAGINA_MAX:
        raise HTTPException(422, f"Pagina invalida. Informe entre 1 e {atrasados.PAGINA_MAX}.")
    return atrasados.obter_atrasados_dia(canal, vencimento=dia, brands=brands, pagina=page)


@router.get("/ldr/pedidos")
def ldr_ml_pedidos(
    vencimento: str = Query(..., description="Dia do prazo (AAAA-MM-DD), ja' fechado."),
    brands: Optional[list[str]] = Depends(brands_query),
    page: int = Query(1, description=f"Pagina ({atrasados.TAMANHO_PAGINA} pedidos)."),
):
    return _pedidos_do_dia("mercadolivre", vencimento, brands, page)


#: Reserva da coluna Shopee da faixa do topo (ver `shopee_ldr_dm_service`).
#: Fora do prefixo `/ml`, mas na mesma flag e no mesmo arquivo de rotas da faixa.
router_shopee = APIRouter(prefix="/api/v1/expedicao/shopee", tags=["expedicao"],
                          dependencies=[Depends(exigir_flag)])


@router_shopee.get("/ldr-datamart")
def ldr_shopee_datamart(
    days: int = Query(7, description="Dias fechados ate' ontem (1 a 30)."),
    brands: Optional[list[str]] = Depends(brands_query),
):
    if days < 1 or days > shopee_dm.JANELA_MAX_DIAS:
        raise HTTPException(422, f"Janela invalida. Informe entre 1 e {shopee_dm.JANELA_MAX_DIAS} dias.")
    return shopee_dm.obter_ldr_shopee_dm(dias=days, brands=brands)


@router_shopee.get("/ldr/pedidos")
def ldr_shopee_pedidos(
    vencimento: str = Query(..., description="Dia do prazo (AAAA-MM-DD), ja' fechado."),
    brands: Optional[list[str]] = Depends(brands_query),
    page: int = Query(1, description=f"Pagina ({atrasados.TAMANHO_PAGINA} pedidos)."),
):
    return _pedidos_do_dia("shopee", vencimento, brands, page)
