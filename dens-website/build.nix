_: {

  imports = [ ];

  config = {
    perSystem = { config, pkgs, ... }: {
      packages = {
        dens-website = pkgs.stdenv.mkDerivation {
          name = "dens-website";
          nativeBuildInputs = [
            pkgs.go
            pkgs.git
            pkgs.hugo
            pkgs.asciidoctor
            pkgs.nodejs
          ];

          src = ../.;

          NODE_MODULES = "${(pkgs.callPackage "${config.packages.dens-website-node2nix}/default.nix" { }).nodeDependencies}/lib/node_modules";
          HUGO_MODULES = "${config.packages.dens-website-hugo-modules}/_vendor";

          configurePhase = ''
            pushd dens-website

            ln -s "$NODE_MODULES" node_modules
            ln -s "$HUGO_MODULES" _vendor

            popd
          '';


          buildPhase = ''
            pushd dens-website

            hugo

            popd
          '';
          installPhase = '' 
                        pushd dens-website

                        mkdir -p "$out"
                        cp -r public/. "$out"

                        popd
                    '';

        };

        dens-website-node2nix = pkgs.stdenv.mkDerivation {
          name = "dens-website-node2nix";
          nativeBuildInputs = [ pkgs.node2nix ];

          srcs = [ ./package.json ./package-lock.json ];

          unpackPhase = ''
            for srcFile in $srcs
            do
                cp "$srcFile" "$(stripHash "$srcFile")"
            done
          '';

          buildPhase = ''
            node2nix --development --lock package-lock.json --input package.json
          '';

          installPhase = ''
            mkdir -p "$out"
            cp package.json package-lock.json node-packages.nix default.nix node-env.nix "$out"
          '';
        };

        # Vendor the modules from hugo i.e., fetch them in a separate
        # derivation.
        # TODO(jaredponn): is this really deterministic? It's not clear
        # to me from the docs that this should be...
        dens-website-hugo-modules = pkgs.stdenv.mkDerivation {
          name = "dens-website-hugo-modules";
          nativeBuildInputs = [ pkgs.go pkgs.hugo pkgs.git ];
          # outputHash = pkgs.lib.fakeHash;
          outputHash = "sha256-cLCrY2yEkN6rJTUZUM29bBk/H/RgwCXa60KqMq7FEz0=";
          outputHashMode = "recursive";
          src = ./.;

          buildPhase = ''
            hugo mod vendor
          '';

          installPhase = ''
            mkdir -p "$out"
            cp -r _vendor "$out"
          '';
        };


      };
    };
  };
}
