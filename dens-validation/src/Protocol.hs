-- for hls to not yell at me
{-# LANGUAGE BlockArguments #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedRecordDot #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QualifiedDo #-}

module Protocol where

import LambdaBuffers.Dens.Plutarch (
    DensKey (..),
    Protocol (..),
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
    pany,
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
    PScriptContext,
    PScriptHash (..),
    PScriptPurpose (..),
    PTokenName (..),
    PTxInInfo (..),
    PTxOut (..),
    PValue (..),
 )
import Plutarch.Api.V2.Tx (
    POutputDatum (POutputDatum),
    PTxInInfo,
    PTxOutRef,
 )
import Plutarch.Builtin (PIsData (pdataImpl), pserialiseData)
import Plutarch.Crypto (pblake2b_256)
import Plutarch.List (PListLike (..), pall, pconvertLists, pfoldl)

import Plutarch.Maybe (pfromJust)
import Utils

mkProtocolMintingPolicy :: ClosedTerm (PTxOutRef :--> POpaque :--> PScriptContext :--> PUnit)
mkProtocolMintingPolicy = phoistAcyclic $ plam $ \outRef _ cxt -> P.do
    PMinting protocolCSRec <- pmatch . pfromData $ pfield @"purpose" # cxt
    protocolCS <- plet . pfromData $ pfield @"_0" # protocolCSRec

    info <- plet $ pfield @"txInfo" # cxt

    fields <- pletFields @["inputs", "mint"] info

    -- check that we have an input w/ the appropriate outref
    inputExistsWithOutRef <-
        plet $
            pany @PBuiltinList
                # plam (\out -> pfromData (pfield @"outRef" # out) #== outRef)
                # fields.inputs
    pguardM "Tx has input with known outref (for one-shot MP)" inputExistsWithOutRef

    -- check that exactly one protocol token is minted
    pguardM "Exactly one protocol NFT Minted" $ mintsExactly # 1 # protocolCS # emptyTN # fields.mint

    -- TODO: Do we need to check *here* for the Protocol Datum in the outputs? Doesn't seem necessary given setElem MP logic
    pcon PUnit
