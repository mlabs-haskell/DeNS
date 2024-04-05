-- References
-- [1]: https://ogmios.dev/api/

-- Linked list set data structure
CREATE TABLE IF NOT EXISTS dens_set (
    -- name for the DNS record that is owned
    name bytea PRIMARY KEY,

    -- slot for this transaction (needed to allow efficient rollbacks)
    slot bigint NOT NULL,

    -- Token which associates this `name` with a validator address which
    -- actually holds (a reference) to the RRs.
    currency_symbol bytea,
    token_name bytea,


    -- Hash of the tx body
    tx_out_ref_id bytea NOT NULL,
    -- Index of the output
    tx_out_ref_idx bigint NOT NULL,


    CONSTRAINT "Currency symbol and token name cannot both be null" CHECK ( ( currency_symbol = null AND token_name = null) OR   (currency_symbol <> null AND token_name <> null)),
    -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Value.hs#L75-L92
    CONSTRAINT "Currency symbol length ==0 or ==28" CHECK (( octet_length(currency_symbol) = 0) OR (octet_length(currency_symbol) = 28)),

    -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Value.hs#L99-L112
    CONSTRAINT "Token name length <=32" CHECK (octet_length(token_name) <= 32),

    -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Tx.hs#L51-L65
    CONSTRAINT "TxId length ==32" CHECK (octet_length(tx_out_ref_id) = 32)
);

-- Index s.t. when given a roll back (i.e., a slot number to roll back to), we
-- can efficiently just delete everything greater than the given slot number
CREATE INDEX IF NOT EXISTS dens_set_slot_index ON dens_set(slot);

-- Index s.t. one can efficiently query if change has happened in the
-- dens_validator
CREATE INDEX IF NOT EXISTS dens_set_currency_symbol_token_name ON dens_set(currency_symbol, token_name);

-- `DensValidator`s with pointer to the `dens_set` i.e., we have 
--      - M:1 relationship of many DensValidator to 1 dens_set
CREATE TABLE IF NOT EXISTS dens_validator (
    -- Foreign key to the dens_set
    name bytea REFERENCES dens_set(name),

    -- Hash of the tx body
    tx_out_ref_id bytea NOT NULL,
    -- Index of the output
    tx_out_ref_idx bigint NOT NULL,

    PRIMARY KEY(tx_out_ref_id, tx_out_ref_idx),

    -- how are we going to store the RRs here?

    -- https://github.com/IntersectMBO/plutus/blob/1.16.0.0/plutus-ledger-api/src/PlutusLedgerApi/V1/Tx.hs#L51-L65
    CONSTRAINT "TxId length ==32" CHECK (octet_length(tx_out_ref_id) = 32)
);

-- Index s.t. we can efficiently join dens_set with dens_validator on the name
CREATE INDEX IF NOT EXISTS dens_validator_name_index ON dens_validator(name);
