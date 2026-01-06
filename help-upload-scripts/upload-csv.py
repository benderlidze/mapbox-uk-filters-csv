import pandas as pd
from sqlalchemy import create_engine

# Read CSV - use relative path only
df = pd.read_csv('../population_data/TS066-2021-1-filtered-2025-12-18T16_13_05Z_collapsed.csv')

# Rename 'code' column to match easier
df = df.rename(columns={'code': 'lsoa_code'})

# Connect to Supabase
engine = create_engine('postgresql://postgres.acykcnsjhtteorhhskaf:oDcsQU09GWm1bbbq@aws-1-eu-west-2.pooler.supabase.com:5432/postgres')

# Upload to PostGIS
df.to_sql('lsoa_data', engine, if_exists='replace', index=False)

print(f"Upload complete! {len(df)} rows uploaded.")
