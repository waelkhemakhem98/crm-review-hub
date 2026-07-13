import React, { useMemo, useState } from "react";

/** Client-side typeahead over the full account index (no server search available). */
export default function MergeTargetPicker({ accountIndex, excludeId, value, onChange }) {
  const [query, setQuery] = useState(value?.name || "");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const matches = [];
    for (const acc of accountIndex) {
      if (acc.accountid === excludeId) continue;
      if (acc.name.toLowerCase().includes(q)) {
        matches.push(acc);
        if (matches.length >= 25) break;
      }
    }
    return matches;
  }, [query, accountIndex, excludeId]);

  return (
    <div className="merge-picker">
      <input
        type="text"
        placeholder="Search accounts to merge into..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {value && (
        <span className="merge-picker-chosen">
          &rarr; {value.name} <code>{value.accountid.slice(-6)}</code>
        </span>
      )}
      {open && results.length > 0 && (
        <ul className="merge-picker-list">
          {results.map((acc) => (
            <li
              key={acc.accountid}
              onMouseDown={() => {
                onChange(acc);
                setQuery(acc.name);
                setOpen(false);
              }}
            >
              {acc.name} <code>{acc.accountid.slice(-6)}</code>{" "}
              <span className={`badge badge-${acc.statecode_label.toLowerCase()}`}>
                {acc.statecode_label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
