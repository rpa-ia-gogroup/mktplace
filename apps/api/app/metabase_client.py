"""
Cliente HTTP para a API REST do Metabase.
Usado como fonte de dados quando o banco local não está disponível.
"""
from __future__ import annotations

import json

import httpx

from app.config import settings


#: Espera padrao por uma consulta. Quem sabe que a sua e' pesada pede mais
#: (`timeout=`), em vez de todo endpoint esperar o mesmo tanto quando o
#: Metabase trava.
TIMEOUT_PADRAO_S = 60.0


def query(sql: str, timeout: float = TIMEOUT_PADRAO_S) -> list[dict]:
    """
    Executa uma query SQL nativa no Data Mart via Metabase e retorna list[dict].
    Lança httpx.HTTPError se a requisição falhar.
    """
    payload = {
        "database": settings.metabase_database_id,
        "type": "native",
        "native": {"query": sql},
    }
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(
            f"{settings.metabase_url}/api/dataset",
            headers={"x-api-key": settings.metabase_api_key},
            json=payload,
        )
        resp.raise_for_status()
        raw = resp.json()

        # Metabase pode retornar erro na resposta mesmo com HTTP 200
        if "error" in raw:
            raise RuntimeError(f"Metabase query error: {raw['error']}")

        data = raw["data"]
        cols = [c["name"] for c in data["cols"]]
        if not data.get("rows_truncated"):
            return [dict(zip(cols, row)) for row in data["rows"]]

        # /api/dataset corta em 2000 linhas (ignora `constraints`) e o resultado
        # vinha pela metade sem aviso. A exportacao devolve tudo; `format_rows`
        # false = valores crus (data sem hora: '2026-11-02', nao '...T00:00-03:00').
        resp = client.post(
            f"{settings.metabase_url}/api/dataset/json",
            headers={"x-api-key": settings.metabase_api_key},
            data={"query": json.dumps(payload), "format_rows": "false"},
        )
        resp.raise_for_status()
        linhas = resp.json()
        if isinstance(linhas, dict):  # erro da exportacao vem como objeto, nao lista
            raise RuntimeError(f"Metabase export error: {linhas.get('error', 'resposta inesperada')}")
        return [{c: linha.get(c) for c in cols} for linha in linhas]
