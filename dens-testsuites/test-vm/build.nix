# Flake module used to create test virtual machines with all the RTS services.
{ inputs, config, ... }: {

  perSystem = { system, ... }:
    let
      preview-rts-vm =
        inputs.nixpkgs.lib.nixosSystem {
          inherit system;
          modules =
            [
              # Test specific vm modules
              ./configuration.nix
              "${inputs.nixpkgs}/nixos/modules/virtualisation/qemu-vm.nix"

              # Modules needed for the runtime
              "${inputs.nixpkgs}/nixos/modules/services/databases/postgresql.nix"
              config.flake.nixosModules.ogmios
              config.flake.nixosModules.cardano-node
            ];
        };
    in
    {
      # A VM for testing which contains runs the following (accessible from
      # localhost):
      #     - ogmios on port 1337
      #     - postgres on port 5432
      #     - ssh on port 6969
      # To build, use the usual nix mechanisms
      # ```
      # nix build .#test-vm
      # ```
      # and to run it, run the executable in the resulting `./result/bin/`
      # symlink.
      # How to's:
      # - How do I SSH in?
      #   ```
      #   ssh -p 6969 dens@127.0.0.1
      #   ```
      # - How do I connect to postgres via PSQL?
      #   ```
      #   psql -h 127.0.0.1 -p 6969 -U dens
      #   ```
      # - How do I see ogmios' dashboard? In the browser, type:
      #   ```
      #   127.0.0.1:1337
      #   ```
      packages.test-vm = preview-rts-vm.config.system.build.vm;
    };
}
