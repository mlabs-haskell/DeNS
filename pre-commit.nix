{ inputs, ... }: {
  imports = [ inputs.pre-commit-hooks-nix.flakeModule ];
  perSystem = { config, ... }: {
    devShells.dev-pre-commit = config.pre-commit.devShell;
    pre-commit.settings = {
      hooks = {
        nixpkgs-fmt.enable = true;
        deadnix.enable = true;
        typos.enable = true;
        markdownlint.enable = true;
      };
    };
  };
}
