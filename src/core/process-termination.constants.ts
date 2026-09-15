/**
 * How long a process is given to exit on its own before it is killed outright.
 *
 * Long enough that a test runner can flush its summary and a build can remove
 * its temporary directory, short enough that a wedged process does not hold the
 * whole run. Five seconds is the interval most process supervisors settle on
 * for the same reason.
 */
export const PROCESS_TERMINATION_GRACE_MS = 5_000;
