const fs = require('fs');

// --- read input CSV ---
const csvData = fs.readFileSync('Mid-2024 LSOA 2021.csv', 'utf8');
const lines = csvData.trim().split('\n');

const results = [];

// --- header parsing (simple split is OK for header) ---
const header = lines[0].trim().split(',');
const fColumns = [];
const mColumns = [];

// Find F0-F90 and M0-M90 columns by index from header
for (let i = 0; i < header.length; i++) {
  if (header[i].startsWith('F') && header[i] !== 'Total') {
    fColumns.push(i);
  } else if (header[i].startsWith('M')) {
    mColumns.push(i);
  }
}

console.log(`Found ${fColumns.length} F columns, ${mColumns.length} M columns`);

// --- process each data line ---
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  const columns = parseCSVLine(line); // robust parser

  const ladCode  = columns[0];
  const ladName  = columns[1];   // may contain comma in input
  const lsoaCode = columns[2];
  const lsoaName = columns[3];
  const totalRaw = columns[4];   // like "1,861" from source

  let fsSum = 0;
  let msSum = 0;

  // Sum F columns
  for (const col of fColumns) {
    const v = (columns[col] || '').replace(/,/g, '');
    fsSum += v ? parseInt(v, 10) : 0;
  }

  // Sum M columns
  for (const col of mColumns) {
    const v = (columns[col] || '').replace(/,/g, '');
    msSum += v ? parseInt(v, 10) : 0;
  }

  const totalMF = fsSum + msSum;

  // DO NOT format with commas here; keep them plain numbers
  const fsummStr   = String(fsSum);
  const msummStr   = String(msSum);
  const totalMFStr = String(totalMF);

  // total from source already has commas; keep as-is, but ensure quoted once
  const totalField = quoteIfNeeded(totalRaw);

  results.push([
    quoteIfNeeded(ladCode),
    quoteIfNeeded(ladName),
    quoteIfNeeded(lsoaCode),
    quoteIfNeeded(lsoaName),
    totalField,
    fsummStr,
    msummStr,
    totalMFStr
  ].join(','));
}

// --- CSV parser that handles quoted fields with commas ---
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

// Quote a field if it contains a comma or quote; escape quotes inside
function quoteIfNeeded(value) {
  if (value == null) return '';
  let s = String(value);
  if (s.includes('"')) {
    s = s.replace(/"/g, '""');
  }
  if (s.includes(',') || s.includes('"') || /\s/.test(s) && s !== s.trim()) {
    return `"${s}"`;
  }
  return s;
}

// --- write output ---
const outputHeader = 'LAD 2023 Code,LAD 2023 Name,LSOA 2021 Code,LSOA 2021 Name,Total,Fsumm,Msumm,TotalMF';
const output = outputHeader + '\n' + results.join('\n');
fs.writeFileSync('output.csv', output);

console.log('Processing complete. Output saved to output.csv');
console.log('Sample results:');
console.log(results.slice(0, 3).join('\n'));
