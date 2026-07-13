import React, { useState } from "react";
import { api } from "../api.js";
import { resolveIndustry } from "../industryLabels.js";

const DECISIONS = ["", "Merge", "Not a duplicate", "Keep separate"];

function MemberDetails({ m }) {
  const [contacts, setContacts] = useState(null); // null=not loaded, []=loaded/empty
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactsError, setContactsError] = useState("");
  const [showContacts, setShowContacts] = useState(false);

  function toggleContacts() {
    if (showContacts) { setShowContacts(false); return; }
    setShowContacts(true);
    if (contacts === null && !loadingContacts) {
      setLoadingContacts(true);
      api.fetchAccountContacts(m.accountid)
        .then((list) => setContacts(list))
        .catch((err) => setContactsError(String(err)))
        .finally(() => setLoadingContacts(false));
    }
  }

  const fields = [
    ["Industry", resolveIndustry(m.industrycode)],
    ["Phone", m.telephone1 || "-"],
    ["Street", m.address1_line1 || "-"],
    ["City", m.address1_city || "-"],
    ["State/Province", m.address1_stateorprovince || "-"],
    ["Postal", m.address1_postalcode || "-"],
    ["Country", m.address1_country || "-"],
    ["Open deals", m.opendeals],
    ["Open revenue", m.openrevenue],
    ["Status code", m.statuscode],
    ["Created", m.createdon || "-"],
    ["Modified", m.modifiedon || "-"],
    ["Account ID", m.accountid],
  ];
  return (
    <div className="member-details-wrap">
      <div className="member-details">
        {fields.map(([label, val]) => (
          <div key={label}>
            <strong>{label}:</strong> {String(val)}
          </div>
        ))}
        {m.websiteurl && (
          <div>
            <strong>Website:</strong>{" "}
            <a href={m.websiteurl} target="_blank" rel="noreferrer">{m.websiteurl}</a>
          </div>
        )}
      </div>
      <div className="contacts-block">
        <button className="contacts-toggle" onClick={toggleContacts}>
          {showContacts ? "▾ Hide contacts" : "▸ Show contacts"}
        </button>
        {showContacts && (
          <div className="contacts-list">
            {loadingContacts && <span className="contacts-muted">Loading contacts&hellip;</span>}
            {contactsError && <span className="section-error">Failed to load contacts: {contactsError}</span>}
            {contacts && contacts.length === 0 && <span className="contacts-muted">No contacts.</span>}
            {contacts && contacts.length > 0 && (
              <table className="contacts-table">
                <thead>
                  <tr><th>Name</th><th>Email</th></tr>
                </thead>
                <tbody>
                  {contacts.map((c, i) => (
                    <tr key={i}>
                      <td>{c.fullname || "-"}</td>
                      <td>{c.email || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ClusterDetailPanel({
  cluster, primaryId, decisions, hasConfirmedPrimary,
  onSetPrimary, onDecide, onDismissCluster, onToggleDelete, onAccept, onClose,
  onPrev, onNext, onConfirmNext, hasPrev, hasNext,
}) {
  const [expandedMembers, setExpandedMembers] = useState(() => new Set());
  const [showHistorical, setShowHistorical] = useState(false);

  if (!cluster) return null;
  const pending = cluster.members.filter((m) => !m.is_already_merged_away);
  const historical = cluster.members.filter((m) => m.is_already_merged_away);

  function toggleMember(accountid) {
    setExpandedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(accountid)) next.delete(accountid);
      else next.add(accountid);
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
          <>&#10003; Primary confirmed. Non-primary members you haven't decided are still open below.</>
        ) : (
          <>
            &#9733; The row tagged <span className="suggested-tag">suggested</span> is the algorithm's
            proposed primary (pre-selected). Click <strong>Accept suggestion</strong> to confirm it and mark
            the rest as Merge, or pick a different primary / set decisions manually.
          </>
        )}
      </div>

      <div className="cluster-bulk-bar">
        <button onClick={() => onDismissCluster(pending.map((m) => m.accountid))}>
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
              <th>Contacts</th>
              <th>Open opps</th>
              <th>Website</th>
              <th>City</th>
              <th>Decision</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((m) => {
              const d = decisions[m.accountid] || {};
              const isPrimary = primaryId === m.accountid;
              const isOpen = expandedMembers.has(m.accountid);
              return (
                <React.Fragment key={m.accountid}>
                  <tr>
                    <td>
                      <button className="icon-btn" onClick={() => toggleMember(m.accountid)} aria-label="details">
                        {isOpen ? "▾" : "▸"}
                      </button>
                    </td>
                    <td>
                      <input
                        type="radio"
                        name={`primary-${cluster.cluster_id}`}
                        checked={isPrimary}
                        onChange={() => onSetPrimary(m.accountid)}
                      />
                    </td>
                    <td>
                      {m.name}
                      {m.is_suggested_primary && <span className="suggested-tag"> &#9733; suggested</span>}
                    </td>
                    <td>
                      <span className={`badge badge-${m.statecode_label.toLowerCase()}`}>{m.statecode_label}</span>
                    </td>
                    <td className="col-num">{m.active_contact_count}</td>
                    <td className="col-num">{m.open_opportunity_count}</td>
                    <td className="truncate-cell">{m.websiteurl}</td>
                    <td>{m.address1_city}</td>
                    <td>
                      {isPrimary ? (
                        <em>primary</em>
                      ) : (
                        <select
                          value={d.decision || ""}
                          onChange={(e) => onDecide(m.accountid, { ...d, decision: e.target.value })}
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
                        onChange={(e) => onDecide(m.accountid, { ...d, note: e.target.value })}
                      />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="member-details-row">
                      <td colSpan={10}><MemberDetails m={m} /></td>
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
                    const marked = decisions[m.accountid]?.decision === "Delete";
                    return (
                      <tr key={m.accountid}>
                        <td>{m.name}</td>
                        <td>
                          {m.existing_masterid_name || m.existing_masterid}
                          {m.masterid_outside_cluster && (
                            <span className="safety-badge"> &#9888; outside this cluster</span>
                          )}
                        </td>
                        <td>
                          <button
                            className={marked ? "delete-btn marked" : "delete-btn"}
                            onClick={() => onToggleDelete(m.accountid, marked)}
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
