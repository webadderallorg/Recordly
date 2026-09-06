{
  description = "Recordly Nix packages";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      version = "1.2.1";

      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "x86_64-linux"
      ];

      forAllSystems = nixpkgs.lib.genAttrs systems;

      releaseHashes = {
        aarch64-darwin = {
          arch = "arm64";
          extension = "zip";
          hash = "sha256-0Mk+ha3n2RA9LtwdoCele82666a4NCLylMruTFGS7C4=";
        };
        x86_64-darwin = {
          arch = "x64";
          extension = "zip";
          hash = "sha256-PRG1DOX9sy9AJCC1/haEWlcNGkBiO9zicf9ng6Ix8fw=";
        };
        x86_64-linux = {
          arch = "linux-x64";
          extension = "AppImage";
          hash = "sha256-r+yUa1XuDnNQISSXE8AyFPC8uWlYkzPL+w85O0XaVPM=";
        };
      };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          recordly = pkgs.callPackage ./nix/package.nix {
            inherit version releaseHashes;
          };
          default = self.packages.${system}.recordly;
        }
      );

      apps = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          recordly = self.packages.${system}.recordly;
        in
        {
          recordly = {
            type = "app";
            program =
              if pkgs.stdenvNoCC.hostPlatform.isDarwin then
                "${pkgs.writeShellScript "recordly" ''
                  exec /usr/bin/open ${recordly}/Applications/Recordly.app --args "$@"
                ''}"
              else
                "${recordly}/bin/recordly";
            meta.description = "Launch Recordly";
          };
          default = self.apps.${system}.recordly;
        }
      );
    };
}
