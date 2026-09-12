/**
 * How much inherited context a child may start with.
 *
 * Sixteen kilobytes is roughly four thousand tokens, which is a real cost taken
 * out of a budget the child needs for its own work. Inheritance is meant to stop
 * a child rediscovering what the parent already knows, not to hand it the
 * parent's whole run: a child that spends a quarter of its budget reading
 * history has been helped into failing.
 */
export const MAX_INHERITED_BYTES = 16 * 1024;

/** How many findings a child sees. The worst ones, since they are ranked. */
export const MAX_INHERITED_FINDINGS = 20;

/** How many already-changed paths are worth naming before the list is noise. */
export const MAX_INHERITED_PATHS = 40;
