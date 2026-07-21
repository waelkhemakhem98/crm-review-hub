# Duplicate Accounts — How grouping and suggestions work

This document explains, in plain terms, **how the tool decides which accounts belong to the same group (cluster)** and **how it suggests which record should be the primary (surviving) account**. It is the companion to the review app's "Duplicate Accounts" section.

For **Duplicate Contacts**, see [`METHODOLOGY_CONTACTS.md`](METHODOLOGY_CONTACTS.md).

The logic lives in [`build_duplicate_clusters.py`](build_duplicate_clusters.py); this document describes what that script does.

---

## 1. In one paragraph

Every account is compared to every other account across **five kinds of evidence** (name, fuzzy name, website, address, shared contacts). When two accounts share evidence, a link is drawn between them. All the links are then followed transitively — if A links to B and B links to C, then A, B and C form one group. Each group gets a **confidence level** (High / Medium / Low) based on *what kind* of evidence held it together, and the tool proposes one member as the **suggested primary** using a fixed set of tie-breakers. A human reviews and confirms.

Current result: **1,347 groups covering 3,250 accounts** (out of 12,478) — 487 High, 356 Medium, 504 Low confidence.

---

## 2. The data used

Pulled fresh from Dataverse (read-only) and processed entirely offline:

- **Accounts** — name, website, address (street/city/state/postal/country), phone, `statecode`, `masterid`, `merged`, created/modified dates.
- **Contacts** — each contact's account + email + name (used for the "shared contacts" signal, and for the "show contacts" feature in the app).
- **Activity counts** — how many active contacts and open opportunities each account has (used only to rank the suggested primary).

No decision is ever written back to Dataverse by this process — it only *produces a list to review*.

---

## 3. How accounts are grouped

### 3.1 The five signals (evidence types)

A link between two accounts is drawn when any of these match:

| Signal | What it compares | Notes |
|---|---|---|
| **Exact name** | The name after cleaning (lowercase, collapsed spaces) is identical. | Strongest name signal. |
| **Fuzzy name** | The name with **legal suffixes and filler words removed** is identical. | Strips `inc, incorporated, corp, corporation, ltd, limited, llc, llp, co, company, group, holdings, international, intl, canada, the, plc, gmbh` plus punctuation. This is what merges **"Canadian Tire"** with **"Canadian Tire Corporation"**. |
| **Fuzzy name (similar)** | Two cleaned names are **≥ 88% similar** (character-level), compared only within buckets sharing the same first 4 letters. | Catches near-misses like typos / word-order that aren't an exact match. |
| **Website domain** | Same web domain (ignoring `http(s)://`, `www.`, and the path). | Suppressed for generic hosts (see 3.3). |
| **Address** | Same **postal code + city + street** after cleaning (suite/unit/floor numbers removed). | Suppressed for shared buildings (see 3.3). |
| **Shared contact domain** | Two different accounts have contacts using the **same email domain** (e.g. both have people `@acme.com`). | Suppressed for generic/shared domains and "hub" accounts (see 3.3). |

The three name signals are considered **strong**; website, address and shared-contact-domain are considered **weak** (more prone to coincidence).

### 3.2 Following the links (how groups form)

The tool uses **connected components** (a "union-find"): every account starts on its own; each surviving link merges two accounts into the same group; the final groups are whatever ends up connected. So a group can be held together by a chain of different signals, not just one.

### 3.3 Guards against false positives

Weak signals coincide often, so several safeguards run **before** links are drawn:

- **Generic domain denylist** — personal/hosting domains (`gmail.com`, `outlook.com`, `wixsite.com`, …) and government portals shared by unrelated bodies (`canada.ca`, `quebec.ca`, `gc.ca`, `gouv.qc.ca`, `ontario.ca`) never create a link. *(Real example that forced this: PWGSC, Passport Canada and Public Safety Canada all share `canada.ca`.)*
- **Over-common key suppression** — a website/address/contact-domain key shared across **too many different company names** is treated as noise, not duplication (a website domain across > 8 distinct names, an address across > 5, a contact domain across > 4).
- **"Hub" account exclusion** — an account whose *own* contacts span more than 4 distinct email domains (a big company like IBM, or an umbrella/placeholder account) is excluded from the shared-contact signal entirely, so it can't chain unrelated companies together.
- **Corroboration rule (the important one)** — a **single weak signal on its own can never pull an unrelated account into an established name-based group, nor bridge two name-based groups together.** Doing that requires **two different weak signals agreeing** on the same pair. Weak signals *can* still freely group otherwise-unconnected accounts (e.g. two small firms sharing one office → a legitimate Low-confidence group). *(Real example that forced this: "Sanofi" was being chained to the unrelated "Dealertrack, Inc." purely through a shared office address — now prevented.)*

### 3.4 Confidence level

Each group is labelled from the *combination* of signals that formed it:

- **High** — an exact-name match is present, **or** a name signal **and** at least one other signal agree.
- **Medium** — a name signal alone, **or** two different weak signals.
- **Low** — a single weak signal only (name never matched).
- **review-needed** — any group larger than 40 members (a sign a threshold slipped; currently **0**).

### 3.5 Already-merged records (historical)

Dataverse's own merge feature has already been used on some accounts. Those "loser" records carry a `masterid` pointing at their survivor. The tool:

- Splits each group into **pending** members (`masterid` empty — still need a decision) and **historical** members (`masterid` set — shown read-only, "already merged into X").
- **Drops groups that have fewer than 2 pending members** (already fully resolved — nothing left to decide). 209 such groups were dropped.

---

## 4. How the suggested primary is generated (v2)

Within each group, the tool proposes one **pending** member as the primary (surviving) record for Dataverse merge. It is only a suggestion — always overridable in the app. Confirmed choices in `duplicate_primary_choices` are never overwritten by a rebuild.

**Pending only:** members with `masterid` set / `is_already_merged_away` are excluded from candidacy (historical stubs).

### Tier A — hard rules (in order)

| # | Rule | Field(s) |
|---|---|---|
| A1 | Pending only | `is_already_merged_away`, `existing_masterid` |
| A2 | Active beats Inactive | `statecode_label` |
| A3 | Already a survivor in this cluster | `accountid` is the `masterid` target of another member |

If a single candidate remains after A2–A3, it is the primary.

### Tier B — business engagement (first criterion that separates wins)

| # | Criterion | Field(s) |
|---|---|---|
| B1 | Open opportunities | `open_opportunity_count`, then `opendeals` |
| B2 | Active contacts | `active_contact_count` |
| B3 | Open revenue | `openrevenue` (ignored when all candidates are 0 / blank) |
| B4 | Total contacts | `total_contact_count` |

### Tier C — data completeness (0–6 points)

One point each if filled (non-placeholder): `websiteurl` (non-generic domain), `telephone1`, `address1_line1`, city+postal together, `address1_country`, `industrycode`. Highest score wins.

### Tier D — age / stability

| # | Criterion | Field |
|---|---|---|
| D1 | Oldest | `createdon` ascending |
| D2 | Most recently touched | `modifiedon` descending (only if createdon within ~1 day) |
| D3 | Deterministic tiebreak | `accountid` |

### Name guardrail

If the chosen primary has a clearly poorer name than a runner-up (acronym-only vs full legal name, or placeholder) **and** they share the same website domain, the report flags `review_name` — the auto choice is unchanged; the reviewer may invert. Display Title Case is **not** a merge criterion.

### Confidence band (report)

- **A** — sole candidate after Tier A, or clear win on A2/A3 / B1  
- **B** — win on other engagement (B2–B4)  
- **C** — win on completeness or age/tiebreak  

In the app, the suggested member's radio is pre-selected (**★ suggested**); **"Accept suggestion"** confirms it and marks the rest as *Merge*. Batch recommendations (with reasons) are produced by `12_recluster_remaining/suggest_primaries.py` → `primary_suggestions.csv`.

---

## 5. What the reviewer then decides

For each group the reviewer confirms the primary and, for every other pending member, chooses: **Merge** (into the primary), **Not a duplicate** (the tool was wrong), or **Keep separate** (real relative but keep distinct). Already-merged stubs can optionally be **marked for deletion**. Decisions export to Excel for a later apply-stage that performs the actual Dataverse **Merge** action (which reparents the contacts, opportunities and history onto the primary).

---

## 6. Tunable parameters (for maintainers)

All are command-line flags on `build_duplicate_clusters.py`, with current defaults:

| Flag | Default | Effect |
|---|---|---|
| `--fuzzy-threshold` | 0.88 | Minimum similarity for the fuzzy-similar name signal. |
| `--domain-max-group` | 8 | Max distinct names a website domain may touch before it's ignored. |
| `--contact-domain-max-group` | 4 | Same, tighter, for shared contact-email domains. |
| `--contact-hub-max-domains` | 4 | An account with more distinct contact domains than this is a "hub" and excluded from the contact signal. |
| `--address-max-group` | 5 | Max distinct names an address may touch before it's ignored. |
| `--max-cluster-size` | 40 | Groups larger than this are flagged `review-needed`. |
| `--min-cluster-size` | 2 | Minimum pending members for a group to be reviewable. |

Re-run `python build_duplicate_clusters.py` after changing any of these (or after refreshing the source extracts), then `python export_app_data.py` and reload the app's data.

---

## 7. Known limitations

- **Weak-signal chains through a mis-filed record** can still, rarely, connect unrelated accounts (e.g. one contact with the wrong company's email). The reviewer's "Not a duplicate" / "Dismiss cluster" controls exist precisely for these.
- **Industry / revenue detail** in the app is only populated for accounts that were also in the inactive-accounts extract; others show blank.
- The suggestion is a **heuristic**, not a decision — it optimizes for "the record most likely to be the right survivor," but the reviewer always has the final say.
