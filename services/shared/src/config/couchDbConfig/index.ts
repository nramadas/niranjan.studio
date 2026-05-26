import { Config } from "effect";

/**
 * Typed config for the CouchDB client. Reads four env vars and fails the
 * program at boot if any are missing — there is no sensible default for a
 * remote database connection, so loud failure beats silent default.
 */
export const couchDbConfig = Config.all({
  url: Config.string("COUCHDB_URL"),
  database: Config.string("COUCHDB_DB"),
  username: Config.string("COUCHDB_USER"),
  password: Config.redacted("COUCHDB_PASSWORD"),
});
