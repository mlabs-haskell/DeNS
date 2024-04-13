{ inputs, lib, ... }:
{
  imports = [ ];
  config = {
    perSystem = { system, config, pkgs, ... }:
      let
        tsFlake = inputs.flake-lang.lib.${system}.typescriptFlake {
          name = "dens-integration";
          src = ./.;
          inherit (config.settings)
            devShellTools
            devShellHook;

          testTools =
            [
              pkgs.postgresql
              inputs.plutip.packages.${system}."plutip-core:exe:local-cluster"
              inputs.ogmios.packages.${system}."ogmios:exe:ogmios"
              config.packages.dens-query-cli
            ];

          npmExtraDependencies =
            [
              inputs.prelude-typescript.packages.${system}.lib
              inputs.plutus-ledger-api-typescript.packages.${system}.lib

              config.packages.lbf-dens-db-typescript
              config.packages.lbf-dens-typescript
            ];
        };
      in
      {
        # When developing, in this directory, run
        # ```bash
        # nix develop .#dens-integration-typescript
        # ```
        # and it'll give you some goodies (`node_modules/` for dependencies +
        # `./.extra-dependencies`).
        devShells = {
          inherit (tsFlake.devShells) dens-integration-typescript;
        };

        inherit (tsFlake) checks;
      };
  };
}
