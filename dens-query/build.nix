# SYNOPSIS.
#   dens-query 
#
# DESCRIPTION.
#   `dens-query` is a server which connects to a Cardano node (via Ogmios), and
#   populates a PostgreSQL database with UTxOs relevant to the DeNS protocol.
#
# ENVIRONMENT.
#   - DENS_QUERY_CONFIG must be set to a file path containing a JSON
#     configuration file
#
# LIMITATIONS:
#   - This always syncs from the beginning of time (easy to fix)
#   - There is no API to query the database
{ inputs, lib, ... }:
{
  imports =
    [
      ./api/lbf/build.nix
    ];
  config = {
    perSystem = { system, config, pkgs, ... }:
      let
        tsFlake = inputs.flake-lang.lib.${system}.typescriptFlake {
          name = "dens-query";
          src = ./.;
          inherit (config.settings)
            devShellTools
            devShellHook;

          testTools = [ pkgs.postgresql ];

          npmExtraDependencies =
            [
              inputs.prelude-typescript.packages.${system}.tgz
              inputs.plutus-ledger-api-typescript.packages.${system}.tgz

              config.packages.lbf-dens-db-typescript
              config.packages.lbf-dens-typescript
            ];
        };
      in
      {

        packages = {
          # Executable
          dens-query-cli = tsFlake.packages.dens-query-typescript-exe.overrideAttrs (_self: super:
            {
              buildInputs = super.buildInputs ++ [ pkgs.makeWrapper ];
              postFixup =
                ''
                  ${super.postFixup or ""}

                  wrapProgram $out/bin/dens-query-cli \
                      --set DENS_QUERY_INIT_SQL_FILE ${lib.escapeShellArg ./api/postgres/dens.sql}
                '';
            });
          # Tarball to use in other projects
          dens-query-tgz = tsFlake.packages.dens-query-typescript-tgz;
        };

        # When developing, in this directory, run
        # ```bash
        # nix develop .#dens-query-typescript
        # ```
        # and it'll give you some goodies (`node_modules/` for dependencies +
        # `./.extra-dependencies`).
        devShells = {
          inherit (tsFlake.devShells) dens-query-typescript;
        };

        inherit (tsFlake) checks;
      };
  };
}
