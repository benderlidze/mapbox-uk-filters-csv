const fs = require('fs');

// ---------- CSV → map by LSOA code ----------
const csvText = fs.readFileSync('output.csv', 'utf8');
const csvLines = csvText.trim().split('\n');

// robust CSV parser (same logic as in the sum script)
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

// header
const headerCols = parseCSVLine(csvLines[0]);

// indexes now match the header:
const idxLsoa    = headerCols.indexOf('LSOA 2021 Code');
const idxTotalMF = headerCols.indexOf('TotalMF');

if (idxLsoa === -1 || idxTotalMF === -1) {
  console.error('Header problem. Columns found:', headerCols);
  process.exit(1);
}

const lsoaFromCsv = {};
for (let i = 1; i < csvLines.length; i++) {
  const cols = parseCSVLine(csvLines[i]);
  const code = (cols[idxLsoa] || '').trim();
  if (!code) continue;
  lsoaFromCsv[code] = {
    TotalMF: cols[idxTotalMF]
  };
}

// quick sanity check
console.log('CSV E01015388:', lsoaFromCsv['E01015388']);

// ---------- GeoJSON ----------
const geojson = JSON.parse(fs.readFileSync('LSOA_2021_EW_BGC_V5.json', 'utf8'));

const geoMissingCsv = [];
let matched = 0;

for (const f of geojson.features) {
  const props = f.properties;
  const code = String(props.LSOA21CD || '').trim();

  // remove unwanted fields
  delete props.LSOA21NMW;
  delete props.BNG_E;
  delete props.BNG_N;
  delete props.LAT;
  delete props.LONG;
  delete props.GlobalID;

  const row = lsoaFromCsv[code];
  if (row) {
    props.TotalMF = row.TotalMF;
    matched++;
  } else {
    geoMissingCsv.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        LSOA21CD: code,
        LSOA21NM: props.LSOA21NM,
        status: 'MISSING_IN_CSV'
      }
    });
  }
}

// debug for the trouble code
const feat15388 = geojson.features.find(
  f => String(f.properties.LSOA21CD).trim() === 'E01015388'
);
console.log('Geo E01015388 found:', !!feat15388);
console.log('Geo E01015388 TotalMF:', feat15388 && feat15388.properties.TotalMF);
console.log('Matched:', matched, '/', geojson.features.length);

// compact outputs (no pretty-print to avoid bloat)
fs.writeFileSync('clean_enriched_LSOA.geojson', JSON.stringify(geojson));
fs.writeFileSync('missed_LSOA.geojson', JSON.stringify({
  type: 'FeatureCollection',
  features: geoMissingCsv
}));
