{ config, pkgs, lib, ... }:
{
  boot.loader = {
    systemd-boot.enable = true;
    efi.canTouchEfiVariables = true;
  };


  ######################
  # VM setup
  ######################
  virtualisation = {
    # 2^14 MB (about 16GB) of disk space
    diskSize = 16384;
    # 2^12 MB (about 4GB) of RAM
    memorySize = 4096;

    # We need to allow the following ports s.t. the vm can talk to the
    # outside world via things like
    # ```
    # 127.0.0.1:<config.services.ogmios.port>
    # ```
    forwardPorts =
      [
        {
          from = "host";
          guest.port = config.services.ogmios.port;

          host.port = config.services.ogmios.port;
        }
        {
          from = "host";
          guest.port = config.services.postgresql.port;
          host.port = config.services.postgresql.port;
        }
        {
          # This allows ssh in the vm via port 6969
          # with something like
          # ```
          # ssh -p 6969 alice@127.0.0.1
          # ```
          from = "host";
          guest.port = 22;
          host.port = 6969;
        }
      ];
  };

  ######################
  # Create a user named `alice` w/o a password
  ######################
  users.users.alice = {
    isNormalUser = true;
    extraGroups = [ "wheel" ]; # Enable `sudo` for the user.
    packages = with pkgs; [
    ];
    initialPassword = "";
  };

  ######################
  # Services
  ######################
  services =
    {
      # Remove bloat
      xserver = {
        enable = false;
        displayManager.gdm.enable = false;
        desktopManager.gnome.enable = false;
      };

      # Enable ssh
      openssh = {
        enable = true;
        settings.PermitRootLogin = "yes";
      };

      # Enable postgres
      postgresql = {
        enable = true;
        port = 5432;
        ensureDatabases = [ "alice" ];
        settings = {
          # Listen on all addresses
          listen_addresses = lib.mkForce "*";
        };
        ensureUsers =
          [
            {
              name = "alice";
              ensureClauses = {
                login = true;
                createdb = true;
              };
            }
          ];
        # # https://www.postgresql.org/docs/current/auth-pg-hba-conf.html
        authentication = pkgs.lib.mkOverride 10
          ''
            # Allow anyone (yes anyone!) to connect to the database
            # TYPE  DATABASE        USER            ADDRESS                 METHOD
            local   all             all                                     trust
            host    all             all             0.0.0.0/0               trust
            host    all             all             ::0/0                   trust
          '';
      };


      # Enable the cardano node
      cardano-node = {
        enable = true;
        environment = "preview";
        hostAddr = "0.0.0.0";
        systemdSocketActivation = true;
        # `useNewTopology` is incompatible with systemdSocketActivation.
        useNewTopology = false;
        useSystemdReload = true;
        # TODO(jaredponn): just pull the config
        # files directly from: https://github.com/input-output-hk/cardano-configurations
        # instead of patching up same cases that
        # seem to be forgotten about e.g. not using
        # P2P since we want to use systemd sockets...
        extraNodeConfig.EnableP2P = false;
      };

      # Enable ogmios
      ogmios = {
        enable = true;
        nodeSocket = config.services.cardano-node.socketPath 0;
        # TODO(jaredponn): bit of a hack -- the
        # cardano-node people don't actually expose
        # the file they use for the node config, so
        # we reconstruct it (well the parts that
        # ogmios needs) ourselves
        # Use this:
        # https://github.com/input-output-hk/cardano-configurations
        nodeConfig = builtins.toFile "node-config.json"
          (builtins.toJSON config.services.cardano-node.cardanoNodePackages.cardanoLib.environments.${config.services.cardano-node.environment}.nodeConfig);
        host = "0.0.0.0";
        port = 1337; # explicitly write out the default port
      };
    };

  # Add ogmios to cardano-node's group s.t.
  # ogmios has sufficient permissions to read the socket.
  users.users.ogmios.extraGroups = [ config.services.cardano-node.socketGroup ];

  # Ensure that ogmios starts after the
  # cardano-node is available so the socket
  # actually exists
  systemd.services.ogmios.after = [ "cardano-node.service" ];

  ######################
  # Networking setup
  ######################
  networking = {
    firewall = {
      allowedTCPPorts = [
        # ssh
        22
        # ogmios
        config.services.ogmios.port
        # postgres
        config.services.postgresql.port
      ];
    };
  };

  ######################
  # Sane environment in the vm
  ######################
  environment = {
    variables = {
      EDITOR = "vim";
      VISUAL = "vim";
    };
    systemPackages =
      [
        pkgs.vim
        pkgs.ogmios
        config.services.cardano-node.cardanoNodePackages.cardano-node
        config.services.cardano-node.cardanoNodePackages.cardano-cli
      ];
  };

  system.stateVersion = "23.11";
}
