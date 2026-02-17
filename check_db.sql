-- Check if campaigns table has progress columns
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'campaigns' 
ORDER BY ordinal_position;

-- If columns are missing, add them:
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS processed INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS successful INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS failed INTEGER DEFAULT 0;

-- Verify columns were added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'campaigns' 
AND column_name IN ('processed', 'successful', 'failed');
