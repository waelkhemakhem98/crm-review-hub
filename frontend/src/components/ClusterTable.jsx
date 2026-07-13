import React from "react";

/** Plain mapped list, not virtualized -- cluster counts (~1,300) are an
 * order of magnitude below the ~11,000-row inactive-accounts list that
 * needed virtualization. Purely presentational: status (notstarted /
 * inprogress / completed) and progress text are computed once in the
 * section (single source of truth) and passed in. */
export default function ClusterTable({ clusters, statusOf, progressOf, expandedId, onExpand, onAccept }) {
  return (
    <div className="grid-table" role="table">
      <div className="grid-header-row cluster-header-row" role="row">
        <div />
        <div className="col-num" role="columnheader">Size</div>
        <div role="columnheader">Confidence</div>
        <div role="columnheader">Signals</div>
        <div role="columnheader">Names</div>
        <div role="columnheader">Progress</div>
        <div role="columnheader" />
      </div>
      <div className="grid-body cluster-body">
        {clusters.map((c) => {
          const isExpanded = expandedId === c.cluster_id;
          const status = statusOf(c);
          const { decidedCount, decidableCount, hasConfirmedPrimary } = progressOf(c);
          return (
            <div
              key={c.cluster_id}
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
          );
        })}
      </div>
    </div>
  );
}
