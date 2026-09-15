import type { OutputStyleCatalog } from './output-style-catalog';
import type { OutputStyle } from '../core/output-style.types';

/** What choosing an output style needs to reach. */
export interface OutputStyleSelection {
  readonly styles: OutputStyleCatalog;
  readonly configuration: { selectOutputStyle(style: OutputStyle): Promise<void> };
}
