/** A lane id is `<messageId>:<provider>:<model>`; the longest honest one is far shorter. */
export const COMPARE_LANE_ID_MAX = 700;

/** One content delta; a whole answer can arrive as a single delta. */
export const COMPARE_LANE_TEXT_MAX = 2_000_000;

export const COMPARE_MESSAGE_ERROR_MAX = 2_000;
