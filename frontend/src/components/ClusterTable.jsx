import React, { useEffect, useRef, useState } from "react";

const RULE_OPTIONS = [
  { value: "include", label: "Avoir" },
  { value: "exclude", label: "Sans" },
  { value: "any", label: "Tout" },
];

/** Excel-style column filter for the Signals header: a funnel button that opens
 * a per-signal tri-state list. Each signal can be required (Avoir), forbidden
 * (Sans), or ignored (Tout, the default). A cluster passes only if it satisfies
 * every non-"Tout" rule -- so e.g. website_domain=Avoir + exact_name=Sans keeps
 * the clusters that have a website match but no exact-name match. */
function SignalHeaderFilter({ allSignals, signalRules, onSetSignalRule, onClearSignals }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const activeCount = Object.keys(signalRules).length;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const summary = Object.entries(signalRules)
    .map(([s, r]) => `${r === "include" ? "+" : "-"}${s.replace(/_/g, " ")}`)
    .join(", ");

  return (
    <span className="col-filter" ref={ref}>
      <span>Signals</span>
      <button
        type="button"
        className={`col-filter-btn ${activeCount ? "active" : ""}`}
        aria-label="Filter by signal"
        aria-expanded={open}
        title={activeCount ? `Filtered: ${summary}` : "Filter by signal"}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        &#9660;{activeCount ? <span className="col-filter-dot" /> : null}
      </button>
      {open && (
        <div className="col-filter-menu col-filter-menu-wide" role="menu" onClick={(e) => e.stopPropagation()}>
          <div className="col-filter-menu-head">
            <span>Filtrer par signal</span>
            <button type="button" className="col-filter-clear" disabled={!activeCount} onClick={onClearSignals}>
              Réinitialiser
            </button>
          </div>
          <div className="col-filter-legend">
            <span>Signal</span>
            <span className="col-filter-rules-head">
              {RULE_OPTIONS.map((o) => <span key={o.value}>{o.label}</span>)}
            </span>
          </div>
          {allSignals.map((s) => {
            const rule = signalRules[s] || "any";
            return (
              <div key={s} className="col-filter-row">
                <span className="col-filter-signal">{s.replace(/_/g, " ")}</span>
                <span className="col-filter-rules" role="radiogroup" aria-label={s}>
                  {RULE_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={rule === o.value}
                      className={`col-filter-rule rule-${o.value} ${rule === o.value ? "on" : ""}`}
                      onClick={() => onSetSignalRule(s, o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </span>
  );
}

/** Plain mapped list, not virtualized -- cluster counts (~1,300) are an
 * order of magnitude below the ~11,000-row inactive-accounts list that
 * needed virtualization. Purely presentational: status (notstarted /
 * inprogress / completed) and progress text are computed once in the
 * section (single source of truth) and passed in. */
export default function ClusterTable({
  clusters, statusOf, progressOf, expandedId, onExpand, onAccept,
  allSignals, signalRules, onSetSignalRule, onClearSignals,
}) {
  return (
    <div className="grid-table" role="table">
      <div className="grid-header-row cluster-header-row" role="row">
        <div />
        <div className="col-num" role="columnheader">Size</div>
        <div role="columnheader">Confidence</div>
        <div role="columnheader">
          <SignalHeaderFilter
            allSignals={allSignals}
            signalRules={signalRules}
            onSetSignalRule={onSetSignalRule}
            onClearSignals={onClearSignals}
          />
        </div>
        <div role="columnheader">Names</div>
        <div role="columnheader">Progress</div>
        <div role="columnheader" />
      </div>
      <div className="grid-body cluster-body">
        {clusters.map((c, index) => {
          const isExpanded = expandedId === c.cluster_id;
          const status = statusOf(c);
          const { decidedCount, decidableCount, hasConfirmedPrimary } = progressOf(c);
          return (
            <React.Fragment key={c.cluster_id}>
              {index > 0 && <hr className="cluster-list-separator" aria-hidden="true" />}
              <div
                role="row"
                className={`cluster-row status-${status} confidence-${c.confidence.toLowerCase()} ${isExpanded ? "expanded" : ""}`}
                onClick={() => onExpand(isExpanded ? null : c.cluster_id)}
              >
              <div className="col-expand">
                <button className="icon-btn" aria-label="expand">
                  {isExpanded ? "▾" : "▸"}
                </button>
              </div>
              <div className="col-num">{c.cluster_size}</div>
              <div>
                <span className={`badge badge-confidence-${c.confidence.toLowerCase()}`}>{c.confidence}</span>
              </div>
              <div className="signals-cell">
                {c.signals.map((s) => (
                  <span key={s} className="signal-badge">
                    {s.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
              <div className="col-name cluster-names-preview">
                {c.members.slice(0, 3).map((m) => m.name).join(" / ")}
                {c.members.length > 3 ? ` +${c.members.length - 3}` : ""}
              </div>
              <div className="cluster-progress-cell">
                {status === "completed" ? (
                  <span className="status-done-tag">&#10003; done</span>
                ) : (
                  <span>
                    {hasConfirmedPrimary ? "primary ✓" : "no primary"} &middot; {decidedCount}/{decidableCount} decided
                  </span>
                )}
              </div>
              <div>
                {status !== "completed" && (
                  <button
                    className="accept-btn"
                    title="Set the suggested primary and merge the rest"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAccept(c);
                    }}
                  >
                    Accept
                  </button>
                )}
              </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
