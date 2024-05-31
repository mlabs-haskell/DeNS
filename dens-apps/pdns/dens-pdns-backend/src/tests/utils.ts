import * as timers from "node:timers/promises";
import { ChildProcess } from "node:child_process";

/**
 * Waits until a condition is ready. This is useful to know when certain
 * executables are finally ready.
 * @internal
 */
export async function poll<A>(
  action: () => Promise<A | undefined>,
): Promise<A> {
  // NOTE(jaredponn): 2^13 = 8192 is about 8 seconds
  const MAX_RETRIES = 13;
  let DELAY = 2;

  await timers.setTimeout(DELAY);

  let result = await action();

  for (let i = 0; i < MAX_RETRIES && result === undefined; ++i) {
    await timers.setTimeout(DELAY *= 2);
    result = await action();
  }

  if (result === undefined) {
    throw new Error(`polling timed out`);
  }

  return result;
}

/**
 * Escapes a shell argument to be used safely within a Bourne shell
 */
export function escapeShellArg(arg: string): string {
  return `'${arg.replaceAll(/'/g, `'\\''`)}'`;
}

/**
 * Escapes a shell argument to be used safely within a Bourne shell
 */
export function processFailedMessage(
  childProcess: ChildProcess,
  childStdout: string,
  childStderr: string,
): string {
  return `${childProcess.spawnfile} failed with exit code ${childProcess.exitCode}\n` +
    `COMMAND:\n${childProcess.spawnargs.map(escapeShellArg).join(` `)}\n` +
    `STDOUT:\n${childStdout}\n` +
    `STDERR:\n${childStderr}`;
}
