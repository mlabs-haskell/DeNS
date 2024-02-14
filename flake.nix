{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    pre-commit-hooks-nix.url = "github:cachix/pre-commit-hooks.nix";
    pre-commit-hooks-nix.inputs.nixpkgs.follows = "nixpkgs";
    hci-effects.url = "github:hercules-ci/hercules-ci-effects";

    # flake-lang.nix: Tools for creating project flakes
    # flake-lang.url = "github:mlabs-haskell/flake-lang.nix";
    flake-lang.follows = "lambda-buffers/flake-lang";


    # LambdaBuffers: Toolkit for generating types and their semantics
    lambda-buffers = {
      url = "github:mlabs-haskell/lambda-buffers";
      # inputs.flake-lang.follows = "flake-lang";
    };

    psm = {
      # url = "github:mlabs-haskell/plutus-simple-model?ref=indigo/update-plutus-apps";
      url = "github:mlabs-haskell/plutus-simple-model";
      flake = false;
    };

    # Plutarch
    plutarch.follows = "lambda-buffers/plutarch";
    # plutarch.url = "github:plutonomicon/plutarch-plutus?ref=f535a6894a25e6d46d16958273769bffa8880090";
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
