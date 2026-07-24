self:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.drawdb;

  tokenType = lib.types.submodule {
    options = {
      userId = lib.mkOption {
        type = lib.types.str;
        description = "Stable identifier for this user.";
      };
      displayName = lib.mkOption {
        type = lib.types.str;
        description = "Name shown to collaborators.";
      };
      color = lib.mkOption {
        type = lib.types.str;
        default = "#2563eb";
        description = "Cursor and presence colour, as a CSS colour.";
      };
    };
  };

  tokensJSON = pkgs.writeText "drawdb-tokens.json" (builtins.toJSON cfg.tokens);

  # tokensFile wins if both are somehow set; the assertion below normally
  # prevents that case from arising at all.
  resolvedTokens = if cfg.tokensFile != null then cfg.tokensFile else tokensJSON;

  # Environment variables the module derives from its own options. Several are
  # load-bearing for the fail-closed behaviour the assertions above protect
  # (COLLAB_REQUIRE_AUTH, ALLOWED_ORIGINS, COLLAB_TOKENS_FILE), so `environment`
  # is not allowed to override them.
  managedEnvironment = [
    "ALLOWED_ORIGINS"
    "COLLAB_REQUIRE_AUTH"
    "COLLAB_TOKENS_FILE"
    "DATABASE_PATH"
    "HOST"
    "NODE_ENV"
    "PORT"
  ];

  conflictingEnvironment = lib.intersectLists managedEnvironment (lib.attrNames cfg.environment);

  # Public path of the SQLite database. StateDirectory + DynamicUser puts the
  # real file under /var/lib/private/drawdb and symlinks /var/lib/drawdb to it.
  databaseFile = "/var/lib/drawdb/drawdb.sqlite";

  backupScript = pkgs.writeShellScript "drawdb-backup" ''
    set -euo pipefail
    umask 077

    db=${lib.escapeShellArg databaseFile}
    dest=${lib.escapeShellArg cfg.backupPath}

    if [ ! -f "$db" ]; then
      echo "drawdb-backup: no database at $db yet; nothing to back up."
      exit 0
    fi

    ts=$(${pkgs.coreutils}/bin/date +%Y%m%d-%H%M%S)
    target="$dest/drawdb-$ts.sqlite"

    # Online backup on a read-only handle: a consistent snapshot even while the
    # server is writing (WAL journalling), and -readonly guarantees we never
    # create or modify anything in the server's state directory. Snapshots are
    # timestamped and accumulate; add external rotation if retention matters.
    ${pkgs.sqlite}/bin/sqlite3 -readonly "$db" ".backup '$target'"
    echo "drawdb-backup: wrote $target"
  '';
in
{
  options.services.drawdb = {
    enable = lib.mkEnableOption "the drawDB collaborative ER diagram editor";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.drawdb;
      defaultText = lib.literalExpression "drawdb.packages.\${system}.drawdb";
      description = "The drawDB package to run.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = ''
        Address the server binds to. Keep this on loopback when running behind a
        reverse proxy.

        Prefer a literal IP address. `RestrictAddressFamilies` omits `AF_NETLINK`,
        so a hostname such as "localhost" would have to resolve through
        `getaddrinfo`, which may be restricted. A literal address skips resolution
        entirely.
      '';
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "TCP port the server listens on.";
    };

    tokens = lib.mkOption {
      type = lib.types.nullOr (lib.types.attrsOf tokenType);
      default = null;
      example = lib.literalExpression ''
        {
          "long-random-token-for-ann" = {
            userId = "ann";
            displayName = "Ann";
            color = "#2563eb";
          };
        }
      '';
      description = ''
        Access token map, keyed by the token string itself.

        ::: {.warning}
        These tokens are written to the Nix store, which is **world-readable**, and
        will appear in your configuration repository. Each token grants read,
        write, and **delete** access to every diagram. Use
        {option}`services.drawdb.tokensFile` in production.
        :::
      '';
    };

    tokensFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/drawdb-tokens";
      description = ''
        Path to a JSON file holding the token map, in the same shape as
        {option}`services.drawdb.tokens`. Read by systemd as root via
        `LoadCredential`, so it may be root-owned and mode 0400 — which is what
        sops-nix and agenix produce.
      '';
    };

    allowedOrigins = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      example = [ "https://drawdb.example.com" ];
      description = ''
        Origin allowlist enforced on the WebSocket upgrade. Must list the public
        URL the browser loads the application from.

        There is no default: the application refuses to boot without an origin
        allowlist, so an empty list is a deployment bug and is rejected at
        evaluation time.
      '';
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = ''
        Extra environment variables for the service.

        Variables the module manages itself — `ALLOWED_ORIGINS`,
        `COLLAB_REQUIRE_AUTH`, `COLLAB_TOKENS_FILE`, `DATABASE_PATH`, `HOST`,
        `NODE_ENV` and `PORT` — are rejected at evaluation time, and the module's
        values win in the merge regardless. Several of them are load-bearing for
        the fail-closed behaviour enforced by the assertions, so overriding them
        here would silently defeat it. Use the dedicated options instead.
      '';
    };

    backup = lib.mkEnableOption "scheduled SQLite backups of the drawDB database";

    startAt = lib.mkOption {
      type = lib.types.str;
      default = "daily";
      example = "*-*-* 03:00:00";
      description = ''
        When to run backups, as a systemd `OnCalendar` expression (for example
        "daily", "hourly", or "*-*-* 03:00:00"). Only has an effect when
        {option}`services.drawdb.backup` is enabled.
      '';
    };

    backupPath = lib.mkOption {
      type = lib.types.str;
      default = "/var/backup/drawdb";
      description = ''
        Directory that timestamped SQLite snapshots are written to. Created
        automatically as root-owned, mode 0700; snapshots are written mode 0600.
        Only has an effect when {option}`services.drawdb.backup` is enabled.
      '';
    };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [ {
    assertions = [
      {
        assertion = (cfg.tokens != null) != (cfg.tokensFile != null);
        message = ''
          services.drawdb: set exactly one of `tokens` or `tokensFile`.
          The server refuses to boot without an access token map.
        '';
      }
      {
        assertion = cfg.allowedOrigins != [ ];
        message = ''
          services.drawdb.allowedOrigins must list at least one origin (the public
          URL users load the application from). The server refuses to boot
          without it.
        '';
      }
      {
        assertion = cfg.port >= 1024;
        message = ''
          services.drawdb.port is ${toString cfg.port}, but the service runs with
          CapabilityBoundingSet = "" and therefore cannot bind a privileged port
          (below 1024). Use a high port and reverse-proxy to it.
        '';
      }
      {
        assertion = conflictingEnvironment == [ ];
        message = ''
          services.drawdb.environment must not set ${lib.concatStringsSep ", " conflictingEnvironment}.
          These are managed by the module and several are load-bearing for its
          fail-closed behaviour. Use the dedicated options instead.
        '';
      }
    ];

    warnings = lib.optional (cfg.tokens != null) ''
      services.drawdb.tokens writes access tokens into the world-readable Nix
      store. Use services.drawdb.tokensFile with a secret manager in production.
    '';

    systemd.services.drawdb = {
      description = "drawDB collaborative ER diagram editor";
      after = [ "network.target" ];
      wantedBy = [ "multi-user.target" ];

      # Module-managed values are merged last so they win outright. The
      # conflictingEnvironment assertion rejects such an override at eval time
      # anyway; this ordering means that even if that guard were ever removed,
      # an override would be an inert no-op rather than a silent auth bypass.
      environment = cfg.environment // {
        NODE_ENV = "production";
        COLLAB_REQUIRE_AUTH = "1";
        HOST = cfg.host;
        PORT = toString cfg.port;
        DATABASE_PATH = "%S/drawdb/drawdb.sqlite";
        COLLAB_TOKENS_FILE = "%d/tokens";
        ALLOWED_ORIGINS = lib.concatStringsSep "," cfg.allowedOrigins;
      };

      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        DynamicUser = true;
        StateDirectory = "drawdb";
        # PID 1 reads the token file as root, before dropping to the dynamic
        # user, and exposes it at $CREDENTIALS_DIRECTORY/tokens (%d).
        LoadCredential = [ "tokens:${resolvedTokens}" ];
        Restart = "on-failure";
        RestartSec = 5;

        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        NoNewPrivileges = true;
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
        ];
        RestrictNamespaces = true;
        RestrictRealtime = true;
        LockPersonality = true;
        CapabilityBoundingSet = "";
        # MUST stay false: V8's JIT needs write-then-execute pages. Enabling
        # this kills the process at startup.
        MemoryDenyWriteExecute = false;
      };
    };
  } (lib.mkIf cfg.backup {
    systemd.tmpfiles.rules = [
      "d ${cfg.backupPath} 0700 root root -"
    ];

    # startAt (below) creates the timer; make it catch up after downtime.
    systemd.timers.drawdb-backup.timerConfig.Persistent = true;

    systemd.services.drawdb-backup = {
      description = "drawDB SQLite database backup";
      after = [ "drawdb.service" ];
      startAt = cfg.startAt;

      serviceConfig = {
        Type = "oneshot";
        ExecStart = backupScript;
        # The only writable location; created by tmpfiles above.
        ReadWritePaths = [ cfg.backupPath ];

        # It runs as root purely to read the DynamicUser-owned state directory,
        # so CAP_DAC_READ_SEARCH is the single privilege it keeps. Otherwise the
        # same hardening posture as the main service.
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        NoNewPrivileges = true;
        RestrictAddressFamilies = [ "AF_UNIX" ];
        RestrictNamespaces = true;
        RestrictRealtime = true;
        LockPersonality = true;
        CapabilityBoundingSet = [ "CAP_DAC_READ_SEARCH" ];
        # sqlite3/sh/date don't JIT, so unlike the node service this is safe.
        MemoryDenyWriteExecute = true;
      };
    };
  }) ]);
}

