from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel

Canal = Literal["tiktok", "ml", "shopee"]


class ProdutoTop(BaseModel):
    posicao: int
    canal: Canal
    #: Codigo do anuncio como foi vendido (kit e' kit): product_id no TikTok,
    #: seller_sku no ML, sku na Shopee. Sem de-para.
    sku: str
    produto: str
    kit: bool
    pecas: float
    receita: float
    preco_medio: Optional[float] = None
    #: Parte da receita da marca nos canais selecionados (0-1).
    share_marca: Optional[float] = None
    pecas_ant: Optional[float] = None
    receita_ant: Optional[float] = None


class ExtraCanal(BaseModel):
    """O que so' um canal sabe, somado no periodo pedido."""
    rotulo: str
    valor: float
    formato: Literal["brl", "num", "vezes"]


class ResumoCanal(BaseModel):
    """Faixa "por canal" da marca: receita e o que aquele canal oferece
    (TikTok: origem do GMV; ML: ads; Shopee: so' a receita)."""
    canal: Canal
    receita: float
    extras: list[ExtraCanal] = []
    aviso_extras: Optional[str] = None


class MarcaTop(BaseModel):
    marca: str
    receita_marca: float
    receita_marca_ant: Optional[float] = None
    produtos: list[ProdutoTop]
    canais: list[ResumoCanal] = []


class TopProdutosResponse(BaseModel):
    inicio: date
    fim: date
    comparacao_inicio: Optional[date] = None
    comparacao_fim: Optional[date] = None
    canais: list[Canal]
    marcas: list[MarcaTop]


class PontoDiario(BaseModel):
    dia: date
    pecas: float
    receita: float


class DetalheProduto(BaseModel):
    canal: Canal
    marca: str
    sku: str
    produto: str
    kit: bool
    #: Serie diaria dos ultimos 12 meses ate o fim do periodo.
    serie: list[PontoDiario]
    extras: list[ExtraCanal]
    #: Quando os extras ainda nao cobrem o periodo (ads do ML chegam D+1).
    aviso_extras: Optional[str] = None


# ---------------------------------------------------------------------------
# COMPARAR-CANAIS — o mesmo produto em cada canal, pela FATIA da marca
# ---------------------------------------------------------------------------
class CelulaCanal(BaseModel):
    """O produto num canal. Canal onde nao vende nao tem celula (nunca 0)."""
    canal: Canal
    #: Receita do produto / receita da marca NESTE canal (0-1). Nunca R$.
    fatia: float
    #: Codigo do anuncio de maior receita do produto neste canal, o mesmo da
    #: rota /top-produtos/detalhe (product_id no TikTok, seller_sku ou item_id
    #: no ML, sku ou item_id na Shopee).
    sku: str


class ProdutoComparado(BaseModel):
    #: SKU normalizado que representa o produto (apelidos e volumes juntados).
    chave: str
    produto: str
    kit: bool
    celulas: list[CelulaCanal]


class CanalComparado(BaseModel):
    canal: Canal
    #: Parte da receita do canal com seller SKU (o que da' para casar), 0-1.
    cobertura: float


class MarcaComparada(BaseModel):
    marca: str
    #: So' os canais onde a marca vendeu no periodo.
    canais: list[CanalComparado]
    #: Top 20 pela maior fatia em qualquer canal; empate pela soma das fatias.
    produtos: list[ProdutoComparado]


class CompararCanaisResponse(BaseModel):
    inicio: date
    fim: date
    marcas: list[MarcaComparada]
