-- = Overview
-- For each "kind of UTxO" for the dens protocol, we create a table for it e.g.
-- we have tables
--  - `+dens_set_utxos+`
--  - `+dens_elem_ids+`
--  - `+dens_protocol_utxos+`
-- We call such a table a _dens table_.
-- Each of these dens tables has a foreign key to `+tx_out_refs+` s.t. when a
-- UTxO gets spent, we may simply delete the corresponding transaction output
-- `+tx_out_refs+` where the deletion will cascade down to the dens table.
-- Note that the `+tx_out_refs+` has foreign keys to the `+blocks+` table.
-- 
-- To handle rollbacks (recall a rollback is when the blockchain "goes back" to
-- a previous block state), we have the `+undo_log+` table which associates
-- blocks with the inverse operation of the SQL statements that changed dens
-- tables (or the `+tx_out_refs+`/`+blocks+` table).
-- Thus, rolling back amounts to executing each of the SQL statements stored in
-- `+undo_log+` until we reach the block that we must roll back to.
-- Finally, to maintain the `+undo_log+`, we essentially create a "higher order
-- function" which creates a trigger for each of the dens tables (and the
-- `+tx_out_refs+`/`+blocks+` table) which records the inverse SQL operation in
-- the `+undo_log+` table.
-- One wrinkle with the triggers is that cascaded SQL operations don't execute
-- the triggers in the "right order" e.g. if we have table A and table B where
-- B has a foreign key to A, and we delete something in A, the trigger for A
-- will run, then the trigger for B will run -- so undoing will temporarily
-- violate the foreign key constraint. Hence, why we always have `+DEFERRABLE+`
-- set for foreign keys.
--
-- Finally, this schema assumes that we are only following a single DeNS
-- protocol. Thus, it assumes that there is a unique protocol NFT we are
-- interested in following -- see the table `+dens_protocol_nft+` for details.
-- 
--
-- = References
-- 
-- * [#ogmios] https://ogmios.dev/api/

-----------------------------------------------------------------------------
-- = Types
-----------------------------------------------------------------------------
DO LANGUAGE plpgsql
$body$
    BEGIN
        CREATE TYPE asset_class_type AS (
            currency_symbol bytea,
            token_name bytea
        );

        CREATE DOMAIN asset_class AS asset_class_type 
        CONSTRAINT currency_symbol_not_null CHECK (((VALUE).currency_symbol IS NOT NULL))
        CONSTRAINT token_name_not_null CHECK (((VALUE).token_name IS NOT NULL))
        -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Value.hs#L75-L92
        CONSTRAINT currency_symbol_length CHECK ((octet_length((VALUE).currency_symbol) = 0) OR (octet_length((VALUE).currency_symbol) = 28))
        -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Value.hs#L99-L112
        CONSTRAINT token_name_length CHECK (octet_length((VALUE).token_name) <= 32);

        EXCEPTION
            WHEN duplicate_object THEN null;
    END
$body$;

-----------------------------------------------------------------------------
-- = Tables for general information about the blockchain
-----------------------------------------------------------------------------

-- All blocks in the blockchain.
CREATE TABLE IF NOT EXISTS blocks (
    block_slot bigint NOT NULL,

    block_id bytea NOT NULL,

    PRIMARY KEY (block_id, block_slot)
);

-- Transaction outputs relevant to the dens tables
CREATE TABLE IF NOT EXISTS tx_out_refs (
    tx_out_ref_id bytea NOT NULL,

    tx_out_ref_idx bigint NOT NULL,

    block_slot bigint NOT NULL,

    block_id bytea NOT NULL,

    FOREIGN KEY (block_id, block_slot) REFERENCES blocks (block_id, block_slot)
    ON DELETE CASCADE DEFERRABLE,

    -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Tx.hs#L51-L65
    CONSTRAINT tx_id_length_is_32 CHECK (octet_length(tx_out_ref_id) = 32),
 
    PRIMARY KEY (tx_out_ref_id, tx_out_ref_idx)
);

-----------------------------------------------------------------------------
-- = Tables for the protocol
-----------------------------------------------------------------------------

-----------------------------------------------------------------------------
-- == Table for the Linked list for associating domain names to RRs
-----------------------------------------------------------------------------
-- Linked list set data structure
CREATE TABLE IF NOT EXISTS dens_set_utxos (
    -- Unique identifier for the names
    id bigserial UNIQUE,

    -- name for the DNS record that is owned
    name bytea UNIQUE,

    -- Token which associates this `+name+` with a validator address which
    -- actually holds (a reference) to the RRs.
    pointer asset_class NOT NULL,

    tx_out_ref_id bytea NOT NULL,
    tx_out_ref_idx bigint NOT NULL,

    PRIMARY KEY (tx_out_ref_id, tx_out_ref_idx),

    FOREIGN KEY (tx_out_ref_id, tx_out_ref_idx) REFERENCES tx_out_refs (tx_out_ref_id, tx_out_ref_idx)
    ON DELETE CASCADE DEFERRABLE
);

-- Index s.t. one can efficiently query if change has happened in the
-- dens_set_utxos
CREATE INDEX IF NOT EXISTS dens_set_utxos_asset_class ON dens_set_utxos (pointer);

-- Index s.t. one can efficiently query which UTxO to spend
CREATE INDEX IF NOT EXISTS dens_set_utxos_name ON dens_set_utxos (name);

-----------------------------------------------------------------------------
-- == Table for representing the UTxOs which contain RRs
-----------------------------------------------------------------------------

-- `+TxOutRef+`s which contain the dens_set_utxos(pointer)
-- i.e., these are the UTxOs which identify the transactions which contain
-- transaction outputs that contain RRs as datum.
CREATE TABLE IF NOT EXISTS dens_elem_ids (
    id bigserial UNIQUE,

    tx_out_ref_id bytea NOT NULL,

    tx_out_ref_idx bigint NOT NULL,

    asset_class asset_class NOT NULL,

    PRIMARY KEY(id),

    UNIQUE (asset_class),

    UNIQUE (tx_out_ref_id, tx_out_ref_idx, asset_class),

    FOREIGN KEY (tx_out_ref_id, tx_out_ref_idx) REFERENCES tx_out_refs (tx_out_ref_id, tx_out_ref_idx)
    ON DELETE CASCADE DEFERRABLE
);

CREATE INDEX IF NOT EXISTS dens_elem_ids_asset_classes ON dens_elem_ids(asset_class);

-- The list of RRs at `+DensValidator+`s addresses i.e., this forms a
-- . M:1 relationship of `+dens_rrs+` to `+dens_elem_ids+`
--
-- NOTE:(jaredponn): so unlike the rest of the tables, the UTxOs we are
-- interested in are controlled by how an asset class at `+dens_elem_ids+`
-- is traded i.e.,
--
-- . If the asset class at `+dens_elem_ids+` is traded (i.e., if this
--    UTxO is consumed), then the RRs are deleted
-- 
-- Contrast this to how all other tables have FKs to the `+tx_out_refs+` table
--
-- NOTE(jaredponn): this loosely follows the records table in
-- <https://github.com/PowerDNS/pdns/blob/0b6eb67e14ce894e8286c0993e393b1191411c96/modules/gpgsqlbackend/schema.pgsql.sql>
-- NOTE(jaredponn): the only DNS backend we support is PowerDNS. The following
-- are useful docs:
-- . <https://github.com/PowerDNS/pdns/blob/0b6eb67e14ce894e8286c0993e393b1191411c96/modules/gpgsqlbackend/schema.pgsql.sql>
-- for the schema
-- . <https://github.com/PowerDNS/pdns/blob/0b6eb67e14ce894e8286c0993e393b1191411c96/modules/gpgsqlbackend/gpgsqlbackend.cc>
-- . In the future, it'll probably be a reasonable idea to write up our own Cardano backend.
-- See over here: <https://doc.powerdns.com/authoritative/appendices/backend-writers-guide.html> for details

CREATE TABLE IF NOT EXISTS dens_rrs (
    id bigserial,

    -- The type of the RR e.g. `+A+`, `+AAAA+`, etc.
    type varchar(10) NOT NULL,

    ttl int NOT NULL,

    content varchar(65535) NOT NULL,

    dens_elem_id bigserial,

    PRIMARY KEY(id),

    FOREIGN KEY (dens_elem_id) REFERENCES dens_elem_ids(id)
    ON DELETE CASCADE DEFERRABLE
);

-----------------------------------------------------------------------------
-- == Table for the protocol UTxO
-----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dens_protocol_utxos (
    element_id_minting_policy bytea NOT NULL,

    set_elem_minting_policy bytea NOT NULL,

    set_validator bytea NOT NULL,

    records_validator bytea NOT NULL,

    tx_out_ref_id bytea NOT NULL,

    tx_out_ref_idx bigint NOT NULL,

    PRIMARY KEY (tx_out_ref_id, tx_out_ref_idx),

    FOREIGN KEY (tx_out_ref_id, tx_out_ref_idx) REFERENCES tx_out_refs (tx_out_ref_id, tx_out_ref_idx)
    ON DELETE CASCADE DEFERRABLE
);

-----------------------------------------------------------------------------
-- == Table for the protocol NFT
-----------------------------------------------------------------------------
-- Note that we assume that we are only following a single instance of the DeNS
-- protocol in this schema, so really _all_ DeNS tables depend on this table;
-- and hence have a foreign key to this table.
-- But, to simplify the schema, we only allow at most one dens_protocol_nft to
-- exist, and hence we don't write this foreign key dependency explicitly in
-- the tables.
-- See `+dens_set_protocol_nft+` for details.
CREATE TABLE IF NOT EXISTS dens_protocol_nft(
    at_most_one boolean PRIMARY KEY DEFAULT TRUE,
    asset_class asset_class NOT NULL,

    CONSTRAINT at_most_one CHECK (at_most_one)
    );

-----------------------------------------------------------------------------
-- = Tables for the undo log
-----------------------------------------------------------------------------

-- Associates a block (the block id and block slot) with an SQL statement to
-- undo something. 

-- TODO(jaredponn): we can play around with the length of undo_log and make it
-- based on the maximum length of the rollback to save some memory.
-- See https://cips.cardano.org/cip/CIP-9/ for details.
CREATE TABLE IF NOT EXISTS undo_log (
    seq bigserial,

    block_slot bigint NOT NULL,

    block_id bytea NOT NULL,

    undo_statement text NOT NULL,

    FOREIGN KEY (block_id, block_slot) REFERENCES blocks (block_id, block_slot)
    ON DELETE CASCADE DEFERRABLE,

    PRIMARY KEY (seq)
);

CREATE INDEX IF NOT EXISTS undo_log_block_id_and_block_slot ON undo_log (block_slot, block_id);

-- Gets the most recent block
CREATE OR REPLACE FUNCTION get_most_recent_block()
RETURNS blocks AS
$body$
    DECLARE most_recent_block blocks;
    BEGIN
        SELECT blocks.block_slot, blocks.block_id INTO most_recent_block
        FROM blocks
        WHERE blocks.block_slot = (SELECT max(block_slot) FROM blocks);

        RETURN most_recent_block;
    END
$body$
LANGUAGE plpgsql;

-- Given a `+table_name+`, returns `+<table_name>_undo_insert+`. This exists to
-- ensure that we have a consistent way of generating the trigger / function
-- name associated with a table.
CREATE OR REPLACE FUNCTION create_undo_insert_name(table_name text)
RETURNS text AS
$body$
    BEGIN
        RETURN table_name || '_undo_insert';
    END
$body$
LANGUAGE plpgsql;

-- Creates a function and trigger with the name `+table_name_undo_insert+`
-- which on insertion to `+table_name+`, assuming that `+undo_log.freeze_log+`
-- is not true, appends an SQL statement of the form
-- ---
-- format
--  ( $$ DELETE FROM table_name WHERE primary_key1 = %L AND ... primary_keyN = %L $$
--  , NEW.primary_key1
--  , ...
--  , NEW.primary_keyN
--  )
-- ---
-- to `+undo_log+` associated with the most recently added block (if it exists,
-- otherwise we do nothing).
CREATE OR REPLACE FUNCTION create_table_undo_insert(table_name text)
RETURNS void AS
$body$
    DECLARE
        name text := create_undo_insert_name(table_name);
        sql_is_primary_keys text;
        sql_new_primary_keys text;
    BEGIN
        CREATE TEMP TABLE table_primary_keys(
            primary_key text
        ) ON COMMIT DROP;

        -- See <https://wiki.postgresql.org/wiki/Retrieve_primary_key_columns>
        -- for details
        INSERT INTO table_primary_keys 
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid
                             AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = CAST (table_name AS regclass)
        AND i.indisprimary;

        -- Create a string of the form 
        -- ---
        -- primary_key1 = %L AND primary_key2 = %L ... AND primary_keyN = %L
        -- ---
        SELECT string_agg(format('%I = %%L', primary_key),  ' AND ' ORDER BY primary_key ASC) INTO STRICT sql_is_primary_keys
        FROM table_primary_keys;

        -- Create a string of the form 
        -- ---
        -- NEW.primary_key1, NEW.primary_key2, ..., NEW.primary_keyN
        -- ---
        SELECT string_agg(format('NEW.%I', primary_key), ',' ORDER BY primary_key ASC) INTO STRICT sql_new_primary_keys
        FROM table_primary_keys;

        EXECUTE
            format(
                $undo_function$
                CREATE OR REPLACE FUNCTION %I()
                    RETURNS trigger AS
                    $$
                        DECLARE
                            most_recent_block record := get_most_recent_block();
                        BEGIN
                            IF current_setting('undo_log.freeze_log', TRUE) = CAST(TRUE AS TEXT) THEN
                                RETURN NEW;
                            END IF;

                            IF most_recent_block IS NOT NULL THEN -- if there is no block, then we can't associate the undo log with anything
                                INSERT INTO undo_log (seq, block_slot, block_id, undo_statement)
                                VALUES (DEFAULT, most_recent_block.block_slot, most_recent_block.block_id, format(%L, %s));
                            END IF;

                            RETURN NEW;
                        END
                    $$
                    LANGUAGE plpgsql;
                $undo_function$, 
                name,
                format('DELETE FROM %I WHERE %s', table_name, sql_is_primary_keys),
                sql_new_primary_keys
            );

        EXECUTE
            format(
                $undo_trigger$
                    CREATE OR REPLACE TRIGGER %I AFTER INSERT ON %I 
                    FOR EACH ROW
                    EXECUTE FUNCTION %I();
                $undo_trigger$, 
                name,
                table_name, 
                name
            );

        DROP TABLE IF EXISTS table_primary_keys;
    END
$body$
LANGUAGE plpgsql;

-- Given a `+table_name+`, returns `+<table_name>_undo_delete+`. This exists to
-- ensure that we have a consistent way of generating the trigger / function
-- name associated with a table.
CREATE OR REPLACE FUNCTION create_undo_delete_name(table_name text)
RETURNS text AS
$body$
    BEGIN
        RETURN table_name || '_undo_delete';
    END
$body$
LANGUAGE plpgsql;

-- Creates a function and trigger with the name `+table_name_undo_delete+`
-- which on deletion to `+table_name+`, assuming that `+undo_log.freeze_log+`
-- is not true, append an SQL statement of the form
-- ---
-- format
--  ( $$ INSERT INTO table_name VALUES ((CAST (%L AS table_name)).*) $$
--  , NEW
--  )
-- ---
-- to `+undo_log+` associated with the most recently added block (if it exists,
-- otherwise we do nothing).
CREATE OR REPLACE FUNCTION create_table_undo_delete(table_name text)
RETURNS void AS
$body$
    DECLARE
        name text := create_undo_delete_name(table_name);
    BEGIN
        EXECUTE
            format(
                $undo_function$
                    CREATE OR REPLACE FUNCTION %I()
                        RETURNS trigger AS
                        $$
                            DECLARE
                                most_recent_block record := get_most_recent_block();
                            BEGIN
                                IF current_setting('undo_log.freeze_log', TRUE) = CAST(TRUE as TEXT) THEN
                                    RETURN OLD;
                                END IF;

                                IF most_recent_block IS NOT NULL 
                                    THEN -- if there is no block, then we can't associate the undo log with anything
                                    INSERT INTO undo_log (seq, block_slot, block_id, undo_statement)
                                    VALUES (DEFAULT, most_recent_block.block_slot, most_recent_block.block_id, format(%L, OLD));
                                END IF;

                                RETURN OLD;
                            END
                        $$
                        LANGUAGE plpgsql;
                $undo_function$,
                name,
                format('INSERT INTO %I VALUES ((CAST (%%L AS %I)).*)', table_name, table_name)
            );

        EXECUTE
            format(
                $undo_trigger$
                    CREATE OR REPLACE TRIGGER %I AFTER DELETE ON %I 
                    FOR EACH ROW
                    EXECUTE FUNCTION %I();
                $undo_trigger$,
                name,
                table_name,
                name
            );

    END
$body$
LANGUAGE plpgsql;

-- Given a `+table_name+`, returns `+<table_name>_undo_update+`. This exists to
-- ensure that we have a consistent way of generating the trigger / function
-- name associated with a table.
CREATE OR REPLACE FUNCTION create_undo_update_name(table_name text)
RETURNS text AS
$body$
    BEGIN
        RETURN table_name || '_undo_update';
    END
$body$
LANGUAGE plpgsql;

-- Creates a function and trigger with the name `+table_name_undo_update+`
-- which on update to `+table_name+`, assuming that `+undo_log.freeze_log+`
-- is not true, appends an SQL statement of the form
-- ---
-- format
--  ( $$ UPDATE table_name SET column_name1 = %L, ..., column_nameN = %L WHERE primary_key1 = %L AND ... AND primary_keyM = %L;
--  , OLD.column_name1
--  , ...
--  , OLD.column_nameN
--  , NEW.primary_key1
--  , ...
--  , NEW.primary_keyM
--  )
-- ---
-- to `+undo_log+` associated with the most recently added block (if it exists,
-- otherwise we do nothing).
CREATE OR REPLACE FUNCTION create_table_undo_update(table_name text)
RETURNS void AS
$body$
    DECLARE
        name text := create_undo_update_name(table_name);
        sql_is_primary_keys text;
        sql_new_primary_keys text;
        sql_set_columns text;
        sql_old_columns text;
    BEGIN
        -- = SQL strings relating to the primary keys
        CREATE TEMP TABLE table_primary_keys(
            primary_key text
        ) ON COMMIT DROP;

        -- See <https://wiki.postgresql.org/wiki/Retrieve_primary_key_columns>
        -- for details
        INSERT INTO table_primary_keys 
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid
                             AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = CAST (table_name AS regclass)
        AND i.indisprimary;

        -- Create a string of the form 
        -- ---
        -- primary_key1 = %L AND primary_key2 = %L ... AND primary_keyN = %L
        -- ---
        SELECT string_agg(format('%I = %%L', primary_key),  ' AND ' ORDER BY primary_key ASC) INTO STRICT sql_is_primary_keys
        FROM table_primary_keys;

        -- Create a string of the form 
        -- ---
        -- NEW.primary_key1, NEW.primary_key2, ..., NEW.primary_keyN
        -- ---
        SELECT string_agg(format('NEW.%I', primary_key), ',' ORDER BY primary_key ASC) INTO STRICT sql_new_primary_keys
        FROM table_primary_keys;

        -- = SQL strings relating to all columns

        CREATE TEMP TABLE table_column_names(
            column_name text
        ) ON COMMIT DROP;

        INSERT INTO table_column_names 
        SELECT i.attname
        FROM pg_attribute i
        WHERE i.attrelid = CAST (table_name AS regclass) AND i.attnum > 0 AND NOT i.attisdropped;

        -- Create a string of the form 
        -- ---
        -- column_name1 = %L, column_name2 = %L, ..., column_nameN = %L
        -- ---
        SELECT string_agg(format('%I = %%L', column_name), ',' ORDER BY column_name ASC) INTO STRICT sql_set_columns
        FROM table_column_names;

        -- Create a string of the form 
        -- ---
        -- OLD.column_name1, column_name2, ..., OLD.column_nameN
        -- ---
        SELECT string_agg(format('OLD.%I', column_name), ',' ORDER BY column_name ASC) INTO STRICT sql_old_columns
        FROM table_column_names;

        EXECUTE
            format(
                $undo_function$
                CREATE OR REPLACE FUNCTION %I()
                    RETURNS trigger AS
                    $$
                        DECLARE
                            most_recent_block record := get_most_recent_block();
                        BEGIN
                            IF current_setting('undo_log.freeze_log', TRUE) = CAST(TRUE AS TEXT) THEN
                                RETURN NEW;
                            END IF;

                            IF most_recent_block IS NOT NULL THEN -- if there is no block, then we can't associate the undo log with anything
                                INSERT INTO undo_log (seq, block_slot, block_id, undo_statement)
                                VALUES (DEFAULT, most_recent_block.block_slot, most_recent_block.block_id, format(%L, %s, %s));
                            END IF;

                            RETURN NEW;
                        END
                    $$
                    LANGUAGE plpgsql;
                $undo_function$, 
                name,
                format('UPDATE %I SET %s WHERE %s', table_name, sql_set_columns, sql_is_primary_keys),
                sql_old_columns,
                sql_new_primary_keys
            );

        EXECUTE
            format(
                $undo_trigger$
                    CREATE OR REPLACE TRIGGER %I AFTER UPDATE ON %I 
                    FOR EACH ROW
                    EXECUTE FUNCTION %I();
                $undo_trigger$, 
                name,
                table_name, 
                name
            );

        DROP TABLE IF EXISTS table_primary_keys;
        DROP TABLE IF EXISTS table_column_names;
    END
$body$
LANGUAGE plpgsql;

-- Freezes the `+undo_log+` i.e., stops triggers from automatically adding
-- things to the `+undo_log+` in the current transaction
CREATE OR REPLACE FUNCTION freeze_undo_log()
RETURNS void as
$body$
    BEGIN
        SET LOCAL undo_log.freeze_log = TRUE;
    END
$body$
LANGUAGE plpgsql;

-- Unfreezes the `+undo_log+` i.e., allows things to be added to the
-- `+undo_log+` again in the current transaction
CREATE OR REPLACE FUNCTION unfreeze_undo_log()
RETURNS void as
$body$
    BEGIN
        SET LOCAL undo_log.freeze_log = FALSE;
    END
$body$
LANGUAGE plpgsql;

-- Roll backs the database to the given block i.e., 
-- Using the `+undo_log+`, execute all `+undo_statement+` _strictly after_ the
-- provided block, and delete such rows from the `+undo_log+`.
CREATE OR REPLACE FUNCTION undo_log_rollback_to(block_slot bigint, block_id bytea)
RETURNS void AS
$body$
    DECLARE
        to_undo record;
    BEGIN
        SET CONSTRAINTS ALL DEFERRED;

        PERFORM freeze_undo_log();

        FOR to_undo IN
            WITH deleted AS(
                DELETE FROM undo_log
                WHERE undo_log.block_slot > undo_log_rollback_to.block_slot
                RETURNING *
            )
            SELECT *
            FROM deleted
            ORDER BY seq DESC
        LOOP
            IF to_undo.undo_statement IS NOT NULL
                THEN EXECUTE to_undo.undo_statement;
            END IF;
        END LOOP;

        PERFORM unfreeze_undo_log();
    END
$body$
LANGUAGE plpgsql;

-----------------------------------------------------------------------------
-- = Undo log triggers
-----------------------------------------------------------------------------
SELECT create_table_undo_insert('blocks');
SELECT create_table_undo_delete('blocks');

SELECT create_table_undo_insert('tx_out_refs');
SELECT create_table_undo_delete('tx_out_refs');
SELECT create_table_undo_update('tx_out_refs');

SELECT create_table_undo_insert('dens_set_utxos');
SELECT create_table_undo_delete('dens_set_utxos');
SELECT create_table_undo_update('dens_set_utxos');

SELECT create_table_undo_insert('dens_elem_ids');
SELECT create_table_undo_delete('dens_elem_ids');
SELECT create_table_undo_update('dens_elem_ids');

SELECT create_table_undo_insert('dens_rrs');
SELECT create_table_undo_delete('dens_rrs');
SELECT create_table_undo_update('dens_rrs');

SELECT create_table_undo_insert('dens_protocol_utxos');
SELECT create_table_undo_delete('dens_protocol_utxos');
SELECT create_table_undo_update('dens_protocol_utxos');

-----------------------------------------------------------------------------
-- = Helper functions
-----------------------------------------------------------------------------

-- If the provided asset class (currency symbol / token name) matches the
-- existing asset class in the `+dens_protocol_nft+` table, do nothing.
-- Otherwise, overwrite the existing `+dens_protocol_nft+`
CREATE OR REPLACE FUNCTION dens_set_protocol_nft(currency_symbol bytea, token_name bytea)
RETURNS dens_protocol_nft AS
$body$
    DECLARE
        old_protocol_nft dens_protocol_nft;
        new_protocol_nft dens_protocol_nft;
    BEGIN
        SELECT * INTO old_protocol_nft FROM dens_protocol_nft;

        INSERT INTO dens_protocol_nft(asset_class)
        VALUES(CAST(ROW(dens_set_protocol_nft.currency_symbol, dens_set_protocol_nft.token_name) AS asset_class))
        ON CONFLICT (at_most_one) DO UPDATE
            SET asset_class = (EXCLUDED).asset_class;

        SELECT * INTO STRICT new_protocol_nft FROM dens_protocol_nft;

        IF old_protocol_nft IS NULL THEN
            RETURN new_protocol_nft;
        END IF;

        IF (old_protocol_nft).asset_class = (new_protocol_nft).asset_class THEN
            RETURN new_protocol_nft;
        END IF;

        RETURN new_protocol_nft;
    END
$body$
LANGUAGE plpgsql;

-- Resets the database if the current protocol NFT stored in the database
-- differs from the provided NFT, and returns the current protocol NFT stored
-- in the database
CREATE OR REPLACE FUNCTION dens_sync_protocol_nft(currency_symbol bytea, token_name bytea)
RETURNS dens_protocol_nft AS
$body$
    DECLARE
        current_protocol_nft dens_protocol_nft;
    BEGIN
        SELECT * INTO current_protocol_nft FROM dens_protocol_nft;


        IF current_protocol_nft IS NULL THEN
            -- Clear all tables if there is no current protocol NFT
            TRUNCATE blocks * RESTART IDENTITY CASCADE;
            RETURN ROW(true, currency_symbol,token_name);
        END IF;

        -- If the current protocol NFT matches the provided NFT, we're good, so do nothing and return
        IF (current_protocol_nft).asset_class = ROW(currency_symbol, token_name) THEN
            RETURN current_protocol_nft;
        END IF;

        TRUNCATE blocks * RESTART IDENTITY CASCADE;
        RETURN current_protocol_nft;
    END
$body$
LANGUAGE plpgsql;

-- Gets a collection of the most recent points suitable for resynchronizing
-- with the blockchain after shutting down.
-- TODO(jaredponn): there's a better way to do this e.g. use binary search to
-- find the first common point. This requires a somewhat tricky interactions
-- between ogmios / postgres; and it's unclear if this would actually be better
-- at all.
CREATE OR REPLACE FUNCTION dens_recent_points()
RETURNS SETOF blocks AS
$body$
    BEGIN
        RETURN QUERY 
            SELECT block_slot, block_id
            FROM blocks
            ORDER BY blocks.block_slot DESC
            LIMIT 64;
    END
$body$ 
LANGUAGE plpgsql;

-- Tests if the provided name is valid. See Section 3.5 of
-- <https://datatracker.ietf.org/doc/html/rfc1034>.
-- Moreover, differing from the specification, we only allow names to be lower
-- case.
--
-- For compatibility with DNS backends like PowerDNS, we must ensure:
--      - names are NEVER terminated with a trailing `.`,
--      - with the exception of the root zone, which must have the name of `.`
-- See <https://doc.powerdns.com/authoritative/backends/generic-sql.html#:~:text=The%20generic%20SQL%20backends%20(like,needed%20to%20cover%20all%20needs.>
CREATE OR REPLACE FUNCTION dens_is_valid_name(name bytea)
RETURNS boolean AS 
$body$
    BEGIN
        RETURN encode(name, 'escape') SIMILAR TO '.|(([a-z]([-a-z0-9]*[a-z0-9])?)(.([a-z]([-a-z0-9]*[a-z0-9])?))*)';
    END
$body$
LANGUAGE plpgsql;
