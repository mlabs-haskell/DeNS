{ inputs, ... }:
{
  config = {
    perSystem = { system, config, ... }:
      let
        tsFlake = inputs.flake-lang.lib.${system}.typescriptFlake {
          name = "dens-query";
          src = ./.;
          inherit (config.settings)
            devShellTools
            devShellHook;
        };
      in
      {

        packages = {
          # Executable
          dens-query-cli = tsFlake.packages.dens-query-typescript-exe;
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
