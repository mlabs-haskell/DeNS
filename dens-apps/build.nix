# Glue code for putting the system together
{ ... }:
{
  imports = [
    ./ogmios/build.nix
    ./cardano-node/build.nix
    ./pdns/build.nix

    ./preview-testnet/build.nix
  ];
}
