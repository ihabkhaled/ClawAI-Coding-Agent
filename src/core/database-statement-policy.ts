export type DatabaseStatementClass =
  'read' | 'write' | 'ddl' | 'admin' | 'shell-file' | 'ambiguous';

export interface ClassifiedDatabaseStatement {
  readonly classification: DatabaseStatementClass;
  readonly normalizedVerb: string;
  readonly statementCount: number;
}

const shellFilePattern =
  /\b(?:copy\s+.*\s+(?:to|from)\s+program|into\s+outfile|load_file|pg_read_file|pg_write_file|xp_cmdshell|sys_exec|system\s*\(|load\s+data\s+infile|attach\s+database|install\s+extension)\b/iu;
const adminPattern =
  /\b(?:alter\s+(?:system|user|role)|create\s+(?:user|role|extension)|drop\s+(?:user|role|database)|grant|revoke|shutdown|vacuum\s+full|flush\s+privileges)\b/iu;
const readVerbs = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'PRAGMA']);
const writeVerbs = new Set(['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'UPSERT', 'MERGE']);
const ddlVerbs = new Set(['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME']);

function lexicalStatements(sql: string): string[] {
  const lexicalToken =
    /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|--[^\r\n]*|\/\*[\s\S]*?\*\/|;/gu;
  const masked = sql.replace(lexicalToken, (token) =>
    token === ';' ? token : ' '.repeat(token.length),
  );
  if (/['"`]|\/\*/u.test(masked)) return [];
  const sanitized = sql.replace(lexicalToken, (token) =>
    token.startsWith('--') || token.startsWith('/*') ? ' '.repeat(token.length) : token,
  );
  const statements: string[] = [];
  let start = 0;
  for (let index = masked.indexOf(';'); index >= 0; index = masked.indexOf(';', start)) {
    const statement = sanitized.slice(start, index).trim();
    if (statement.length > 0) statements.push(statement);
    start = index + 1;
  }
  const remainder = sanitized.slice(start).trim();
  if (remainder.length > 0) statements.push(remainder);
  return statements;
}

function effectiveVerb(statement: string): string {
  const tokens = statement.toUpperCase().match(/[A-Z_]+/gu) ?? [];
  const first = tokens[0] ?? '';
  if (first !== 'WITH') return first;
  return tokens.find((token) => readVerbs.has(token) || writeVerbs.has(token)) ?? '';
}

export function classifyDatabaseStatement(sql: string): ClassifiedDatabaseStatement {
  if (sql.length === 0 || sql.length > 1_048_576 || sql.includes('\0'))
    return { classification: 'ambiguous', normalizedVerb: '', statementCount: 0 };
  const statements = lexicalStatements(sql);
  if (statements.length !== 1)
    return { classification: 'ambiguous', normalizedVerb: '', statementCount: statements.length };
  const statement = statements[0] ?? '';
  const verb = effectiveVerb(statement);
  if (shellFilePattern.test(statement))
    return { classification: 'shell-file', normalizedVerb: verb, statementCount: 1 };
  if (adminPattern.test(statement))
    return { classification: 'admin', normalizedVerb: verb, statementCount: 1 };
  if (readVerbs.has(verb))
    return { classification: 'read', normalizedVerb: verb, statementCount: 1 };
  if (writeVerbs.has(verb))
    return { classification: 'write', normalizedVerb: verb, statementCount: 1 };
  if (ddlVerbs.has(verb)) return { classification: 'ddl', normalizedVerb: verb, statementCount: 1 };
  return { classification: 'ambiguous', normalizedVerb: verb, statementCount: 1 };
}
