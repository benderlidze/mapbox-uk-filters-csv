const fs = require('fs');

// ===== EDIT THESE =====
const BASE_FILE = 'lsoa_age_bands_imd.csv';
const TS017_FILE = 'TS017-2021-1-filtered-2025-12-18T16_01_44Z.csv';
const TS066_FILE = 'TS066-2021-1-filtered-2025-12-18T16_13_05Z.csv';

const OUT_FILE = 'lsoa_age_bands_imd_ts017_ts066.csv';
const MISSING_TS017_FILE = 'missing_in_ts017.csv';
const MISSING_TS066_FILE = 'missing_in_ts066.csv';

// -------- CSV helpers (quote-aware) --------
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
  return { path, header, rows };
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
  const n = parseInt(s.replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function idxOfAny(header, names) {
  for (const n of names) {
    const idx = header.indexOf(n);
    if (idx !== -1) return idx;
  }
  return -1;
}

// -------- Pivot TS017: HH size 0..8 (8 = 8+) [web:236] --------
function buildTS017ByCode(ts017) {
  const codeIdx = idxOfAny(ts017.header, ['Lower layer Super Output Areas Code']);
  const catIdx = idxOfAny(ts017.header, ['Household size (9 categories) Code']);
  const obsIdx = idxOfAny(ts017.header, ['Observation']);

  if (codeIdx === -1 || catIdx === -1 || obsIdx === -1) {
    console.error('TS017 header:', ts017.header);
    throw new Error('TS017 missing required columns.');
  }

  const map = new Map(); // code -> counts[9]
  for (const cols of ts017.rows) {
    const code = (cols[codeIdx] || '').trim();
    if (!code) continue;

    const cat = toInt(cols[catIdx]); // 0..8
    if (cat < 0 || cat > 8) continue;

    const obs = toInt(cols[obsIdx]);

    if (!map.has(code)) map.set(code, Array(9).fill(0));
    map.get(code)[cat] += obs;
  }

  return map;
}

// -------- Pivot TS066: Econ activity -8, 1..19 [web:247] --------
// Store -8 at index 0 (EA_m8) and 1..19 at index 1..19
function buildTS066ByCode(ts066) {
  const codeIdx = idxOfAny(ts066.header, ['Lower layer Super Output Areas Code']);
  const catIdx = idxOfAny(ts066.header, ['Economic activity status (20 categories) Code']);
  const obsIdx = idxOfAny(ts066.header, ['Observation']);

  if (codeIdx === -1 || catIdx === -1 || obsIdx === -1) {
    console.error('TS066 header:', ts066.header);
    throw new Error('TS066 missing required columns.');
  }

  const map = new Map(); // code -> counts[20]
  for (const cols of ts066.rows) {
    const code = (cols[codeIdx] || '').trim();
    if (!code) continue;

    const raw = toInt(cols[catIdx]); // -8 or 1..19
    const obs = toInt(cols[obsIdx]);

    let idx = -1;
    if (raw === -8) idx = 0;
    else if (raw >= 1 && raw <= 19) idx = raw;
    else continue;

    if (!map.has(code)) map.set(code, Array(20).fill(0));
    map.get(code)[idx] += obs;
  }

  return map;
}

function main() {
  // 1) Load base
  const base = readCSV(BASE_FILE);
  const baseCodeIdx = idxOfAny(base.header, ['LSOA21CD']);
  if (baseCodeIdx === -1) {
    console.error('Base header:', base.header);
    throw new Error('Base file missing LSOA21CD.');
  }

  // 2) Load + pivot TS017/TS066 (same code assumed)
  const ts017 = readCSV(TS017_FILE);
  const ts066 = readCSV(TS066_FILE);

  const ts017ByCode = buildTS017ByCode(ts017);
  const ts066ByCode = buildTS066ByCode(ts066);

  console.log('TS017 codes:', ts017ByCode.size);
  console.log('TS066 codes:', ts066ByCode.size);
  console.log('Base rows:', base.rows.length);

  // 3) Output header
  const hhCols = [
    'HH_0','HH_1','HH_2','HH_3','HH_4','HH_5','HH_6','HH_7','HH_8plus',
    'HH_Total','HH_AvgSizeApprox'
  ];

  const eaCols = [
    'EA_m8',
    ...Array.from({ length: 19 }, (_, i) => `EA_${i + 1}`),
    'EA_Total_16plus',
    'EA_Active_16plus',
    'EA_Inactive_16plus'
  ];

  const outHeader = [...base.header, ...hhCols, ...eaCols];
  const outLines = [outHeader.map(escapeCSVField).join(',')];

  const missingTS017 = [];
  const missingTS066 = [];

  // 4) Merge
  for (const cols of base.rows) {
    const code = (cols[baseCodeIdx] || '').trim();

    // HH
    let hh = ts017ByCode.get(code);
    if (!hh) {
      missingTS017.push(code);
      hh = Array(9).fill(0);
    }

    const hhTotal = hh.reduce((a, b) => a + b, 0);
    let hhPeopleApprox = 0;
    for (let size = 0; size <= 7; size++) hhPeopleApprox += size * hh[size];
    hhPeopleApprox += 8 * hh[8]; // 8+ treated as 8 (approx) [web:236]
    const hhAvgApprox = hhTotal > 0 ? (hhPeopleApprox / hhTotal) : '';

    // Econ
    let ea = ts066ByCode.get(code);
    if (!ea) {
      missingTS066.push(code);
      ea = Array(20).fill(0);
    }

    const EA_m8 = ea[0];
    const EA_1_19 = ea.slice(1);

    const EA_Total_16plus = EA_1_19.reduce((a, b) => a + b, 0);
    const EA_Active_16plus = ea.slice(1, 15).reduce((a, b) => a + b, 0);  // 1..14 [web:247]
    const EA_Inactive_16plus = ea.slice(15, 20).reduce((a, b) => a + b, 0); // 15..19 [web:247]

    const outRow = [
      ...cols,

      // HH cols
      hh[0], hh[1], hh[2], hh[3], hh[4], hh[5], hh[6], hh[7], hh[8],
      hhTotal,
      hhAvgApprox === '' ? '' : hhAvgApprox.toFixed(3),

      // EA cols
      EA_m8,
      ...EA_1_19,
      EA_Total_16plus,
      EA_Active_16plus,
      EA_Inactive_16plus
    ];

    outLines.push(outRow.map(escapeCSVField).join(','));
  }

  fs.writeFileSync(OUT_FILE, outLines.join('\n'));
  console.log('Wrote:', OUT_FILE);

  // 5) Missing files only if needed
  if (missingTS017.length > 0) {
    const uniq = Array.from(new Set(missingTS017.filter(Boolean)));
    fs.writeFileSync(MISSING_TS017_FILE, ['LSOA21CD', ...uniq].join('\n'));
    console.log('Missing TS017:', MISSING_TS017_FILE, `(count: ${uniq.length})`);
  } else {
    console.log('No missing TS017. No missing file created.');
  }

  if (missingTS066.length > 0) {
    const uniq = Array.from(new Set(missingTS066.filter(Boolean)));
    fs.writeFileSync(MISSING_TS066_FILE, ['LSOA21CD', ...uniq].join('\n'));
    console.log('Missing TS066:', MISSING_TS066_FILE, `(count: ${uniq.length})`);
  } else {
    console.log('No missing TS066. No missing file created.');
  }
}

main();
