/** Where the user last left an editor chat tab, remembered across restarts. */
export interface PlacementMemory {
  get(): number | undefined;
  remember(column: number): void;
}
