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

  perSystem = { system, ... }:
    {
      packages = {
        ogmios = inputs.ogmios.packages.${system}."ogmios:exe:ogmios";
      };
    };
}
