# PowerDNS is a officially supported backend that we use. So, we include some
# glue code + a PowerDNS configuration to interact with DeNS
{ ... }:
{
  imports =
    [
      ./dens-pdns-backend/build.nix
    ];

  config = {
    perSystem = { config, pkgs, ... }: {
      packages = {
        pdns-image = pkgs.dockerTools.buildImage {
          name = "pdns";
          tag = "latest";
          created = "now";

          copyToRoot = pkgs.buildEnv {
            name = "pdns-image-root";
            paths = [ pkgs.pdns ];
            pathsToLink = [ "/bin" ];
          };

          config = {
            Cmd = [ "/bin/pdns_server" "--config-dir=/etc/pdns" "--socket-dir=/ipc/pdns" ];
            Volumes = {
              "/etc/pdns" = { };
              "/ipc/pdns" = { };
              "/ipc/dens-pdns-backend" = { };
            };
          };
        };
      };
    };
  };
}
