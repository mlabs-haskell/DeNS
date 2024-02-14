# `./settings.nix` contains project wide settings such as
#   
#   - `perSystem.settings.devShellTools`: packages to include in every developer shell
#   e.g. pre-commit tools
# 
#   - `perSystem.settings.devShellHook`: shell script to invoke in all devShells (e.g.
#   to ensure that pre-commit hooks are installed properly)
#
#   - `perSystem.haskell.index-state`, `perSystem.haskell.compiler-nix-name`:
#   for haskell.nix
{ flake-parts-lib, lib, ... }:
{

  options = {
    perSystem = flake-parts-lib.mkPerSystemOption
      ({ config, ... }:
        {
          options = {
            settings = {
              devShellTools = lib.mkOption {
                type = lib.types.listOf lib.types.package;
                description = ''
                  Tools to be included in all devshells.
                '';
              };
              devShellHook = lib.mkOption {
                type = lib.types.str;
                description = ''
                  Shell script to be invoked in all devshells.
                '';
              };

              haskell.index-state = lib.mkOption {
                type = lib.types.str;
                description = "Hackage index state to use when making a haskell.nix build environment";
              };
              haskell.compiler-nix-name = lib.mkOption {
                type = lib.types.str;
                description = "GHC Haskell compiler to use when building haskell.nix projects";
              };
            };
          };

          config = {
            settings = {
              # haskell.index-state = "2024-01-16T11:00:00Z";
              haskell.compiler-nix-name = "ghc963";
              haskell.index-state = "202211-16T11:00:00Z";
              # haskell.compiler-nix-name = "ghc8107";
              # haskell.index-state = "2022-05-18T00:00:00Z";

              devShellTools =
                [
                  # Note(jaredponn): Include other useful developer devShellTools
                  # that should be available for _all_ dev shells here
                ];

              devShellHook =
                ''
                  # Install the pre-commit hook
                  ${config.pre-commit.installationScript}
                '';
            };
          };
        }
      );

  };
}
