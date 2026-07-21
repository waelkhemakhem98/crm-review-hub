import React, { useEffect, useMemo, useState } from "react";
import ClusterTable from "../components/ClusterTable.jsx";
import ContactClusterDetailPanel from "../components/ContactClusterDetailPanel.jsx";
import { api } from "../api.js";

const CONFIDENCES = ["High", "Medium", "Low"];
const CONFIDENCE_RANK = { High: 0, Medium: 1, Low: 2 };

function normalizeCluster(c) {
  return {
    ...c,
    members: (c.members || []).map((m) => ({
      ...m,
      name: m.fullname,
      accountid: m.contactid,
    })),
  };
}

function suggestedPrimaryOf(cluster) {
  const found = cluster.members.find((m) => m.is_suggested_primary);
  return found ? found.contactid : null;
}

export default function DuplicateContactsSection({ reviewer }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [clusters, setClusters] = useState([]);
  const [decisions, setDecisions] = useState({});
  const [primaryChoices, setPrimaryChoices] = useState({});
  const [search, setSearch] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState(() => new Set());
  const [signalRules, setSignalRules] = useState(() => ({}));
  const [decidedFilter, setDecidedFilter] = useState("undecided");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.fetchContactClusters(),
      api.fetchContactDuplicateDecisions(),
      api.fetchContactPrimaryChoices(),
    ])
      .then(([c, d, p]) => {
        if (cancelled) return;
        setClusters(c.map(normalizeCluster));
        setDecisions(d);
        setPrimaryChoices(Object.fromEntries(Object.entries(p).map(([cid, row]) => [cid, row.contactid])));
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
    const decidable = pending.filter((m) => m.contactid !== primaryId);
    const decidedCount = decidable.filter((m) => decisions[m.contactid]?.decision).length;
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

  function onSetPrimary(clusterId, contactid) {
    setPrimaryChoices((prev) => ({ ...prev, [clusterId]: contactid }));
    api.setContactPrimaryChoice(clusterId, contactid, reviewer).catch((err) => {
      console.error("Failed to save contact primary choice:", err);
    });
  }

  function onDecide(contactid, patch) {
    setDecisions((prev) => ({
      ...prev,
      [contactid]: { ...prev[contactid], ...patch, reviewer },
    }));
    api.saveContactDuplicateDecision(contactid, { ...patch, reviewer }).catch((err) => {
      console.error("Failed to save contact decision:", err);
    });
  }

  function toggleDelete(contactid, marked) {
    onDecide(contactid, { decision: marked ? "" : "Delete" });
  }

  function acceptSuggestion(cluster) {
    const sugg = suggestedPrimaryOf(cluster);
    if (!sugg) return;
    const targets = cluster.members
      .filter((m) => !m.is_already_merged_away && m.contactid !== sugg)
      .map((m) => m.contactid);
    if (cluster.confidence === "Low" &&
      !window.confirm(`Low-confidence cluster: set primary and mark ${targets.length} member(s) as Merge?`)) {
      return;
    }
    onSetPrimary(cluster.cluster_id, sugg);
    if (targets.length) {
      setDecisions((prev) => {
        const next = { ...prev };
        for (const id of targets) next[id] = { ...next[id], decision: "Merge", reviewer };
        return next;
      });
      api.bulkSaveContactDuplicateDecisions(targets, "Merge", reviewer).catch((err) => {
        console.error("Accept-suggestion bulk save failed:", err);
      });
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clusters
      .filter((c) => {
        if (confidenceFilter.size > 0 && !confidenceFilter.has(c.confidence)) return false;
        for (const sig in signalRules) {
          const has = c.signals.includes(sig);
          if (signalRules[sig] === "include" && !has) return false;
          if (signalRules[sig] === "exclude" && has) return false;
        }
        if (decidedFilter !== "all") {
          const status = clusterStatus(c);
          if (decidedFilter === "decided" && status !== "completed") return false;
          if (decidedFilter === "undecided" && status === "completed") return false;
          if (decidedFilter === "inprogress" && status !== "inprogress") return false;
          if (decidedFilter === "notstarted" && status !== "notstarted") return false;
        }
        if (q) {
          const hit = c.members.some((m) =>
            (m.fullname || "").toLowerCase().includes(q)
            || (m.emailaddress1 || "").toLowerCase().includes(q)
            || (m.parent_account_name || "").toLowerCase().includes(q)
          );
          if (!hit) return false;
        }
        return true;
      })
      .sort((a, b) =>
        (CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]) || (b.cluster_size - a.cluster_size)
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters, search, confidenceFilter, signalRules, decidedFilter, decisions, primaryChoices]);

  const allSignals = useMemo(() => {
    const set = new Set();
    for (const c of clusters) for (const s of c.signals) set.add(s);
    return [...set].sort();
  }, [clusters]);

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

  function setSignalRule(signal, rule) {
    setSignalRules((prev) => {
      const next = { ...prev };
      if (rule === "any") delete next[signal];
      else next[signal] = rule;
      return next;
    });
  }

  function clearSignalFilter() {
    setSignalRules({});
  }

  function dismissCluster(pendingContactIds, primaryId) {
    const targets = pendingContactIds.filter((id) => id !== primaryId);
    if (!window.confirm(`Mark all ${targets.length} pending member(s) in this cluster as "Not a duplicate"?`)) {
      return;
    }
    setDecisions((prev) => {
      const next = { ...prev };
      for (const id of targets) next[id] = { ...next[id], decision: "Not a duplicate", reviewer };
      return next;
    });
    api.bulkSaveContactDuplicateDecisions(targets, "Not a duplicate", reviewer).catch((err) => {
      console.error("Failed to save dismiss-cluster decisions:", err);
    });
  }

  if (loading) {
    return <div className="section-status">Loading duplicate contact clusters&hellip;</div>;
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
          placeholder="Search name, email, or account..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="tier-chips confidence-chips">
          {CONFIDENCES.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip chip-confidence-${c.toLowerCase()} ${confidenceFilter.has(c) ? "chip-on" : ""}`}
              aria-pressed={confidenceFilter.has(c)}
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
        <a className="export-btn" href={api.exportContactDuplicatesXlsxUrl()}>
          Export decisions Excel
        </a>
      </div>

      <div className="filter-count">{filtered.length} clusters match current filters</div>

      {expandedCluster && (
        <ContactClusterDetailPanel
          cluster={expandedCluster}
          primaryId={effectivePrimary(expandedCluster)}
          hasConfirmedPrimary={Boolean(primaryChoices[expandedCluster.cluster_id])}
          decisions={decisions}
          onSetPrimary={(contactid) => onSetPrimary(expandedCluster.cluster_id, contactid)}
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
        allSignals={allSignals}
        signalRules={signalRules}
        onSetSignalRule={setSignalRule}
        onClearSignals={clearSignalFilter}
      />
    </div>
  );
}
