# Duplicate Contacts — How grouping and suggestions work

Companion to the review app's **Duplicate Contacts** section.

- Design canvas (open beside chat): `canvases/contact-duplicate-similarity.canvas.tsx` in the Cursor project
- Implementation: [`../10_duplicate_contacts/build_duplicate_contact_clusters.py`](../10_duplicate_contacts/build_duplicate_contact_clusters.py)
- Summary of last run: [`../10_duplicate_contacts/duplicate_contacts_summary.md`](../10_duplicate_contacts/duplicate_contacts_summary.md)

---

## 1. In one paragraph

Start from the **512 exact-fullname groups** in `03_duplicate_audit/contact_duplicate_names.csv`. Inside each name group, compare contact pairs on identity signals (email, LinkedIn, Engage ID, phone, parent account, similar email local-part). Union-find builds **sub-clusters**. Homonyms with no identity edge never become a reviewable cluster. Each cluster gets High/Medium confidence and a suggested primary; a human confirms Merge / Not a duplicate / Keep separate.

Current result (v1 run): **155 reviewable clusters** covering **319 contact rows** — 117 High, 38 Medium. **318** name groups had no identity edge (homonyms, left out of review). **65** already-resolved clusters dropped.

---

## 2. The data used

- Full contact rows from the Dataverse full-row cache (`full_row_dup_cache`, merged via `full_row_duplicate_census.merge_table_records`).
- Duplicate name list: `03_duplicate_audit/contact_duplicate_names.csv`.
- Account names (for parent display): `accounts_full_extract.csv` when available.

No decisions are written back to Dataverse by this process — review + Excel export only.

---

## 3. How contacts are grouped

### 3.1 Candidates

Only contacts whose `fullname` appears in the duplicate-names file (≥ 2 records with that exact name). No fuzzy cross-name matching in v1.

### 3.2 Identity signals (edges)

| Signal | Strength | Rule |
|--------|----------|------|
| `exact_email` | Strong | Same normalized `emailaddress1` |
| `exact_linkedin` | Strong | Same normalized LinkedIn URL |
| `exact_engageid` | Strong | Same non-empty `sp_engageid` |
| `similar_email_local` | Medium | Same domain + similar local-part **and** same parent account; disabled on generic domains |
| `exact_phone` | Medium | Digits-only phone ≥ 7 chars (suppressed if over-common in the name group) |
| `same_parent_account` | Medium | Same `parentcustomerid` / `accountid` |

`name_only` does **not** create an edge.

### 3.3 Confidence

- **High** — any strong signal, or ≥ 2 distinct medium signals.
- **Medium** — exactly one medium signal.
- **Low** — unused in v1 (no name-only clusters).
- **review-needed** — cluster size > `--max-cluster-size` (default 40).

### 3.4 Historical merges

Members with `masterid` set are historical (read-only). Clusters with fewer than 2 pending members are dropped unless `--include-fully-resolved`.

---

## 4. Suggested primary

Among pending members, in order:

1. Active over Inactive  
2. Already a survivor of an in-cluster merge  
3. Has an email  
4. Higher `kpi_inhowmanyopps`  
5. Oldest `createdon`  
6. Lowest `contactid`

---

## 5. Reviewer decisions

Same vocabulary as accounts: confirm primary; for others **Merge** / **Not a duplicate** / **Keep separate**; optional **Mark for deletion** on historical stubs. Export via **Export decisions Excel**.

---

## 6. Tunable parameters

| Flag | Default | Effect |
|------|---------|--------|
| `--local-similarity` | 0.75 | Min ratio for `similar_email_local` |
| `--phone-max-group` | 4 | Suppress phones shared by more than N contacts in a name group |
| `--max-cluster-size` | 40 | Flag mega-clusters as `review-needed` |
| `--min-cluster-size` | 2 | Min pending members for a reviewable cluster |

Re-run:

```bash
cd 10_duplicate_contacts
python build_duplicate_contact_clusters.py
cd ../crm-review-hub/backend
python build_db.py
```

---

## 7. Known limitations

- Exact fullname only — `Jean-François` vs `Jean Francois` will not meet in v1.
- Shared LinkedIn URLs across different employers can form High clusters (career moves or bad data); reviewers use **Not a duplicate** when wrong.
- Parent account names may be blank when the account is missing from the extract.
