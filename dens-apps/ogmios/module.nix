# Module for a ogmios systemd unit.
{ pkgs, config, lib, ... }:
let
  cfg = config.services.ogmios;
  ogmios = cfg.package;
in
{
  options = {
    services.ogmios = {
      enable = lib.mkEnableOption (lib.mdDoc "ogmios");

      # executable to use for ogmios
      package = lib.mkPackageOption pkgs "ogmios" {
        default = "ogmios";
      };

      nodeSocket = lib.mkOption
        {
          type = lib.types.str;
          description = lib.mdDoc ''
            Path to the node socket.
          '';
          example = lib.mdDoc ''
            path/to/db/node.socket
          '';
        };

      nodeConfig = lib.mkOption
        {
          type = lib.types.str;
          description = lib.mdDoc ''
            Path to the node configuration file.
          '';
          example = lib.mdDoc ''
            path/to/db/config.json
          '';
        };

      host = lib.mkOption
        {
          type = lib.types.str;
          default = "127.0.0.1";
          description = lib.mdDoc ''
            Address to bind to. 
          '';
        };

      port = lib.mkOption
        {
          type = lib.types.port;
          default = 1337;
          description = lib.mdDoc ''
            Port to listen on.
          '';
        };

      timeout = lib.mkOption
        {
          type = lib.types.int;
          default = 90;
          description = lib.mdDoc ''
            Number of seconds of inactivity after which the server should close client connections.
          '';
        };

      maxInFlight = lib.mkOption
        {
          type = lib.types.int;
          default = 1000;
          description = lib.mdDoc ''
            Max number of ChainSync requests which can be pipelined at once. Only applies to the chain-sync protocol.
          '';
        };
      includeCbor = lib.mkOption
        {
          type = lib.types.bool;
          default = false;
          description = lib.mdDoc ''
            In chain-synchronization, always include a 'cbor' field for transaction, metadata and scripts that contain the original binary serialized representation of each object.
          '';
        };

      includeMetadataCbor = lib.mkOption
        {
          type = lib.types.bool;
          default = false;
          description = lib.mdDoc ''
            In chain-synchronization, always include a 'cbor' field for all metadata containing the original binary serialized representation of that metadata. Otherwise, the field is only present when the metadata can't be safely represented as JSON.
          '';
        };
      includeScriptCbor = lib.mkOption
        {
          type = lib.types.bool;
          default = false;
          description = lib.mdDoc ''
            In chain-synchronization, always include a 'cbor' field for all phase-1 native scripts that contain the original binary serialized representation of that script.
          '';
        };

      logLevel = lib.mkOption
        {
          type = lib.types.nullOr (lib.types.enum [ "Debug" "Info" "Notice" "Warning" "Error" "Off" ]);
          default = "Info";
          description = lib.mdDoc ''
            Minimal severity of all log messages.
                - Debug
                - Info
                - Notice
                - Warning
                - Error
            Or alternatively, to turn a logger off:
                - Off
          '';
        };
      logLevelHealth = lib.mkOption
        {
          type = lib.types.nullOr (lib.types.enum [ "Debug" "Info" "Notice" "Warning" "Error" "Off" ]);
          default = null;
          description = lib.mdDoc ''
            Minimal severity of health log messages.
          '';
        };
      logLevelMetrics = lib.mkOption
        {
          type = lib.types.nullOr (lib.types.enum [ "Debug" "Info" "Notice" "Warning" "Error" "Off" ]);
          default = null;
          description = lib.mdDoc ''
            Minimal severity of metrics log messages.
          '';
        };

      logLevelWebsocket = lib.mkOption
        {
          type = lib.types.nullOr (lib.types.enum [ "Debug" "Info" "Notice" "Warning" "Error" "Off" ]);
          default = null;
          description = lib.mdDoc ''
            Minimal severity of websocket log messages.
          '';
        };

      logLevelServer = lib.mkOption
        {
          type = lib.types.nullOr (lib.types.enum [ "Debug" "Info" "Notice" "Warning" "Error" "Off" ]);
          default = null;
          description = lib.mdDoc ''
            Minimal severity of server log messages.
          '';
        };

      logLevelOptions = lib.mkOption
        {
          type = lib.types.nullOr (lib.types.enum [ "Debug" "Info" "Notice" "Warning" "Error" "Off" ]);
          default = null;
          description = lib.mdDoc ''
            Minimal severity of options log messages.
          '';
        };
    };
  };

  config = lib.mkIf cfg.enable {
    assertions =
      [
        { assertion = ogmios != null; message = "Ogmios is missing. Perhaps you need to add ogmios via an overlay to `nixpkgs`"; }
        {
          assertion = !(cfg.logLevel != null && (
            cfg.logLevelHealth != null
              || cfg.logLevelMetrics != null
              || cfg.logLevelWebsocket != null
              || cfg.logLevelServer != null
              || cfg.logLevelOptions != null
          )
          );
          message = "`logLevel` and any of `logLevelHealth`, `logLevelMetrics`, `logLevelWebsocket`, `logLevelServer`, or `logLevelOptions` cannot both be non null";
        }
      ];

    services.ogmios = {
      package = pkgs.ogmios;
    };
    # add ogmios to the environment
    environment.systemPackages = [ ogmios ];

    # set up a user for just ogmios
    users.users.ogmios = {
      name = "ogmios";
      group = "ogmios";
      description = "Ogmios server user";
      isSystemUser = true;
    };

    users.groups.ogmios = { };

    # systemd unit
    systemd.services.ogmios = {
      description = "Ogmios server";
      after = [ "network.target" ];
      wantedBy = [ "multi-user.target" ];

      serviceConfig =
        {
          User = "ogmios";
          Group = "ogmios";
          ExecStart = ''
            ${ogmios}/bin/ogmios ${lib.escapeShellArgs 
                    (
                    [ "--node-socket" cfg.nodeSocket
                      "--node-config" cfg.nodeConfig
                      "--host" cfg.host
                      "--port" cfg.port 
                      "--timeout" cfg.timeout
                      "--max-in-flight" cfg.maxInFlight
                    ]
                    ++ lib.optional cfg.includeCbor "--include-cbor" 
                    ++ lib.optional cfg.includeMetadataCbor "--include-metadata-cbor" 
                    ++ lib.optional cfg.includeScriptCbor "--include-script-cbor" 
                    ++ lib.optionals (cfg.logLevel != null) ["--log-level" cfg.logLevel]
                    ++ lib.optionals (cfg.logLevelHealth != null) [ "--log-level-health" cfg.logLevelHealth ]
                    ++ lib.optionals (cfg.logLevelMetrics != null) [ "--log-level-metrics" cfg.logLevelMetrics ]
                    ++ lib.optionals (cfg.logLevelWebsocket != null) [ "--log-level-websocket" cfg.logLevelWebsocket ]
                    ++ lib.optionals (cfg.logLevelServer != null) [ "--log-level-server" cfg.logLevelServer ]
                    ++ lib.optionals (cfg.logLevelOptions != null) [ "--log-level-options" cfg.logLevelOptions ]
                    )
                }
          '';
        };
    };
  };
}
