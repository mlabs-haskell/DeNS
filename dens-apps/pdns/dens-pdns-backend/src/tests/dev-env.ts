/**
 * Importing this module should spin up a fresh developer environment where
 *
 * - The database will have a fresh instance of postgres
 *
 * - The server will be running in a temporary directory.
 *
 * WARNING(jaredponn): this import _must_ happen before ALL other imports.
 */

import { Postgres } from "./postgres.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Setting up the server on a fresh unix domain socket
 */
export const serverSocketPath: string = (() => {
  let tmp = "";
  if (process.env["SOCKET_PATH"] === undefined) {
    // WARNING(jaredponn): this _needs_ to be a synchronous call because if
    // it is asynchronous, this won't set the environment variable BEFORE
    // the server is started.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), `dens-pdns-backend-`));
    tmp = path.join(tmp, `.s.dens-pdns-backend`);
    process.env["SOCKET_PATH"] = tmp;
  } else {
    tmp = process.env["SOCKET_PATH"];
  }
  return tmp;
})();

/**
 * Getting a database up and running.
 * If the environment variable `PGHOST` is already defined, it will assume that
 * the user has provided the database setup which _must_ include setting the
 * following environment variables:
 *
 * - `PGHOST`
 * - `PGUSER`
 * - `PGPASSWORD`
 * - `PGDATABASE`
 *
 * Otherwise, this will start a fresh database automatically, and point the
 * tests to this database.
 */

export let postgres: Postgres | undefined = undefined;

if (process.env["PGHOST"] === undefined) {
  postgres = await Postgres.new();
  const username = `dens`;
  const database = `dens`;
  await postgres!.createUser(username);
  await postgres!.createDb(username, database);

  process.env["PGHOST"] = postgres!.unixSocketDirectory;
  process.env["PGUSER"] = username;
  process.env["PGPASSWORD"] = ``;
  process.env["PGDATABASE"] = database;
}
