{ inputs, ... }: {
  imports = [ inputs.pre-commit-hooks-nix.flakeModule ];
  perSystem = { config, ... }: {
    devShells.pre-commit = config.pre-commit.devShell;
    pre-commit.settings = {
      hooks = {
        nixpkgs-fmt.enable = true;
        deadnix.enable = true;
        typos.enable = true;
        markdownlint.enable = true;
        denofmt = {
          enable = true;
          # Note(jaredponn): We follow the default files this formats, except
          # we exclude markdown files. See  
          #   [1] https://docs.deno.com/runtime/manual/tools/formatter
          files = ''^.*\.(js|ts|jsx|tsx|json|jsonc)$'';
        };
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
