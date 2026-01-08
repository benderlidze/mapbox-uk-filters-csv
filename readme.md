DATSETS POPULATION
https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/populationestimates/datasets/lowersuperoutputareamidyearpopulationestimates

https://geoportal.statistics.gov.uk/datasets/68515293204e43ca8ab56fa13ae8a547_0/explore?location=51.392693%2C-2.554487%2C12.53

Step 1: Add Projected Centroid Column (Run Once)
sql
-- Add column for British National Grid (meters-based)
ALTER TABLE lsoa_polygons ADD COLUMN centroid_bng geometry(Point, 27700);

-- Transform centroids to EPSG:27700
UPDATE lsoa_polygons
SET centroid_bng = ST_Transform(centroid_point, 27700);

-- Create spatial index
CREATE INDEX idx_lsoa_centroids_bng ON lsoa_polygons USING GIST(centroid_bng);

-- Update statistics
ANALYZE lsoa_polygons;

Step 2: Updated Query (Proper Circle)

WITH candidate_centers AS (
SELECT
p.lsoa_code,
p.centroid_bng
FROM lsoa_polygons p
JOIN lsoa_data d ON p.lsoa_code = d.lsoa_code
ORDER BY d."Retired" DESC
LIMIT 10000
)
SELECT
c.lsoa_code as center_lsoa,
ST_X(ST_Transform(c.centroid_bng, 4326)) as center_lng,
ST_Y(ST_Transform(c.centroid_bng, 4326)) as center_lat,
SUM(d."Retired") as total_retirees_in_radius,
COUNT(DISTINCT p.lsoa_code) as num_polygons_in_radius,
ARRAY_AGG(p.lsoa_code) as polygon_ids_in_radius
FROM candidate_centers c
JOIN lsoa_polygons p ON ST_DWithin(
c.centroid_bng,
p.centroid_bng,
8046.72 -- 5 miles in meters (proper circle!)
)
JOIN lsoa_data d ON p.lsoa_code = d.lsoa_code
GROUP BY c.lsoa_code, c.centroid_bng
ORDER BY total_retirees_in_radius DESC
LIMIT 10;




---------- FOR SUPABASE ONE QUERY --------------
WITH area_list AS (
  SELECT DISTINCT area_name
  FROM lsoa_polygons
  ORDER BY area_name
  
),
results AS (
  SELECT 
    a.area_name,
    c.lsoa_code as center_lsoa,
    ST_X(ST_Transform(c.centroid_bng, 4326)) as center_lng,
    ST_Y(ST_Transform(c.centroid_bng, 4326)) as center_lat,
    SUM(d."Retired") as total_retirees_in_radius,
    COUNT(DISTINCT p.lsoa_code) as num_polygons_in_radius,
    ARRAY_AGG(p.lsoa_code) as polygon_ids_in_radius,
    ROW_NUMBER() OVER (PARTITION BY a.area_name ORDER BY SUM(d."Retired") DESC) as rn
  FROM area_list a
  CROSS JOIN LATERAL (
    SELECT p2.lsoa_code, p2.centroid_bng
    FROM lsoa_polygons p2
    JOIN lsoa_data d2 ON p2.lsoa_code = d2.lsoa_code
    WHERE lower(p2.area_name) = lower(a.area_name)
    ORDER BY d2."Retired" DESC
  ) c
  JOIN lsoa_polygons p
    ON lower(p.area_name) = lower(a.area_name)
    AND ST_DWithin(c.centroid_bng, p.centroid_bng, 3218.688)
  JOIN lsoa_data d ON p.lsoa_code = d.lsoa_code
  GROUP BY a.area_name, c.lsoa_code, c.centroid_bng
)
SELECT 
  area_name,
  center_lsoa,
  center_lng,
  center_lat,
  total_retirees_in_radius,
  num_polygons_in_radius,
  polygon_ids_in_radius,
  '2_miles' as radius
FROM results
WHERE rn = 1
ORDER BY area_name;
---------- FOR SUPABASE ONE QUERY --------------






//FOR PLACES
WITH candidate_centers AS (
SELECT
p.lsoa_code,
p.centroid_bng
FROM lsoa_polygons p
JOIN lsoa_data d ON p.lsoa_code = d.lsoa_code
WHERE lower(p.area_name) = lower('cornwall')
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
ON lower(p.area_name) = lower('cornwall')
AND ST_DWithin(c.centroid_bng, p.centroid_bng, 8046.72)
JOIN lsoa_data d ON p.lsoa_code = d.lsoa_code
GROUP BY c.lsoa_code, c.centroid_bng
ORDER BY total_retirees_in_radius DESC
LIMIT 10;
