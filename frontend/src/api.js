/** Thin fetch wrapper around the FastAPI backend.
 *
 * The app may be served at the root ("/") in local dev, or under a sub-path
 * (e.g. "/crm-review-hub/") when deployed behind the demo host. Vite exposes
 * that mount point as import.meta.env.BASE_URL, so we prefix every request
 * with it -- otherwise the browser would call "/api/..." at the domain root,
 * which isn't routed to this app under a sub-path. */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, ""); // "/crm-review-hub" or ""
const url = (path) => `${BASE}${path}`;

async function getJSON(path) {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function putJSON(path, body) {
  const res = await fetch(url(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
  return res.json();
}

async function postJSON(path, body) {
  const res = await fetch(url(path), {
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
  exportInactiveXlsxUrl: () => url("/api/inactive/export.xlsx"),

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
  exportDuplicatesXlsxUrl: () => url("/api/duplicates/export.xlsx"),

  // -- duplicate contacts --
  fetchContactClusters: () => getJSON("/api/contact-duplicates/clusters"),
  fetchContactDuplicateDecisions: () => getJSON("/api/contact-duplicates/decisions"),
  fetchContactPrimaryChoices: () => getJSON("/api/contact-duplicates/primary-choices"),
  saveContactDuplicateDecision: (contactid, patch) =>
    putJSON(`/api/contact-duplicates/decisions/${contactid}`, patch),
  bulkSaveContactDuplicateDecisions: (contactids, decision, reviewer) =>
    postJSON("/api/contact-duplicates/decisions/bulk", { contactids, decision, reviewer }),
  setContactPrimaryChoice: (clusterId, contactid, reviewer) =>
    putJSON(`/api/contact-duplicates/primary-choices/${clusterId}`, { contactid, reviewer }),
  exportContactDuplicatesXlsxUrl: () => url("/api/contact-duplicates/export.xlsx"),
};
