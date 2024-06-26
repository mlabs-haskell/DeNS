# SYNOPSIS.
#   dens-pdns-backend
#
# DESCRIPTION.
#   `dens-pdns-backend` is a remote backend for PowerDNS which is compatible
#   with the RRs stored by
#
# ENVIRONMENT.
#   - TODO(jaredponn): write me down
{ inputs, lib, ... }:
{
  imports =
    [
    ];
  config = {
    perSystem = { config, system, pkgs, ... }:
      let
        tsFlake = inputs.flake-lang.lib.${system}.typescriptFlake {
          name = "dens-pdns-backend";
          src = ./.;
          inherit (config.settings)
            devShellTools;

          devShellHook = ''
            ${config.settings.devShellHook or ""}
            export DENS_QUERY_POSTGRES_SCHEMA=${config.packages.dens-query-postgres-schema}
          '';

          testTools = [ pkgs.postgresql pkgs.pdns ];

          npmExtraDependencies = [ ];

        };
      in
      {
        packages = {
          # Executable
          dens-pdns-backend = tsFlake.packages.dens-pdns-backend-typescript-exe;
        };

        # When developing, in this directory, run
        # ```bash
        # nix develop .#dens-pdns-backend-typescript
        # ```
        # and it'll give you some goodies (`node_modules/` for dependencies +
        # `./.extra-dependencies`).
        devShells = {
          inherit (tsFlake.devShells) dens-pdns-backend-typescript;
        };

        checks = {
          dens-pdns-backend-typescript-test = tsFlake.checks.dens-pdns-backend-typescript-test.overrideAttrs (_self: _super: {
            DENS_QUERY_POSTGRES_SCHEMA = config.packages.dens-query-postgres-schema;
          });
        };
      };
  };
}
