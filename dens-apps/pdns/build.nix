# PowerDNS is a officially supported backend that we use. So, we include some
# glue code + a PowerDNS configuration to interact with DeNS
{ ... }:
{
  imports =
    [
      ./dens-pdns-backend/build.nix
    ];
}
