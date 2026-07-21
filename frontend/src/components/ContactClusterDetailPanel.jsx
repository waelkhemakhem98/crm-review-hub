import React, { useState } from "react";

const DECISIONS = ["", "Merge", "Not a duplicate", "Keep separate"];

function MemberDetails({ m }) {
  const fields = [
    ["Email", m.emailaddress1 || "-"],
    ["Job title", m.jobtitle || "-"],
    ["Parent account", m.parent_account_name || "-"],
    ["Phone", m.telephone1 || "-"],
    ["LinkedIn", m.new_linkedinurl || "-"],
    ["Engage ID", m.sp_engageid || "-"],
    ["In opps", m.kpi_inhowmanyopps],
    ["Created", m.createdon || "-"],
    ["Contact ID", m.contactid],
    ["Parent ID", m.parentcustomerid || "-"],
  ];
  return (
    <div className="member-details-wrap">
      <div className="member-details">
        {fields.map(([label, val]) => (
          <div key={label}>
            <strong>{label}:</strong>{" "}
            {label === "LinkedIn" && m.new_linkedinurl ? (
              <a href={m.new_linkedinurl} target="_blank" rel="noreferrer">{m.new_linkedinurl}</a>
            ) : (
              String(val)
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ContactClusterDetailPanel({
  cluster, primaryId, decisions, hasConfirmedPrimary,
  onSetPrimary, onDecide, onDismissCluster, onToggleDelete, onAccept, onClose,
  onPrev, onNext, onConfirmNext, hasPrev, hasNext,
}) {
  const [expandedMembers, setExpandedMembers] = useState(() => new Set());
  const [showHistorical, setShowHistorical] = useState(false);

  if (!cluster) return null;
  const pending = cluster.members.filter((m) => !m.is_already_merged_away);
  const historical = cluster.members.filter((m) => m.is_already_merged_away);

  function toggleMember(contactid) {
    setExpandedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(contactid)) next.delete(contactid);
      else next.add(contactid);
      return next;
    });
  }

  return (
    <div className="detail-panel cluster-detail-panel">
      <div className="detail-panel-header">
        <strong>
          Cluster {cluster.cluster_id.slice(0, 8)} &middot; {cluster.confidence} confidence &middot;{" "}
          {cluster.cluster_size} member(s)
        </strong>
        <div className="detail-nav">
          <button className="nav-btn" onClick={onPrev} disabled={!hasPrev} title="Previous (←)">&#9664; Prev</button>
          <button className="nav-btn" onClick={onNext} disabled={!hasNext} title="Next (→)">Next &#9654;</button>
          <button className="accept-btn" onClick={onAccept} title="Set suggested primary and merge the rest (Enter)">
            Accept suggestion
          </button>
          <button className="nav-btn primary-btn" onClick={onConfirmNext} title="Confirm & jump to next undecided">
            Confirm &amp; Next
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="close" title="Close (Esc)">&times;</button>
        </div>
      </div>

      <div className="keyboard-legend">
        Shortcuts: <kbd>←</kbd>/<kbd>→</kbd> prev/next &middot; <kbd>Enter</kbd> accept &amp; next &middot; <kbd>Esc</kbd> close
      </div>

      <div className="signals-cell" style={{ marginBottom: 10 }}>
        {cluster.signals.map((s) => (
          <span key={s} className="signal-badge">{s.replace(/_/g, " ")}</span>
        ))}
      </div>

      <div className="primary-hint">
        {hasConfirmedPrimary ? (
          <>&#10003; Primary confirmed. Non-primary members you haven&apos;t decided are still open below.</>
        ) : (
          <>
            &#9733; The row tagged <span className="suggested-tag">suggested</span> is the algorithm&apos;s
            proposed primary (pre-selected). Click <strong>Accept suggestion</strong> to confirm it and mark
            the rest as Merge, or pick a different primary / set decisions manually.
          </>
        )}
      </div>

      <div className="cluster-bulk-bar">
        <button onClick={() => onDismissCluster(pending.map((m) => m.contactid))}>
          Dismiss entire cluster as false positive
        </button>
      </div>

      <div className="cluster-member-table-wrap">
        <table className="cluster-member-table">
          <thead>
            <tr>
              <th />
              <th>Primary</th>
              <th>Name</th>
              <th>State</th>
              <th>Email</th>
              <th>Job title</th>
              <th>Account</th>
              <th>Decision</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((m) => {
              const d = decisions[m.contactid] || {};
              const isPrimary = primaryId === m.contactid;
              const isOpen = expandedMembers.has(m.contactid);
              return (
                <React.Fragment key={m.contactid}>
                  <tr>
                    <td>
                      <button className="icon-btn" onClick={() => toggleMember(m.contactid)} aria-label="details">
                        {isOpen ? "▾" : "▸"}
                      </button>
                    </td>
                    <td>
                      <input
                        type="radio"
                        name={`primary-contact-${cluster.cluster_id}`}
                        checked={isPrimary}
                        onChange={() => onSetPrimary(m.contactid)}
                      />
                    </td>
                    <td>
                      {m.fullname}
                      {Boolean(m.is_suggested_primary) && <span className="suggested-tag"> &#9733; suggested</span>}
                    </td>
                    <td>
                      <span className={`badge badge-${(m.statecode_label || "").toLowerCase()}`}>{m.statecode_label}</span>
                    </td>
                    <td className="truncate-cell">{m.emailaddress1}</td>
                    <td className="truncate-cell">{m.jobtitle}</td>
                    <td className="truncate-cell">{m.parent_account_name || "—"}</td>
                    <td>
                      {isPrimary ? (
                        <em>primary</em>
                      ) : (
                        <select
                          value={d.decision || ""}
                          onChange={(e) => onDecide(m.contactid, { ...d, decision: e.target.value })}
                        >
                          {DECISIONS.map((opt) => (
                            <option key={opt} value={opt}>{opt || "-- decide --"}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <input
                        type="text"
                        className="note-input"
                        value={d.note || ""}
                        placeholder="note..."
                        onChange={(e) => onDecide(m.contactid, { ...d, note: e.target.value })}
                      />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="member-details-row">
                      <td colSpan={9}><MemberDetails m={m} /></td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {historical.length > 0 && (
        <div className="historical-members">
          <button className="historical-toggle" onClick={() => setShowHistorical((x) => !x)}>
            {showHistorical ? "▾" : "▸"} {historical.length} already-resolved record(s) (historical)
          </button>
          {showHistorical && (
            <>
              <p className="historical-caution">
                &#9888; Marking for deletion is destructive and only takes effect in a later Dataverse
                apply-stage. These records were already merged away; delete only removes the leftover stub.
              </p>
              <table className="cluster-member-table historical-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Merged into</th>
                    <th>Delete stub?</th>
                  </tr>
                </thead>
                <tbody>
                  {historical.map((m) => {
                    const marked = decisions[m.contactid]?.decision === "Delete";
                    return (
                      <tr key={m.contactid}>
                        <td>{m.fullname}</td>
                        <td>
                          {m.existing_masterid_name || m.existing_masterid}
                          {Boolean(m.masterid_outside_cluster) && (
                            <span className="safety-badge"> &#9888; outside this cluster</span>
                          )}
                        </td>
                        <td>
                          <button
                            className={marked ? "delete-btn marked" : "delete-btn"}
                            onClick={() => onToggleDelete(m.contactid, marked)}
                          >
                            {marked ? "✓ Marked — undo" : "Mark for deletion"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
