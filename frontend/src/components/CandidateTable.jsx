import React, { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const ROW_HEIGHT = 44;
const TIER_LABEL = { 1: "Never engaged", 2: "Dormant", 3: "Cold (Active)", 4: "Watch" };
const DECISIONS = ["", "Keep", "Archive", "Merge", "Delete"];

/** Only the ~20-30 rows actually visible in the scroll viewport are ever
 * mounted -- this is what keeps interaction smooth at 11k+ rows. A real
 * <table> can't be virtualized this way (absolutely-positioned <tr>/<td>
 * inside <tbody> isn't valid layout), so this renders a CSS-grid "div table"
 * instead, styled to look identical to one. */
export default function CandidateTable({ rows, decisions, onDecide, expandedId, onExpand }) {
  const parentRef = useRef(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  return (
    <div className="grid-table" role="table">
      <div className="grid-header-row" role="row">
        <div />
        <div role="columnheader">Name</div>
        <div role="columnheader">Tier</div>
        <div role="columnheader">State</div>
        <div className="col-num" role="columnheader">Active contacts</div>
        <div className="col-num" role="columnheader">Open opps</div>
        <div role="columnheader">Last activity</div>
        <div role="columnheader">Decision</div>
      </div>
      <div className="grid-body" ref={parentRef}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index];
            const d = decisions[row.accountid] || {};
            const isExpanded = expandedId === row.accountid;
            return (
              <div
                key={row.accountid}
                role="row"
                className={`grid-row tier-${row.dormancy_tier} ${d.decision ? "decided" : ""} ${isExpanded ? "expanded" : ""}`}
                style={{
                  position: "absolute", top: 0, left: 0, width: "100%", height: ROW_HEIGHT,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <div className="col-expand">
                  <button
                    className="icon-btn"
                    onClick={() => onExpand(isExpanded ? null : row.accountid)}
                    aria-label="expand"
                  >
                    {isExpanded ? "▾" : "▸"}
                  </button>
                </div>
                <div className="col-name">{row.name || <em>(no name)</em>}</div>
                <div>
                  <span className={`badge badge-tier${row.dormancy_tier}`}>
                    {row.dormancy_tier} &middot; {TIER_LABEL[row.dormancy_tier]}
                  </span>
                </div>
                <div>
                  <span className={`badge badge-${row.statecode_label.toLowerCase()}`}>
                    {row.statecode_label}
                  </span>
                </div>
                <div className="col-num">{row.active_contact_count}</div>
                <div className="col-num">{row.open_opportunity_count}</div>
                <div className="col-activity">
                  {row.last_activity_date || "never"}
                  {row.last_activity_source !== "none" && (
                    <span className="source-tag"> ({row.last_activity_source})</span>
                  )}
                </div>
                <div className="col-decision">
                  <select
                    value={d.decision || ""}
                    onChange={(e) => onDecide(row.accountid, { ...d, decision: e.target.value })}
                  >
                    {DECISIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt || "-- decide --"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
