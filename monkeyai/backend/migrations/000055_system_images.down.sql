BEGIN;
ALTER TABLE environments DROP COLUMN image_id;
DROP TABLE images;
COMMIT;
