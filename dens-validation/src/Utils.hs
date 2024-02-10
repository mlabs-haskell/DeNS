{-# LANGUAGE DataKinds #-}
-- for hls to not yell at me
{-# LANGUAGE OverloadedRecordDot #-}
-- for hls to not yell at me
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PartialTypeSignatures #-}
{-# LANGUAGE QualifiedDo #-}
{-# OPTIONS_GHC -Wno-partial-type-signatures #-}

module Utils where

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
    PPair,
    PPartialOrd ((#<)),
    PString,
    PTryFrom,
    PType,
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
import Plutarch.Api.V1.AssocMap (plookup)
import Plutarch.Api.V1.Maybe (PMaybeData (PDNothing))
import Plutarch.Api.V1.Scripts (PScriptHash (..))
import Plutarch.Api.V1.Value (pnormalize, pvalueOf)
import Plutarch.Api.V2 (
    AmountGuarantees (..),
    PAddress (..),
    PCurrencySymbol (..),
    PDatum (PDatum),
    PMap (..),
    PMaybeData (PDNothing),
    POutputDatum (POutputDatum),
    PScriptContext,
    PScriptHash (..),
    PTokenName (..),
    PTxInInfo (..),
    PTxOut (..),
    PValue (..),
 )
import Plutarch.Api.V2.Contexts (PScriptPurpose (PMinting))
import Plutarch.Api.V2.Tx (POutputDatum (POutputDatum), PTxInInfo)
import Plutarch.Builtin (PIsData (pdataImpl), pserialiseData)
import Plutarch.Crypto (pblake2b_256)
import Plutarch.List (PListLike (..), pconvertLists, pfoldl)

{-
    UTILITIES (TODO: Break out into separate module)
-}

-- stupid plutarch stuff

-- traceIfFalse for P.do
pguardM :: Term s PString -> Term s PBool -> Term s a -> Term s a
pguardM msg cond x = pif cond x $ ptraceError msg

-- empty token name constant
emptyTN :: Term s PTokenName
emptyTN = pcon (PTokenName $ pconstant "")

mintsExactly :: ClosedTerm (PInteger :--> PCurrencySymbol :--> PTokenName :--> PValue _ _ :--> PBool)
mintsExactly = phoistAcyclic $ plam $ \i cs tn val -> (pvalueOf # val # cs # tn) #== i

scriptHashToCS :: Term s (PScriptHash :--> PCurrencySymbol)
scriptHashToCS = phoistAcyclic $ plam $ \shash -> P.do
    PScriptHash bs <- pmatch shash
    pcon (PCurrencySymbol bs)

{- Gets the total quantity of all minted tokens in a value.
   This is needed for a "doesn't mint anything else" check,
   which is strictly necessary to conform with the specification.
-}
totalMint :: ClosedTerm (PValue 'Sorted 'NonZero :--> PInteger)
totalMint = phoistAcyclic $ plam $ \val -> P.do
    PValue innerV <- pmatch val
    PMap innerM1 <- pmatch innerV
    pfoldl # go # 0 # innerM1
  where
    go ::
        ClosedTerm
            ( PInteger
                :--> PBuiltinPair (PAsData PCurrencySymbol) (PAsData (PMap 'Sorted PTokenName PInteger))
                :--> PInteger
            )
    go = phoistAcyclic $ plam $ \acc bipair -> P.do
        PMap innerM2 <- pmatch . pfromData $ psndBuiltin # bipair
        recList <- plet $ plam $ \inneracc innerpair -> P.do
            q <- plet $ pfromData $ psndBuiltin # innerpair
            inneracc + q
        x <- plet $ pfoldl # recList # 0 # innerM2
        acc + x

{- -go :: ClosedTerm (
  PList (PPair PCurrencySymbol (PPair PTokenName PInteger))
  :--> PBuiltinPair (PAsData PCurrencySymbol) (PAsData (PMap 'Sorted PTokenName PInteger))
     ) -}
-- i hate plutarch
pscriptHashAddress :: Term s (PAsData PScriptHash :--> PAddress)
pscriptHashAddress = plam $ \datahash ->
    let credential = pcon (PScriptCredential (pdcons @"_0" # datahash #$ pdnil))
        nothing = pdata $ pcon (PDNothing pdnil)
        inner = pdcons @"credential" # pdata credential #$ pdcons @"stakingCredential" # nothing #$ pdnil
     in pcon (PAddress inner)

-- SetDatum predicate builder
hasLR :: Term s (DensKey :--> DensKey :--> SetDatum :--> PBool)
hasLR = phoistAcyclic $ plam $ \l r setDatum -> P.do
    SetDatum l' r' _ <- pmatch setDatum
    (l #== pfromData l') #&& (r #== pfromData r')

resolved :: ClosedTerm (PTxInInfo :--> PTxOut)
resolved = phoistAcyclic $ plam $ \out -> P.do
    PTxInInfo inRec <- pmatch out
    pfield @"resolved" # inRec

{- Finds a datum in a list of TxOuts where:
   - The TxOut pays to the supplied address
   - The matching TxOut value contains an empty token name at the provided currency symbol
   - The datum satisfies the provided predicate

   May require a type application if the type cannot be inferred (thought it usually should be inferable)

   Is this really a closed term? :P

   NOTE: Rework if the token name matters
   TODO: Optimize so we only traverse the list once
-}
extractDatumSuchThat ::
    forall t.
    (PIsData t, PTryFrom PData t) =>
    ClosedTerm
        ( (t :--> PBool)
            :--> PAddress -- output addr
            :--> PCurrencySymbol
            :--> PBuiltinList PTxOut
            :--> t
        )
extractDatumSuchThat = phoistAcyclic $ plam $ \pred addr cs outs' -> P.do
    outs <- plet $ pconvertLists @PBuiltinList @PList @PTxOut @_ # outs' -- missing PLift for SetDatum if we don't convert. Maybe write instance?
    xs <- plet (pfilter # (matchAddrCS # addr # cs) # outs)
    x <- pmatch $ pfind # pred #$ pmap # txOutDatum # xs
    case x of
        PJust datum -> datum
        PNothing -> ptraceError "Could not find tx out with supplied addr/cs/setdatum pred" -- todo: better error!

matchAddrCS :: ClosedTerm (PAddress :--> PCurrencySymbol :--> PTxOut :--> PBool)
matchAddrCS = plam $ \addr cs txout -> P.do
    PTxOut outRec <- pmatch txout
    outFields <- pletFields @'["address", "value", "datum"] outRec
    addrsMatch <- plet $ outFields.address #== addr
    hasNFT <- plet $ (pvalueOf # outFields.value # cs # emptyTN) #== 1
    addrsMatch #&& hasNFT

hasCS :: ClosedTerm (PCurrencySymbol :--> PTxOut :--> PBool)
hasCS = phoistAcyclic $ plam $ \cs out -> P.do
    PTxOut outRec <- pmatch out
    val <- plet $ pfield @"value" # outRec
    pvalueOf
        # (pfield @"value" # outRec)
        # cs
        # emptyTN
        #== 1

valHasCS :: ClosedTerm (PCurrencySymbol :--> PValue 'Sorted 'Positive :--> PBool)
valHasCS = phoistAcyclic $ plam $ \cs val -> P.do
    PValue valInner <- pmatch val
    res <- pmatch $ plookup # cs # valInner
    case res of
        PJust _ -> pcon PTrue
        PNothing -> pcon PFalse

lacksCS :: ClosedTerm (PCurrencySymbol :--> PTxOut :--> PBool)
lacksCS = phoistAcyclic $ plam $ \cs out -> P.do
    PTxOut outRec <- pmatch out
    valLacksCS # cs #$ pfield @"value" # outRec

valLacksCS :: ClosedTerm (PCurrencySymbol :--> PValue 'Sorted 'Positive :--> PBool)
valLacksCS = phoistAcyclic $ plam $ \cs val -> P.do
    PValue valInner <- pmatch val
    (plookup # cs # valInner) #== pcon PNothing

findUnique ::
    (PListLike l, PElemConstraint l a) =>
    Term
        s
        ( (a :--> PBool)
            :--> l a
            :--> a
        )
findUnique = phoistAcyclic $ plam $ \pred list -> P.do
    xs <- plet $ pfilter # pred # list
    pguardM "findUnique: List does not have exactly one matching element" $ (plength # xs) #== 1
    phead # xs

pownCurrencySymbol :: ClosedTerm (PScriptContext :--> PCurrencySymbol)
pownCurrencySymbol = phoistAcyclic $ plam $ \cxt -> P.do
    purpose <- pmatch (pfromData $ pfield @"purpose" # cxt)
    case purpose of
        PMinting csRec -> pfield @"_0" # csRec
        other -> ptraceError "Purpose is not minting"

txOutDatum :: forall t. (PIsData t, PTryFrom PData t) => ClosedTerm (PTxOut :--> t)
txOutDatum = phoistAcyclic $ plam $ \txOut -> P.do
    outDatum <- pmatch $ pfield @"datum" # txOut
    case outDatum of
        POutputDatum outDatumRec -> P.do
            PDatum inner <- pmatch $ pfield @"outputDatum" # outDatumRec
            ptryFrom @t @PData inner fst
        stupidlinter -> ptraceError "not a set datum"

-- extractDatumSuchThat where you don't care about the suchThat
extractDatum :: forall t. (PIsData t, PTryFrom PData t) => ClosedTerm (PAddress :--> PCurrencySymbol :--> PBuiltinList PTxOut :--> t)
extractDatum = extractDatumSuchThat #$ plam (\x -> pcon PTrue)

findOutWithCS ::
    (PListLike l, PElemConstraint l PTxOut) =>
    Term s (PCurrencySymbol :--> l PTxOut :--> PMaybe PTxOut)
findOutWithCS = phoistAcyclic $ plam $ \cs list ->
    pfind # (hasCS # cs) # list
