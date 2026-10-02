/**
 * Gives one browser call a hard ceiling.
 *
 * Playwright's own timeouts stop at the page protocol: a page that spins in a
 * script loop never answers, so a call waiting on it (`title`, `evaluate`)
 * waits forever and the run hangs with it. When the ceiling passes, the call
 * fails with `message` and `expire` runs, which closes the browser and kills
 * the busy page.
 */
export function withDeadline<T>(
  work: Promise<T>,
  milliseconds: number,
  expire: () => Promise<void>,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
      void expire();
    }, milliseconds);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('The browser call failed.'));
      },
    );
  });
}
