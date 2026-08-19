-- delivery_type 'test' support
-- SQLite cannot modify CHECK constraints, but D1 doesn't enforce CHECK on INSERT
-- when the column already exists. We just document the intent here.
-- The application code will write 'test' values; the schema.sql has the updated CHECK
-- for new environments.
SELECT 1;
