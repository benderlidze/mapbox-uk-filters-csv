const fs = require('fs');
const readline = require('readline');

const GEOJSON_FILE = 'clean_enriched_LSOA.geojson';
const CSV_FILE = 'sapelsoasyoa20222024.csv';

const OUT_FILE = 'lsoa_age_bands.csv';
const ERR_FILE = 'missing_in_csv.csv';

// Age bands (inclusive)
const BANDS = [
  { key: 'Children',             from: 0,  to: 14 },
  { key: 'Young adults',         from: 15, to: 24 },
  { key: 'Early professionals',  from: 25, to: 34 },
  { key: 'Family builders',      from: 35, to: 49 },
  { key: 'Mature adults',        from: 50, to: 64 },
  { key: 'Older',                from: 65, to: 90 }
];

// RFC4180-ish CSV line parser (commas in quotes + "" escape)
function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // If we're inside quotes and the next char is also a quote,
      // this represents an escaped quote ("") -> add a single quote.
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++; // skip the escaped quote
      } else {
        inQuotes = !inQuotes; // toggle quoted mode
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

function toInt(value) {
  if (value == null) return 0;
  const s = String(value).trim().replace(/,/g, ''); // remove thousands separators like 1,898
  if (!s) return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  // ---- 1) Load GeoJSON codes ----
  const geo = JSON.parse(fs.readFileSync(GEOJSON_FILE, 'utf8'));
  const geoCodes = new Set();

  for (const f of geo.features || []) {
    const code = (f?.properties?.LSOA21CD ?? '').toString().trim();
    if (code) geoCodes.add(code);
  }

  // start with all codes missing; delete as we find them in CSV
  const missingCodes = new Set(geoCodes);

  console.log('GeoJSON features:', (geo.features || []).length);
  console.log('Unique LSOA21CD in GeoJSON:', geoCodes.size);

  // ---- 2) Stream CSV + write result CSV ----
  const rl = readline.createInterface({
    input: fs.createReadStream(CSV_FILE),
    crlfDelay: Infinity
  });

  const outStream = fs.createWriteStream(OUT_FILE, { encoding: 'utf8' });
  outStream.write(['LSOA21CD', 'Total', ...BANDS.map(b => b.key)].join(',') + '\n');

  let header = null;

  let idxLSOA = -1;
  let idxTotal = -1;

  // map age -> column index (from header)
  const idxF = {};
  const idxM = {};

  let written = 0;
  let scanned = 0;

  for await (const lineRaw of rl) {
    const line = lineRaw.trim();
    if (!line) continue;

    if (!header) {
      header = parseCSVLine(line);

      idxLSOA = header.indexOf('LSOA 2021 Code');
      idxTotal = header.indexOf('Total');

      if (idxLSOA === -1 || idxTotal === -1) {
        console.error('CSV header columns:', header);
        throw new Error('Could not find required columns: "LSOA 2021 Code" and/or "Total".');
      }

      // find F0..F90 and M0..M90 columns
      for (let i = 0; i < header.length; i++) {
        const name = header[i];

        let m = /^F(\d+)$/.exec(name);
        if (m) {
          idxF[parseInt(m[1], 10)] = i;
          continue;
        }

        m = /^M(\d+)$/.exec(name);
        if (m) {
          idxM[parseInt(m[1], 10)] = i;
        }
      }

      // light sanity check (you can tighten this if you want)
      if (idxF[0] == null || idxF[90] == null || idxM[0] == null || idxM[90] == null) {
        console.warn('Warning: did not detect all F0..F90 and M0..M90 columns (check CSV header).');
      }

      continue;
    }

    scanned++;
    const cols = parseCSVLine(line);

    const code = (cols[idxLSOA] || '').trim();
    if (!code || !geoCodes.has(code)) continue;

    // found this code in CSV
    missingCodes.delete(code);

    const total = toInt(cols[idxTotal]);

    const bandSums = {};
    for (const b of BANDS) bandSums[b.key] = 0;

    for (let age = 0; age <= 90; age++) {
      const f = toInt(cols[idxF[age]]);
      const m = toInt(cols[idxM[age]]);
      const both = f + m;

      // assign age to one band
      for (const b of BANDS) {
        if (age >= b.from && age <= b.to) {
          bandSums[b.key] += both;
          break;
        }
      }
    }

    const row = [
      code,
      String(total),
      ...BANDS.map(b => String(bandSums[b.key]))
    ].join(',');

    outStream.write(row + '\n');
    written++;
  }

  outStream.end();

  console.log('Scanned CSV rows:', scanned);
  console.log('Written result rows:', written);

  // ---- 3) Write missing codes file ONLY if needed ----
  if (missingCodes.size > 0) {
    const errStream = fs.createWriteStream(ERR_FILE, { encoding: 'utf8' });
    errStream.write('LSOA21CD\n');
    for (const code of missingCodes) errStream.write(code + '\n');
    errStream.end();

    console.log('Missing GeoJSON codes not found in CSV:', missingCodes.size);
    console.log('Errors file:', ERR_FILE);
  } else {
    console.log('No missing GeoJSON codes in CSV. No errors file created.');
  }

  console.log('Output file:', OUT_FILE);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
