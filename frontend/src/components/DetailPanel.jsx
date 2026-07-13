import React from "react";
import MergeTargetPicker from "./MergeTargetPicker.jsx";

/** Docked panel for the single currently-expanded row, rendered outside the
 * virtualized table so every table row stays a uniform height. */
export default function DetailPanel({ row, decision, accountIndex, onDecide, onClose }) {
  if (!row) return null;
  const d = decision || {};

  function setField(field, val) {
    onDecide(row.accountid, { ...d, [field]: val });
  }

  return (
    <div className="detail-panel">
      <div className="detail-panel-header">
        <strong>{row.name || "(no name)"}</strong>
        <button className="icon-btn" onClick={onClose} aria-label="close">
          &times;
        </button>
      </div>
      <div className="detail-grid">
        <div>
          <strong>Flag reasons:</strong> {row.flag_reasons}
        </div>
        <div>
          <strong>Industry code:</strong> {row.industrycode || "-"} &nbsp;
          <strong>Website:</strong>{" "}
          {row.websiteurl ? (
            <a href={row.websiteurl} target="_blank" rel="noreferrer">
              {row.websiteurl}
            </a>
          ) : (
            "-"
          )}
        </div>
        <div>
          <strong>Open deals:</strong> {row.opendeals} &nbsp;
          <strong>Open revenue:</strong> {row.openrevenue} &nbsp;
          <strong>Created:</strong> {row.createdon}
        </div>
        {row.new_strategicaccount === 1 && (
          <div className="safety-badge">&#9888; Marked Strategic Account</div>
        )}
        {Number(row.openrevenue) > 0 && <div className="safety-badge">&#9888; Has open revenue</div>}
        {row.possible_duplicate_of && <div className="dup-hint">&#8505; {row.possible_duplicate_of}</div>}
        {d.decision === "Merge" && (
          <div>
            <strong>Merge into:</strong>
            <MergeTargetPicker
              accountIndex={accountIndex}
              excludeId={row.accountid}
              value={
                d.merge_target_accountid
                  ? { accountid: d.merge_target_accountid, name: d.merge_target_name }
                  : null
              }
              onChange={(acc) =>
                onDecide(row.accountid, {
                  ...d,
                  merge_target_accountid: acc ? acc.accountid : "",
                  merge_target_name: acc ? acc.name : "",
                })
              }
            />
          </div>
        )}
        <div>
          <strong>Note:</strong>
          <input
            type="text"
            className="note-input"
            value={d.note || ""}
            placeholder="optional note..."
            onChange={(e) => setField("note", e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
