/** Characters kept from one cell's outputs. A chatty loop must not fill a model's context. */
export const MAX_CELL_OUTPUT_CHARS = 8_000;

/** Characters kept across every cell of one run. */
export const MAX_RUN_OUTPUT_CHARS = 32_000;

/** Cells one call may run. `run-all` on a larger notebook is refused, not truncated. */
export const MAX_CELLS_PER_RUN = 200;

/** How long a run waits for the kernel when the caller does not say. */
export const DEFAULT_KERNEL_TIMEOUT_MS = 120_000;

/** The longest a single call may hold the agent. */
export const MAX_KERNEL_TIMEOUT_MS = 600_000;

/** The MIME type VS Code uses for an error output. */
export const NOTEBOOK_ERROR_MIME = 'application/vnd.code.notebook.error';

/** The extension that provides kernels for `.ipynb` files. */
export const JUPYTER_EXTENSION_ID = 'ms-toolsai.jupyter';
