/**
 * The code points a terminal reads as instructions rather than as text.
 *
 * Written as numbers rather than as a regular expression on purpose: a pattern
 * containing raw control characters is unreadable, unreviewable, and the one
 * shape ESLint refuses outright. A named boundary can be checked against the
 * ECMA-48 table by eye.
 */
export const ESCAPE = 0x1b;
export const BELL = 0x07;
export const TAB = 0x09;
export const LINE_FEED = 0x0a;
export const CARRIAGE_RETURN = 0x0d;
export const DELETE = 0x7f;
export const CSI_INTRODUCER = 0x5b;
export const OSC_INTRODUCER = 0x5d;
export const STRING_TERMINATOR_FINAL = 0x5c;

/** `ESC [` parameter bytes, then intermediate bytes, then exactly one final. */
export const CSI_PARAMETER_FIRST = 0x30;
export const CSI_PARAMETER_LAST = 0x3f;
export const CSI_INTERMEDIATE_FIRST = 0x20;
export const CSI_INTERMEDIATE_LAST = 0x2f;
export const CSI_FINAL_FIRST = 0x40;
export const CSI_FINAL_LAST = 0x7e;

/** The two-character escapes: `ESC` followed by one byte in this range. */
export const SHORT_ESCAPE_FIRST = 0x40;
export const SHORT_ESCAPE_LAST = 0x5f;

/** The C0 block, whose only members text needs are tab, line feed and return. */
export const C0_LAST = 0x1f;
