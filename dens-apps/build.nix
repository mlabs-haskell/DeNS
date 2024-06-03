# Glue code for putting the system together
{ config, ... }:
{
  imports = [
    ./ogmios/build.nix
    ./cardano-node/build.nix
    ./pdns/build.nix
  ];

  config = {
    # TODO(jaredponn): move all the images here
    # flake.flakeModules.default = {
    #     perSystem = { pkgs, system, ... }: {
    #         packages = {
    #             myPackage = config.${system}.dens-query-cli;
    #         };
    #     };
    # };

    perSystem = { pkgs, config, ... }: {
      packages = {
        cardano-node-preview-testnet-config = pkgs.stdenv.mkDerivation {
          name = "cardano-node-preview-testnet-config";

          nativeBuildInputs = [ pkgs.curl pkgs.cacert ];

          # outputHash = pkgs.lib.fakeHash;
          outputHash = "sha256-wJYCGAonfJNUnzt/M4Q6POpe30tqD5sEVzdnasUq/50=";
          outputHashMode = "recursive";

          dontUnpack = true;

          installPhase = ''
            mkdir -p "$out"

            pushd "$out"

            curl -O -J https://book.world.dev.cardano.org/environments/preview/config.json
            curl -O -J https://book.world.dev.cardano.org/environments/preview/db-sync-config.json
            curl -O -J https://book.world.dev.cardano.org/environments/preview/submit-api-config.json
            curl -O -J https://book.world.dev.cardano.org/environments/preview/topology.json
            curl -O -J https://book.world.dev.cardano.org/environments/preview/byron-genesis.json
            curl -O -J https://book.world.dev.cardano.org/environments/preview/shelley-genesis.json
            curl -O -J https://book.world.dev.cardano.org/environments/preview/alonzo-genesis.json
            curl -O -J https://book.world.dev.cardano.org/environments/preview/conway-genesis.json

            popd
          '';

        };

        cardano-node-preview-testnet-image = pkgs.dockerTools.buildImage {
          name = "cardano-node-preview-testnet";
          tag = "latest";

          copyToRoot = pkgs.buildEnv {
            name = "cardano-node-preview-testnet-root";
            paths = [ pkgs.bash pkgs.coreutils config.packages.cardano-node config.packages.cardano-cli ];
            pathsToLink = [ "/bin" ];
          };

          created = "now";

          runAsRoot = ''
            #!${pkgs.runtimeShell}

            mkdir -p /etc/cardano-node

            pushd /etc/cardano-node
                    
            cp -r ${config.packages.cardano-node-preview-testnet-config}/. .

            popd
          '';

          config = {
            Cmd = [
              "/bin/cardano-node"
              "run"
              "--topology"
              "/etc/cardano-node/topology.json"
              "--database-path"
              "/var/cardano-node/db"
              "--socket-path"
              "/ipc/cardano-node/node.socket"
              "--config"
              "/etc/cardano-node/config.json"
            ];
          };
        };

        ogmios-image = pkgs.dockerTools.buildImage {
          name = "ogmios";
          tag = "latest";
          created = "now";

          copyToRoot = pkgs.buildEnv {
            name = "ogmios-image-root";
            paths = [ pkgs.bash pkgs.coreutils config.packages.ogmios pkgs.curl ];
            pathsToLink = [ "/bin" ];
          };

          config = {
            Cmd = [ "/bin/ogmios" "--host" "0.0.0.0" "--port" "1337" "--node-socket" "/ipc/cardano-node/node.socket" "--node-config" "/etc/cardano-node/config.json" ];
          };
        };

        # Docker image for dens-query
        dens-query-image = pkgs.dockerTools.buildImage {
          name = "dens-query";
          tag = "latest";
          created = "now";

          copyToRoot = pkgs.buildEnv {
            name = "dens-query-image-root";
            paths = [ pkgs.bash pkgs.coreutils config.packages.dens-query-cli config.packages.dens-transactions-cli pkgs.curl ];
            pathsToLink = [ "/bin" ];
          };

          runAsRoot = ''
            #!${pkgs.runtimeShell}

            mkdir -p /etc/dens-query

            cp ${../dens-query/doc/example-config.json} /etc/dens-query/config.json
          '';

          config = {
            Env = [ "NODE_ENV=production" "DENS_QUERY_CONFIG=/etc/dens-query/config.json" ];
            Cmd = [ "/bin/dens-query-cli" ];
          };
        };

        dens-pdns-image = pkgs.dockerTools.buildImage {
          name = "dens-pdns";
          tag = "latest";
          created = "now";

          copyToRoot = pkgs.buildEnv {
            name = "dens-pdns-image-root";
            paths = [ pkgs.bash pkgs.coreutils pkgs.pdns pkgs.dig ];
            pathsToLink = [ "/bin" ];
          };

          runAsRoot = ''
            #!${pkgs.runtimeShell}

            mkdir -p /etc/pdns
            mkdir -p /ipc/pdns

            cp ${./pdns/pdns.conf} /etc/pdns/pdns.conf
          '';

          config = {
            Cmd = [ "/bin/pdns_server" "--config-dir=/etc/pdns" "--socket-dir=/ipc/pdns" "--local-port=5353" ];
          };
        };

        dens-pdns-backend-image = pkgs.dockerTools.buildImage {
          name = "dens-pdns-backend";
          tag = "latest";
          created = "now";

          runAsRoot = ''
            #!${pkgs.runtimeShell}

            mkdir -p /ipc/dens-pdns-backend
          '';

          copyToRoot = pkgs.buildEnv {
            name = "dens-pdns-backend-image-root";
            paths = [ pkgs.bash pkgs.coreutils config.packages.dens-pdns-backend pkgs.netcat-openbsd ];
            pathsToLink = [ "/bin" ];
          };

          config = {
            Env = [
              "SOCKET_PATH=/ipc/dens-pdns-backend/dens-pdns-backend.sock"
              "PGHOST=/ipc/postgres"
              "PGUSER=dens"
              "PGPASSWORD="
              "PGDATABASE=dens"
            ];
            Cmd = [ "/bin/dens-pdns-backend-cli" ];
          };
        };

        dens-query-postgres-image = pkgs.dockerTools.buildImage {
          name = "dens-query-postgres";
          tag = "latest";
          created = "now";

          copyToRoot = pkgs.buildEnv {
            name = "dens-query-postgres-image-root";
            paths = [ pkgs.bash pkgs.su pkgs.postgresql pkgs.less pkgs.coreutils ];
            pathsToLink = [ "/bin" "/share" ];
          };

          runAsRoot = ''
            #!${pkgs.runtimeShell}

            ${pkgs.dockerTools.shadowSetup}
            groupadd -r postgres
            useradd -r -g postgres postgres
                
            mkdir -p /var/postgres
            mkdir -p /ipc/postgres

            pushd /var/postgres

            chown postgres:postgres /var/postgres
            chown postgres:postgres /ipc/postgres

            su --command 'pg_ctl init -D .' postgres
            su --command 'pg_ctl start -D . -o "-k /ipc/postgres" -o "-h \"\""' postgres

            # Create the user/database dens
            su --command 'createuser -h /ipc/postgres -d -r dens' postgres
            su --command 'createdb -h /ipc/postgres -O dens dens' postgres

            su --command 'pg_ctl stop -D .' postgres

            popd
          '';

          config = {
            Cmd = [ "/bin/postgres" "-h" "*" "-D" "/var/postgres" "-k" "/ipc/postgres" ];
            User = "postgres:postgres";
          };
        };

      };
    };
  };
}
