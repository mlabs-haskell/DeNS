{ inputs, ... }:
{
  perSystem = { config, system, ... }:
    let
      lbf-dens-config = builtins.toFile "lbf-dens-config.json"
        (builtins.toJSON
          {
            opaquesConfig = {
              "Dens.Db.Protocol" = [
                "lbf-dens/LambdaBuffers/Dens.mjs"
                "LbfDens"
                "Protocol"
              ];
              "Dens.Db.DensRr" = [
                "lbf-dens/LambdaBuffers/Dens.mjs"
                "LbfDens"
                "DensRr"
              ];
            };
            classesConfig = { };
          }
        );

      lbf-dens-db-args = {
        name = "lbf-dens-db";
        src = ./.;
        files = [ "Dens/Db.lbf" "Dens/Config.lbf" "Dens/Server.lbf" ];
        configs = [ lbf-dens-config ];
        npmExtraDependencies = [ config.packages.lbf-dens-typescript ];
      };

    in
    {
      packages = {
        lbf-dens-db-typescript = inputs.lambda-buffers.lib.${system}.lbfPlutusTypescript lbf-dens-db-args;
      };
    };
}
