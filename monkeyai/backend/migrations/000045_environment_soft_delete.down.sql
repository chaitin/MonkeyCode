ALTER TABLE environments DROP CONSTRAINT environments_deleted_at_check;
ALTER TABLE environments DROP COLUMN deleted_at;
