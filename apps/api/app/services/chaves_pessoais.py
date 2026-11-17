"""CHAVES-PESSOAIS — chaves `torre_pat_...` do MCP e da API REST (migration 049).

A chave e' `torre_pat_` + 32 bytes aleatorios em base64url. Mostrada UMA vez,
na criacao; o banco guarda so' o SHA-256. Nada aqui loga ou devolve a chave
nem o hash. As funcoes recebem a sessao/conexao SQLAlchemy e o `agora`, para
serem testaveis sem relogio nem Postgres.
"""
from __future__ import annotations

import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import DateTime, text

PREFIXO = "torre_pat_"
DIAS_PADRAO = 90
DIAS_MAXIMO = 365
_FORMATO = re.compile(r"^torre_pat_[A-Za-z0-9_-]{43}$")
_DATAS = {c: DateTime(timezone=True) for c in ("criada_em", "expira_em", "revogada_em", "ultimo_uso_em")}
_COLUNAS = "id, nome, dono_email, criada_por, criada_em, expira_em, revogada_em, ultimo_uso_em"


@dataclass(frozen=True)
class DonoDaChave:
    id: int
    nome: str
    dono_email: str
    expira_em: datetime


def gerar() -> str:
    return PREFIXO + secrets.token_urlsafe(32)


def hash_chave(chave: str) -> str:
    return hashlib.sha256(chave.encode("utf-8")).hexdigest()


def formato_valido(chave: Optional[str]) -> bool:
    return isinstance(chave, str) and _FORMATO.fullmatch(chave) is not None


def validar(db, chave: Optional[str], agora: datetime) -> Optional[DonoDaChave]:
    """Dono da chave se valida (nao revogada, nao vencida), marcando o ultimo uso."""
    if not formato_valido(chave):
        return None
    r = db.execute(
        text(
            "UPDATE audit.torre_chave_pessoal SET ultimo_uso_em = :agora "
            "WHERE hash_chave = :h AND revogada_em IS NULL AND expira_em > :agora "
            "RETURNING id, nome, dono_email, expira_em"
        ).columns(expira_em=_DATAS["expira_em"]),
        {"agora": agora, "h": hash_chave(chave)},
    ).mappings().first()
    db.commit()
    return DonoDaChave(r["id"], r["nome"], r["dono_email"], r["expira_em"]) if r else None


def criar(db, *, nome: str, dono_email: str, criada_por: str, dias: int, agora: datetime) -> tuple[str, dict]:
    """Devolve (chave, linha). A chave so' existe neste retorno."""
    chave = gerar()
    r = db.execute(
        text(
            "INSERT INTO audit.torre_chave_pessoal "
            "(nome, dono_email, hash_chave, criada_por, criada_em, expira_em) "
            "VALUES (:nome, :dono, :h, :por, :agora, :expira) RETURNING " + _COLUNAS
        ).columns(**_DATAS),
        {"nome": nome, "dono": dono_email, "h": hash_chave(chave), "por": criada_por,
         "agora": agora, "expira": agora + timedelta(days=dias)},
    ).mappings().first()
    db.commit()
    return chave, dict(r)


def listar(db) -> list[dict]:
    rows = db.execute(
        text(f"SELECT {_COLUNAS} FROM audit.torre_chave_pessoal ORDER BY criada_em DESC, id DESC").columns(**_DATAS)
    ).mappings().all()
    db.rollback()  # fim da leitura: nao deixa transacao aberta
    return [dict(r) for r in rows]


def revogar(db, chave_id: int, agora: datetime) -> bool:
    r = db.execute(
        text(
            "UPDATE audit.torre_chave_pessoal SET revogada_em = :agora "
            "WHERE id = :id AND revogada_em IS NULL RETURNING id"
        ),
        {"agora": agora, "id": chave_id},
    ).first()
    db.commit()
    return r is not None
