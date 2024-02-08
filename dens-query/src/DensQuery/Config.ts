// import * as ws from 'ws'

export interface DensConfig {
  /**
   * Ogmios connection options (note that this server is *client* to ogmios)
   */
  ogmios: { host: string; port: number };

  /**
   * Database configuration options
   * TODO(jaredponn): document me
   */
  db: {
    connectionOptions: {
      host: string;
      port: number;
      user: string;
      database: string;
      password: string | undefined;
    };
    /**
     * Path to the file containing SQL to initialize the database
     */
    initSqlFile: string;
  };
}

// TODO(jaredponn): allow input from environment variables.
export const config: DensConfig = {
  ogmios: { host: "127.0.0.1", port: 1337 },
  db: {
    connectionOptions: {
      host: `127.0.0.1`,
      port: 5432,
      user: `dens`,
      database: `dens`,
      password: undefined,
    },
    initSqlFile: "./api/postgres/dens.sql",
  },
};

export default config;
