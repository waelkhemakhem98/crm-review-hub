"""FastAPI backend for the shared CRM Review Hub app.

Serves the reference candidate/cluster data (read-only, rebuilt from the
pipeline CSVs by build_db.py) and the shared decision state multiple
reviewers read and write concurrently (backed by SQLite -- see db.py).
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

import export_xlsx
from db import get_connection, init_schema


@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = get_connection()
    init_schema(conn)
    conn.close()
    yield


app = FastAPI(title="CRM Review Hub API", lifespan=lifespan)

# Wide open: this is an internal tool behind nginx in production (same-origin,
# so CORS is moot there); left permissive so `npm run dev` can also talk to a
# locally-running backend directly during development.
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Inactive accounts
# ---------------------------------------------------------------------------

@app.get("/api/inactive/candidates")
def get_inactive_candidates():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM inactive_candidates").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/inactive/account-index")
def get_account_index():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM account_index").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/inactive/decisions")
def get_inactive_decisions():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM inactive_decisions").fetchall()
    conn.close()
    return {r["accountid"]: dict(r) for r in rows}


class InactiveDecisionPatch(BaseModel):
    decision: Optional[str] = None
    merge_target_accountid: Optional[str] = None
    merge_target_name: Optional[str] = None
    note: Optional[str] = None
    reviewer: Optional[str] = None


def _merge_patch(existing: dict, patch: dict, defaults: dict) -> dict:
    merged = dict(defaults)
    merged.update(existing)
    for k, v in patch.items():
        if v is not None:
            merged[k] = v
    return merged


@app.put("/api/inactive/decisions/{accountid}")
def put_inactive_decision(accountid: str, patch: InactiveDecisionPatch):
    conn = get_connection()
    existing = conn.execute("SELECT * FROM inactive_decisions WHERE accountid = ?", (accountid,)).fetchone()
    existing = dict(existing) if existing else {}
    merged = _merge_patch(
        existing, patch.model_dump(),
        {"decision": "", "merge_target_accountid": "", "merge_target_name": "", "note": "", "reviewer": ""},
    )
    merged["accountid"] = accountid
    merged["decided_at"] = now_iso()
    conn.execute(
        """INSERT INTO inactive_decisions
           (accountid, decision, merge_target_accountid, merge_target_name, note, reviewer, decided_at)
           VALUES (:accountid, :decision, :merge_target_accountid, :merge_target_name, :note, :reviewer, :decided_at)
           ON CONFLICT(accountid) DO UPDATE SET
             decision=excluded.decision, merge_target_accountid=excluded.merge_target_accountid,
             merge_target_name=excluded.merge_target_name, note=excluded.note,
             reviewer=excluded.reviewer, decided_at=excluded.decided_at""",
        merged,
    )
    conn.commit()
    conn.close()
    return merged


class BulkDecisionRequest(BaseModel):
    accountids: list[str]
    decision: str
    reviewer: str


@app.post("/api/inactive/decisions/bulk")
def bulk_inactive_decisions(req: BulkDecisionRequest):
    conn = get_connection()
    now = now_iso()
    for accountid in req.accountids:
        existing = conn.execute("SELECT * FROM inactive_decisions WHERE accountid = ?", (accountid,)).fetchone()
        existing = dict(existing) if existing else {}
        conn.execute(
            """INSERT INTO inactive_decisions
               (accountid, decision, merge_target_accountid, merge_target_name, note, reviewer, decided_at)
               VALUES (:accountid, :decision, :merge_target_accountid, :merge_target_name, :note, :reviewer, :decided_at)
               ON CONFLICT(accountid) DO UPDATE SET
                 decision=excluded.decision, reviewer=excluded.reviewer, decided_at=excluded.decided_at""",
            {
                "accountid": accountid,
                "decision": req.decision,
                "merge_target_accountid": existing.get("merge_target_accountid", ""),
                "merge_target_name": existing.get("merge_target_name", ""),
                "note": existing.get("note", ""),
                "reviewer": req.reviewer,
                "decided_at": now,
            },
        )
    conn.commit()
    conn.close()
    return {"updated": len(req.accountids)}


@app.get("/api/inactive/export.xlsx")
def export_inactive_xlsx():
    content = export_xlsx.build_inactive_xlsx()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=inactive_accounts_decisions.xlsx"},
    )


# ---------------------------------------------------------------------------
# Duplicate accounts
# ---------------------------------------------------------------------------

@app.get("/api/duplicates/clusters")
def get_clusters():
    conn = get_connection()
    clusters = conn.execute(
        "SELECT * FROM duplicate_clusters ORDER BY cluster_size DESC, cluster_id"
    ).fetchall()
    members = conn.execute("SELECT * FROM duplicate_cluster_members").fetchall()
    conn.close()

    by_cluster: dict[str, list[dict]] = {}
    for m in members:
        by_cluster.setdefault(m["cluster_id"], []).append(dict(m))

    result = []
    for c in clusters:
        c = dict(c)
        c["signals"] = c["signals"].split(";") if c["signals"] else []
        c["members"] = by_cluster.get(c["cluster_id"], [])
        result.append(c)
    return result


@app.get("/api/accounts/{accountid}/contacts")
def get_account_contacts(accountid: str):
    conn = get_connection()
    rows = conn.execute(
        "SELECT fullname, email FROM account_contacts WHERE accountid = ? ORDER BY fullname",
        (accountid,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/duplicates/decisions")
def get_duplicate_decisions():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM duplicate_decisions").fetchall()
    conn.close()
    return {r["accountid"]: dict(r) for r in rows}


@app.get("/api/duplicates/primary-choices")
def get_primary_choices():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM duplicate_primary_choices").fetchall()
    conn.close()
    return {r["cluster_id"]: dict(r) for r in rows}


class DuplicateDecisionPatch(BaseModel):
    decision: Optional[str] = None
    note: Optional[str] = None
    reviewer: Optional[str] = None


@app.put("/api/duplicates/decisions/{accountid}")
def put_duplicate_decision(accountid: str, patch: DuplicateDecisionPatch):
    conn = get_connection()
    existing = conn.execute("SELECT * FROM duplicate_decisions WHERE accountid = ?", (accountid,)).fetchone()
    existing = dict(existing) if existing else {}
    merged = _merge_patch(existing, patch.model_dump(), {"decision": "", "note": "", "reviewer": ""})
    merged["accountid"] = accountid
    merged["decided_at"] = now_iso()
    conn.execute(
        """INSERT INTO duplicate_decisions (accountid, decision, note, reviewer, decided_at)
           VALUES (:accountid, :decision, :note, :reviewer, :decided_at)
           ON CONFLICT(accountid) DO UPDATE SET
             decision=excluded.decision, note=excluded.note, reviewer=excluded.reviewer,
             decided_at=excluded.decided_at""",
        merged,
    )
    conn.commit()
    conn.close()
    return merged


class DuplicateBulkRequest(BaseModel):
    accountids: list[str]
    decision: str
    reviewer: str


@app.post("/api/duplicates/decisions/bulk")
def bulk_duplicate_decisions(req: DuplicateBulkRequest):
    conn = get_connection()
    now = now_iso()
    for accountid in req.accountids:
        existing = conn.execute("SELECT * FROM duplicate_decisions WHERE accountid = ?", (accountid,)).fetchone()
        existing = dict(existing) if existing else {}
        conn.execute(
            """INSERT INTO duplicate_decisions (accountid, decision, note, reviewer, decided_at)
               VALUES (:accountid, :decision, :note, :reviewer, :decided_at)
               ON CONFLICT(accountid) DO UPDATE SET
                 decision=excluded.decision, reviewer=excluded.reviewer, decided_at=excluded.decided_at""",
            {"accountid": accountid, "decision": req.decision, "note": existing.get("note", ""),
             "reviewer": req.reviewer, "decided_at": now},
        )
    conn.commit()
    conn.close()
    return {"updated": len(req.accountids)}


class PrimaryChoiceRequest(BaseModel):
    accountid: str
    reviewer: str


@app.put("/api/duplicates/primary-choices/{cluster_id}")
def set_primary_choice(cluster_id: str, req: PrimaryChoiceRequest):
    conn = get_connection()
    row = {"cluster_id": cluster_id, "accountid": req.accountid, "reviewer": req.reviewer,
           "decided_at": now_iso()}
    conn.execute(
        """INSERT INTO duplicate_primary_choices (cluster_id, accountid, reviewer, decided_at)
           VALUES (:cluster_id, :accountid, :reviewer, :decided_at)
           ON CONFLICT(cluster_id) DO UPDATE SET
             accountid=excluded.accountid, reviewer=excluded.reviewer, decided_at=excluded.decided_at""",
        row,
    )
    conn.commit()
    conn.close()
    return row


@app.get("/api/duplicates/export.xlsx")
def export_duplicates_xlsx():
    content = export_xlsx.build_duplicates_xlsx()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=duplicate_accounts_decisions.xlsx"},
    )
