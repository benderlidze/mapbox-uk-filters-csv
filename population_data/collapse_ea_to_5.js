const fs = require("fs");

const IN_FILE = "TS066-2021-1-filtered-2025-12-18T16_13_05Z.csv";     // <-- change
const OUT_FILE = "TS066-2021-1-filtered-2025-12-18T16_13_05Z_collapsed.csv";  // <-- change

// ---------- CSV parsing (quote-aware, no deps) ----------
function parseCsv(text) {
  // Returns { header: string[], rows: string[][] }
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  // Normalize newlines
  text = text.replace(/\r\n/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        // Escaped quote
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        pushField();
      } else if (c === "\n") {
        pushField();
        // ignore completely empty trailing line
        if (!(row.length === 1 && row[0] === "")) pushRow();
      } else {
        field += c;
      }
    }
  }

  // flush last field/row if text doesn't end with newline
  if (field.length > 0 || inQuotes || row.length > 0) {
    pushField();
    pushRow();
  }

  const header = rows.shift();
  return { header, rows };
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(path, objects, header) {
  const out = [];
  out.push(header.map(csvEscape).join(","));
  for (const obj of objects) {
    out.push(header.map((h) => csvEscape(obj[h])).join(","));
  }
  fs.writeFileSync(path, out.join("\n") + "\n", "utf8");
}

function toIntStrict(v, context) {
  const s = String(v ?? "").trim();
  if (s === "") throw new Error(`Empty integer field (${context})`);
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`Invalid integer "${s}" (${context})`);
  return n;
}

function norm(s) {
  return String(s ?? "").trim();
}

// ---------- Grouping rules ----------
const employedCodes = new Set([1,2,3,4,5,6,8,9,10,11,12,13]);
const unemployedCodes = new Set([7,14]);
const inactiveStudentCode = 16;
const inactiveRetiredCode = 15;
const otherInactiveCodes = new Set([17,18,19]);
const doesNotApplyCode = -8;

const expectedCodes = new Set([doesNotApplyCode, ...Array.from({ length: 19 }, (_, i) => i + 1)]);

// ---------- Main ----------
const inputText = fs.readFileSync(IN_FILE, "utf8");
const { header, rows } = parseCsv(inputText);

if (!header || header.length === 0) throw new Error("CSV header missing/empty.");

const colLSOA = header.indexOf("Lower layer Super Output Areas Code");
const colCatCode = header.indexOf("Economic activity status (20 categories) Code");
const colObs = header.indexOf("Observation");

if (colLSOA === -1) throw new Error(`Missing column: "Lower layer Super Output Areas Code"`);
if (colCatCode === -1) throw new Error(`Missing column: "Economic activity status (20 categories) Code"`);
if (colObs === -1) throw new Error(`Missing column: "Observation"`);

const byLsoa = new Map();

// For tests: track raw totals and coverage
const rawTotalByLsoa = new Map();       // sum of ALL observations including -8
const rawNonNegByLsoa = new Map();      // sum of observations where code != -8
const seenCodesByLsoa = new Map();      // set of codes per LSOA
let badRowCount = 0;
let unknownCodeCount = 0;

function ensureAgg(lsoa) {
  if (!byLsoa.has(lsoa)) {
    byLsoa.set(lsoa, {
      code: lsoa,
      Employed: 0,
      Unemployed: 0,
      "Students (inactive)": 0,
      Retired: 0,
      "Other inactive": 0,
      DoesNotApply: 0, // optional; used for tests
      EA_Total_16plus: 0, // optional; derived
      EA_Active_16plus: 0, // optional; derived
      EA_Inactive_16plus: 0, // optional; derived
    });
    rawTotalByLsoa.set(lsoa, 0);
    rawNonNegByLsoa.set(lsoa, 0);
    seenCodesByLsoa.set(lsoa, new Set());
  }
  return byLsoa.get(lsoa);
}

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  try {
    const lsoa = norm(r[colLSOA]);
    if (!lsoa) throw new Error("Missing LSOA code");

    const code = toIntStrict(r[colCatCode], `row ${i+2} category code`);
    const obs = toIntStrict(r[colObs], `row ${i+2} observation`);
    if (obs < 0) throw new Error(`Negative observation (${obs}) row ${i+2}`);

    const agg = ensureAgg(lsoa);

    rawTotalByLsoa.set(lsoa, rawTotalByLsoa.get(lsoa) + obs);
    if (code !== doesNotApplyCode) rawNonNegByLsoa.set(lsoa, rawNonNegByLsoa.get(lsoa) + obs);

    const codesSet = seenCodesByLsoa.get(lsoa);
    codesSet.add(code);

    if (!expectedCodes.has(code)) {
      unknownCodeCount++;
      // ignore unknown codes but keep running
      continue;
    }

    if (code === doesNotApplyCode) agg.DoesNotApply += obs;
    else if (employedCodes.has(code)) agg.Employed += obs;
    else if (unemployedCodes.has(code)) agg.Unemployed += obs;
    else if (code === inactiveStudentCode) agg["Students (inactive)"] += obs;
    else if (code === inactiveRetiredCode) agg.Retired += obs;
    else if (otherInactiveCodes.has(code)) agg["Other inactive"] += obs;
    else {
      // Should never happen if expectedCodes is correct, but keep safe:
      unknownCodeCount++;
    }
  } catch (e) {
    badRowCount++;
    // If you want to hard-fail on first bad row, replace with: throw e;
    // For now: continue.
  }
}

// ---------- Derive totals + tests ----------
let lsoaWithMismatch = 0;
let lsoaWithMissingCodes = 0;

for (const [lsoa, agg] of byLsoa.entries()) {
  agg.EA_Active_16plus = agg.Employed + agg.Unemployed;
  agg.EA_Inactive_16plus = agg["Students (inactive)"] + agg.Retired + agg["Other inactive"];
  agg.EA_Total_16plus = agg.EA_Active_16plus + agg.EA_Inactive_16plus;

  // Test 1: our 5-bucket sum should equal raw non -8 sum (codes 1..19)
  const rawNonNeg = rawNonNegByLsoa.get(lsoa) ?? 0;
  if (agg.EA_Total_16plus !== rawNonNeg) {
    lsoaWithMismatch++;
  }

  // Test 2: did we see all expected category codes for this LSOA?
  // Many datasets include all codes per area, but not guaranteed. This is a warning, not an error.
  const seen = seenCodesByLsoa.get(lsoa) ?? new Set();
  let missing = 0;
  for (const c of expectedCodes) {
    if (!seen.has(c)) missing++;
  }
  if (missing > 0) lsoaWithMissingCodes++;
}

// Print a compact report
console.log("Rows parsed:", rows.length);
console.log("Bad rows skipped:", badRowCount);
console.log("Unknown/ignored codes:", unknownCodeCount);
console.log("LSOAs produced:", byLsoa.size);
console.log("LSOAs where 5-bucket total != sum(codes 1..19):", lsoaWithMismatch);
console.log("LSOAs missing some expected category codes:", lsoaWithMissingCodes);

// Optional: fail build if mismatches exist
if (lsoaWithMismatch > 0) {
  console.error("ERROR: Found LSOAs with total mismatches. Fix input or mapping.");
  process.exitCode = 2;
}

// ---------- Write output (exactly 6 columns as requested) ----------
const outRows = Array.from(byLsoa.values()).sort((a, b) => a.code.localeCompare(b.code));
const outHeader = ["code", "Employed", "Unemployed", "Students (inactive)", "Retired", "Other inactive"];

writeCsv(OUT_FILE, outRows, outHeader);
console.log("Wrote:", OUT_FILE);
