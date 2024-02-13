{-# LANGUAGE BlockArguments #-}
{-# LANGUAGE DataKinds #-}
-- for hls to not yell at me
{-# LANGUAGE OverloadedRecordDot #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PartialTypeSignatures #-}
{-# LANGUAGE QualifiedDo #-}
{-# OPTIONS_GHC -Wno-partial-type-signatures #-}

module ElemID where

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
import Plutarch.Api.V2.Tx (POutputDatum (POutputDatum), PTxInInfo)
import Plutarch.Builtin (PIsData (pdataImpl), pserialiseData)
import Plutarch.Crypto (pblake2b_256)
import Plutarch.List (PListLike (..), pall, pconvertLists, pfoldl)

import Plutarch.Maybe (pfromJust)
import Utils (
    emptyTN,
    findUnique,
    hasCS,
    mintsExactly,
    pguardM,
    resolved,
    scriptHashToCS,
    txOutDatum,
 )

-- NOTE: We can assume the protocol datum to be in the reference inputs here (if it's in the outputs, no ElemIDs should get minted)
mkElemIDMintingPolicy :: ClosedTerm (PCurrencySymbol :--> POpaque :--> PScriptContext :--> PUnit)
mkElemIDMintingPolicy = phoistAcyclic $ plam $ \protocolCS _ cxt -> P.do
    PMinting elemIDCSRec <- pmatch . pfromData $ pfield @"purpose" # cxt
    elemIDCS' <- plet . pfromData $ pfield @"_0" # elemIDCSRec

    txInfo <- plet $ pfield @"txInfo" # cxt

    fields <- pletFields @["inputs", "referenceInputs", "outputs", "mint"] txInfo

    refInputsResolved <- plet $ pmap # resolved # fields.referenceInputs

    Protocol elemIDMP setElemMP setValidator _ <- pmatch $ txOutDatum @Protocol #$ findUnique # (hasCS # protocolCS) # refInputsResolved

    elemIDCS <- plet $ scriptHashToCS # pfromData elemIDMP
    -- It just makes me feel better to verify it!
    pguardM "Own CS doesn't match protocol ElemID CS" $ elemIDCS #== elemIDCS'

    mint <- plet $ passertPositive # pfromData fields.mint

    setElemCS <- plet $ scriptHashToCS # pfromData setElemMP
    -- One SetElem token is minted in the same tx
    pguardM "SetElemID token minted" $ mintsExactly # 1 # setElemCS # emptyTN # mint

    -- TODO: Do we need to check the outputs? If someone mistakenly pays the ElemID token to the validator, is there any way to fix that?

    pcon PUnit
