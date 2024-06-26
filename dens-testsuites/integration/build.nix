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
            devShellTools;

          testTools =
            [
              pkgs.postgresql
              inputs.plutip.packages.${system}."plutip-core:exe:local-cluster"
              inputs.ogmios.packages.${system}."ogmios:exe:ogmios"
              config.packages.dens-query-cli
              pkgs.glibcLocales
            ];

          npmExtraDependencies =
            [
              inputs.prelude-typescript.packages.${system}.lib
              inputs.plutus-ledger-api-typescript.packages.${system}.lib
              config.packages.dens-transactions-typescript-lib
              config.packages.lbf-dens-db-typescript
              config.packages.lbf-dens-typescript
            ];

          devShellHook =
            ''
              ${config.settings.devShellHook}
            '';
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
