-- References
-- [1]: https://ogmios.dev/api/

-- Highly simplified view of the blockchain which only contains the block_id
-- (hash of the block), and its slot.
-- This is needed to allow efficient rollbacks.
CREATE TABLE IF NOT EXISTS blocks (
    block_slot bigint NOT NULL,
    block_id bytea NOT NULL,
    PRIMARY KEY(block_slot, block_id)
);

CREATE TABLE IF NOT EXISTS tx_out_refs (
    tx_out_ref_id bytea NOT NULL,
    tx_out_ref_idx bigint NOT NULL,
    PRIMARY KEY(tx_out_ref_id, tx_out_ref_idx),

    block_slot bigint NOT NULL,
    block_id bytea NOT NULL,
    FOREIGN KEY (block_slot, block_id) REFERENCES blocks(block_slot, block_id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Linked list set data structure
CREATE TABLE IF NOT EXISTS dens_set_utxos (
    -- name for the DNS record that is owned
    name bytea UNIQUE,

    -- Token which associates this `name` with a validator address which
    -- actually holds (a reference) to the RRs.
    currency_symbol bytea,
    token_name bytea,

    tx_out_ref_id bytea NOT NULL,
    tx_out_ref_idx bigint NOT NULL,
    PRIMARY KEY(tx_out_ref_id, tx_out_ref_idx),
    FOREIGN KEY (tx_out_ref_id, tx_out_ref_idx) REFERENCES tx_out_refs(tx_out_ref_id, tx_out_ref_idx) ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT currency_symbol_and_token_name_both_present_or_not CHECK ( ( currency_symbol = null AND token_name = null) 
        OR (currency_symbol <> null AND token_name <> null)),

    -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Value.hs#L75-L92
    CONSTRAINT currency_sybmol_length_0_or_28 CHECK (( octet_length(currency_symbol) = 0) OR (octet_length(currency_symbol) = 28)),

    -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Value.hs#L99-L112
    CONSTRAINT token_name_length_at_most_32 CHECK (octet_length(token_name) <= 32),

    -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Tx.hs#L51-L65
    CONSTRAINT tx_id_length_is_32 CHECK (octet_length(tx_out_ref_id) = 32)

);

-- Index s.t. one can efficiently query if change has happened in the
-- dens_set_utxos
CREATE INDEX IF NOT EXISTS dens_set_utxos_currency_symbol_token_name ON dens_set_utxos(currency_symbol, token_name);

-- Index s.t. one can efficiently query which UTxO to spend
CREATE INDEX IF NOT EXISTS dens_set_utxos_name ON dens_set_utxos(name);

-- `DensValidator`s with pointer to the `dens_set_utxos` i.e., we have 
--      - M:1 relationship of many DensValidator to 1 dens_set_utxos
CREATE TABLE IF NOT EXISTS dens_rrs_utxos (
    -- Foreign key to the dens_set_utxos
    name bytea REFERENCES dens_set_utxos(name) ON DELETE CASCADE ON UPDATE CASCADE,


    rrs bytea NOT NULL,

    -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Tx.hs#L51-L65
    CONSTRAINT tx_id_length_is_32 CHECK (octet_length(tx_out_ref_id) = 32),

    tx_out_ref_id bytea NOT NULL,
    tx_out_ref_idx bigint NOT NULL,
    PRIMARY KEY(tx_out_ref_id, tx_out_ref_idx, name),
    FOREIGN KEY (tx_out_ref_id, tx_out_ref_idx) REFERENCES tx_out_refs(tx_out_ref_id, tx_out_ref_idx) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Index s.t. we can efficiently join dens_set_utxos with dens_rrs_utxos on the name
CREATE INDEX IF NOT EXISTS dens_rrs_utxos_name_index ON dens_rrs_utxos(name);

CREATE TABLE IF NOT EXISTS dens_protocol_utxos(
    element_id_minting_policy bytea NOT NULL,
    set_elem_minting_policy bytea NOT NULL,
    set_validator bytea NOT NULL,
    records_validator bytea NOT NULL,

    tx_out_ref_id bytea NOT NULL,
    tx_out_ref_idx bigint NOT NULL,
    PRIMARY KEY(tx_out_ref_id, tx_out_ref_idx),
    FOREIGN KEY (tx_out_ref_id, tx_out_ref_idx) REFERENCES tx_out_refs(tx_out_ref_id, tx_out_ref_idx) ON DELETE CASCADE ON UPDATE CASCADE
);
