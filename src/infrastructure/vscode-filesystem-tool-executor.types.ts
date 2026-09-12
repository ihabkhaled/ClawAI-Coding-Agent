/** One place a search matched, in the shape the result list reports. */
export interface SearchHit {
  path: string;
  line: number;
  preview: string;
  context?: { before: string[]; after: string[] };
}
