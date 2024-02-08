{-# LANGUAGE DataKinds #-}
-- for hls to not yell at me
{-# LANGUAGE OverloadedRecordDot #-}
-- for hls to not yell at me
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QualifiedDo #-}

module MyLib (mkSetValidator) where

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
    PBool (PTrue),
    PBuiltinList,
    PData,
    PEq ((#==)),
    PIsData,
    PMaybe (PJust, PNothing),
    PPartialOrd ((#<)),
    PString,
    PTryFrom,
    PUnit (..),
    Term,
    pcon,
    pconstant,
    pdata,
    pdcons,
    pdnil,
    pfield,
    pfilter,
    pfind,
    pfromData,
    phoistAcyclic,
    pif,
    plam,
    plength,
    plet,
    pletFields,
    pmap,
    pmatch,
    ptraceError,
    ptryFrom,
    (#),
    (#$),
    (#&&),
    (:-->),
 )
import Plutarch.Script qualified

import Plutarch.Api.V1 (PCredential (..), PCurrencySymbol (..), PTokenName (..))
import Plutarch.Api.V1.Maybe (PMaybeData (PDNothing))
import Plutarch.Api.V1.Scripts (PScriptHash (..))
import Plutarch.Api.V1.Value (pnormalize, pvalueOf)
import Plutarch.Api.V2 (
    PAddress (..),
    PCurrencySymbol (..),
    PDatum (PDatum),
    PMaybeData (PDNothing),
    POutputDatum (POutputDatum),
    PScriptContext,
    PScriptHash (..),
    PTokenName (..),
    PTxInInfo (..),
    PTxOut (..),
 )
import Plutarch.Api.V2.Tx (POutputDatum (POutputDatum), PTxInInfo)
import Plutarch.Builtin (PIsData (pdataImpl), pserialiseData)
import Plutarch.Crypto (pblake2b_256)
import Plutarch.List (pconvertLists)
import System.Exit qualified as Exit

mkSetValidator ::
    Term
        s
        ( PAddress -- Address of the (unspendable) protocol validator
            :--> PCurrencySymbol
            :--> SetInsert
            :--> PScriptContext
            :--> PUnit
        )
mkSetValidator = phoistAcyclic $ plam $ \protocolAddr protocolCS setInsert cxt -> P.do
    -- We only need to check whether the setElem token is minted, all the real validation logic is in that MP
    txInfo <- plet $ pfield @"txInfo" # cxt

    fields <- pletFields @'["inputs", "referenceInputs", "outputs", "mint"] txInfo

    Protocol elemIdMP setElemMP setValidator _ <-
        pmatch $
            extractDatum @Protocol
                # protocolAddr
                # protocolCS
                #$ pmap
                # resolved
                # fields.referenceInputs

    setElemIdCS <- plet $ scriptHashToCS # pfromData setElemMP

    pguardM "ElementID token minted" $
        (pvalueOf # fields.mint # setElemIdCS # pcon (PTokenName $ pconstant ""))
            #== 1

    pcon PUnit

mkSetElemMintingPolicy ::
    Term
        s
        ( PAddress -- Address of the (unspendable) protocol validator
            :--> PCurrencySymbol -- Protocol NFT (assume empty token name for now)
            :--> SetInsert
            :--> PScriptContext
            :--> PUnit
        )
mkSetElemMintingPolicy = phoistAcyclic $ plam $ \protocolAddr protocolSymb setInsert cxt -> P.do
    SetInsert'Insert keyToInsert <- pmatch setInsert

    txInfo <- plet $ pfield @"txInfo" # cxt

    fields <- pletFields @'["inputs", "referenceInputs", "outputs", "mint"] txInfo

    -- 0) REFERENCE INPUTS: Get the protocol datum (reference input, paid to protocol validator)

    Protocol elemIdMP setElemMP setValidator _ <-
        pmatch $
            extractDatum @Protocol
                # protocolAddr
                # protocolSymb
                #$ pmap
                # resolved
                # fields.referenceInputs

    -- 1) INPUTS: Check for k < densKey < nxt input that pays to the set validator & holds a

    -- not strictly necessary but can't hurt
    pguardM "Only one input" (plength # pfromData fields.inputs #== 1)
    setValidatorAddress <- plet $ pscriptHashAddress # setValidator
    setElemCS <- plet $ scriptHashToCS # pfromData setElemMP -- tx in inputs should have SetElem NFT (right?)
    setDatum <- plet $ extractDatum @SetDatum # setValidatorAddress # setElemCS #$ pmap # resolved # fields.inputs -- ignoring OwnerApproval for now
    SetDatum l r _ <- pmatch setDatum
    pguardM "Validate set insert" $ validateSetInsert # setDatum # pfromData keyToInsert

    -- 2) OUTPUTS: Check for a. SD(k, densKey) b. SD(densKey,nxt)
    outputs <- plet $ pfromData fields.outputs
    pguardM "Only two outputs" (plength # outputs #== 2)
    l' <- plet $ pfromData l
    r' <- plet $ pfromData r
    k <- plet $ pfromData keyToInsert
    checkOutput <- plet $ plam $ \p -> extractDatumSuchThat @SetDatum # p # setValidatorAddress # setElemCS # outputs
    SetDatum{} <- pmatch $ checkOutput # (hasLR # l' # k)
    SetDatum{} <- pmatch $ checkOutput # (hasLR # k # r')

    -- 3) MINTS: Check for the presence of a SetElemID NFT & ElementID NFT

    mint <- plet $ pnormalize # pfromData fields.mint

    checkMintsOne <- plet $ plam $ \currSym tokName -> (pvalueOf # mint # currSym # tokName) #== 1

    pguardM "Mints one SetElemID token" $ checkMintsOne # setElemCS # emptyTN

    elemIdCS <- plet $ scriptHashToCS # pfromData elemIdMP
    kTokName <- plet $ pcon $ PTokenName (pblake2b_256 #$ pserialiseData # pdataImpl k)
    pguardM "Mints one ElementID NFT with a token name == blake2b_256(densKey)" $ checkMintsOne # elemIdCS # kTokName
    -- TODO: We probably want to double check that nothing *else* gets minted (but that's annoying to implement)

    pcon PUnit
  where
    validateSetInsert :: ClosedTerm (SetDatum :--> DensKey :--> PBool)
    validateSetInsert = phoistAcyclic $ plam $ \setDatum toInsert -> P.do
        SetDatum l r _ <- pmatch setDatum
        DensKey lName lClass <- pmatch $ pfromData l
        DensKey rName rClass <- pmatch $ pfromData r
        DensKey xName xClass <- pmatch toInsert
        pguardM "All keys have same class" (lClass #== rClass #&& lClass #== xClass)
        pguardM "l < x" (pfromData lName #< pfromData xName)
        pguardM "x < r" (pfromData xName #< pfromData rName)
        pcon PTrue

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

scriptHashToCS :: Term s (PScriptHash :--> PCurrencySymbol)
scriptHashToCS = phoistAcyclic $ plam $ \shash -> P.do
    PScriptHash bs <- pmatch shash
    pcon (PCurrencySymbol bs)

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
   - The TxOut value contains an empty token name at the provided currency symbol
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
    x <- pmatch $ pfind # pred #$ pmap # getSetDatum # xs
    case x of
        PJust datum -> datum
        PNothing -> ptraceError "Could not find tx out with supplied addr/cs/setdatum pred" -- todo: better error!
  where
    getSetDatum :: Term s (PTxOut :--> t)
    getSetDatum = phoistAcyclic $ plam $ \txOut -> P.do
        outDatum <- pmatch $ pfield @"datum" # txOut
        case outDatum of
            POutputDatum outDatumRec -> P.do
                PDatum inner <- pmatch $ pfield @"outputDatum" # outDatumRec
                ptryFrom @t @PData inner fst
            stupidlinter -> ptraceError "not a set datum"

    matchAddrCS :: Term s (PAddress :--> PCurrencySymbol :--> PTxOut :--> PBool)
    matchAddrCS = plam $ \addr cs txout -> P.do
        PTxOut outRec <- pmatch txout
        outFields <- pletFields @'["address", "value", "datum"] outRec
        addrsMatch <- plet $ outFields.address #== addr
        hasNFT <- plet $ (pvalueOf # outFields.value # cs # emptyTN) #== 1
        addrsMatch #&& hasNFT

-- extractDatumSuchThat where you don't care about the suchThat
extractDatum :: forall t. (PIsData t, PTryFrom PData t) => ClosedTerm (PAddress :--> PCurrencySymbol :--> PBuiltinList PTxOut :--> t)
extractDatum = extractDatumSuchThat #$ plam (\x -> pcon PTrue)
