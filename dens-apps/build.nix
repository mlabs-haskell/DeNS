# Glue code for putting the system together
_:
{
  imports = [
    ./ogmios/build.nix
    ./cardano-node/build.nix
    ./pdns/build.nix
  ];
}
