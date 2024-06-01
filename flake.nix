{
  inputs = {
    nixpkgs.follows = "lambda-buffers/nixpkgs";

    # Module system for flakes
    flake-parts.follows = "lambda-buffers/flake-parts";

    # Code quality things
    pre-commit-hooks-nix.follows = "lambda-buffers/pre-commit-hooks";
    hci-effects.follows = "lambda-buffers/hci-effects";

    # flake-lang.nix: Tools for creating project flakes
    flake-lang.follows = "lambda-buffers/flake-lang";

    # LambdaBuffers: Toolkit for generating types and their semantics
    lambda-buffers = {
      url = "github:mlabs-haskell/lambda-buffers";
    };

    # Plutarch
    plutarch.follows = "lambda-buffers/plutarch";

    # ogmios: Websockets for interacting with the cardano-node
    ogmios.url = "github:mlabs-haskell/ogmios-nixos/78e829e9ebd50c5891024dcd1004c2ac51facd80";

    # plutip: local testnet cluster
    plutip.url = "github:mlabs-haskell/plutip/1bf0b547cd3689c727586abb8385c008fb2a3d1c";

    # cardano-node:
    cardano-node.url = "github:input-output-hk/cardano-node?ref=8.9.3";

    # TypeScript libraries
    prelude-typescript.follows = "lambda-buffers/prelude-typescript";
    plutus-ledger-api-typescript.follows = "lambda-buffers/plutus-ledger-api-typescript";
  };

  outputs = inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; }
      {
        systems = [ "x86_64-linux" "x86_64-darwin" ];
        imports = [
          # Code quality
          ./hercules-ci.nix
          ./pre-commit.nix

          # DeNS project
          ./dens-apps/build.nix
          ./dens-query/build.nix
          ./dens-apps/build.nix
          ./dens-testsuites/build.nix
          ./dens-transactions/build.nix
          ./dens-validation/build.nix

          # Documentation / website
          ./dens-website/build.nix

          # Settings
          ./settings.nix
        ];
      };
}
