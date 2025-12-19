const fs = require('fs');

// ===== EDIT ONLY THESE =====
const BASE_FILE = 'lsoa_age_bands_imd.csv';          // already has age bands + IMD
const HOUSEHOLDS_FILE = 'TS017-2021-1-filtered-2025-12-18T16_01_44Z.csv';        // the 5-column file shown in your message

const OUT_FILE = 'lsoa_age_bands_imd_households.csv';
const MISSING_FILE = 'missing_in_households.csv';

// RFC4180-ish CSV line parser (commas in quotes + "" escape)
function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }

  out.push(cur.trim());
  return out;
}

function readCSV(path) {
  const text = fs.readFileSync(path, 'utf8');
  const lines = text
    .split('\n')
    .map(l => l.replace(/\r$/, '').trim())
    .filter(Boolean);

  const header = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) rows.push(parseCSVLine(lines[i]));
  return { header, rows };
}

function escapeCSVField(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toInt(v) {
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function main() {
  // -------------------------
  // 1) Load base (age+imd)
  // -------------------------
  const base = readCSV(BASE_FILE);
  const baseCodeIdx = base.header.indexOf('LSOA21CD');
  if (baseCodeIdx === -1) {
    console.error('Base header:', base.header);
    throw new Error('BASE_FILE missing "LSOA21CD" column.');
  }

  // -------------------------
  // 2) Load household rows and pivot to map(code -> counts[0..8])
  // -------------------------
  const hh = readCSV(HOUSEHOLDS_FILE);

  const hhCodeIdx = hh.header.indexOf('Lower layer Super Output Areas Code');
  const hhCatIdx = hh.header.indexOf('Household size (9 categories) Code');
  const hhObsIdx = hh.header.indexOf('Observation');

  if (hhCodeIdx === -1 || hhCatIdx === -1 || hhObsIdx === -1) {
    console.error('Households header:', hh.header);
    throw new Error(
      'HOUSEHOLDS_FILE missing required columns: ' +
      '"Lower layer Super Output Areas Code", "Household size (9 categories) Code", "Observation".'
    );
  }

  const hhByCode = new Map(); // code -> { counts: number[9] }
  for (const cols of hh.rows) {
    const code = (cols[hhCodeIdx] || '').trim();
    if (!code) continue;

    const cat = toInt(cols[hhCatIdx]);       // 0..8
    const obs = toInt(cols[hhObsIdx]);       // count

    if (cat < 0 || cat > 8) continue;

    if (!hhByCode.has(code)) hhByCode.set(code, { counts: Array(9).fill(0) });
    hhByCode.get(code).counts[cat] += obs;
  }

  console.log('Household LSOA codes:', hhByCode.size);
  console.log('Base rows:', base.rows.length);

  // -------------------------
  // 3) Write output with added HH columns
  // -------------------------
  const outHeader = [
    ...base.header,
    'HH_0',
    'HH_1',
    'HH_2',
    'HH_3',
    'HH_4',
    'HH_5',
    'HH_6',
    'HH_7',
    'HH_8plus',
    'HH_Total',
    'HH_AvgSizeApprox'
  ];

  const outLines = [];
  outLines.push(outHeader.map(escapeCSVField).join(','));

  const missing = [];

  for (const cols of base.rows) {
    const code = (cols[baseCodeIdx] || '').trim();
    const hhRow = hhByCode.get(code);

    let counts = Array(9).fill(0);
    if (!hhRow) {
      missing.push(code);
    } else {
      counts = hhRow.counts;
    }

    const totalHouseholds = counts.reduce((a, b) => a + b, 0);

    // Avg household size approximation: treat category "8 or more" as 8.
    let peopleApprox = 0;
    for (let size = 0; size <= 7; size++) peopleApprox += size * counts[size];
    peopleApprox += 8 * counts[8];

    const avgSizeApprox = totalHouseholds > 0 ? (peopleApprox / totalHouseholds) : '';

    const outRow = [
      ...cols,
      counts[0],
      counts[1],
      counts[2],
      counts[3],
      counts[4],
      counts[5],
      counts[6],
      counts[7],
      counts[8],
      totalHouseholds,
      avgSizeApprox === '' ? '' : avgSizeApprox.toFixed(3)
    ];

    outLines.push(outRow.map(escapeCSVField).join(','));
  }

  fs.writeFileSync(OUT_FILE, outLines.join('\n'));
  console.log('Wrote:', OUT_FILE);

  // -------------------------
  // 4) Missing file only if needed
  // -------------------------
  if (missing.length > 0) {
    const uniq = Array.from(new Set(missing.filter(Boolean)));
    fs.writeFileSync(MISSING_FILE, ['LSOA21CD', ...uniq].join('\n'));
    console.log('Missing households:', MISSING_FILE, `(count: ${uniq.length})`);
  } else {
    console.log('No missing household rows. No missing file created.');
  }
}

main();
