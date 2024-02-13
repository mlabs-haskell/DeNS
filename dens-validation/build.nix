{ inputs, ... }:
{
  imports = [ ./api/lbf/build.nix ];

  perSystem = { config, system, ... }:
    let
      hsFlake = inputs.flake-lang.lib.${system}.haskellPlutusFlake {
        src = ./.;
        name = "dens-validation";

        inherit (config.settings.haskell) index-state compiler-nix-name;

        dependencies =
          [
            # Plutarch
            "${inputs.plutarch}"

            # LambdaBuffers Plutarch support
            "${inputs.lambda-buffers.packages.${system}.lbf-prelude-plutarch}"
            "${inputs.lambda-buffers.packages.${system}.lbf-plutus-plutarch}"
            "${inputs.lambda-buffers.packages.${system}.lbr-plutarch-src}"

            # PSM
            "${inputs.psm}"

            # Api
            "${config.packages.lbf-dens-plutarch}"
          ];

        inherit (config.settings) devShellTools;
        inherit (config.settings) devShellHook;
      };
    in
    {
      packages = {
        dens-validation-cli = hsFlake.packages."dens-validation:exe:dens-validation-cli";
      };

      devShells = {
        dens-validation = hsFlake.devShell;
        default = hsFlake.devShell;
      };
    };
}
