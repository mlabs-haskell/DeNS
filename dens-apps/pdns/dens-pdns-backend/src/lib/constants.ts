/**
 * Static readonly constants to configure the server
 *
 * Note that the postgres backend also requires some environment variables --
 * see `./postgres.ts`
 */
export const socketPath: string = await new Promise<string>(
  (resolve, reject) => {
    const tmp: undefined | string = process.env["SOCKET_PATH"];
    if (tmp === undefined) {
      return reject(
        new Error(
          `Environment variable \`SOCKET_PATH\` must be set for the Unix Domain Socket`,
        ),
      );
    }
    return resolve(tmp);
  },
);

/**
 * Number of ms to timeout clients
 *
 * @see https://nodejs.org/api/net.html#socketsettimeouttimeout-callback
 */
export const socketTimeout = process.env["CLIENT_TIMEOUT"] === undefined
  ? 2000
  : parseInt(process.env["CLIENT_TIMEOUT"]);

/**
 * Max request length from clients
 */
export const maxRequestLength = process.env["MAX_REQUEST_LENGTH"] === undefined
  ? 2 ** 16
  : parseInt(process.env["MAX_REQUEST_LENGTH"]);
