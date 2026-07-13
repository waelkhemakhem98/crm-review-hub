import React, { useState } from "react";
import InactiveAccountsSection from "./sections/InactiveAccountsSection.jsx";
import DuplicateAccountsSection from "./sections/DuplicateAccountsSection.jsx";
import { safeGet, safeSet } from "./storage.js";

const TAB_KEY = "review_app_active_tab_v1";
// Single reviewer for now -- the backend still stamps every decision with a
// reviewer, so we pass a constant. Reinstate a name gate here if the review
// ever becomes multi-user.
const REVIEWER = "reviewer";

export default function App() {
  const [tab, setTab] = useState(() => safeGet(TAB_KEY, "duplicates"));

  function switchTab(t) {
    setTab(t);
    safeSet(TAB_KEY, t);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>CRM Review Hub</h1>
      </header>

      <div className="tab-bar">
        <button
          className={`tab-btn ${tab === "duplicates" ? "tab-btn-active" : ""}`}
          onClick={() => switchTab("duplicates")}
        >
          Duplicate Accounts
        </button>
        <button
          className={`tab-btn ${tab === "inactive" ? "tab-btn-active" : ""}`}
          onClick={() => switchTab("inactive")}
        >
          Inactive Accounts
        </button>
      </div>

      {tab === "duplicates" && <DuplicateAccountsSection reviewer={REVIEWER} />}
      {tab === "inactive" && <InactiveAccountsSection reviewer={REVIEWER} />}
    </div>
  );
}
