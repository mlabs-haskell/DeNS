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
        denofmt.enable = true;
        denolint.enable = true;
      };

      settings = {
        markdownlint.config = {
          # Disable rule for lines longer than 80 characters
          "MD013" = false;
        };
        typos = {
          # Disable typo checking for markdown files (per @gnumonik's request
          # since it doesn't like technical terms)
          exclude = "*.md";
        };
      };
    };
  };
}
