BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':billing-ledger-partitions', 0));
DO $$
DECLARE progress billing_ledger_partition_state;
BEGIN
    SELECT * INTO STRICT progress FROM billing_ledger_partition_state;
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT', progress.source_relation);
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT', progress.target_relation);
    EXECUTE format('DROP TRIGGER billing_ledger_forward ON %s', progress.source_relation);
    EXECUTE format('DROP TRIGGER billing_ledger_reverse ON %s', progress.target_relation);
    IF progress.phase = 'partitioned' THEN
        -- Always restore missing facts from the authoritative parent. An observation
        -- flag is not proof that every historical transaction made its mirror.
        EXECUTE format('INSERT INTO %s SELECT * FROM %s current_entries WHERE NOT EXISTS
            (SELECT 1 FROM %s old_entries WHERE old_entries.id=current_entries.id)',
            progress.source_relation, progress.target_relation, progress.source_relation);
        DROP TRIGGER stats_model_credit_added ON credit_ledger_entries;
        ALTER TABLE credit_ledger_entries RENAME TO credit_ledger_entries_partitioned;
        ALTER TABLE credit_ledger_entries_legacy RENAME TO credit_ledger_entries;
        CREATE TRIGGER stats_model_credit_added AFTER INSERT ON credit_ledger_entries
        REFERENCING NEW TABLE AS inserted_credits FOR EACH STATEMENT EXECUTE FUNCTION stats_model_credit_added();
    END IF;
END;
$$;
DROP VIEW billing_ledger_original_entries;
DROP TABLE credit_ledger_entries_partitioned CASCADE;
DROP FUNCTION billing_finish_ledger_observation();
DROP FUNCTION billing_cutover_ledger();
DROP FUNCTION billing_copy_ledger_batch(integer);
DROP FUNCTION billing_ensure_ledger_weeks(timestamptz);
DROP FUNCTION billing_create_ledger_week(timestamptz, integer);
DROP FUNCTION billing_mirror_ledger();
DROP FUNCTION billing_register_ledger_key();
DROP TABLE billing_ledger_partition_state;
DROP TABLE credit_ledger_entry_keys;
COMMIT;
