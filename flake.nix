{
  description = "drawDB — collaborative ER diagram editor";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];

      # nixpkgs instantiates importNpmLock's npmConfigHook against the *default*
      # nodejs (24.x today): the hook hardcodes npm_config_nodedir /
      # npm_config_node_gyp to that nodejs, so node-gyp compiles native modules
      # (better-sqlite3) against node 24 headers even when `nodejs = nodejs_22`
      # is passed to buildNodeModules. The resulting better_sqlite3.node then
      # fails to load under node 22 with an undefined v8 symbol. Overriding the
      # default nodejs in the package set makes hook and runtime agree.
      pkgsFor = system:
        nixpkgs.legacyPackages.${system}.extend (final: prev: { nodejs = prev.nodejs_22; });

      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f (pkgsFor system));
    in
    {
      packages = forAllSystems (pkgs: rec {
        # Spike target: builds node_modules only, so the native better-sqlite3
        # compile is isolated from the (slow) vite bundle step.
        node-modules = pkgs.importNpmLock.buildNodeModules {
          npmRoot = ./.;
          nodejs = pkgs.nodejs_22;
        };

        drawdb = pkgs.callPackage ./nix/package.nix {
          nodejs = pkgs.nodejs_22;
        };

        default = drawdb;
      });

      nixosModules.drawdb = import ./nix/module.nix self;
      nixosModules.default = self.nixosModules.drawdb;

      checks = forAllSystems (
        pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
          evaluated = nixpkgs.lib.nixosSystem {
            inherit system;
            modules = [
              self.nixosModules.default
              (
                { ... }:
                {
                  # Minimum needed to make a NixOS eval succeed off-host.
                  fileSystems."/" = {
                    device = "/dev/null";
                    fsType = "ext4";
                  };
                  boot.loader.grub.enable = false;
                  system.stateVersion = "25.05";
                  services.drawdb = {
                    enable = true;
                    allowedOrigins = [ "https://drawdb.example.com" ];
                    tokensFile = "/run/secrets/drawdb-tokens";
                  };
                }
              )
            ];
          };
          # config.assertions is inert unless something forces it — only
          # system.build.toplevel does, and we deliberately never build it.
          # checkAssertWarn is the same helper top-level.nix uses, so a failing
          # assertion aborts this check instead of passing silently.
          unit = nixpkgs.lib.asserts.checkAssertWarn
            evaluated.config.assertions
            evaluated.config.warnings
            evaluated.config.systemd.services.drawdb;
        in
        {
          # Forces evaluation of the generated unit, so option/type errors
          # surface without needing a real host (or its out-of-tree net.nix).
          module-eval = pkgs.writeText "drawdb-module-eval.json" (
            builtins.toJSON {
              execStart = unit.serviceConfig.ExecStart;
              loadCredential = unit.serviceConfig.LoadCredential;
              dynamicUser = unit.serviceConfig.DynamicUser;
              stateDirectory = unit.serviceConfig.StateDirectory;
              memoryDenyWriteExecute = unit.serviceConfig.MemoryDenyWriteExecute;
              environment = unit.environment;
            }
          );

          server-tests = pkgs.runCommand "drawdb-server-tests" {
            nativeBuildInputs = [ pkgs.nodejs_22 ];
          } ''
            cp -r ${self.packages.${system}.drawdb}/lib/drawdb/node_modules ./node_modules
            cp -r ${./server} ./server
            cp -r ${./src} ./src
            cp ${./package.json} ./package.json
            chmod -R u+w .
            # `node --test` treats an unmatched glob as "zero test files" and
            # exits 0, so a broken copy list would make this check silently
            # test nothing. failglob turns that into a hard build failure.
            shopt -s failglob
            node --test server/*.test.js
            touch $out
          '';

          mcp-tests = pkgs.runCommand "drawdb-mcp-tests" {
            nativeBuildInputs = [ pkgs.nodejs_22 ];
          } ''
            cp -r ${self.packages.${system}.drawdb}/lib/drawdb/node_modules ./node_modules
            cp -r ${./server} ./server
            cp -r ${./src} ./src
            cp -r ${./mcp} ./mcp
            cp ${./package.json} ./package.json
            chmod -R u+w .
            shopt -s failglob
            node --test mcp/*.test.js mcp/mutators/*.test.js
            touch $out
          '';

          import-tests = pkgs.runCommand "drawdb-import-tests" {
            nativeBuildInputs = [ pkgs.nodejs_22 ];
          } ''
            cp -r ${self.packages.${system}.drawdb}/lib/drawdb/node_modules ./node_modules
            cp -r ${./src} ./src
            cp ${./package.json} ./package.json
            chmod -R u+w .
            node --test src/utils/importSQL/normalize.test.js
            touch $out
          '';

          vitest = pkgs.runCommand "drawdb-vitest" {
            nativeBuildInputs = [ pkgs.nodejs_22 ];
          } ''
            cp -r ${self.packages.${system}.node-modules}/node_modules ./node_modules
            cp -r ${./src} ./src
            cp ${./package.json} ./package.json
            cp ${./vitest.config.js} ./vitest.config.js
            chmod -R u+w .
            node_modules/.bin/vitest run
            touch $out
          '';

          vm-test = pkgs.testers.runNixOSTest {
            name = "drawdb";

            nodes.machine =
              { ... }:
              {
                imports = [ self.nixosModules.default ];

                # Stand-in for the sops-managed secret. Fine for a throwaway VM;
                # on a real host this file is root-only and comes from sops.
                environment.etc."drawdb-tokens.json".text = builtins.toJSON {
                  "vm-test-token" = {
                    userId = "vmtest";
                    displayName = "VM Test";
                    color = "#2563eb";
                  };
                };

                services.drawdb = {
                  enable = true;
                  port = 3000;
                  allowedOrigins = [ "http://localhost:3000" ];
                  tokensFile = "/etc/drawdb-tokens.json";
                  backup = true;
                  startAt = "daily";
                  backupPath = "/var/backup/drawdb";
                  backupsLimit = 2;
                  mcp = {
                    enable = true;
                    port = 3001;
                  };
                };

                environment.systemPackages = [
                  pkgs.curl
                  pkgs.sqlite
                ];
              };

            testScript = ''
              machine.wait_for_unit("drawdb.service")
              machine.wait_for_open_port(3000)

              # Unauthenticated requests must be rejected.
              code = machine.succeed(
                  "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/diagrams"
              ).strip()
              assert code == "401", f"expected 401 without a token, got {code}"

              # Authenticated requests must succeed.
              body = machine.succeed(
                  "curl -s -H 'Authorization: Bearer vm-test-token' "
                  "http://127.0.0.1:3000/api/diagrams"
              )
              assert '"diagrams"' in body, f"unexpected body: {body}"

              # The SPA must be served.
              html = machine.succeed("curl -s http://127.0.0.1:3000/")
              assert "<!doctype html" in html.lower(), f"no SPA at /: {html[:200]}"

              # The listener must be on loopback only, not 0.0.0.0.
              machine.succeed("ss -tln | grep -q '127.0.0.1:3000'")
              machine.fail("ss -tln | grep -q '0.0.0.0:3000'")

              # The service must not run as root.
              user = machine.succeed(
                  "ps -o user= -p $(systemctl show -p MainPID --value drawdb.service)"
              ).strip()
              assert user != "root", f"service is running as root: {user}"

              # The database must land in the StateDirectory.
              machine.succeed("test -f /var/lib/private/drawdb/drawdb.sqlite")

              # Backups: the timer must be scheduled, and triggering the oneshot
              # must drop a valid, non-world-readable SQLite snapshot.
              machine.succeed("systemctl is-active drawdb-backup.timer")
              machine.succeed("systemctl start drawdb-backup.service")
              backup = machine.succeed("ls /var/backup/drawdb/drawdb-*.sqlite").strip()
              assert backup, "no backup file was produced"
              # A valid snapshot with the app schema (proves the root+cap read of
              # the DynamicUser-owned WAL database worked).
              machine.succeed(f"sqlite3 {backup} 'SELECT count(*) FROM diagrams'")
              mode = machine.succeed(f"stat -c %a {backup}").strip()
              assert mode == "600", f"backup mode is {mode}, expected 600"

              # backupsLimit must cap retained snapshots. Two more runs (1s apart
              # for distinct timestamps) make three total; only the newest two
              # must survive.
              machine.succeed("sleep 1 && systemctl start drawdb-backup.service")
              machine.succeed("sleep 1 && systemctl start drawdb-backup.service")
              kept = int(
                  machine.succeed("ls -1 /var/backup/drawdb/drawdb-*.sqlite | wc -l").strip()
              )
              assert kept == 2, f"backupsLimit=2 should keep 2 snapshots, found {kept}"

              # MCP service: a separate hardened unit, token-gated, loopback only.
              machine.wait_for_unit("drawdb-mcp.service")
              machine.wait_for_open_port(3001)
              machine.succeed("ss -tln | grep -q '127.0.0.1:3001'")
              machine.fail("ss -tln | grep -q '0.0.0.0:3001'")

              # A minimal MCP initialize request. Unauthenticated must be 401.
              init = (
                  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":'
                  '{"protocolVersion":"2025-06-18","capabilities":{},'
                  '"clientInfo":{"name":"vm","version":"1"}}}'
              )
              accept = "application/json, text/event-stream"
              code = machine.succeed(
                  "curl -s -o /dev/null -w '%{http_code}' -X POST "
                  "-H 'Content-Type: application/json' "
                  f"-H 'Accept: {accept}' "
                  f"-d '{init}' http://127.0.0.1:3001/mcp"
              ).strip()
              assert code == "401", f"expected 401 without a token, got {code}"

              # Authenticated initialize must succeed and mint a session id
              # (proves fail-closed auth accepts the shared token and the
              # service is live).
              headers = machine.succeed(
                  "curl -s -D - -o /dev/null -X POST "
                  "-H 'Authorization: Bearer vm-test-token' "
                  "-H 'Content-Type: application/json' "
                  f"-H 'Accept: {accept}' "
                  f"-d '{init}' http://127.0.0.1:3001/mcp"
              )
              assert (
                  "mcp-session-id" in headers.lower()
              ), f"no session id in MCP initialize response: {headers}"
            '';
          };
        }
      );
    };
}
