{ inputs, ... }:
{
  config = {
    perSystem = { system, config, ... }:
      let
        tsFlake = inputs.flake-lang.lib.${system}.typescriptFlake {
          name = "tx-builder";
          src = ./.;
          inherit (config.settings)
            devShellTools
            devShellHook;
        };
      in
      {
        packages = {
          inherit (tsFlake.packages)
            tx-builder-typescript
            tx-builder-typescript-tgz;
        };

        # When developing, in this directory, run
        # ```bash
        # nix develop .#tx-builder-typescript
        # ```
        # and it'll give you some goodies (`node_modules/` for dependencies +
        # `./extra-dependencies`).
        devShells = {
          inherit (tsFlake.devShells) tx-builder-typescript;
        };

        inherit (tsFlake) checks;
      };
  };
}
