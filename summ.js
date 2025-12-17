// sum-populations.js
import fs from 'fs';

const csvData = fs.readFileSync('TS007-2021-1.csv', 'utf8');
const lines = csvData.split('\n').filter(line => line.trim());

const populations = {};

for (const line of lines.slice(1)) { // Skip header
  const cols = line.split(',');
  if (cols.length < 5) continue;
  
  const code = cols[0]?.trim();
  const name = cols[1]?.trim();
  const observation = cols[4]?.trim();
  
  if (!code || !observation) continue;
  
  const pop = parseInt(observation, 10);
  if (isNaN(pop)) continue;
  
  if (!populations[code]) {
    populations[code] = {
      code,
      name,
      total: 0
    };
  }
  populations[code].total += pop;
}

// Output CSV
const output = Object.values(populations)
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(p => `${p.code},"${p.name.replace(/"/g, '""')}",${p.total}`)
  .join('\n');

const result = `code,name,total_population\n${output}`;

console.log(result);
fs.writeFileSync('populations.csv', result);
console.log(`\n✅ Saved ${Object.keys(populations).length} local authorities to populations.csv`);
