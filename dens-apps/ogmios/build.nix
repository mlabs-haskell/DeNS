# Flake module to wrap up ogmios.
{ inputs, config, ... }: {

  flake = {
    overlays = {
      # Overlay to include ogmios in the package set
      ogmios = _self: super: { inherit (config.flake.packages.${super.system}) ogmios; };
    };

    nixosModules = {
      ogmios = _:
        {
          # Import the ogmios overlay
          imports = [ ./module.nix ];

          # Include ogmios in nixpkgs
          nixpkgs.overlays = [ config.flake.overlays.ogmios ];
        };
    };
  };

  perSystem = { system, pkgs, config, ... }:
    {
      packages = {
        ogmios = inputs.ogmios.packages.${system}."ogmios:exe:ogmios";

        ogmios-image = pkgs.dockerTools.buildImage {
          name = "ogmios";
          tag = "latest";
          created = "now";

          copyToRoot = pkgs.buildEnv {
            name = "ogmios-image-root";
            paths = [ config.packages.ogmios ];
            pathsToLink = [ "/bin" ];
          };
          config = {
            Cmd = [ "/bin/ogmios" ];
            Volumes = {
              "/ipc/cardano-node" = { };
            };
          };
        };
      };
    };
}
