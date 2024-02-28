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
            devShellHook;

          # TODO(jaredponn): update  `flake-lang` later so we don't have this
          # awkwardness
          devShellTools = config.settings.devShellTools ++ [ pkgs.postgresql ];
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
                      --set-default cat meow
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
