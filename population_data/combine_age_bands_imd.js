const fs = require('fs');

const AGE_BANDS_FILE = 'lsoa_age_bands.csv';
const IMD_FILE = 'IMD2019.csv';

const OUT_FILE = 'lsoa_age_bands_imd.csv';
const MISSING_FILE = 'missing_in_imd.csv';

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
    const lines = text.trim().split('\n').map(l => l.replace(/\r$/, ''));
    const header = parseCSVLine(lines[0]);

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = parseCSVLine(line);
        rows.push(cols);
    }

    return { header, rows };
}

function escapeCSVField(value) {
    if (value == null) return '';
    const s = String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function main() {
    // --- read IMD -> map(code -> {rank, decile}) ---
    const imd = readCSV(IMD_FILE);

    const imdCodeIdx = imd.header.indexOf('LSOA code (2011)');
    const imdRankIdx = imd.header.indexOf('Index of Multiple Deprivation (IMD) Rank');
    const imdDecIdx = imd.header.indexOf('Index of Multiple Deprivation (IMD) Decile');

    if (imdCodeIdx === -1 || imdRankIdx === -1 || imdDecIdx === -1) {
        console.error('IMD header:', imd.header);
        throw new Error('IMD file missing required columns.');
    }

    const imdByCode = new Map();
    for (const cols of imd.rows) {
        const code = (cols[imdCodeIdx] || '').trim();
        if (!code) continue;
        imdByCode.set(code, {
            rank: (cols[imdRankIdx] || '').trim(),
            decile: (cols[imdDecIdx] || '').trim()
        });
    }

    // --- read age-bands and write merged ---
    const age = readCSV(AGE_BANDS_FILE);

    const ageCodeIdx = age.header.indexOf('LSOA21CD');
    if (ageCodeIdx === -1) {
        console.error('Age-bands header:', age.header);
        throw new Error('Age-bands file missing "LSOA21CD" column.');
    }

    const outHeader = [
        ...age.header,
        'Index of Multiple Deprivation (IMD) Rank',
        'Index of Multiple Deprivation (IMD) Decile'
    ];

    const outLines = [];
    outLines.push(outHeader.map(escapeCSVField).join(','));

    const missing = [];

    for (const cols of age.rows) {
        const code = (cols[ageCodeIdx] || '').trim();
        const imdRow = imdByCode.get(code);

        if (!imdRow) {
            missing.push(code);
            outLines.push([
                ...cols,
                '', // rank
                ''  // decile
            ].map(escapeCSVField).join(','));
        } else {
            outLines.push([
                ...cols,
                imdRow.rank,
                imdRow.decile
            ].map(escapeCSVField).join(','));
        }
    }

    fs.writeFileSync(OUT_FILE, outLines.join('\n'));
    console.log('Wrote:', OUT_FILE);

    // only write missing file if needed
    if (missing.length > 0) {
        const uniq = Array.from(new Set(missing));
        fs.writeFileSync(MISSING_FILE, ['LSOA21CD', ...uniq].join('\n'));
        console.log('Missing:', MISSING_FILE, `(count: ${uniq.length})`);
    } else {
        console.log('No missing LSOA21CD codes. No missing file created.');
    }
}

main();
