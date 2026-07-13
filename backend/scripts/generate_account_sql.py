#!/usr/bin/env python3
"""Turn a CRM Review Hub decisions export (.xlsx) into apply-stage artifacts.

Input : the Excel a reviewer exported from the app -- EITHER the inactive-
        accounts decisions OR the duplicate-accounts decisions. The type is
        auto-detected from the columns.

Output (next to the input file, same stem):
  <stem>_account_updates.sql   guarded, transaction-wrapped field updates
                               (Archive -> deactivate; Delete -> DELETE)
  <stem>_merges.json           subordinate->master pairs for the Web API
                               Merge action (merges CANNOT be plain SQL)
  <stem>_skipped.csv           every row not turned into an action, with why

Read this before running anything
---------------------------------
1. The Dataverse SQL (TDS) endpoint is READ-ONLY. `UPDATE`/`DELETE account`
   will not execute against it. Run the .sql against a writable replica, or
   translate it to Web API PATCH/DELETE. The .sql defaults to ROLLBACK.
2. MERGES ARE NOT IN THE .sql ON PURPOSE. A merge must go through Dataverse's
   Web API `Merge` action, which reparents the subordinate's contacts,
   opportunities, cases and activities onto the master. A hand-written
   `masterid`/`statecode` UPDATE would deactivate the loser but ORPHAN its
   children. Those pairs are written to <stem>_merges.json for a Web API step.
3. DELETE is destructive and unrecoverable. The DELETE section is wrapped in a
   transaction that ROLLBACKs by default and guards on `merged = 1` for
   already-merged stubs, so it can only remove leftover merge stubs unless you
   loosen it deliberately.

Usage:
  python generate_account_sql.py path/to/decisions.xlsx
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

GUID_RE = re.compile(
    r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
)


def sql_str(v: str) -> str:
    return "N'" + str(v).replace("'", "''") + "'"


def is_guid(v) -> bool:
    return isinstance(v, str) and bool(GUID_RE.match(v.strip()))


def load_all_decision_rows(path: Path) -> tuple[pd.DataFrame, str]:
    """Read every non-Summary sheet into one frame; detect export type."""
    sheets = pd.read_excel(path, sheet_name=None, dtype=str, keep_default_na=False)
    frames = [df for name, df in sheets.items() if name.lower() != "summary" and not df.empty]
    if not frames:
        raise SystemExit("No decision rows found in the workbook.")
    df = pd.concat(frames, ignore_index=True)
    if "cluster_id" in df.columns:
        return df, "duplicate"
    if "dormancy_tier" in df.columns:
        return df, "inactive"
    raise SystemExit(
        "Could not tell if this is an inactive or duplicate export "
        "(missing both 'cluster_id' and 'dormancy_tier' columns)."
    )


def build_inactive(df: pd.DataFrame):
    """-> (deactivate[accountid,name], deletes[accountid,name],
           merges[{subordinate,master,...}], skips[{...}])"""
    deactivate, deletes, merges, skips = [], [], [], []
    for _, r in df.iterrows():
        acc, name, dec = r.get("accountid", ""), r.get("name", ""), (r.get("decision") or "").strip()
        if not is_guid(acc):
            continue  # header/blank artifacts from concatenated sheets
        if dec == "Archive":
            deactivate.append({"accountid": acc, "name": name})
        elif dec == "Delete":
            deletes.append({"accountid": acc, "name": name})
        elif dec == "Merge":
            target = (r.get("merge_target_accountid") or "").strip()
            if is_guid(target):
                merges.append({"subordinate_accountid": acc, "subordinate_name": name,
                               "master_accountid": target, "master_name": r.get("merge_target_name", "")})
            else:
                skips.append({"accountid": acc, "name": name, "decision": dec,
                              "reason": "Merge with no valid merge_target_accountid"})
        # Keep / blank -> nothing to do
    return deactivate, deletes, merges, skips


def build_duplicate(df: pd.DataFrame):
    # master of each cluster = the row flagged is_primary = 1
    primary_by_cluster = {}
    for _, r in df.iterrows():
        if str(r.get("is_primary", "")).strip() in ("1", "1.0", "True", "true"):
            primary_by_cluster[r.get("cluster_id", "")] = (r.get("accountid", ""), r.get("name", ""))

    deactivate, deletes, merges, skips = [], [], [], []
    for _, r in df.iterrows():
        acc, name, dec = r.get("accountid", ""), r.get("name", ""), (r.get("decision") or "").strip()
        if not is_guid(acc):
            continue
        if dec == "Merge":
            master = primary_by_cluster.get(r.get("cluster_id", ""))
            if master and is_guid(master[0]) and master[0] != acc:
                merges.append({"subordinate_accountid": acc, "subordinate_name": name,
                               "master_accountid": master[0], "master_name": master[1],
                               "cluster_id": r.get("cluster_id", "")})
            else:
                skips.append({"accountid": acc, "name": name, "decision": dec,
                              "reason": "Merge but no confirmed primary in the cluster"})
        elif dec == "Delete":
            deletes.append({"accountid": acc, "name": name})
        # Not a duplicate / Keep separate / blank -> nothing to do
    return deactivate, deletes, merges, skips


def write_sql(path: Path, deactivate, deletes, stamp: str, kind: str) -> None:
    # Duplicate "Delete" targets already-merged leftover stubs (no children --
    # they were reparented at merge time), so guard on merged = 1. Inactive
    # "Delete" targets dormant accounts, which are not merged; guard on
    # statecode = 1 instead, so an Active account can never be deleted by
    # accident. Deleting an account with live children still needs the Web API
    # (it applies the cascade rules) -- raw SQL here is a last resort.
    if kind == "duplicate":
        delete_guard = "merged = 1"
        delete_note = "Guarded on merged = 1 (only removes already-merged leftover stubs)."
    else:
        delete_guard = "statecode = 1"
        delete_note = "Guarded on statecode = 1 (never deletes an Active account). Prefer the Web API for accounts that still have contacts/opportunities."
    lines = [
        "-- ============================================================",
        f"-- CRM Review Hub -- account field updates. Generated {stamp}.",
        "-- The Dataverse TDS endpoint is READ-ONLY: run against a writable",
        "-- replica or translate to Web API. MERGES are NOT here (see the",
        "-- _merges.json file -- they must use the Web API Merge action).",
        "-- ============================================================",
        "",
        "BEGIN TRANSACTION;",
        "",
    ]

    if deactivate:
        lines.append(f"-- Deactivate (Archive): {len(deactivate)} account(s). Idempotent: only touches still-Active rows.")
        for d in deactivate:
            lines.append(f"-- {d['name']}")
            lines.append(
                f"UPDATE account SET statecode = 1, statuscode = 2 "
                f"WHERE accountid = '{d['accountid']}' AND statecode = 0;"
            )
        lines.append("")

    if deletes:
        lines.append("-- ---------------------------------------------------------")
        lines.append(f"-- DESTRUCTIVE DELETE: {len(deletes)} account(s).")
        lines.append(f"-- {delete_note} Review carefully.")
        lines.append("-- ---------------------------------------------------------")
        for d in deletes:
            lines.append(f"-- {d['name']}")
            lines.append(f"DELETE FROM account WHERE accountid = '{d['accountid']}' AND {delete_guard};")
        lines.append("")

    if not deactivate and not deletes:
        lines.append("-- (No field updates or deletes in this export -- all actionable")
        lines.append("--  decisions were merges; see the _merges.json file.)")
        lines.append("")

    lines += [
        "-- COMMIT TRANSACTION;   -- uncomment to apply",
        "ROLLBACK TRANSACTION;    -- delete this line to apply",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate apply-stage SQL/merge artifacts from a decisions .xlsx")
    ap.add_argument("input", type=Path, help="decisions .xlsx exported from the app")
    args = ap.parse_args()

    if not args.input.exists():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 1

    df, kind = load_all_decision_rows(args.input)
    deactivate, deletes, merges, skips = (build_inactive if kind == "inactive" else build_duplicate)(df)

    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    stem = args.input.with_suffix("")
    sql_path = Path(f"{stem}_account_updates.sql")
    merges_path = Path(f"{stem}_merges.json")
    skipped_path = Path(f"{stem}_skipped.csv")

    write_sql(sql_path, deactivate, deletes, stamp, kind)
    merges_path.write_text(json.dumps(merges, ensure_ascii=False, indent=2), encoding="utf-8")
    with skipped_path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["accountid", "name", "decision", "reason"])
        w.writeheader()
        w.writerows(skips)

    print("=" * 60)
    print(f"CRM REVIEW HUB -- APPLY ARTIFACTS ({kind} export)")
    print("=" * 60)
    print(f"Deactivate (Archive) : {len(deactivate)}")
    print(f"Delete (stubs)       : {len(deletes)}")
    print(f"Merge (Web API)      : {len(merges)}")
    print(f"Skipped              : {len(skips)}")
    print("=" * 60)
    print(f"Wrote {sql_path.name}   (field updates -- ROLLBACK by default)")
    print(f"Wrote {merges_path.name}   (merge pairs for the Web API Merge action)")
    print(f"Wrote {skipped_path.name}")
    if merges:
        print("\nReminder: merges are NOT in the .sql -- run them through the")
        print("Web API Merge action so contacts/opportunities reparent onto the master.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
