{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    pre-commit-hooks-nix.url = "github:cachix/pre-commit-hooks.nix";
    pre-commit-hooks-nix.inputs.nixpkgs.follows = "nixpkgs";
    hci-effects.url = "github:hercules-ci/hercules-ci-effects";

    # flake-lang.nix: Tools for creating project flakes
    flake-lang.url = "github:mlabs-haskell/flake-lang.nix";

    # LambdaBuffers: Toolkit for generating types and their semantics
    lambda-buffers = {
      url = "github:mlabs-haskell/lambda-buffers?ref=jared/copy-instead-of-symlink-for-haskell-nix";
      inputs.flake-lang.follows = "flake-lang";
    };

    # Plutarch
    plutarch.follows = "flake-lang/plutarch";
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
