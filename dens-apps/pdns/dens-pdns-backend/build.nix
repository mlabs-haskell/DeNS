# SYNOPSIS.
#   dens-pdns-backend
#
# DESCRIPTION.
#   `dens-pdns-backend` is a remote backend for PowerDNS which is compatible
#   with the RRs stored by
#
# ENVIRONMENT.
#   - DENS_QUERY_CONFIG must be set to a file path containing a JSON
#     configuration file
{ inputs, lib, ... }:
{
  imports =
    [
    ];
  config = {
    perSystem = { system, config, pkgs, ... }:
      let
        tsFlake = inputs.flake-lang.lib.${system}.typescriptFlake {
          name = "dens-pdns-backend";
          src = ./.;
          inherit (config.settings)
            devShellTools
            devShellHook;

          testTools = [ pkgs.postgresql ];

          npmExtraDependencies =
            [
              # inputs.prelude-typescript.packages.${system}.lib
              # inputs.plutus-ledger-api-typescript.packages.${system}.lib
            ];
        };
      in
      {

        packages = {

          # Executable
          dens-pdns-backend = tsFlake.packages.dens-pdns-backend-typescript-exe.overrideAttrs (_self: super:
            {
              buildInputs = super.buildInputs ++ [ pkgs.makeWrapper ];
              postFixup =
                ''
                  ${super.postFixup or ""}

                  wrapProgram $out/bin/dens-pdns-backend-cli \
                      --set DENS_QUERY_INIT_SQL_FILE ${
                            # Awkwardness since Hercules CI doesn't like
                            # depending on files in the nix store at run time,
                            # and instead prefers derivations
                            pkgs.runCommand "dens-sql"  { SQL_FILE = ./api/postgres/dens.sql; } ''
                                cp "$SQL_FILE" "$out"
                            ''
                        }
                '';
            });

          # User manual
          # dens-pdns-backend-manual = pkgs.stdenv.mkDerivation {
          #   name = "dens-pdns-backend-manual";
          #   nativeBuildInputs = [ pkgs.nodejs pkgs.asciidoctor ];
          #   src = ./.;
          #   buildPhase =
          #     ''
          #       npm run doc-manual
          #     '';
          #   installPhase =
          #     ''
          #       mkdir -p "$out/share/doc"
          #       mv index.html "$out/share/doc"
          #     '';
          # };
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

        inherit (tsFlake) checks;
      };
  };
}
