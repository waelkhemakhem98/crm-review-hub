#!/usr/bin/env python3
"""Load the pipeline's candidate CSVs into the SQLite reference tables.

Safe to re-run any time fresh CSVs are dropped into seed/ -- only the
reference tables are DROPped and re-INSERTed; inactive_decisions,
duplicate_decisions, and duplicate_primary_choices (the shared state
reviewers are actively editing) are never touched here.

Usage: python build_db.py [--seed-dir DIR]
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

from db import drop_reference_tables, get_connection, init_schema

HERE = Path(__file__).resolve().parent


def norm(v) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    return "" if s == "" or s.upper() == "NULL" else s


def parse_int(v, default=0) -> int:
    s = norm(v)
    if not s:
        return default
    try:
        return int(float(s))
    except ValueError:
        return default


def load_inactive_candidates(conn, path: Path) -> int:
    with path.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    conn.execute("DELETE FROM inactive_candidates")
    conn.executemany(
        """INSERT INTO inactive_candidates
           (accountid, name, statecode_label, statuscode, industrycode, websiteurl,
            active_contact_count, open_opportunity_count, opendeals, openrevenue,
            last_activity_date, last_activity_source, createdon, modifiedon,
            new_strategicaccount, dormancy_tier, flag_reasons, possible_duplicate_of)
           VALUES (:accountid, :name, :statecode_label, :statuscode, :industrycode, :websiteurl,
                   :active_contact_count, :open_opportunity_count, :opendeals, :openrevenue,
                   :last_activity_date, :last_activity_source, :createdon, :modifiedon,
                   :new_strategicaccount, :dormancy_tier, :flag_reasons, :possible_duplicate_of)""",
        rows,
    )
    return len(rows)


def load_account_index(conn, path: Path) -> int:
    label = {"0": "Active", "1": "Inactive"}
    entries = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if len(row) < 3 or not row[0].strip():
                continue
            accountid = row[0].strip()
            name = norm(row[1])
            statecode = row[2].strip()
            entries.append({"accountid": accountid, "name": name,
                             "statecode_label": label.get(statecode, statecode)})
    conn.execute("DELETE FROM account_index")
    conn.executemany(
        "INSERT INTO account_index (accountid, name, statecode_label) VALUES (:accountid, :name, :statecode_label)",
        entries,
    )
    return len(entries)


def load_account_contacts(conn, path: Path) -> int:
    # contact_email_extract.csv is headerless: contactid, accountid, email, fullname
    entries = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if len(row) < 4 or not row[1].strip():
                continue
            entries.append({
                "accountid": row[1].strip(),
                "contactid": row[0].strip(),
                "email": norm(row[2]),
                "fullname": norm(row[3]),
            })
    conn.execute("DELETE FROM account_contacts")
    conn.executemany(
        "INSERT INTO account_contacts (accountid, contactid, fullname, email) "
        "VALUES (:accountid, :contactid, :fullname, :email)",
        entries,
    )
    return len(entries)


def load_duplicate_clusters(conn, clusters_path: Path, accounts_full_path: Path) -> tuple[int, int]:
    # accounts_full_extract.csv is headerless; columns (from the pull query):
    # 0 accountid, 1 name, 2 websiteurl, 3 address1_line1, 4 address1_city,
    # 5 address1_stateorprovince, 6 address1_postalcode, 7 address1_country,
    # 8 statecode, 9 statuscode, 10 masterid, 11 merged, 12 telephone1,
    # 13 createdon, 14 modifiedon
    names_by_id = {}
    details_by_id: dict[str, dict] = {}
    with accounts_full_path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if len(row) < 15 or not row[0].strip():
                continue
            aid = row[0].strip()
            names_by_id[aid] = row[1].strip()
            details_by_id[aid] = {
                "address1_line1": norm(row[3]),
                "address1_stateorprovince": norm(row[5]),
                "address1_country": norm(row[7]),
                "telephone1": norm(row[12]),
                "statuscode": parse_int(row[9]),
                "modifiedon": norm(row[14]).split(" ")[0] if norm(row[14]) else "",
            }

    # industry/opendeals/openrevenue live on inactive_candidates (already
    # loaded earlier in this build run) -- only for accounts that are inactive
    # candidates; others get blanks.
    enrich_by_id: dict[str, dict] = {}
    for r in conn.execute("SELECT accountid, industrycode, opendeals, openrevenue FROM inactive_candidates"):
        enrich_by_id[r["accountid"]] = {
            "industrycode": r["industrycode"] or "",
            "opendeals": r["opendeals"] or 0,
            "openrevenue": r["openrevenue"] or 0.0,
        }

    with clusters_path.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    conn.execute("DELETE FROM duplicate_clusters")
    conn.execute("DELETE FROM duplicate_cluster_members")

    cluster_seen: dict[str, dict] = {}
    member_rows = []
    for r in rows:
        cid = r["cluster_id"]
        if cid not in cluster_seen:
            cluster_seen[cid] = {
                "cluster_id": cid, "signals": r["signals"], "confidence": r["confidence"],
                "cluster_size": int(r["cluster_size"]), "pending_count": int(r["pending_count"]),
            }
        mid = r["existing_masterid"]
        aid = r["accountid"]
        det = details_by_id.get(aid, {})
        enr = enrich_by_id.get(aid, {})
        member_rows.append({
            "cluster_id": cid,
            "accountid": aid,
            "name": r["name"],
            "statecode_label": r["statecode_label"],
            "is_already_merged_away": int(r["is_already_merged_away"]),
            "existing_masterid": mid,
            "existing_masterid_name": names_by_id.get(mid, "") if mid else "",
            "masterid_outside_cluster": int(r["masterid_outside_cluster"]),
            "is_suggested_primary": int(r["is_suggested_primary"]),
            "active_contact_count": int(r["active_contact_count"]),
            "open_opportunity_count": int(r["open_opportunity_count"]),
            "websiteurl": r["websiteurl"],
            "address1_line1": det.get("address1_line1", ""),
            "address1_city": r["address1_city"],
            "address1_stateorprovince": det.get("address1_stateorprovince", ""),
            "address1_postalcode": r["address1_postalcode"],
            "address1_country": det.get("address1_country", ""),
            "telephone1": det.get("telephone1", ""),
            "statuscode": det.get("statuscode", 0),
            "modifiedon": det.get("modifiedon", ""),
            "industrycode": enr.get("industrycode", ""),
            "opendeals": enr.get("opendeals", 0),
            "openrevenue": enr.get("openrevenue", 0.0),
            "createdon": r["createdon"],
        })

    conn.executemany(
        """INSERT INTO duplicate_clusters (cluster_id, signals, confidence, cluster_size, pending_count)
           VALUES (:cluster_id, :signals, :confidence, :cluster_size, :pending_count)""",
        list(cluster_seen.values()),
    )
    conn.executemany(
        """INSERT INTO duplicate_cluster_members
           (cluster_id, accountid, name, statecode_label, is_already_merged_away, existing_masterid,
            existing_masterid_name, masterid_outside_cluster, is_suggested_primary,
            active_contact_count, open_opportunity_count, websiteurl, address1_line1, address1_city,
            address1_stateorprovince, address1_postalcode, address1_country, telephone1, statuscode,
            modifiedon, industrycode, opendeals, openrevenue, createdon)
           VALUES (:cluster_id, :accountid, :name, :statecode_label, :is_already_merged_away,
                   :existing_masterid, :existing_masterid_name, :masterid_outside_cluster,
                   :is_suggested_primary, :active_contact_count, :open_opportunity_count,
                   :websiteurl, :address1_line1, :address1_city, :address1_stateorprovince,
                   :address1_postalcode, :address1_country, :telephone1, :statuscode,
                   :modifiedon, :industrycode, :opendeals, :openrevenue, :createdon)""",
        member_rows,
    )
    return len(cluster_seen), len(member_rows)


def main() -> int:
    ap = argparse.ArgumentParser(description="Load reference CSVs into the SQLite reference tables")
    ap.add_argument("--seed-dir", type=Path, default=HERE / "seed")
    args = ap.parse_args()

    conn = get_connection()
    # Drop + recreate the reference tables so schema changes (added columns)
    # take effect on a rebuild. Decision tables are untouched.
    drop_reference_tables(conn)
    init_schema(conn)

    n_inactive = load_inactive_candidates(conn, args.seed_dir / "inactive_accounts_candidates.csv")
    n_index = load_account_index(conn, args.seed_dir / "accounts_base_extract.csv")
    n_contacts = load_account_contacts(conn, args.seed_dir / "contact_email_extract.csv")
    n_clusters, n_members = load_duplicate_clusters(
        conn, args.seed_dir / "duplicate_accounts_candidates.csv", args.seed_dir / "accounts_full_extract.csv"
    )
    conn.commit()
    conn.close()

    print(f"inactive_candidates : {n_inactive}")
    print(f"account_index       : {n_index}")
    print(f"account_contacts    : {n_contacts}")
    print(f"duplicate_clusters  : {n_clusters}")
    print(f"cluster_members     : {n_members}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
