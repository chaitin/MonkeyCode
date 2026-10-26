BEGIN;
SET LOCAL lock_timeout = '2s';
-- Stop all backends/workers first. NOWAIT keeps a failed rollback fully atomic.
DO $$
DECLARE progress billing_activity_partition_state; item record; assignments text;
    marker text := ''; definition text; business_fks jsonb := '[]';
BEGIN
    FOR progress IN SELECT * FROM billing_activity_partition_state ORDER BY table_name LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended(current_schema() || ':billing-activity:' || progress.table_name,0));
        EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',progress.source_relation);
        EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',progress.target_relation);
        marker := marker || ',' || progress.table_name || ',';
    END LOOP;
    PERFORM set_config('monkeyai.activity_mirror',marker,true);
    FOR progress IN SELECT * FROM billing_activity_partition_state ORDER BY table_name LOOP
        EXECUTE format('DROP TRIGGER activity_mirror ON %s',progress.source_relation);
        EXECUTE format('DROP TRIGGER activity_mirror ON %s',progress.target_relation);
        EXECUTE format('DROP TRIGGER activity_key ON %s',progress.source_relation);
        EXECUTE format('DROP TRIGGER activity_key ON %s',progress.target_relation);
        -- A legacy snapshot must never keep enforcing relationships against live keys.
        FOR item IN SELECT conname FROM pg_constraint WHERE conrelid=progress.source_relation AND contype='f' AND conparentid=0 LOOP
            EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',progress.source_relation,item.conname);
        END LOOP;
        FOR item IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint
            WHERE conrelid=progress.target_relation AND contype='f' AND conparentid=0
            AND confrelid<>to_regclass(format('%I.%I',current_schema(),progress.table_name || '_keys'))
        LOOP
            business_fks := business_fks || jsonb_build_array(jsonb_build_object('table_name',progress.table_name,'name',item.conname,'definition',item.definition));
        END LOOP;
        IF progress.phase='partitioned' THEN
            -- Mutable facts require exact restoration, including post-observation
            -- updates AND deletions. Re-inserting only missing rows would resurrect purges.
            PERFORM billing_activity_move_stats(progress.target_relation,progress.source_relation);
            -- Keep projections quiet during the physical restoration.
            FOR item IN SELECT tgname FROM pg_trigger WHERE tgrelid=progress.source_relation AND NOT tgisinternal AND tgname LIKE 'stats_%' LOOP
                EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I',progress.source_relation,item.tgname);
            END LOOP;
            -- Replace the obsolete snapshot transactionally. This also handles
            -- unique job IDs that changed owners after the observation window.
            EXECUTE format('DELETE FROM %s',progress.source_relation);
            EXECUTE format('INSERT INTO %s SELECT * FROM %s',progress.source_relation,progress.target_relation);
            FOR item IN SELECT tgname FROM pg_trigger WHERE tgrelid=progress.source_relation AND NOT tgisinternal AND tgname LIKE 'stats_%' LOOP
                EXECUTE format('ALTER TABLE %s ENABLE TRIGGER %I',progress.source_relation,item.tgname);
            END LOOP;
            EXECUTE format('ALTER TABLE %s RENAME TO %I',progress.target_relation,progress.table_name || '_partitioned');
            EXECUTE format('ALTER TABLE %s RENAME TO %I',progress.source_relation,progress.table_name);
        END IF;
    END LOOP;
    -- Restore external FK targets before dropping the global registry. Referencing
    -- rows are unchanged and the complete authoritative transactions were restored.
    FOR item IN SELECT c.conrelid,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c
        WHERE c.contype='f' AND c.confrelid='billing_transactions_keys'::regclass AND c.conparentid=0
        AND NOT EXISTS(SELECT 1 FROM billing_activity_partition_state s WHERE c.conrelid IN(s.source_relation,s.target_relation))
    LOOP
        EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',item.conrelid::regclass);
        definition := replace(item.definition,'REFERENCES billing_transactions_keys(','REFERENCES billing_transactions(');
        definition := regexp_replace(definition,' NOT VALID$','');
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',item.conrelid::regclass,item.conname);
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s NOT VALID',item.conrelid::regclass,item.conname,definition);
    END LOOP;
    FOR progress IN SELECT * FROM billing_activity_partition_state ORDER BY table_name LOOP
        EXECUTE format('DROP VIEW %I',progress.table_name || '_original');
        EXECUTE format('DROP TABLE %s',progress.target_relation);
    END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(business_fks) LOOP
        definition := replace(item.value->>'definition','REFERENCES billing_transactions_keys(','REFERENCES billing_transactions(');
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',item.value->>'table_name',item.value->>'name',definition);
    END LOOP;
END;
$$;
CREATE OR REPLACE FUNCTION stats_model_usage_known() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
    NEW.usage_known := coalesce(
        (SELECT (b.usage->>'known')::boolean FROM billing_transactions b WHERE b.id = NEW.id),
        coalesce(NEW.error_code, '') = '');
    RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION stats_model_billing_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE model_calls c SET usage_known = coalesce((b.usage->>'known')::boolean, coalesce(c.error_code, '') = '')
        FROM inserted_billing b WHERE c.id = b.id
            AND c.usage_known IS DISTINCT FROM coalesce((b.usage->>'known')::boolean, coalesce(c.error_code, '') = '');
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE model_calls c SET usage_known = coalesce((b.usage->>'known')::boolean, coalesce(c.error_code, '') = '')
        FROM updated_billing b JOIN previous_billing old_b ON old_b.id = b.id
        WHERE c.id = b.id AND (b.usage->>'known') IS DISTINCT FROM (old_b.usage->>'known')
            AND c.usage_known IS DISTINCT FROM coalesce((b.usage->>'known')::boolean, coalesce(c.error_code, '') = '');
    ELSE
        UPDATE model_calls c SET usage_known = coalesce(c.error_code, '') = ''
        FROM deleted_billing b WHERE c.id = b.id
            AND c.usage_known IS DISTINCT FROM (coalesce(c.error_code, '') = '');
    END IF;
    RETURN NULL;
END;
$$;
DROP FUNCTION billing_finish_activity_observation();
DROP FUNCTION billing_cutover_activity(text);
DROP FUNCTION billing_activity_move_stats(regclass,regclass);
DROP FUNCTION billing_copy_activity_batch(text,integer);
DROP FUNCTION billing_ensure_activity_weeks(text,timestamptz);
DROP FUNCTION billing_create_activity_week(text,timestamptz,integer);
DROP FUNCTION billing_activity_mirror();
DROP FUNCTION billing_activity_register_key();
DROP FUNCTION billing_activity_key_payload(text,jsonb,text);
DROP FUNCTION billing_activity_time(text,uuid);
DROP FUNCTION billing_activity_backfilling(text);
DROP TABLE billing_activity_partition_state;
DROP TABLE billing_transactions_keys,model_calls_keys,mcp_tool_calls_keys,image_calls_keys,video_calls_keys;
DROP INDEX billing_transactions_migration_identity,model_calls_migration_identity,mcp_tool_calls_migration_identity,image_calls_migration_identity,video_calls_migration_identity,video_calls_migration_job;
DROP INDEX billing_transactions_migration_time,model_calls_migration_time,mcp_tool_calls_migration_time,image_calls_migration_time,video_calls_migration_time;
COMMIT;
