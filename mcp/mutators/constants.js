// Self-contained subset of src/data/constants.js. The client modules under
// src/ are written for the Vite bundler (extensionless imports, asset/i18n
// imports) and cannot be imported by plain Node, so the handful of enum values
// and capability flags the mutators need are mirrored here. Keep in sync with
// src/data/constants.js and src/data/databases.js if those change.

export const DB = {
  MYSQL: "mysql",
  POSTGRES: "postgresql",
  MSSQL: "transactsql",
  SQLITE: "sqlite",
  MARIADB: "mariadb",
  ORACLESQL: "oraclesql",
  GENERIC: "generic",
};

export const Cardinality = {
  ONE_TO_ONE: "one_to_one",
  ONE_TO_MANY: "one_to_many",
  MANY_TO_ONE: "many_to_one",
};

export const Constraint = {
  NONE: "No action",
  RESTRICT: "Restrict",
  CASCADE: "Cascade",
  SET_NULL: "Set null",
  SET_DEFAULT: "Set default",
};

export const defaultBlue = "#175e7a";
export const defaultNoteTheme = "#fcf7ac";

// hasEnums / hasTypes per database (mirrors src/data/databases.js). Unknown
// databases get {} → both false.
const CAPABILITIES = {
  [DB.POSTGRES]: { hasEnums: true, hasTypes: true },
  [DB.GENERIC]: { hasEnums: false, hasTypes: true },
  [DB.MYSQL]: { hasEnums: false, hasTypes: false },
  [DB.MARIADB]: { hasEnums: false, hasTypes: false },
  [DB.SQLITE]: { hasEnums: false, hasTypes: false },
  [DB.MSSQL]: { hasEnums: false, hasTypes: false },
  [DB.ORACLESQL]: { hasEnums: false, hasTypes: false },
};

export function capabilities(database) {
  return CAPABILITIES[database] ?? { hasEnums: false, hasTypes: false };
}

export const VALID_DATABASES = Object.values(DB);
export const VALID_CARDINALITIES = Object.values(Cardinality);
export const VALID_CONSTRAINTS = Object.values(Constraint);
