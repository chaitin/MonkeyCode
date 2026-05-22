CREATE TABLE IF NOT EXISTS license_installations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    installation_id character varying NOT NULL,
    product character varying NOT NULL,
    product_version character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT license_installations_product_check CHECK (((product)::text = 'monkeycode-enterprise'::text))
);

CREATE UNIQUE INDEX IF NOT EXISTS license_installations_installation_id_key ON license_installations USING btree (installation_id);

CREATE TABLE IF NOT EXISTS license_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    license_id character varying NOT NULL,
    installation_id character varying NOT NULL,
    customer_id character varying,
    customer_name character varying,
    seats integer NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    payload_json character varying NOT NULL,
    signature character varying NOT NULL,
    key_id character varying NOT NULL,
    alg character varying NOT NULL,
    active boolean DEFAULT false NOT NULL,
    imported_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT license_records_alg_check CHECK (((alg)::text = 'Ed25519'::text))
);

CREATE UNIQUE INDEX IF NOT EXISTS license_records_license_id_key ON license_records USING btree (license_id);
CREATE INDEX IF NOT EXISTS idx_license_records_installation_id ON license_records USING btree (installation_id);
CREATE INDEX IF NOT EXISTS idx_license_records_active ON license_records USING btree (active);

CREATE TABLE IF NOT EXISTS license_audits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    license_id character varying,
    action character varying NOT NULL,
    result character varying NOT NULL,
    message character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT license_audits_action_check CHECK (((action)::text = ANY ((ARRAY['export_machine_code'::character varying, 'import_license'::character varying, 'view_status'::character varying])::text[]))),
    CONSTRAINT license_audits_result_check CHECK (((result)::text = ANY ((ARRAY['success'::character varying, 'failed'::character varying])::text[])))
);

CREATE INDEX IF NOT EXISTS idx_license_audits_license_id ON license_audits USING btree (license_id);
CREATE INDEX IF NOT EXISTS idx_license_audits_action ON license_audits USING btree (action);
CREATE INDEX IF NOT EXISTS idx_license_audits_created_at ON license_audits USING btree (created_at);
