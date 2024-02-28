{ inputs, ... }:
{
  perSystem = { system, ... }:
    let
      lbf-dens-args = {
        name = "lbf-dens";
        src = ./.;
        files = [ "Dens.lbf" ];
      };

    in
    {
      packages = {
        lbf-dens-plutarch = inputs.lambda-buffers.lib.${system}.lbfPlutarch lbf-dens-args;
        lbf-dens-typescript = inputs.lambda-buffers.lib.${system}.lbfPlutusTypescript lbf-dens-args;
      };
    };
}
