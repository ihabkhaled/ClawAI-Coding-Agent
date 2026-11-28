import type { OutputStyle } from '../core/output-style.types';
import type { OutputStyleCatalog } from './output-style-catalog';

/** What choosing an output style needs to reach. */
export interface OutputStyleSelection {
  readonly styles: OutputStyleCatalog;
  readonly configuration: { selectOutputStyle(style: OutputStyle): Promise<void> };
}
