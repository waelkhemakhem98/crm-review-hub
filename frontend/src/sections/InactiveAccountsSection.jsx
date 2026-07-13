import React, { useEffect, useMemo, useState } from "react";
import CandidateTable from "../components/CandidateTable.jsx";
import DetailPanel from "../components/DetailPanel.jsx";
import { api } from "../api.js";

const TIERS = [1, 2, 3, 4];
const DECISION_TYPES = ["Keep", "Archive", "Merge", "Delete"];

export default function InactiveAccountsSection({ reviewer }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [accountIndex, setAccountIndex] = useState([]);
  const [decisions, setDecisions] = useState({});
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState(new Set(TIERS));
  const [decidedFilter, setDecidedFilter] = useState("all"); // all | decided | undecided
  const [bulkDecision, setBulkDecision] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.fetchInactiveCandidates(), api.fetchAccountIndex(), api.fetchInactiveDecisions()])
      .then(([c, idx, d]) => {
        if (cancelled) return;
        setCandidates(c);
        setAccountIndex(idx);
        setDecisions(d);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function onDecide(accountid, patch) {
    setDecisions((prev) => ({
      ...prev,
      [accountid]: { ...prev[accountid], ...patch, reviewer },
    }));
    api.saveInactiveDecision(accountid, { ...patch, reviewer }).catch((err) => {
      console.error("Failed to save decision, will not persist on reload:", err);
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((row) => {
      if (!tierFilter.has(row.dormancy_tier)) return false;
      const has = Boolean(decisions[row.accountid]?.decision);
      if (decidedFilter === "decided" && !has) return false;
      if (decidedFilter === "undecided" && has) return false;
      if (q && !row.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [candidates, search, tierFilter, decidedFilter, decisions]);

  const progress = useMemo(() => {
    const counts = { Keep: 0, Archive: 0, Merge: 0, Delete: 0 };
    let decided = 0;
    for (const row of candidates) {
      const dec = decisions[row.accountid]?.decision;
      if (dec) {
        decided += 1;
        counts[dec] = (counts[dec] || 0) + 1;
      }
    }
    return { decided, total: candidates.length, counts };
  }, [candidates, decisions]);

  const expandedRow = useMemo(
    () => (expandedId ? candidates.find((r) => r.accountid === expandedId) : null),
    [candidates, expandedId]
  );

  function toggleTier(t) {
    setTierFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function applyBulk() {
    if (!bulkDecision) return;
    if (!window.confirm(`Apply "${bulkDecision}" to all ${filtered.length} currently-filtered rows?`)) {
      return;
    }
    const accountids = filtered.map((r) => r.accountid);
    setDecisions((prev) => {
      const next = { ...prev };
      for (const accountid of accountids) {
        next[accountid] = { ...next[accountid], decision: bulkDecision, reviewer };
      }
      return next;
    });
    api.bulkSaveInactiveDecisions(accountids, bulkDecision, reviewer).catch((err) => {
      console.error("Bulk save failed, changes may not persist on reload:", err);
    });
  }

  if (loading) {
    return <div className="section-status">Loading inactive accounts&hellip;</div>;
  }
  if (loadError) {
    return <div className="section-status section-error">Could not load data: {loadError}</div>;
  }

  return (
    <div className="section">
      <div className="progress-bar-wrap">
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${(progress.decided / progress.total) * 100}%` }}
          />
        </div>
        <div className="progress-text">
          {progress.decided} / {progress.total} decided
          {DECISION_TYPES.map((t) => (
            <span key={t} className="progress-count">
              {t}: {progress.counts[t] || 0}
            </span>
          ))}
        </div>
      </div>

      <div className="toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="Search account name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="tier-chips">
          {TIERS.map((t) => (
            <button
              key={t}
              className={`chip ${tierFilter.has(t) ? "chip-on" : ""}`}
              onClick={() => toggleTier(t)}
            >
              Tier {t}
            </button>
          ))}
        </div>
        <select value={decidedFilter} onChange={(e) => setDecidedFilter(e.target.value)}>
          <option value="all">All rows</option>
          <option value="decided">Decided only</option>
          <option value="undecided">Not yet decided</option>
        </select>
        <a className="export-btn" href={api.exportInactiveXlsxUrl()}>
          Export decisions Excel
        </a>
      </div>

      <div className="bulk-bar">
        <span>{filtered.length} rows match current filters &mdash; bulk apply:</span>
        <select value={bulkDecision} onChange={(e) => setBulkDecision(e.target.value)}>
          <option value="">-- choose decision --</option>
          {DECISION_TYPES.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <button disabled={!bulkDecision} onClick={applyBulk}>
          Apply to all filtered
        </button>
      </div>

      <DetailPanel
        row={expandedRow}
        decision={expandedId ? decisions[expandedId] : null}
        accountIndex={accountIndex}
        onDecide={onDecide}
        onClose={() => setExpandedId(null)}
      />

      <CandidateTable
        rows={filtered}
        decisions={decisions}
        onDecide={onDecide}
        expandedId={expandedId}
        onExpand={setExpandedId}
      />
    </div>
  );
}
