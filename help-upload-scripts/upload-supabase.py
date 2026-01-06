import geopandas as gpd
from sqlalchemy import create_engine

# Read shapefile from zip
gdf = gpd.read_file('zip://../data/Lower_layer_Super_Output_Areas_December_2021_Boundaries_EW_BGC_V5_4492169359079898015 (1).zip')

# Convert to EPSG:4326
gdf = gdf.to_crs(epsg=4326)

# Connect to Supabase
engine = create_engine('postgresql://postgres.acykcnsjhtteorhhskaf:oDcsQU09GWm1bbbq@aws-1-eu-west-2.pooler.supabase.com:6543/postgres')

# Upload to PostGIS
gdf.to_postgis('lsoa_polygons', engine, if_exists='replace', index=False)

print("Upload complete!")
