-- = Overview
-- For each "kind of UTxO" for the dens protocol, we create a table for it e.g.
-- we have tables
--  - `+dens_set_utxos+`
--  - `+dens_rrs_utxos+`
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
-- = References
-- 
-- * [[ogmios]] https://ogmios.dev/api/

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
 
    PRIMARY KEY (tx_out_ref_id, tx_out_ref_idx)
);

-----------------------------------------------------------------------------
-- = Tables for the undo log
-----------------------------------------------------------------------------

-- Associates a block (the block id and block slot) with an SQL statement to
-- undo something. 
-- Note that `+undo_statement+` can indeed be NULL which denotes this row is a
-- block that was just added to the blockchain.

-- TODO(jaredponn): we can play around with the length of undo_log and make it
-- based on the maximum length of the rollback to save some memory.
-- See https://cips.cardano.org/cip/CIP-9/ for details.
CREATE TABLE IF NOT EXISTS undo_log (
    seq bigserial,

    block_slot bigint NOT NULL,

    block_id bytea NOT NULL,

    undo_statement text,

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

-- Roll backs the database to the given block i.e., 
-- Using the `+undo_log+`, execute all `+undo_statement+` _strictly after_ the
-- provided block, and delete such rows from the `+undo_log+`.
CREATE OR REPLACE FUNCTION undo_log_rollback_to(block_slot bigint, block_id bytea)
RETURNS void AS
$body$
    DECLARE
        the_block_seq bigint;
        to_undo record;
    BEGIN
        SET CONSTRAINTS ALL DEFERRED;

        SELECT coalesce(max(undo_log.seq), 0) INTO STRICT the_block_seq
        FROM undo_log
        WHERE undo_log.block_id = undo_log_rollback_to.block_id AND undo_log.block_slot = undo_log_rollback_to.block_slot;

        FOR to_undo IN
            WITH deleted AS(
                DELETE FROM undo_log
                WHERE seq > the_block_seq
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

        -- Needed to remove the stuff we just added by undoing
        -- TODO(jaredponn): this isn't so efficient is it? It would be
        -- preferable to pass an argument to the trigger dynamically!
        DELETE FROM undo_log
        WHERE NOT(seq <= the_block_seq);
    END
$body$
LANGUAGE plpgsql;

-- Creates a function and trigger with the name `+table_name_undo_insert+`
-- which on insertion to `+table_name+`, append an SQL statement of the form
-- ---
-- format
--  ( $$ DELETE FROM table_name WHERE table_name.primary_key1 = %L AND ... table_name.primary_keyN = %L $$
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
        name text := table_name || '_undo_insert';
        sql_is_primary_keys text;
        sql_new_primary_keys text;
    BEGIN
        CREATE TEMP TABLE table_primary_keys(
            primary_key text
        ) ON COMMIT DROP;

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

-- Creates a function and trigger with the name `+table_name_undo_delete+`
-- which on deletion to `+table_name+`, append an SQL statement of the form
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
        name text := table_name || '_undo_delete';
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
                                IF most_recent_block IS NOT NULL THEN -- if there is no block, then we can't associate the undo log with anything
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

-----------------------------------------------------------------------------
-- = Tables for the protocol
-----------------------------------------------------------------------------

-- Add undoing to the `+blocks+`
SELECT create_table_undo_insert('blocks');
SELECT create_table_undo_delete('blocks');

-- Add undoing to the `+tx_out_refs+`
SELECT create_table_undo_insert('tx_out_refs');
SELECT create_table_undo_delete('tx_out_refs');

-----------------------------------------------------------------------------
-- == Table for the Linked list for associating domain names to RRs
-----------------------------------------------------------------------------
-- Linked list set data structure
CREATE TABLE IF NOT EXISTS dens_set_utxos (
    -- name for the DNS record that is owned
    name bytea UNIQUE,

    -- Token which associates this `+name+` with a validator address which
    -- actually holds (a reference) to the RRs.
    currency_symbol bytea,
    token_name bytea,

    tx_out_ref_id bytea NOT NULL,
    tx_out_ref_idx bigint NOT NULL,

    PRIMARY KEY (tx_out_ref_id, tx_out_ref_idx),

    FOREIGN KEY (tx_out_ref_id, tx_out_ref_idx) REFERENCES tx_out_refs (tx_out_ref_id, tx_out_ref_idx)
    ON DELETE CASCADE DEFERRABLE,

    CONSTRAINT currency_symbol_and_token_name_both_present_or_not CHECK
    (
        (currency_symbol IS null AND token_name IS null)
        OR (currency_symbol IS NOT null AND token_name IS NOT null)
    ),

    -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Value.hs#L75-L92
    CONSTRAINT currency_symbol_length_0_or_28 CHECK
    (
        (octet_length(currency_symbol) = 0) OR (octet_length(currency_symbol) = 28)
    ),

    -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Value.hs#L99-L112
    CONSTRAINT token_name_length_at_most_32 CHECK (octet_length(token_name) <= 32),

    -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Tx.hs#L51-L65
    CONSTRAINT tx_id_length_is_32 CHECK (octet_length(tx_out_ref_id) = 32)
);

-- Index s.t. one can efficiently query if change has happened in the
-- dens_set_utxos
CREATE INDEX IF NOT EXISTS dens_set_utxos_currency_symbol_token_name ON dens_set_utxos (currency_symbol, token_name);

-- Index s.t. one can efficiently query which UTxO to spend
CREATE INDEX IF NOT EXISTS dens_set_utxos_name ON dens_set_utxos (name);

-----------------------------------------------------------------------------
-- === Undo log triggers
-----------------------------------------------------------------------------
SELECT create_table_undo_insert('dens_set_utxos');
SELECT create_table_undo_delete('dens_set_utxos');

-----------------------------------------------------------------------------
-- == Table for representing the UTxOs which contain RRs
-----------------------------------------------------------------------------

-- `+DensValidator+`s with pointer to the `+dens_set_utxos+` i.e., we have 
--      - M:1 relationship of many DensValidator to 1 dens_set_utxos
CREATE TABLE IF NOT EXISTS dens_rrs_utxos (
    -- Foreign key to the dens_set_utxos
    name bytea REFERENCES dens_set_utxos (name)
    ON DELETE CASCADE,

    rrs bytea NOT NULL,

    -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Tx.hs#L51-L65
    CONSTRAINT tx_id_length_is_32 CHECK (octet_length(tx_out_ref_id) = 32),

    tx_out_ref_id bytea NOT NULL,

    tx_out_ref_idx bigint NOT NULL,

    PRIMARY KEY (tx_out_ref_id, tx_out_ref_idx),

    FOREIGN KEY (tx_out_ref_id, tx_out_ref_idx) REFERENCES tx_out_refs (tx_out_ref_id, tx_out_ref_idx)
    ON DELETE CASCADE DEFERRABLE
);

-- Index s.t. we can efficiently join dens_set_utxos with dens_rrs_utxos on the name
CREATE INDEX IF NOT EXISTS dens_rrs_utxos_name_index ON dens_rrs_utxos (name);

-----------------------------------------------------------------------------
-- === Undo log triggers
-----------------------------------------------------------------------------
SELECT create_table_undo_insert('dens_rrs_utxos');
SELECT create_table_undo_delete('dens_rrs_utxos');

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
-- === Undo log triggers
-----------------------------------------------------------------------------
SELECT create_table_undo_insert('dens_protocol_utxos');
SELECT create_table_undo_delete('dens_protocol_utxos');