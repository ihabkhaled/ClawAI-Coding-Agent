/**
 * How many results one SARIF log may contribute.
 *
 * A full scanner run on a large repository routinely produces thousands. A
 * findings list is triaged by a person, and one that arrives with four thousand
 * entries is not triaged at all. Taking the worst two hundred is a real answer;
 * taking everything is a way of not answering.
 */
export const MAX_SARIF_FINDINGS = 200;

export const MAX_SARIF_BYTES = 8 * 1024 * 1024;

/**
 * The `security-severity` band a scanner reports, mapped the way GitHub code
 * scanning does. Recorded here rather than inlined because the boundaries are a
 * convention other tools share, and a reader comparing two dashboards should
 * see the same word for the same number.
 */
export const SECURITY_SEVERITY_BANDS = [
  { atLeast: 9, severity: 'critical' },
  { atLeast: 7, severity: 'high' },
  { atLeast: 4, severity: 'medium' },
  { atLeast: 0.1, severity: 'low' },
] as const;
