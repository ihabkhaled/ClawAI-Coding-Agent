import { BackendRequestError } from './backend-errors';

/** An older backend answers 404 or 501 for a route it does not have yet. */
export function isUnsupportedRoute(error: unknown): boolean {
  return error instanceof BackendRequestError && (error.status === 404 || error.status === 501);
}

/** The value, or `undefined` when the backend predates the route. */
export async function orUnsupported<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (isUnsupportedRoute(error)) return undefined;
    throw error;
  }
}
