# `./settings.nix` contains project wide settings such as
#   
#   - `perSystem.settings.devShellTools`: packages to include in every developer shell
#   e.g. pre-commit tools
# 
#   - `perSystem.settings.devShellHook`: shell script to invoke in all devShells (e.g.
#   to ensure that pre-commit hooks are installed properly)
#
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
            };
          };

          config = {
            settings.devShellTools =
              [
                # Note(jaredponn): Include other useful developer devShellTools
                # that should be available for _all_ dev shells here
              ];

            settings.devShellHook =
              ''
                # Install the pre-commit hook
                ${config.pre-commit.installationScript}
              '';
          };
        }
      );

  };
}
