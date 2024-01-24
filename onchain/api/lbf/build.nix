{ inputs, ... }:
{
  perSystem = { system, ... }:
    let
      lbf-dens-args = {
        name = "lbf-dens";
        src = ./.;
        files = [ "DeNS.lbf" ];
      };

    in
    {
      packages = {
        lbf-dens-plutarch = inputs.lambda-buffers.lib.${system}.lbfPlutarch lbf-dens-args;
      };
    };
}
