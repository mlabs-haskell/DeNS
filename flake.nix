{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    # Module system for flakes
    flake-parts.url = "github:hercules-ci/flake-parts";

    # Code quality things
    pre-commit-hooks-nix.url = "github:cachix/pre-commit-hooks.nix";
    pre-commit-hooks-nix.inputs.nixpkgs.follows = "nixpkgs";
    hci-effects.url = "github:hercules-ci/hercules-ci-effects";

    # flake-lang.nix: Tools for creating project flakes
    flake-lang.follows = "lambda-buffers/flake-lang";

    # LambdaBuffers: Toolkit for generating types and their semantics
    lambda-buffers = {
      url = "github:mlabs-haskell/lambda-buffers";
    };

    # Plutarch
    plutarch.follows = "lambda-buffers/plutarch";

    # ogmios: Websockets for interacting with the cardano-node
    ogmios.url = "github:mlabs-haskell/ogmios-nixos";

    # cardano-node:
    cardano-node.url = "github:input-output-hk/cardano-node/8.7.3";

    # TypeScript libraries
    # prelude-typescript.follows = "lambda-buffers/prelude-typescript";
    # plutus-ledger-api-typescript.follows = "lambda-buffers/plutus-ledger-api-typescript";
    plutus-ledger-api-typescript = {
      url = "github:mlabs-haskell/plutus-ledger-api-typescript";
      inputs.flake-lang.follows = "flake-lang";
    };
    prelude-typescript.follows = "plutus-ledger-api-typescript/prelude-typescript";

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

          # Settings
          ./settings.nix
        ];
      };
}
