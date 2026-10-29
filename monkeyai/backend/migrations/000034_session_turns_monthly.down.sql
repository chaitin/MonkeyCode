BEGIN;
SET LOCAL lock_timeout = '2s';
-- Stop all backends/workers first. Restore CURRENT facts, including purges made
-- after observation ended. A failed NOWAIT lock rolls back the whole migration.
DO $$
DECLARE progress session_turns_partition_state; item record; definition text; business_fks jsonb := '[]';
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(current_schema() || ':session-turns-monthly',0));
    SELECT * INTO STRICT progress FROM session_turns_partition_state FOR UPDATE;
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',progress.source_relation);
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',progress.target_relation);
    PERFORM set_config('monkeyai.turns_mirror','rollback',true);
    EXECUTE format('DROP TRIGGER turns_key ON %s',progress.source_relation);
    EXECUTE format('DROP TRIGGER turns_mirror ON %s',progress.source_relation);
    EXECUTE format('DROP TRIGGER turns_key ON %s',progress.target_relation);
    EXECUTE format('DROP TRIGGER turns_mirror ON %s',progress.target_relation);
    FOR item IN SELECT conname FROM pg_constraint WHERE conrelid=progress.source_relation AND contype='f' LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',progress.source_relation,item.conname);
    END LOOP;
    FOR item IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint
        WHERE conrelid=progress.target_relation AND contype='f' AND confrelid<>'session_turns_keys'::regclass AND conparentid=0 LOOP
        business_fks := business_fks || jsonb_build_array(jsonb_build_object('name',item.conname,'definition',item.definition));
    END LOOP;
    IF progress.phase='partitioned' THEN
        EXECUTE format('DELETE FROM %s',progress.source_relation);
        EXECUTE format('INSERT INTO %s SELECT * FROM %s',progress.source_relation,progress.target_relation);
        EXECUTE format('ALTER TABLE %s RENAME TO session_turns_partitioned',progress.target_relation);
        EXECUTE format('ALTER TABLE %s RENAME TO session_turns',progress.source_relation);
    END IF;
    FOR item IN SELECT c.conrelid,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c
        WHERE c.contype='f' AND c.confrelid='session_turns_keys'::regclass AND c.conparentid=0 AND c.conrelid<>progress.target_relation LOOP
        EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',item.conrelid::regclass);
        definition := regexp_replace(replace(item.definition,'REFERENCES session_turns_keys(','REFERENCES session_turns('),' NOT VALID$','');
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',item.conrelid::regclass,item.conname);
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s NOT VALID',item.conrelid::regclass,item.conname,definition);
    END LOOP;
    DROP VIEW session_turns_original;
    EXECUTE format('DROP TABLE %s',progress.target_relation);
    FOR item IN SELECT value FROM jsonb_array_elements(business_fks) LOOP
        EXECUTE format('ALTER TABLE session_turns ADD CONSTRAINT %I %s',item.value->>'name',item.value->>'definition');
    END LOOP;
END;
$$;
DROP FUNCTION session_finish_turn_observation();
DROP FUNCTION session_cutover_turns();
DROP FUNCTION session_copy_turn_batch(integer);
DROP FUNCTION session_calibrate_turn_counts(integer);
DROP FUNCTION session_ensure_turn_months(timestamptz);
DROP FUNCTION session_create_turn_month(timestamptz,integer);
DROP FUNCTION session_turns_mirror();
DROP FUNCTION session_turns_register_key();
DROP FUNCTION session_turn_bounds(uuid);
DROP FUNCTION session_turn_times(uuid);
DROP FUNCTION session_turn_time(uuid,integer);
DROP FUNCTION session_turns_backfilling();
DROP TABLE session_turns_keys;
DROP TABLE session_turns_partition_state;
ALTER TABLE sessions DROP COLUMN turn_count_verified;
COMMIT;
