module MyLib (myDomainName, myClass, someDensKeys, myFunction) where

import LambdaBuffers.Dens.Plutarch (
    DensKey (DensKey),
 )
import LambdaBuffers.Plutus.V1.Plutarch (Bytes)
import LambdaBuffers.Prelude.Plutarch qualified as Lb.Plutarch
import LambdaBuffers.Runtime.Plutarch (PList (PList))
import Plutarch (Config (Config), Term, TracingMode (DoTracingAndBinds))
import Plutarch qualified
import Plutarch.Prelude (PAsData, PBuiltinList (PCons, PNil))
import Plutarch.Prelude qualified
import Plutarch.Script qualified

import System.Exit qualified as Exit

myDomainName :: Term s (PAsData Bytes)
myDomainName = Plutarch.Prelude.pdata (Plutarch.Prelude.pconstant "maltese")

myClass :: Term s (PAsData Lb.Plutarch.Integer)
myClass = Plutarch.Prelude.pdata (Plutarch.Prelude.pconstant 69)

myDensKey :: Term s (PAsData DensKey)
myDensKey = Plutarch.Prelude.pdata (Plutarch.Prelude.pcon (DensKey myDomainName myClass))

someDensKeys :: Term s (PAsData (PList DensKey))
someDensKeys =
    Plutarch.Prelude.pdata $
        Plutarch.Prelude.pcon $
            PList $
                Plutarch.Prelude.pcon $
                    PCons myDensKey $
                        Plutarch.Prelude.pcon PNil

myFunction :: IO ()
myFunction = do
    case Plutarch.compile (Config DoTracingAndBinds) someDensKeys of
        Left err -> Exit.die (show err)
        Right script -> do
            putStrLn "The script is as follows:"
            print $ Plutarch.Script.serialiseScript script
