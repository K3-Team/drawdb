{
  lib,
  buildNpmPackage,
  importNpmLock,
  nodejs,
  python3,
  makeWrapper,
}:

buildNpmPackage {
  pname = "drawdb";
  version = "0.0.0";

  src = lib.cleanSourceWith {
    src = ./..;
    filter =
      path: type:
      let
        base = baseNameOf path;
      in
      !(builtins.elem base [
        "node_modules"
        "dist"
        "docs"
        "result"
        ".git"
        ".direnv"
        "flake.nix"
        "flake.lock"
        "nix"
      ]);
  };

  inherit nodejs;

  npmDeps = importNpmLock { npmRoot = ./..; };
  npmConfigHook = importNpmLock.npmConfigHook;

  nativeBuildInputs = [
    python3 # node-gyp needs a python interpreter for better-sqlite3
    makeWrapper
  ];

  env = {
    NODE_OPTIONS = "--max-old-space-size=4096";
  };

  installPhase = ''
    runHook preInstall

    npm prune --omit=dev

    mkdir -p $out/lib/drawdb/src $out/bin
    cp -r dist server node_modules package.json $out/lib/drawdb/
    # The server imports the shared protocol from src/collaboration.
    cp -r src/collaboration $out/lib/drawdb/src/

    makeWrapper ${nodejs}/bin/node $out/bin/drawdb \
      --add-flags $out/lib/drawdb/server/index.js

    runHook postInstall
  '';

  meta = {
    description = "Collaborative ER diagram editor and SQL generator";
    mainProgram = "drawdb";
    platforms = lib.platforms.linux;
  };
}
