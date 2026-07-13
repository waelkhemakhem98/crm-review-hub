/** Thin fetch wrapper around the FastAPI backend. Relative paths only --
 * nginx proxies /api to the backend container in production, and Vite's dev
 * server can be configured with the same proxy for local development. */

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function putJSON(path, body) {
  const res = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
  return res.json();
}

async function postJSON(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

export const api = {
  // -- inactive accounts --
  fetchInactiveCandidates: () => getJSON("/api/inactive/candidates"),
  fetchAccountIndex: () => getJSON("/api/inactive/account-index"),
  fetchInactiveDecisions: () => getJSON("/api/inactive/decisions"),
  saveInactiveDecision: (accountid, patch) => putJSON(`/api/inactive/decisions/${accountid}`, patch),
  bulkSaveInactiveDecisions: (accountids, decision, reviewer) =>
    postJSON("/api/inactive/decisions/bulk", { accountids, decision, reviewer }),
  exportInactiveXlsxUrl: () => "/api/inactive/export.xlsx",

  // -- shared --
  fetchAccountContacts: (accountid) => getJSON(`/api/accounts/${accountid}/contacts`),

  // -- duplicate accounts --
  fetchClusters: () => getJSON("/api/duplicates/clusters"),
  fetchDuplicateDecisions: () => getJSON("/api/duplicates/decisions"),
  fetchPrimaryChoices: () => getJSON("/api/duplicates/primary-choices"),
  saveDuplicateDecision: (accountid, patch) => putJSON(`/api/duplicates/decisions/${accountid}`, patch),
  bulkSaveDuplicateDecisions: (accountids, decision, reviewer) =>
    postJSON("/api/duplicates/decisions/bulk", { accountids, decision, reviewer }),
  setPrimaryChoice: (clusterId, accountid, reviewer) =>
    putJSON(`/api/duplicates/primary-choices/${clusterId}`, { accountid, reviewer }),
  exportDuplicatesXlsxUrl: () => "/api/duplicates/export.xlsx",
};
