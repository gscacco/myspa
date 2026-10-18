{
  description = "Toolchain Node.js fissata per Foglio";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      eachSystem = nixpkgs.lib.genAttrs systems;
    in {
      devShells = eachSystem (system: {
        default = let
          pkgs = import nixpkgs { inherit system; };
        in pkgs.mkShell {
          packages = [ pkgs.nodejs_24 ];
        };
      });
    };
}
