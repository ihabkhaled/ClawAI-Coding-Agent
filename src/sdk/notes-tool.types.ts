/** One remembered fact. `id` is stable for the life of the thread; it is never reused. */
export interface AgentNote {
  readonly id: number;
  readonly text: string;
  readonly tag?: string;
  readonly createdAt: string;
}

/** What the notes file holds. */
export interface NotesFile {
  readonly version: 1;
  readonly nextId: number;
  readonly notes: readonly AgentNote[];
}

/** What a `note.added` event reports: never the text. */
export interface NoteAddedInfo {
  readonly id: number;
  readonly tag?: string;
  readonly chars: number;
}

/** The notes of one conversation, in memory and on disk. */
export interface NotesStore {
  list(): readonly AgentNote[];
  add(text: string, tag: string | undefined): AgentNote;
  replace(id: number, text: string): AgentNote;
  remove(id: number): void;
  clear(): void;
}

/** Where a store lives and which conversation it belongs to. */
export interface NotesStoreOptions {
  readonly workspace: string;
  /** Read on every call: the thread id is only known once the first run has started. */
  readonly threadId: () => string | undefined;
  /** Directory of the CLI's state; `undefined` keeps the notes in memory only. */
  readonly stateDirectory: string | undefined;
}

/** The tool as the executor sees it. */
export interface NotesTool {
  execute(operation: string, args: Readonly<Record<string, unknown>>): string;
}
