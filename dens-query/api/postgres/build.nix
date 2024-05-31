_:
{
  perSystem = { pkgs, ... }:
    {
      packages = {
        # Short derivation for the SQL file
        dens-query-postgres-schema = pkgs.runCommand "dens-query-postgres-schema" { SQL_FILE = ./dens.sql; } ''
          cp "$SQL_FILE" "$out"
        '';
      };
    };
}
