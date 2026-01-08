// build.js
import dotenv from "dotenv";
import pg from "pg";
import fs from "fs";
import path from "path";

dotenv.config();

const { Client } = pg;

function arrayToCSV(data) {
  if (!data || data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const csvRows = [headers.join(',')];
  
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      if (Array.isArray(value)) {
        return `"${value.join(';')}"`;
      }
      if (value === null || value === undefined) return '';
      const str = String(value);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` 
        : str;
    });
    csvRows.push(values.join(','));
  }
  
  return csvRows.join('\n');
}

async function main() {
  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 6543),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: { rejectUnauthorized: false },
    query_timeout: 120000, // 2 minutes
    statement_timeout: 120000
  });

  try {
    await client.connect();
    console.log('✓ Connected to Supabase');
    
    // Set timeout at session level
    await client.query('SET statement_timeout = 120000');
    
    // Fetch all unique area names
    console.log('\nFetching area names...');
    const areaResult = await client.query(`
      SELECT DISTINCT area_name
      FROM lsoa_polygons
      ORDER BY area_name
    `);
    
    const areaNames = areaResult.rows.map(row => row.area_name);
    console.log(`Found ${areaNames.length} areas\n`);
    
    // Create output directory
    const outputDir = './output';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    
    let successCount = 0;
    let emptyCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < areaNames.length; i++) {
      const areaName = areaNames[i];
      console.log(`[${i + 1}/${areaNames.length}] Processing ${areaName}...`);
      
      try {
        const query = `
          WITH candidate_centers AS (
            SELECT
              p.lsoa_code,
              p.centroid_bng
            FROM lsoa_polygons p
            JOIN lsoa_data d ON p.lsoa_code = d.lsoa_code
            WHERE lower(p.area_name) = lower($1)
            ORDER BY d."Retired" DESC
          )
          SELECT
            c.lsoa_code as center_lsoa,
            ST_X(ST_Transform(c.centroid_bng, 4326)) as center_lng,
            ST_Y(ST_Transform(c.centroid_bng, 4326)) as center_lat,
            SUM(d."Retired") as total_retirees_in_radius,
            COUNT(DISTINCT p.lsoa_code) as num_polygons_in_radius,
            ARRAY_AGG(p.lsoa_code) as polygon_ids_in_radius
          FROM candidate_centers c
          JOIN lsoa_polygons p
            ON lower(p.area_name) = lower($1)
           AND ST_DWithin(c.centroid_bng, p.centroid_bng, 3218.688)
          JOIN lsoa_data d ON p.lsoa_code = d.lsoa_code
          GROUP BY c.lsoa_code, c.centroid_bng
          ORDER BY total_retirees_in_radius DESC
          LIMIT 10;
        `;
        
        const result = await client.query(query, [areaName]);
        
        if (result.rows.length > 0) {
          const csv = arrayToCSV(result.rows);
          const filename = `${areaName.replace(/[^a-z0-9]/gi, '_')}_2_miles.csv`;
          const filepath = path.join(outputDir, filename);
          
          fs.writeFileSync(filepath, csv);
          console.log(`  ✓ Saved ${filename} (${result.rows.length} rows)`);
          successCount++;
        } else {
          console.log(`  ✗ No results`);
          emptyCount++;
        }
        
      } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        errorCount++;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n✅ Complete! ${successCount} files created, ${emptyCount} areas with no results, ${errorCount} errors`);
    
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await client.end();
  }
}

main();
