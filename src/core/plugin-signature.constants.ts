/** How strictly a plugin's publisher signature is enforced at install. */
export const PLUGIN_SIGNATURE_POLICIES = ['off', 'warn', 'require'] as const;

/** Warn by default: a marketplace that does not sign yet still works, visibly. */
export const DEFAULT_PLUGIN_SIGNATURE_POLICY = 'warn';

/** Where the profile remembers who signed each installed plugin. Never in the repository. */
export const PLUGIN_PROVENANCE_FILE = 'plugin-provenance.json';

/** The DER prefix that turns a raw 32-byte Ed25519 public key into an SPKI key. */
export const ED25519_SPKI_PREFIX_HEX = '302a300506032b6570032100';

/** A publisher id has the same shape as a plugin name. */
export const PUBLISHER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;
