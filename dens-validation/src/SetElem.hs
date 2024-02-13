{-# LANGUAGE BlockArguments #-}
{-# LANGUAGE DataKinds #-}
-- for hls to not yell at me
{-# LANGUAGE OverloadedRecordDot #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PartialTypeSignatures #-}
{-# LANGUAGE QualifiedDo #-}
{-# OPTIONS_GHC -Wno-partial-type-signatures #-}

module SetElem (mkSetValidator) where

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
import Utils

densNameMin :: ClosedTerm Bytes
densNameMin = pconstant ""

-- placeholder
densNameMax :: ClosedTerm Bytes
densNameMax = pconstant "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

-- ignores the currency symbol for the extension for now
isInitialSetDatum :: ClosedTerm (SetDatum :--> PBool)
isInitialSetDatum = phoistAcyclic $ plam $ \setDatum -> P.do
    SetDatum l r _ <- pmatch setDatum
    DensKey lname lclass <- pmatch . pfromData $ l
    DensKey rname rclass <- pmatch . pfromData $ r
    leftIsMin <- plet $ pfromData lname #== densNameMin
    rightIsMax <- plet $ pfromData rname #== densNameMax
    classesMatch <- plet $ lclass #== rclass
    leftIsMin #&& rightIsMax #&& classesMatch

mkSetValidator ::
    Term
        s
        ( PCurrencySymbol
            :--> PUnit
            :--> SetInsert
            :--> PScriptContext
            :--> PUnit
        )
mkSetValidator = phoistAcyclic $ plam $ \protocolCS _ setInsert cxt -> P.do
    -- We only need to check whether the setElem token is minted, all the real validation logic is in that MP
    txInfo <- plet $ pfield @"txInfo" # cxt

    fields <- pletFields @'["referenceInputs", "outputs", "mint"] txInfo

    resolvedOutputs <- plet $ pfromData fields.outputs

    resolvedRefInputs <- plet $ pmap # resolved # pfromData fields.referenceInputs

    -- NOTE/FIXME/TODO: I am NOT 100% sure that this is safe, but I do not know another way to get the setElemID
    --                  Someone needs to carefully review. It *seems* safe if the protocol NFT MP is a one shot policy
    Protocol elemIdMP setElemMP _ _ <- pmatch $ P.do
        inInputs <- pmatch $ findOutWithCS # protocolCS # resolvedOutputs
        case inInputs of
            PNothing ->
                txOutDatum @Protocol
                    #$ pfromJust
                    #$ findOutWithCS
                    # protocolCS
                    # resolvedRefInputs

    setElemIdCS <- plet $ scriptHashToCS # pfromData setElemMP

    pguardM "SetElemID token minted" $ (pvalueOf # fields.mint # setElemIdCS # emptyTN) #== 1

    pcon PUnit

mkSetElemMintingPolicy ::
    Term
        s
        ( PCurrencySymbol -- Protocol NFT (assume empty token name for now)
            :--> SetInsert
            :--> PScriptContext
            :--> PUnit
        )
mkSetElemMintingPolicy = phoistAcyclic $ plam $ \protocolSymb setInsert cxt -> P.do
    SetInsert'Insert keyToInsert <- pmatch setInsert

    txInfo <- plet $ pfield @"txInfo" # cxt

    fields <- pletFields @'["inputs", "referenceInputs", "outputs", "mint"] txInfo

    setElemCS <- plet $ pownCurrencySymbol # cxt

    outputs <- plet $ pfromData fields.outputs

    mint <- plet $ passertPositive #$ pfromData fields.mint

    isInitalization <- plet $ initialSetDatumInOutputs # setElemCS # outputs

    pif
        isInitalization
        P.do
            -- Checks for an initialize transaction. We already know a SetDatum w/ the initialization properties is in an output w/ a SetElem NFT

            -- Is the protocol NFT minted in this TX? NOTE: Protocol MP must be one shot!
            pguardM "Protocol NFT Minted" $ pvalueOf # mint # protocolSymb # emptyTN #== 1

            -- Is there a protocol datum in the output that contains the protocol NFT? (also we need the fields here)
            Protocol elemIdMP setElemMP setValidator _ <- pmatch $ findProtocolInOutputs # protocolSymb # outputs

            -- Probably redundant, but it can't hurt to make sure that this minting policy is the one indicated in the Protocol datum
            pguardM "Own CS doesn't match protocol SetElem CS" $ (scriptHashToCS # pfromData setElemMP) #== setElemCS

            -- Are no element id tokens minted? (We check the output and mints for redundancy, maybe not necessary)
            elemIdCS <- plet $ scriptHashToCS # pfromData elemIdMP
            noElemIDInOutputs <- plet $ pall # (lacksCS # elemIdCS) # outputs
            noElemIDInMint <- plet $ valLacksCS # elemIdCS # mint
            pguardM "No ElemID NFT minted or in output" $ noElemIDInMint #&& noElemIDInOutputs

            pcon PUnit
        P.do
            -- 0) REFERENCE INPUTS: Get the protocol datum (reference input, paid to protocol validator)

            Protocol elemIdMP setElemMP setValidator _ <-
                pmatch $
                    txOutDatum @Protocol
                        #$ findUnique
                        # (hasCS # protocolSymb)
                        #$ pmap
                        # resolved
                        # fields.referenceInputs

            -- 1) INPUTS: Check for k < densKey < nxt input that pays to the set validator & holds a
            resolvedInputs <- plet $ pmap # resolved # pfromData fields.inputs

            setValidatorAddress <- plet $ pscriptHashAddress # setValidator
            setDatum <- plet $ extractDatum @SetDatum # setValidatorAddress # setElemCS #$ resolvedInputs -- ignoring OwnerApproval for now
            SetDatum l r _ <- pmatch setDatum
            pguardM "Validate set insert" $ validateSetInsert # setDatum # pfromData keyToInsert

            -- 2) OUTPUTS: Check for a. SD(k, densKey) b. SD(densKey,nxt)

            l' <- plet $ pfromData l
            r' <- plet $ pfromData r
            k <- plet $ pfromData keyToInsert
            checkOutput <- plet $ plam $ \p -> extractDatumSuchThat @SetDatum # p # setValidatorAddress # setElemCS # outputs
            SetDatum{} <- pmatch $ checkOutput # (hasLR # l' # k)
            SetDatum{} <- pmatch $ checkOutput # (hasLR # k # r')

            -- 3) MINTS: Check for the presence of a SetElemID NFT & ElementID NFT

            -- This, plus the two subsequent checks, implies that *only* the SetElem and ElemID tokens are minted
            pguardM "Only two CS minted " $ totalMint # pforgetPositive mint #== 2

            checkMintsOne <- plet $ plam $ \currSym tokName -> mintsExactly # 1 # currSym # tokName # mint

            pguardM "Mints one SetElemID token" $ checkMintsOne # setElemCS # emptyTN

            elemIdCS <- plet $ scriptHashToCS # pfromData elemIdMP
            kTokName <- plet $ pcon $ PTokenName (pblake2b_256 #$ pserialiseData # pdataImpl k)
            pguardM "Mints one ElementID NFT with a token name == blake2b_256(densKey)" $ checkMintsOne # elemIdCS # kTokName

            pcon PUnit
  where
    -- TODO: plet these funs with the correct arguments pre-applied. These bindings
    --       are a temporary thing to improve code readability until I'm sure the logic is solid

    -- If it's an initialization tx, there should be *one* SetDatum in the outputs, and that set datum should match
    -- the schema for an initialization datum
    initialSetDatumInOutputs :: ClosedTerm (PCurrencySymbol :--> PBuiltinList PTxOut :--> PBool)
    initialSetDatumInOutputs = phoistAcyclic $ plam $ \setElemCS outputs -> P.do
        withSetElemCS <- plet $ pfilter # (hasCS # setElemCS) # outputs
        pif
            (plength # withSetElemCS #== 1)
            (isInitialSetDatum #$ txOutDatum #$ phead # withSetElemCS)
            (pcon PFalse)

    -- The protocol MP should be a one shot, and a set initialization tx should mint it
    findProtocolInOutputs :: ClosedTerm (PCurrencySymbol :--> PBuiltinList PTxOut :--> Protocol)
    findProtocolInOutputs = phoistAcyclic $ plam $ \protocolCS outputs -> P.do
        withProtocolCS <- plet $ pfilter # (hasCS # protocolCS) # outputs
        pguardM "Exactly 1 output with a Protocol CS" $ plength # withProtocolCS #== 1
        txOutDatum # (phead # withProtocolCS)

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
