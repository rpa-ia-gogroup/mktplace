"""
Testes de pipelines/connectors/shopee/_parser_ads.py — mesma classe de
correção do parser numérico (thousand separator / valor inválido / fail-fast)
que _parser.py, mas para o CSV de anúncios (Despesas, GMV, Impressões, Cliques).
"""
from __future__ import annotations

import csv
import io
import logging
import traceback
from datetime import date, datetime, timedelta

import pytest

from pipelines.connectors.shopee import _parser_ads
from pipelines.connectors.shopee._numeric import ShopeeNumericParseError

HEADER = ["#", "Impressões", "Cliques", "Despesas", "GMV"]

#: Sentinela: "use a criação válida padrão" (dia seguinte ao fim do período).
_CRIACAO_PADRAO = object()


def _criacao_valida(period: str) -> str:
    """Export fechado: criado no dia SEGUINTE ao fim do período, de manhã —
    a forma dos exports limpos reais (ex.: 14/09–22/09 criado 23/09 09:34)."""
    fim = datetime.strptime(period.split(" - ")[1].strip(), "%d/%m/%Y").date()
    return f"{fim + timedelta(days=1):%d/%m/%Y} 09:34"


def _write_ads_csv(path, period="01/01/2026 - 31/01/2026", rows=(), criacao=_CRIACAO_PADRAO):
    """`criacao`: valor bruto da linha de criação; None omite a linha."""
    if criacao is _CRIACAO_PADRAO:
        criacao = _criacao_valida(period)
    preamble = [
        "Relatório de Todos os Anúncios CPC - Shopee Brasil\n",
        "Nome de Usuário,marca_teste\n",
        "Nome da loja,Marca Teste\n",
        "ID da Loja,123456\n",
        *([f"Data de Criação do Relatório,{criacao}\n"] if criacao is not None else []),
        f"Período,{period}\n",
        "\n",
    ]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(HEADER)
    for i, row in enumerate(rows, start=1):
        writer.writerow([i, row["impressoes"], row["cliques"], row["despesas"], row["gmv"]])

    path.write_text("".join(preamble) + buf.getvalue(), encoding="utf-8-sig")


def test_parse_brand_ads_formato_real_ponto_decimal(tmp_path):
    """Formato real confirmado: ponto decimal, sem separador de milhar."""
    brand_dir = tmp_path / "apice"
    brand_dir.mkdir()
    _write_ads_csv(
        brand_dir / "Dados+Gerais+de+Anúncios+Shopee-01_01_2026-31_01_2026.csv",
        rows=[{"impressoes": "90808", "cliques": "2032", "despesas": "1133.83", "gmv": "11298.96"}],
    )

    result = _parser_ads.parse_brand_ads(tmp_path, "apice")

    assert len(result) == 31  # janeiro/2026
    day = result[0]
    assert day["ad_spend"] == round(1133.83 / 31, 2)
    assert day["ad_revenue"] == round(11298.96 / 31, 2)


def test_parse_brand_ads_separador_de_milhar_br_apos_correcao(tmp_path):
    """Formato BR com milhar não observado nos exports reais (o CSV usa ','
    como delimitador de coluna, então um número BR real exigiria o campo
    entre aspas — provável razão pela qual o export sempre usa ponto
    decimal). Suportado mesmo assim como proteção; antes da correção, o
    valor virava 0.0 silenciosamente."""
    brand_dir = tmp_path / "apice"
    brand_dir.mkdir()
    _write_ads_csv(
        brand_dir / "Dados+Gerais+de+Anúncios+Shopee-01_01_2026-31_01_2026.csv",
        rows=[{"impressoes": "1000", "cliques": "10", "despesas": "1.234,56", "gmv": "5.000,00"}],
    )

    result = _parser_ads.parse_brand_ads(tmp_path, "apice")

    assert len(result) == 31
    assert result[0]["ad_spend"] == round(1234.56 / 31, 2)
    assert result[0]["ad_revenue"] == round(5000.00 / 31, 2)


def test_parse_brand_ads_valor_invalido_interrompe_com_erro_controlado(tmp_path):
    """Fail-fast: valor não vazio e inválido nunca vira 0.0 — a exceção
    propaga com contexto sanitizado (marca/arquivo/índice/campo), nunca
    o valor bruto da célula."""
    brand_dir = tmp_path / "apice"
    brand_dir.mkdir()
    file_name = "Dados+Gerais+de+Anúncios+Shopee-01_01_2026-31_01_2026.csv"
    _write_ads_csv(
        brand_dir / file_name,
        rows=[{"impressoes": "1000", "cliques": "10", "despesas": "nao_numerico", "gmv": "500.00"}],
    )

    with pytest.raises(ShopeeNumericParseError) as excinfo:
        _parser_ads.parse_brand_ads(tmp_path, "apice")

    message = str(excinfo.value)
    assert "apice" in message
    assert file_name in message
    assert "spend" in message
    assert "nao_numerico" not in message


def test_parse_brand_ads_valor_invalido_nao_encadeia_cause_context_nem_vaza_no_traceback(tmp_path):
    """Endurecimento: __cause__/__context__ None e traceback FORMATADO
    (não só str(exc)) nunca contém o valor bruto da célula inválida."""
    brand_dir = tmp_path / "apice"
    brand_dir.mkdir()
    valor_ficticio_sensivel = "vazamento_ficticio_telefone_+5511988887777"
    _write_ads_csv(
        brand_dir / "Dados+Gerais+de+Anúncios+Shopee-01_01_2026-31_01_2026.csv",
        rows=[{"impressoes": "1000", "cliques": "10", "despesas": valor_ficticio_sensivel, "gmv": "500.00"}],
    )

    with pytest.raises(ShopeeNumericParseError) as excinfo:
        _parser_ads.parse_brand_ads(tmp_path, "apice")

    exc = excinfo.value
    assert exc.__cause__ is None
    assert exc.__context__ is None

    formatted = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    assert valor_ficticio_sensivel not in formatted


# --- T-0094: recusa de export com o dia corrente (D0) dentro ----------------
#
# Regra: o arquivo só entra se a `Data de Criação do Relatório` for de um dia
# ESTRITAMENTE posterior ao fim do período. Recusa vale para UM arquivo (os
# outros da marca seguem) e deixa o dia SEM linha de Ads — nunca 0.

_PERIODO_JAN = "01/01/2026 - 31/01/2026"
_UM_ANUNCIO = [{"impressoes": "31000", "cliques": "310", "despesas": "3100.00", "gmv": "31000.00"}]


def _recusas(caplog):
    return [r.getMessage() for r in caplog.records
            if r.levelno == logging.WARNING and "RECUSADO" in r.getMessage()]


def test_criacao_no_dia_seguinte_ao_fim_do_periodo_e_aceita(tmp_path, caplog):
    """Fronteira: 00:00 do dia seguinte já é dia fechado."""
    d = tmp_path / "apice"; d.mkdir()
    _write_ads_csv(d / "Dados-jan.csv", period=_PERIODO_JAN, rows=_UM_ANUNCIO,
                   criacao="01/02/2026 00:00")

    with caplog.at_level(logging.WARNING, logger=_parser_ads.__name__):
        result = _parser_ads.parse_brand_ads(tmp_path, "apice")

    assert len(result) == 31
    assert result[0]["ad_spend"] == 100.00
    assert _recusas(caplog) == []


@pytest.mark.parametrize("criacao", ["31/01/2026 23:59", "31/01/2026 00:00"])
def test_criacao_no_ultimo_dia_do_periodo_recusa_d0_parcial(tmp_path, caplog, criacao):
    """O caso real: `22/09–29/09` criado em 29/09 11:47 — total com o dia
    corrente parcial, rateado por igual em todos os dias fechados."""
    d = tmp_path / "apice"; d.mkdir()
    _write_ads_csv(d / "Dados-jan.csv", period=_PERIODO_JAN, rows=_UM_ANUNCIO, criacao=criacao)

    with caplog.at_level(logging.WARNING, logger=_parser_ads.__name__):
        result = _parser_ads.parse_brand_ads(tmp_path, "apice")

    assert result == []                       # sem linha: nem rateio, nem 0
    [msg] = _recusas(caplog)
    assert "motivo=D0_PARCIAL" in msg
    assert "Dados-jan.csv" in msg and "apice" in msg
    assert "criacao=2026-01-31" in msg


def test_criacao_antes_do_fim_do_periodo_recusa_d0_parcial(tmp_path, caplog):
    d = tmp_path / "apice"; d.mkdir()
    _write_ads_csv(d / "Dados-jan.csv", period=_PERIODO_JAN, rows=_UM_ANUNCIO,
                   criacao="15/01/2026 10:00")

    with caplog.at_level(logging.WARNING, logger=_parser_ads.__name__):
        result = _parser_ads.parse_brand_ads(tmp_path, "apice")

    assert result == []
    [msg] = _recusas(caplog)
    assert "motivo=D0_PARCIAL" in msg and "criacao=2026-01-15" in msg


def test_criacao_ausente_recusa(tmp_path, caplog):
    """Sem data de criação não há prova de que o arquivo está fechado."""
    d = tmp_path / "apice"; d.mkdir()
    _write_ads_csv(d / "Dados-jan.csv", period=_PERIODO_JAN, rows=_UM_ANUNCIO, criacao=None)

    with caplog.at_level(logging.WARNING, logger=_parser_ads.__name__):
        result = _parser_ads.parse_brand_ads(tmp_path, "apice")

    assert result == []
    [msg] = _recusas(caplog)
    assert "motivo=CRIACAO_AUSENTE" in msg and "criacao=-" in msg


@pytest.mark.parametrize("criacao", [
    "2026-02-01 10:00",        # ISO: outro formato
    "01/02/2026",              # sem hora: outro formato
    "32/01/2026 10:00",        # data impossível
    "",                        # rótulo sem valor
    "ontem",
])
def test_criacao_ilegivel_recusa(tmp_path, caplog, criacao):
    d = tmp_path / "apice"; d.mkdir()
    _write_ads_csv(d / "Dados-jan.csv", period=_PERIODO_JAN, rows=_UM_ANUNCIO, criacao=criacao)

    with caplog.at_level(logging.WARNING, logger=_parser_ads.__name__):
        result = _parser_ads.parse_brand_ads(tmp_path, "apice")

    assert result == []
    [msg] = _recusas(caplog)
    assert "motivo=CRIACAO_ILEGIVEL" in msg


def test_contaminado_de_date_to_maior_nao_vence_o_limpo(tmp_path):
    """O defeito do desempate: vence o maior `date_to`, então o export
    contaminado `22/09–29/09` (criado 29/09) ganharia do limpo `14/09–22/09`
    (criado 23/09) em 22/09. Como a recusa vem ANTES do desempate, o
    contaminado nem concorre: 22/09 fica com o limpo e 23–29/09 ficam sem
    linha (não 0)."""
    d = tmp_path / "apice"; d.mkdir()
    # Taxas diárias diferentes: limpo 450/9 = 50,00; contaminado 800/8 = 100,00.
    _write_ads_csv(d / "Dados-limpo.csv", period="14/09/2026 - 22/09/2026",
                   criacao="23/09/2026 09:34",
                   rows=[{"impressoes": "9000", "cliques": "90", "despesas": "450.00", "gmv": "4500.00"}])
    _write_ads_csv(d / "Dados-contaminado.csv", period="22/09/2026 - 29/09/2026",
                   criacao="29/09/2026 11:47",
                   rows=[{"impressoes": "8000", "cliques": "80", "despesas": "800.00", "gmv": "8000.00"}])

    # Sem a recusa o contaminado venceria: a chave dele é maior.
    assert _parser_ads._chave_de_ordem((date(2026, 9, 22), date(2026, 9, 29))) > \
        _parser_ads._chave_de_ordem((date(2026, 9, 14), date(2026, 9, 22)))

    porta = {l["date"]: l for l in _parser_ads.parse_brand_ads(tmp_path, "apice")}

    assert porta[date(2026, 9, 22)]["ad_spend"] == 50.00
    assert porta[date(2026, 9, 14)]["ad_spend"] == 50.00
    assert all(date(2026, 9, 23) + timedelta(days=i) not in porta for i in range(7))
    assert len(porta) == 9


def test_reexport_contaminado_nao_troca_o_valor_limpo_ja_coberto(tmp_path):
    """A armadilha no disco: `29/09–12/10` (limpo, criado 13/10) e
    `29/09–13/10` (criado 13/10, D0 dentro). Antes, qualquer backfill trocava
    29/09–12/10 pelo contaminado; agora o limpo fica sozinho."""
    d = tmp_path / "apice"; d.mkdir()
    _write_ads_csv(d / "Dados-29_09_2026-12_10_2026 (1).csv", period="29/09/2026 - 12/10/2026",
                   criacao="13/10/2026 10:49",
                   rows=[{"impressoes": "14000", "cliques": "140", "despesas": "1400.00", "gmv": "14000.00"}])
    _write_ads_csv(d / "Dados-29_09_2026-13_10_2026.csv", period="29/09/2026 - 13/10/2026",
                   criacao="13/10/2026 09:01",
                   rows=[{"impressoes": "15000", "cliques": "150", "despesas": "1200.00", "gmv": "12000.00"}])

    porta = {l["date"]: l for l in _parser_ads.parse_brand_ads(tmp_path, "apice")}

    assert len(porta) == 14
    assert porta[date(2026, 10, 1)]["ad_spend"] == 100.00
    assert date(2026, 10, 13) not in porta


def test_rotulo_de_criacao_tolera_nfd_bom_e_crlf():
    """Mesma tolerância do rótulo de período: recusar um cabeçalho legítimo
    por um `ç` decomposto custaria o arquivo inteiro."""
    import unicodedata
    fim = date(2026, 9, 22)
    for linha in (
        "Data de Criação do Relatório,23/09/2026 09:34\n",
        unicodedata.normalize("NFD", "Data de Criação do Relatório,23/09/2026 09:34"),
        "﻿Data de Criação do Relatório,23/09/2026 09:34\r\n",
        "  Data de Criação do Relatório,23/09/2026 09:34",
    ):
        assert _parser_ads._motivo_de_recusa_por_criacao([linha], fim) == (None, date(2026, 9, 23))
    # rótulo errado = ausente, não aceito
    assert _parser_ads._motivo_de_recusa_por_criacao(
        ["Data de Criacao do Relatorio,23/09/2026 09:34"], fim) == ("CRIACAO_AUSENTE", None)
