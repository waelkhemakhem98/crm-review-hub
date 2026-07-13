// account.industrycode option-set: code -> label.
// Sourced from describe('tables/account') plus the 11 custom codes created in
// Dataverse (571320001-571320011). A few deprecated/orphan codes present in
// old data have no current label -- resolveIndustry() falls back to the raw
// code for those.
export const INDUSTRY_LABELS = {
  "10": "Distribution",
  "12": "Manufacturing",
  "20": "Insurance",
  "25": "Retail",
  "100000000": "Mining  & Metals",
  "100000001": "Logistics and Supply Chain",
  "100000003": "Mining & Metals",
  "100000004": "Consumer Goods",
  "100000017": "Real Estate",
  "100000018": "Medical Products",
  "100000019": "Other",
  "100000020": "Association(s)",
  "100000021": "Construction",
  "100000022": "Financial Services / Banking",
  "100000023": "Government +",
  "100000024": "IT",
  "100000025": "Agency Marketing",
  "100000026": "Telecommunications and Media",
  "100000027": "Transportation/Trucking/Railroad",
  "100000028": "Pharmaceuticals",
  "100000030": "Travel",
  "100000031": "Consumer Electronics",
  "100000032": "Wine and Spirits",
  "571320001": "Education",
  "571320002": "Healthcare Services",
  "571320003": "Energy / Oil & Gas",
  "571320004": "Energy & Utilities",
  "571320005": "Legal Services",
  "571320006": "Food & Beverage",
  "571320007": "Environmental Services",
  "571320008": "Market Research",
  "571320009": "Agriculture",
  "571320010": "Staffing",
  "571320011": "Professional Services",
};

export function resolveIndustry(code) {
  const c = String(code ?? "").trim();
  if (!c) return "-";
  return INDUSTRY_LABELS[c] || `Code ${c}`;
}
