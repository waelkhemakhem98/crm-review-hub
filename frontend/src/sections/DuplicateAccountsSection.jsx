import React, { useEffect, useMemo, useState } from "react";
import ClusterTable from "../components/ClusterTable.jsx";
import ClusterDetailPanel from "../components/ClusterDetailPanel.jsx";
import { api } from "../api.js";

const CONFIDENCES = ["High", "Medium", "Low"];
const CONFIDENCE_RANK = { High: 0, Medium: 1, Low: 2 };

function suggestedPrimaryOf(cluster) {
  const found = cluster.members.find((m) => m.is_suggested_primary);
  return found ? found.accountid : null;
}

export default function DuplicateAccountsSection({ reviewer }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [clusters, setClusters] = useState([]);
  const [decisions, setDecisions] = useState({});
  const [primaryChoices, setPrimaryChoices] = useState({});
  const [search, setSearch] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState(new Set(CONFIDENCES));
  const [decidedFilter, setDecidedFilter] = useState("undecided"); // all | decided | undecided
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.fetchClusters(), api.fetchDuplicateDecisions(), api.fetchPrimaryChoices()])
      .then(([c, d, p]) => {
        if (cancelled) return;
        setClusters(c);
        setDecisions(d);
        setPrimaryChoices(Object.fromEntries(Object.entries(p).map(([cid, row]) => [cid, row.accountid])));
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

  function effectivePrimary(cluster) {
    return primaryChoices[cluster.cluster_id] || suggestedPrimaryOf(cluster);
  }

  function clusterProgress(cluster) {
    const pending = cluster.members.filter((m) => !m.is_already_merged_away);
    const primaryId = effectivePrimary(cluster);
    const decidable = pending.filter((m) => m.accountid !== primaryId);
    const decidedCount = decidable.filter((m) => decisions[m.accountid]?.decision).length;
    const hasConfirmedPrimary = Boolean(primaryChoices[cluster.cluster_id]);
    return {
      pending, primaryId, decidable, decidedCount, hasConfirmedPrimary,
      fullyDecided: hasConfirmedPrimary && decidedCount === decidable.length,
    };
  }

  function clusterStatus(cluster) {
    const { decidable, decidedCount, hasConfirmedPrimary } = clusterProgress(cluster);
    if (hasConfirmedPrimary && decidedCount === decidable.length) return "completed";
    if (hasConfirmedPrimary || decidedCount > 0) return "inprogress";
    return "notstarted";
  }

  function progressOf(cluster) {
    const { decidable, decidedCount, hasConfirmedPrimary } = clusterProgress(cluster);
    return { decidedCount, decidableCount: decidable.length, hasConfirmedPrimary };
  }

  function onSetPrimary(clusterId, accountid) {
    setPrimaryChoices((prev) => ({ ...prev, [clusterId]: accountid }));
    api.setPrimaryChoice(clusterId, accountid, reviewer).catch((err) => {
      console.error("Failed to save primary choice, will not persist on reload:", err);
    });
  }

  function onDecide(accountid, patch) {
    setDecisions((prev) => ({
      ...prev,
      [accountid]: { ...prev[accountid], ...patch, reviewer },
    }));
    api.saveDuplicateDecision(accountid, { ...patch, reviewer }).catch((err) => {
      console.error("Failed to save decision, will not persist on reload:", err);
    });
  }

  function toggleDelete(accountid, marked) {
    onDecide(accountid, { decision: marked ? "" : "Delete" });
  }

  // One-click: set the suggested primary + mark every other pending member Merge.
  function acceptSuggestion(cluster) {
    const sugg = suggestedPrimaryOf(cluster);
    if (!sugg) return;
    const targets = cluster.members
      .filter((m) => !m.is_already_merged_away && m.accountid !== sugg)
      .map((m) => m.accountid);
    if (cluster.confidence === "Low" &&
      !window.confirm(`Low-confidence cluster: set primary and mark ${targets.length} member(s) as Merge?`)) {
      return;
    }
    onSetPrimary(cluster.cluster_id, sugg);
    if (targets.length) {
      setDecisions((prev) => {
        const next = { ...prev };
        for (const aid of targets) next[aid] = { ...next[aid], decision: "Merge", reviewer };
        return next;
      });
      api.bulkSaveDuplicateDecisions(targets, "Merge", reviewer).catch((err) => {
        console.error("Accept-suggestion bulk save failed:", err);
      });
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clusters
      .filter((c) => {
        if (!confidenceFilter.has(c.confidence)) return false;
        if (decidedFilter !== "all") {
          const status = clusterStatus(c);
          if (decidedFilter === "decided" && status !== "completed") return false;
          if (decidedFilter === "undecided" && status === "completed") return false;
          if (decidedFilter === "inprogress" && status !== "inprogress") return false;
          if (decidedFilter === "notstarted" && status !== "notstarted") return false;
        }
        if (q && !c.members.some((m) => m.name.toLowerCase().includes(q))) return false;
        return true;
      })
      .sort((a, b) =>
        (CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]) || (b.cluster_size - a.cluster_size)
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters, search, confidenceFilter, decidedFilter, decisions, primaryChoices]);

  const statusCounts = useMemo(() => {
    let completed = 0, inprogress = 0, notstarted = 0;
    for (const c of clusters) {
      const s = clusterStatus(c);
      if (s === "completed") completed += 1;
      else if (s === "inprogress") inprogress += 1;
      else notstarted += 1;
    }
    return { completed, inprogress, notstarted, total: clusters.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters, decisions, primaryChoices]);

  const expandedCluster = useMemo(
    () => clusters.find((c) => c.cluster_id === expandedId) || null,
    [clusters, expandedId]
  );

  // -- navigation over the current filtered+sorted list --
  const filteredIds = filtered.map((c) => c.cluster_id);
  const curIdx = expandedId ? filteredIds.indexOf(expandedId) : -1;
  const hasPrev = curIdx > 0;
  const hasNext = curIdx >= 0 && curIdx < filteredIds.length - 1;
  const goPrev = () => { if (hasPrev) setExpandedId(filteredIds[curIdx - 1]); };
  const goNext = () => setExpandedId(hasNext ? filteredIds[curIdx + 1] : null);
  const acceptAndNext = () => {
    if (curIdx < 0) return;
    acceptSuggestion(filtered[curIdx]);
    goNext();
  };
  const confirmNext = () => {
    for (let i = curIdx + 1; i < filtered.length; i++) {
      if (clusterStatus(filtered[i]) !== "completed") { setExpandedId(filtered[i].cluster_id); return; }
    }
    setExpandedId(null);
  };

  // keyboard shortcuts while a cluster is open (ignored when typing in a field)
  useEffect(() => {
    if (!expandedId) return;
    function onKey(e) {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
      else if (e.key === "Enter") { e.preventDefault(); acceptAndNext(); }
      else if (e.key === "Escape") { e.preventDefault(); setExpandedId(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId, filteredIds.join(","), decisions, primaryChoices]);

  function toggleConfidence(c) {
    setConfidenceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  function dismissCluster(pendingAccountIds, primaryId) {
    const targets = pendingAccountIds.filter((id) => id !== primaryId);
    if (!window.confirm(`Mark all ${targets.length} pending member(s) in this cluster as "Not a duplicate"?`)) {
      return;
    }
    setDecisions((prev) => {
      const next = { ...prev };
      for (const aid of targets) next[aid] = { ...next[aid], decision: "Not a duplicate", reviewer };
      return next;
    });
    api.bulkSaveDuplicateDecisions(targets, "Not a duplicate", reviewer).catch((err) => {
      console.error("Failed to save dismiss-cluster decisions:", err);
    });
  }

  if (loading) {
    return <div className="section-status">Loading duplicate account clusters&hellip;</div>;
  }
  if (loadError) {
    return <div className="section-status section-error">Could not load data: {loadError}</div>;
  }

  const pct = statusCounts.total ? (statusCounts.completed / statusCounts.total) * 100 : 0;

  return (
    <div className="section">
      <div className="progress-bar-wrap">
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="progress-text">
          <span className="progress-count status-chip-completed">{statusCounts.completed} completed</span>
          <span className="progress-count status-chip-inprogress">{statusCounts.inprogress} in progress</span>
          <span className="progress-count status-chip-notstarted">{statusCounts.notstarted} not started</span>
          <span>of {statusCounts.total} clusters</span>
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
          {CONFIDENCES.map((c) => (
            <button
              key={c}
              className={`chip ${confidenceFilter.has(c) ? "chip-on" : ""}`}
              onClick={() => toggleConfidence(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <select value={decidedFilter} onChange={(e) => setDecidedFilter(e.target.value)}>
          <option value="undecided">Not yet decided</option>
          <option value="notstarted">Not started</option>
          <option value="inprogress">In progress</option>
          <option value="decided">Completed</option>
          <option value="all">All clusters</option>
        </select>
        <a className="export-btn" href={api.exportDuplicatesXlsxUrl()}>
          Export decisions Excel
        </a>
      </div>

      <div className="filter-count">{filtered.length} clusters match current filters</div>

      {expandedCluster && (
        <ClusterDetailPanel
          cluster={expandedCluster}
          primaryId={effectivePrimary(expandedCluster)}
          hasConfirmedPrimary={Boolean(primaryChoices[expandedCluster.cluster_id])}
          decisions={decisions}
          onSetPrimary={(accountid) => onSetPrimary(expandedCluster.cluster_id, accountid)}
          onDecide={onDecide}
          onToggleDelete={toggleDelete}
          onDismissCluster={(pendingIds) => dismissCluster(pendingIds, effectivePrimary(expandedCluster))}
          onAccept={() => acceptSuggestion(expandedCluster)}
          onClose={() => setExpandedId(null)}
          onPrev={goPrev}
          onNext={goNext}
          onConfirmNext={confirmNext}
          hasPrev={hasPrev}
          hasNext={hasNext}
        />
      )}

      <ClusterTable
        clusters={filtered}
        statusOf={clusterStatus}
        progressOf={progressOf}
        expandedId={expandedId}
        onExpand={setExpandedId}
        onAccept={acceptSuggestion}
      />
    </div>
  );
}
