{ inputs, ... }:
{
  config = {
    perSystem = { system, config, ... }:
      let
        tsFlake = inputs.flake-lang.lib.${system}.typescriptFlake {
          name = "chain-indexer";
          src = ./.;
          inherit (config.settings)
            devShellTools
            devShellHook;
        };
      in
      {
        packages = {
          inherit (tsFlake.packages)
            chain-indexer-typescript
            chain-indexer-typescript-tgz;
        };

        # When developing, in this directory, run
        # ```bash
        # nix develop .#chain-indexer-typescript
        # ```
        # and it'll give you some goodies (`node_modules/` for dependencies +
        # `./extra-dependencies`).
        devShells = {
          inherit (tsFlake.devShells) chain-indexer-typescript;
        };

        inherit (tsFlake) checks;
      };
  };
}
