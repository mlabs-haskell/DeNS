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
          # Executable
          dens-transactions-cli = tsFlake.packages.dens-transactions-typescript-exe;
          # Tarball to use in other projects
          dens-transactions-tgz = tsFlake.packages.dens-transactions-typescript-tgz;
          dens-transactions-typescript-lib = tsFlake.packages.dens-transactions-typescript-lib;
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
