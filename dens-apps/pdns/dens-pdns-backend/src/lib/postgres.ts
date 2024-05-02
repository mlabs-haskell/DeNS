/**
 * Database connection
 *
 * Note that the database connection is configured by:
 * <<https://node-postgres.com/features/connecting#environment-variables>>
 */

import { Pool } from "pg";

const pool = new Pool();

export default pool;
