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

        devShells = {
          inherit (tsFlake.devShells) tx-builder-typescript;
        };

        inherit (tsFlake) checks;
      };
  };
}
