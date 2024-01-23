# `./settings.nix` contains project wide settings such as
#   
#   - `perSystem.shell.tools`: packages to include in every developer shell
#   e.g. pre-commit tools
# 
#   - `perSystem.shell.hooks`: shell script to invoke in all devShells (e.g.
#   to ensure that pre-commit hooks are installed properly)
#
{ flake-parts-lib, lib, ... }:
{

  options = {
    perSystem = flake-parts-lib.mkPerSystemOption
      ({ config, pkgs, ... }:
        {
          options = {
            settings = {
              tools = lib.mkOption {
                type = lib.types.listOf lib.types.package;
                description = ''
                  Tools to be included in all devshells.
                '';
              };
              hook = lib.mkOption {
                type = lib.types.str;
                description = ''
                  Shell script to be invoked in all devshells.
                '';
              };
            };
          };

          config = {
            settings.tools =
              [
                # Note(jaredponn): Include other useful developer tools
                # that should be available for _all_ dev shells here
                pkgs.hello
              ]
              ++
              lib.filterAttrs (_key: value: value.enable) config.precommit.hooks
            ;

            settings.hook =
              ''
                ${lib.escapeShellArg config.pre-commit.installationScript}
              '';
          };
        }
      );

  };
}
