{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedRecordDot #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QualifiedDo #-}

module Records where

import LambdaBuffers.Dens.Plutarch (
    DensKey (..),
    Protocol (..),
    RecordDatum (..),
    SetDatum (..),
    SetInsert (..),
 )
import LambdaBuffers.Plutus.V1.Plutarch (Bytes)
import LambdaBuffers.Prelude.Plutarch qualified as Lb.Plutarch
import LambdaBuffers.Runtime.Plutarch (PList (PList))
import Plutarch (Config (Config), Term, TracingMode (DoTracingAndBinds))
import Plutarch qualified as P
import Plutarch.Monadic qualified as P
import Plutarch.Prelude (
    ClosedTerm,
    PAsData,
    PBool (..),
    PBuiltinList,
    PBuiltinPair,
    PData,
    PEq ((#==)),
    PInteger,
    PIsData,
    PMaybe (PJust, PNothing),
    POpaque,
    PPair,
    PPartialOrd ((#<)),
    PString,
    PTryFrom,
    PUnit (..),
    S,
    Term,
    pcon,
    pconstant,
    pdata,
    pdcons,
    pdnil,
    pfield,
    pfilter,
    pfind,
    pfoldr,
    pfromData,
    pfstBuiltin,
    phoistAcyclic,
    pif,
    plam,
    plength,
    plet,
    pletFields,
    pmap,
    pmatch,
    psndBuiltin,
    ptraceError,
    ptryFrom,
    (#),
    (#$),
    (#&&),
    (:-->),
 )
import Plutarch.Script qualified

import Plutarch.Api.V1 (AmountGuarantees (NonZero), KeyGuarantees (Sorted), PCredential (..), PCurrencySymbol (..), PTokenName (..))
import Plutarch.Api.V1.Maybe (PMaybeData (PDNothing))
import Plutarch.Api.V1.Scripts (PScriptHash (..))
import Plutarch.Api.V1.Value (passertPositive, pforgetPositive, pnormalize, pvalueOf)
import Plutarch.Api.V2 (
    PAddress (..),
    PCurrencySymbol (..),
    PDatum (PDatum),
    PMap (..),
    PMaybeData (PDNothing),
    POutputDatum (POutputDatum),
    PPubKeyHash (..),
    PScriptContext,
    PScriptHash (..),
    PScriptPurpose (..),
    PTokenName (..),
    PTxInInfo (..),
    PTxOut (..),
    PValue (..),
 )
import Plutarch.Api.V2.Tx (POutputDatum (POutputDatum), PTxInInfo)
import Plutarch.Builtin (PIsData (pdataImpl), pserialiseData)
import Plutarch.Crypto (pblake2b_256)
import Plutarch.List (PListLike (..), pall, pany, pconvertLists, pelem, pfoldl)

import Plutarch.Maybe (pfromJust)
import Utils (
    emptyTN,
    findUnique,
    hasCS,
    mintsExactly,
    paysTo,
    pguardM,
    pscriptHashAddress,
    resolved,
    scriptHashToCS,
    txOutDatum,
    txOutValue,
 )

{-
data RecordDatum = RecordDatum
    { class :: Word16
    , name  :: ByteString
    , reference :: Maybe ByteString
        -- ^ an Arweave address
    , owner :: PubKeyHash
}

-}

mkRecordValidator :: ClosedTerm (PCurrencySymbol :--> RecordDatum :--> PUnit :--> PScriptContext :--> PUnit)
mkRecordValidator = phoistAcyclic $ plam $ \protocolCS recordDatum _ cxt -> P.do
    txInfo <- plet $ pfield @"txInfo" # cxt

    fields <- pletFields @'["referenceInputs", "outputs", "mint", "inputs", "signatories"] txInfo

    referenceInputsResolved <- plet $ pmap # resolved # pfromData fields.referenceInputs

    Protocol elemIdMP setElemMP setValidator recordsValidator <-
        pmatch $
            txOutDatum @Protocol
                #$ findUnique
                # (hasCS # protocolCS)
                # referenceInputsResolved

    -- INPUTS: UTxO w/ ElemID Token

    elemIdCS <- plet $ scriptHashToCS # pfromData elemIdMP

    RecordDatum dClass dName dRef dOwner <- pmatch recordDatum

    densKey <- plet . pcon $ DensKey dName dClass

    recTokName <- plet $ pcon $ PTokenName (pblake2b_256 #$ pserialiseData # pdataImpl densKey)

    inputsResolved <- plet $ pmap # resolved # pfromData fields.inputs

    authTokenInInputs <- plet $ pany # plam (\x -> pvalueOf # (txOutValue # x) # elemIdCS # recTokName #== 1) # inputsResolved

    pguardM "Auth token in inputs" authTokenInInputs

    -- OUTPUTS: RecordDatum paid to RecordsValidator

    outs <- plet $ pfromData fields.outputs

    recValidatorAddr <- plet $ pscriptHashAddress # recordsValidator

    -- REVIEW: I'm assuming that there's only ever one output paid to the record validator. Not 100% sure that this should always be the case?
    --         If not, we need to find some other way to identify the TxOut that's supposed to contain the datum
    --         (`PTryFrom` doesn't give us a `PMaybe` wrapped result, but just crashes, so we can't just try to convert arbitrary
    --          datums in the outputs to find the "right" one)
    outRecDatum <- plet $ txOutDatum @RecordDatum #$ findUnique # (paysTo # recValidatorAddr) # outs

    pguardM "Output record datum == input record datum" $ outRecDatum #== recordDatum

    -- SIGNATURES: Tx is signed by owner
    pguardM "Signed by owner" $ pelem # dOwner # fields.signatories

    -- REVIEW: Do we need a check that nothing gets minted? Doesn't seem to matter.

    pcon PUnit
