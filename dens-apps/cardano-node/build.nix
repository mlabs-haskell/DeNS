# Flake module to wrap up the cardano-node.
{ inputs, ... }: {
  flake.nixosModules = {
    # Rexport cardano-node's module
    inherit (inputs.cardano-node.nixosModules) cardano-node;
  };

  perSystem = { system, ... }:
    {
      packages = {
        inherit (inputs.cardano-node.packages.${system}) cardano-node cardano-cli;
      };
    };
}
