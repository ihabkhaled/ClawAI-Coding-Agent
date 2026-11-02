/** The most models one `POST /chat-messages/model-access` call accepts (the backend's own ceiling). */
export const MODEL_ACCESS_MAX_MODELS = 300;

/** The cost bands the backend names; never a rate. */
export const MODEL_COST_CLASSES = ['FREE', 'CHEAP', 'STANDARD', 'PREMIUM', 'ULTRA'] as const;
