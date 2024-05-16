{ inputs, ... }:
{
  config = {
    perSystem = { system, config, ... }:
      let
        tsFlake = inputs.flake-lang.lib.${system}.typescriptFlake {
          name = "dens-transactions";
          src = ./.;
          inherit (config.settings)
            devShellTools
            devShellHook;

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
        packages = {
          inherit (tsFlake.packages)
            # Executable
            dens-transactions-typescript-exe
            # Library for other projects
            dens-transactions-typescript-lib;
        };

        # When developing, in this directory, run
        # ```bash
        # nix develop .#dens-transactions-typescript
        # ```
        # and it'll give you some goodies (`node_modules/` for dependencies +
        # `./.extra-dependencies`).
        # You can run the executable with
        # ```
        # npx dens-transactions-cli
        # ```
        devShells = {
          inherit (tsFlake.devShells) dens-transactions-typescript;
        };

        inherit (tsFlake) checks;
      };
  };
}
