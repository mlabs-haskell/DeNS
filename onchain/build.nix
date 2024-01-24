{ ... }:
{
  imports = [ ./api/lbf/build.nix ];

  perSystem = { config, ... }:
    {
      packages = {
        remove-me-later-this-is-just-an-example-to-show-how-to-access-the-compiled-lbf-dens-schema =
          config.packages.lbf-dens-plutarch;
      };

      devShells = {
        # When writing the devShells, remember to run 
        # ```
        # config.devShellHook
        # ```
        # in the `shellHook`; and include 
        # ```
        # config.devShellTools
        # ```
        # in the `buildInputs`.
      };

    };
}
