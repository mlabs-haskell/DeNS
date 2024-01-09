# Design & Architecture

## Requirements (Conceptual)

The DeNS protocol must support a small list of essential features to deliver on the promise of a decentralized, transparent, censorship-resistant, and privacy-conscious successor to the DNS protocol. These features are:

  - Records must be stored in an immutable, permanent, and public database.
  - Users must have the ability (at least in principle) to resolve queries _locally_ - that is, it ought to be possible for a user to reconstruct the DeNS database solely from public information, and use that database to resolve queries without sharing those queries (or the identity of the user) with any third party
  - Users must be provided with direct control over their records, such that they can update those records without the assent or intervention of any third party.
  - Users must have the ability to transfer ownership of their records without the assent or intervention of any third party.
  - It must be possible to reconstruct a database, suitable for use as the primary database mapping domain names to resources in a DNS resolver, from these public records
  - A viable and orderly transition path from traditional DNS must exist, such that existing users of DNS can gradually migrate to the DeNS protocol

The last feature requires further elaboration and discussion. A 'transition path', for the purposes of this document, can be understood in two ways: First, from the perspective of end-users of the system, a DeNS transition path requires that they be able to interact with DeNS to resolve traditional DNS queries while benefiting from the advantages of decentralization, transparency, etc. Second, from the perspective of (DNS) domain owners and operators, a transition path requires that DeNS (temporarily) delegates authority over existing DNS records to the authoritative sources of those records in the existing DNS system.

As far as we can determine, the only way to delegate authority over existing DNS records to their authoritative source in traditional DNS without abandoning some other required feature is to _mirror existing DNS records in the DeNS system_. This entails a further design constraint: It must be _economically feasible_ to perform DNS record mirroring in DeNS. While this is, in some sense, an implementation detail, it is nevertheless an essential requirement which must guide the rest of the design.

## Overview: A Cross-Chain Database (Conceptual)

The constraints outlined in the previous section give rise to an apparent dilemma: The Web3 technologies which are most suitable for the _data-storage_ functionality (Arweave, IPFS, other distributed storage solutions) are inadequate for implementing the transaction logic, while, conversely,  the Web3 technologies most suited to implement transaction logic necessary for users to have meaningful control over their records (Cardano and other smart-contract capable blockchains) are unsuitable for storing the large (relative to typical smart contracts) amounts of data necessary for a protocol that aims to replace DNS in its entirety.

Fortunately, this dilemma only poses a problem under the assumption that the database of DeNS records must exist "in one place". Were that the case, we would be forced to choose between two unsatisfactory and cumbersome solutions: Either we would have to implement complex smart contract logic on a platform designed primarily for data storage, or implement data storage on a platform designed for contract logic. This assumption, however, is false. If we think of a database as an abstract structure that (logically) associates values (or sets of values) with specific keys, it is clear that a logical relation can be established between keys and values located on entirely distinct Web3 technologies.

This insight motivates the general architecture of the DeNS (onchain) protocol: DeNS will consist in a cross-chain database, such that contract logic (creating, updating, deleting, transfering ownership of) records is performed on a smart-contract capable blockchain, while data-storage is performed on a blockchain (or similar Web3 technology) designed for efficient storage and retrieval of data. Transactions on the smart-contract blockchain do not contain records as such ("inline"), but rather contain _pointers_ (references, addresses) to resources on the data-storage Web3 platform. When constructing the database of records to be used in a resolver, transactions on the smart-contract blockchain serve as a source of authorization - only those records which are properly referenced in a suitable transaction on the smart-contract blockchain will be retrieved from the data-store and included in the final data set.

## Root Domain Topography (Conceptual)

Before moving to a detailed discussion of the DeNS protocol architecture, it is necessary to first clarify exactly what is meant (conceptually) by "names" and "records" - and, perhaps most importantly, by "ownership" - in DeNS. To motivate this discussion, it will be helpful to look at the format of a DNS record, here represented as a Haskell data type (we ignore the inner structure of DNS names and resource data here, as these are not important at this level of discussion):

```haskell
data DNSRecord =
  DNSRecord {
    name     :: DNSName,
    type     :: Word16,
    class    :: Word16,
    ttl      :: Word32,
    rdLength :: Word16,
    rData    :: ResourceData
  }
```

Although it is commonplace (and perfectly fine in most circumstances) to think of DNS records as representing a mapping from a human-readable name to a machine-readable IP address, this is not strictly correct. The `class` field in a DNS record indicates the protocol that the record is concerned with, and one must know the class in order to interpret the `type` field (and consequently the `rData` field as well). In almost every interaction with DNS, the `class` can be assumed to be `1`, which indicates an IP (Internet Protocol) record (`A`,`AAAA`,`MX`, etc) - the family of records with which most developers are familiar.

While this may seem like a minor technical detail, it motivates several important questions about the nature of ownership, names, and records in DeNS. Because DeNS aims to support both "traditional DNS records" (which we can now operationally define as: IP class records of types specified in the relevant DNS RFCs) and new classes of records that support a variety of Web3 naming protocols, we cannot maintain the illusion that all records are IP class records. Furthermore, if we wish to sell access rights for the records associated with a given name, we must be able to specify precisely the criteria by which a record is "associated with a given name". That is: We must be able to tell our potential customers exactly what it is they are buying.

We anticipate that, in the future, DeNS will support a variety of name systems. Some of them may integrate with DeNS at a deep level, such that transactions are always processed by a DeNS contract. However, we would also like to support (name resolution for) autonomous protocols which are not managed by DeNS contracts  and therefore cannot assume that a single name (i.e. the value of the `name` field) is owned by the same entity in each supported protocol. Consequently, in DeNS, "ownership" must mean: Delegated control over the records associated with a `(Name,Class)` pair, where a record `R` is associated with a name/class pair `(N,C)` iff `R.name == N && R.class == C`.

Similarly, at the highest level there are no "bare names" in DeNS. A DeNS name exists in a _Name-Universe_ which is indicated by the associated class (or, if you prefer, by the protocol the class refers to).

Records in DeNS, then, are just ordinary DNS records. However, in order to maximize the number of additional protocols that DeNS support, and to reduce the burden of supporting obsolete protocols, we will consider all existing DNS record classes other than 1 (IP) to be deprecated. We will not consider ourselves obliged to support these protocols, and we reserve the right to reassign their class identifier at our discretion.

The considerations raised in this section also constrain the logical structure of the DeNS root domain. In particular, the DeNS root domain must be _universal_ in a sense in which the DNS root domain is not. To elaborate: What we ordinarily refer to as the DNS root domain - the set of zone files served by DNS root servers - is really *a* DNS root domain. Namely, it is the root domain for the IP class. There are [other](https://chaosnet.net/chaos-dns) root domains for non-IP classes, and (e.g.) the Chaosnet root domain and the IP root domain are utterly distinct from one another. In this sense, the existing DNS root domain is not universal.

DeNS, by contrast, will be universal. Concretely, this implies that the records which constitute the DeNS top-level root domain will contain resources which are associated with a *class*, and not, as with DNS, a top-level domain. In this way, we can support a wide variety of different protocols, including protocols that serve as their own autonomous top-level domain.

This architecture allows us to specify more clearly the mechanics of the transition away from DNS as an authority for IP records: We will lease the IP class of domains to ourselves and maintain mirrors of DNS records until DeNS adoption reaches a level that we judge sufficient to facilitate a "hard fork" from DNS authority. At that point, we will let the lease expire and IP class domains in DeNS will be directly managed by domain owners via DeNS smart contracts.

## Architecture - Cardano (Technical) (WIP)

TODO/FIXME: Everything here assumes that domain ownership is eternal/indefinite. In practice that won't work, and we'll have to modify this design to accommodate a "lease" model instead of a "permanent control" model.

### Protocol NFT

All contract scripts will be parameterized by a `Protocol` NFT that uniquely identifies the protocol. (TODO: Figure out details later)

### Record Keys

Morally, the DeNS protocol is a cross-chain distributed Key-Value store, where the key component is managed by a Cardano smart-contract and contains a pointer to an Arweave resource which in turn contains a set of records associated with the `(Name,Class)` pair in the Key:

``` haskell
{-
  This data type contains all of the elements necessary to function as a key in our logical database.
-}
data DeNSKey
  = DeNSKey {
      densClass :: Word16,
      densName  :: ByteString,
      densPointer :: Maybe ByteString -- By convention, this should be an Arweave resource address. `Nothing` indicated a deleted record
  }
```

### Set Validator / ELEMENTID Minting Policy

NOTE: As mentioned above, this should be parameterized by the `Protocol` NFT (TODO)

The most important invariant that the protocol must maintain is the _uniqueness of names_ in the set of onchain keys. Unfortunately, we cannot adopt the naive approach of using an onchain List to represent this set. Because such a list could conceivably grow to include _tens of millions_ (or more!) entries, and because traversing a list that large would assuredly exceed Cardano ExUnit limits, we are forced to adopt a more sophisticated solution. First, we will require a data type to represent entries in our set:

``` haskell
data SetDatum
  = SetDatum {
      sdClass :: Word16, -- Each set represents a Name Universe and must be tagged w/ the class ID corresponding to that universe
      sdName :: ByteString, -- A human readable domain name
      sdNext :: (Maybe (ByteString,Word16)) -- The succesor to sdName (if one exists in the set)
  }
```

We will also need an NFT asset that uniquely identifies a member of this set. Let's call this asset **ElementID**.

#### Set Validator (WIP)

The set validator locks UTxOs containing `SetDatum` entries and is used to represent the on-chain collection of unique keys. We initialize a new class `c` by locking a UTXO with `SetDatum c "" Nothing` at the validator (which can be assumed to exist for validation checks). For comparisons on the `sdName` ByteString, we assume that an `Ord` instance (or equivalent in Plutarch/Aiken) exists, and that the empty ByteString `""` is the absolute minimum (forall x. x /= "" -> x > "")

Let
  - `(N,C)` designate a new Name/Class pair for which we would like to mint an **ElementID** NFT
  - `SD(c,n,nxt)`designate a SetDatum such that `sdClass = c, sdName = n, sdNext = nxt`

**PARAMETERS**:
  - The Protocol NFT

**INPUTS:**

ONE OF:
  1. A UTxO (locked at this validator )`SD(C,X,Just (Y,C))` where X < N < Y
  2. A UTxO (locked at this validator )`SD(C,X,Nothing)` where X < N
**REFERENCE INPUTS:**
  - If 1 was passed as an input: A UTxO (locked at this validator) `SD(C,Y,_)`

**OUTPUTS:**
  - If 1 was passed:
    - A UTxO `SD(C,X,Just (N,C))` (paid to the Set Validator)
    - A UTxO `SD(C,N,Just (Y,C))` (paid to the Set Validator)
  - If 2 was passed:
    - A UTxO `SD(C,X,Just (N,C))` (paid to the Set Validator)
    - A UTxO `SD(C,N,Nothing)`    (paid to the Set Validator)
  - A UTxO with an `ElementID` token that uniquely identifies the `(N,C)` pair which was inserted into the set

**MINTS**:
  - One `ElementID` NFT that represents the `(Name,Class)` pair being inserted into the set

**REDEEMER**:

``` haskell
data SetInsert
  = InsertAfter {class :: Word16, name :: ByteString}
  | InsertBetween {class :: Word16, name :: ByteString, next :: (ByteString,Word16)}
```

**CHECKS:**
  - The inputs contain a UTxO with a datum conforming to either 1 or 2 above (but not both!)
  - The outputs conform to the above schema
  - NOTE: Most of the relevant checks are conducted inside the `ElementID` minting policy

**DISCUSSION:** TODO

Because each virtual set is initialized with a minimal element, inserting an arbitrary name `n` always amounts to either inserting `n` after some _known_ name `m` where `m < n`, or inserting `n` between `m` and `o` where `m < n < o`.

#### ElementID Minting Policy (WIP)

The `ElementID` minting policy mints an NFT which serves as an access control identifier in order to gate access to specific records in the virtual DeNS database.

**PARAMETERS**:
  - The Protocol NFT

**REDEEMER**:
(We reuse the Set validator redeemer)
``` haskell
data Insert
  = InsertAfter {class :: Word16, name :: ByteString}
  | InsertBetween {class :: Word16, name :: ByteString, next :: (ByteString,Word16)}
```

**CHECKS:**: (WIP, probably not exhaustive)
  - The inputs contain a UTxO with a datum conforming to either 1 or 2 above. That is, EITHER:
    - If `InsertAfter`:
      - A UTxO locked at (i.e. paying to) the Set validator with a `SD(C,N,Nothing)` datum where `N < redeemer.name && C == redeemer.class`
    - If `InsertBetween`: A UTxO locked at (i.e. paying to) the Set validator with a `SD(C,X,Just (Y,C))` where `X < redeemer.name < Y && C == c`
  - If `InsertBetween`: Check for a reference input (locked at / paid to the Set validator) with a `SD(C,Y,_)` datum
  - Exactly 1 minted NFT
  - The TokenName of the minted NFT is `== blake2b_256 (show redeemer.class <> redeemer.name)`
    - NOTE: Note sure about this, @bladyjoker should review

### Records Validator

The records validator serves as an access control list for the virtual DeNS database. When the offchain code reconstructs the database from Cardano keys and Arweave values, it treats the records locked at the Records validator as the source of authority. That is: Only records locked at the records validator are used to construct the database used in a DeNS resolver.

**PARAMETERS**:
  - The Protocol NFT
  - The CurrencySymbol/ScriptHash of the ElementID minting policy

**DATUM**:

The the Records Validator datum functions as the key in our virtual database. To update or create a record, a DeNS user simply adjusts the reference for the class and name that they own. To delete a record, the user submits a transaction with an output datum where the `reference` field is `Nothing`.

``` haskell
data DeNSKey = DeNSKey {
  class :: Word32,
  name  :: ByteString,
  reference :: Maybe ByteString -- an Arweave address
}
```

**REDEEMER**:

The offchain code that constructs the DeNS database will always treat the _most recent_ record associated with a given name as authoritative, and consequently we do not need to distinguish between record creation and record deletion. (Unlike the Set validator, we do not need a simulated Map or Set).

``` haskell
data DeNSAction
  = Upsert
  | Delete
```

**INPUTS:**
  - A UtXO containing a NFT where the AssetClass consists of a CurrencySymbol == the hash of the ElementID MintingPolicy and where the token name is (or should be) == the blake2b hash calculated from `blake2b_256 (show redeemer.class <> redeemer.name)`

**OUTPUTS:**
  - A UTxO, paid to the Records Validator, which contains the `DeNSKey` passed by the user

**MINTS**: N/A

**CHECKS:** (WIP / PROBABLY NOT COMPREHENSIVE)
  - The NFT in the inputs contains a token that satisfies the constraints outlined above in the **INPUTS** section (todo: Elaborate)
  - The output contains a single UtXO with an *inline* `DeNSKey` datum which is equal to the input passed in by the user
  - This output UtXO is paid to the validator

**DISCUSSION:** TODO

## Architecture - Arweave (Technical) (WIP)

TODO

## Architecture - Offchain (Technical) (WIP)

TODO
