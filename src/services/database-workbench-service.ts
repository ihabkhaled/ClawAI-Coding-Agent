import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  classifyDatabaseStatement,
  type DatabaseStatementClass,
} from '../core/database-statement-policy';
import { redactText } from '../core/redaction';
import { runCommandSpec } from '../infrastructure/bounded-command-runner';

import type { DatabaseProfileMetadata, DatabaseProfileVault } from './database-profile-vault';

const databaseRequestSchema = z
  .object({
    profileId: z.string().min(8).max(200),
    operation: z.enum(['introspect', 'query', 'explain', 'migration-dry-run', 'migration-apply']),
    statement: z.string().min(1).max(1_048_576),
    rowLimit: z.number().int().min(1).max(10_000).default(500),
    timeoutMs: z.number().int().min(100).max(600_000).default(30_000),
    outputLimitBytes: z.number().int().min(1_024).max(8_388_608).default(1_048_576),
    backupAcknowledged: z.boolean().default(false),
  })
  .strict();

export type DatabaseRequest = z.infer<typeof databaseRequestSchema>;

export interface DatabaseImpactReceipt {
  readonly receiptId: string;
  readonly profileId: string;
  readonly engine: DatabaseProfileMetadata['engine'];
  readonly environment: DatabaseProfileMetadata['environment'];
  readonly classification: DatabaseStatementClass;
  readonly statementHash: string;
  readonly dryRun: boolean;
  readonly rollback: string;
  readonly output: string;
  readonly truncated: boolean;
}

export interface DatabaseAdapter {
  readonly engines: readonly DatabaseProfileMetadata['engine'][];
  execute(
    profile: DatabaseProfileMetadata,
    connection: string,
    request: DatabaseRequest,
    statement: string,
    signal?: AbortSignal,
  ): Promise<{ readonly output: string; readonly truncated: boolean }>;
}

interface DatabaseApprovalPort {
  approveWrite(
    profile: DatabaseProfileMetadata,
    classification: DatabaseStatementClass,
    statementHash: string,
    backupAcknowledged: boolean,
    signal?: AbortSignal,
  ): Promise<boolean>;
  productionWritesEnabled(): boolean;
}

const sensitiveColumnPattern =
  /(?:password|passwd|secret|token|api[-_]?key|credential|private[-_]?key)/iu;

function redactSensitiveColumns(output: string): string {
  return redactText(
    output
      .split(/\r?\n/u)
      .map((line) => {
        const separator = line.includes('\t') ? '\t' : line.includes(',') ? ',' : undefined;
        if (separator === undefined) return line;
        return line
          .split(separator)
          .map((value) => (sensitiveColumnPattern.test(value) ? '[REDACTED]' : value))
          .join(separator);
      })
      .join('\n'),
  );
}

function classifyForEngine(
  engine: DatabaseProfileMetadata['engine'],
  statement: string,
): ReturnType<typeof classifyDatabaseStatement> {
  if (engine === 'redis') return classifyRedis(statement);
  if (engine === 'mongodb') return classifyMongo(statement);
  if (engine === 'neo4j') return classifyNeo4j(statement);
  if (engine === 'elasticsearch' || engine === 'opensearch')
    return classifySearchDocument(statement);
  return classifyDatabaseStatement(statement);
}

function classifyRedis(statement: string): ReturnType<typeof classifyDatabaseStatement> {
  const verb = statement.trim().split(/\s/u)[0]?.toUpperCase() ?? '';
  const reads = new Set([
    'GET',
    'MGET',
    'HGET',
    'HGETALL',
    'LRANGE',
    'SMEMBERS',
    'ZRANGE',
    'SCAN',
    'TYPE',
    'TTL',
    'EXISTS',
    'INFO',
  ]);
  const writes = new Set([
    'SET',
    'MSET',
    'DEL',
    'HSET',
    'LPUSH',
    'RPUSH',
    'SADD',
    'ZADD',
    'EXPIRE',
  ]);
  return {
    classification: reads.has(verb) ? 'read' : writes.has(verb) ? 'write' : 'admin',
    normalizedVerb: verb,
    statementCount: 1,
  };
}

function classifyMongo(statement: string): ReturnType<typeof classifyDatabaseStatement> {
  try {
    const candidate: unknown = JSON.parse(statement);
    const command = z.record(z.string(), z.unknown()).parse(candidate);
    const verb = Object.keys(command)[0]?.toLowerCase() ?? '';
    const reads = new Set([
      'find',
      'aggregate',
      'count',
      'distinct',
      'listcollections',
      'listindexes',
      'collstats',
      'dbstats',
      'explain',
    ]);
    const writes = new Set([
      'insert',
      'update',
      'delete',
      'findandmodify',
      'create',
      'createindexes',
      'dropindexes',
    ]);
    return {
      classification: reads.has(verb) ? 'read' : writes.has(verb) ? 'write' : 'admin',
      normalizedVerb: verb.toUpperCase(),
      statementCount: 1,
    };
  } catch {
    return { classification: 'ambiguous', normalizedVerb: '', statementCount: 0 };
  }
}

function classifyNeo4j(statement: string): ReturnType<typeof classifyDatabaseStatement> {
  const verb = statement.trim().split(/\s/u)[0]?.toUpperCase() ?? '';
  if (['MATCH', 'OPTIONAL', 'RETURN', 'EXPLAIN', 'PROFILE'].includes(verb))
    return { classification: 'read', normalizedVerb: verb, statementCount: 1 };
  if (['CREATE', 'MERGE', 'SET', 'REMOVE', 'DELETE', 'DETACH'].includes(verb))
    return { classification: 'write', normalizedVerb: verb, statementCount: 1 };
  return { classification: 'ambiguous', normalizedVerb: verb, statementCount: 1 };
}

function classifySearchDocument(statement: string): ReturnType<typeof classifyDatabaseStatement> {
  try {
    z.record(z.string(), z.unknown()).parse(JSON.parse(statement));
    return { classification: 'read', normalizedVerb: 'SEARCH', statementCount: 1 };
  } catch {
    return { classification: 'ambiguous', normalizedVerb: '', statementCount: 0 };
  }
}

export class DatabaseWorkbenchService {
  constructor(
    private readonly profiles: DatabaseProfileVault,
    private readonly adapters: readonly DatabaseAdapter[],
    private readonly approvals: DatabaseApprovalPort,
  ) {}

  async execute(candidate: unknown, signal?: AbortSignal): Promise<DatabaseImpactReceipt> {
    const request = databaseRequestSchema.parse(candidate);
    const profile = this.profiles.list().find((item) => item.profileId === request.profileId);
    if (profile === undefined) throw new Error('Database profile is unavailable');
    const classified = classifyForEngine(profile.engine, request.statement);
    if (['ambiguous', 'admin', 'shell-file'].includes(classified.classification))
      throw new Error(`Database statement class is blocked: ${classified.classification}`);
    const write = classified.classification === 'write' || classified.classification === 'ddl';
    const statementHash = `sha256:${createHash('sha256').update(request.statement).digest('hex')}`;
    if (write)
      await this.authorizeWrite(profile, classified.classification, statementHash, request, signal);
    const adapter = this.adapters.find((item) => item.engines.includes(profile.engine));
    if (adapter === undefined)
      throw new Error(`Database adapter prerequisite is unavailable: ${profile.engine}`);
    const connection = await this.profiles.resolve(profile.profileId);
    const dryRun = request.operation === 'migration-dry-run';
    const normalizedStatement = `${request.statement.replace(/;\s*$/u, '')};`;
    const statement =
      write && dryRun ? `BEGIN;\n${normalizedStatement}\nROLLBACK;` : normalizedStatement;
    const result = await adapter.execute(profile, connection, request, statement, signal);
    return {
      receiptId: `database:${randomUUID()}`,
      profileId: profile.profileId,
      engine: profile.engine,
      environment: profile.environment,
      classification: classified.classification,
      statementHash,
      dryRun,
      rollback: this.rollbackGuidance(write, dryRun),
      output: redactSensitiveColumns(result.output).slice(0, request.outputLimitBytes),
      truncated: result.truncated || result.output.length > request.outputLimitBytes,
    };
  }

  private rollbackGuidance(write: boolean, dryRun: boolean): string {
    if (!write) return 'No database mutation was performed.';
    return dryRun
      ? 'Transaction rolled back after validation.'
      : 'Restore the acknowledged backup or apply a reviewed compensating migration.';
  }

  private async authorizeWrite(
    profile: DatabaseProfileMetadata,
    classification: DatabaseStatementClass,
    statementHash: string,
    request: DatabaseRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    if (profile.environment === 'production' && !this.approvals.productionWritesEnabled())
      throw new Error('Production database writes are disabled');
    if (
      !(await this.approvals.approveWrite(
        profile,
        classification,
        statementHash,
        request.backupAcknowledged,
        signal,
      ))
    )
      throw new Error('Database write was not approved');
    if (profile.environment === 'production' && !request.backupAcknowledged)
      throw new Error('Production write requires backup acknowledgement');
  }
}

export class SqlCliDatabaseAdapter implements DatabaseAdapter {
  readonly engines = [
    'postgresql',
    'mysql',
    'mariadb',
    'sqlite',
    'redis',
    'sqlserver',
    'cockroachdb',
    'oracle',
  ] as const;

  async execute(
    profile: DatabaseProfileMetadata,
    connection: string,
    request: DatabaseRequest,
    statement: string,
    signal?: AbortSignal,
  ): Promise<{ readonly output: string; readonly truncated: boolean }> {
    const command = this.command(profile.engine, connection, request, statement);
    const result = await runCommandSpec(
      {
        executable: command.executable,
        arguments: command.arguments,
        cwdRootKey: 'database-profile',
        cwd: '.',
        environment: {},
        timeoutMs: request.timeoutMs,
        outputLimitBytes: request.outputLimitBytes,
        expectedEffect: 'local-mutation',
        targetId: `database:${profile.profileId}`,
        elevation: false,
        stdin: command.stdin,
      },
      process.cwd(),
      signal,
      command.environment,
    );
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Database CLI failed');
    return { output: result.stdout, truncated: result.truncated };
  }

  private command(
    engine: DatabaseProfileMetadata['engine'],
    connection: string,
    request: DatabaseRequest,
    statement: string,
  ): {
    executable: string;
    arguments: string[];
    environment: Record<string, string>;
    stdin: string;
  } {
    const bounded = this.boundedRead(engine, statement, request.rowLimit);
    if (engine === 'sqlite')
      return {
        executable: 'sqlite3',
        arguments: [connection, '-json'],
        environment: {},
        stdin: `${bounded}\n`,
      };
    return this.networkCommand(engine, connection, bounded);
  }

  private networkCommand(
    engine: DatabaseProfileMetadata['engine'],
    connection: string,
    bounded: string,
  ): {
    executable: string;
    arguments: string[];
    environment: Record<string, string>;
    stdin: string;
  } {
    const url = new URL(connection);
    const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
    if (['postgresql', 'cockroachdb'].includes(engine))
      return {
        executable: engine === 'postgresql' ? 'psql' : 'cockroach',
        arguments:
          engine === 'postgresql'
            ? [
                '--no-psqlrc',
                '--csv',
                '--host',
                url.hostname,
                '--port',
                url.port || '5432',
                '--username',
                decodeURIComponent(url.username),
                '--dbname',
                database,
              ]
            : [
                'sql',
                '--url',
                `${url.protocol}//${encodeURIComponent(url.username)}@${url.host}/${database}`,
              ],
        environment: { PGPASSWORD: decodeURIComponent(url.password) },
        stdin: `${bounded}\n`,
      };
    if (['mysql', 'mariadb'].includes(engine))
      return {
        executable: 'mysql',
        arguments: [
          '--batch',
          '--raw',
          '--host',
          url.hostname,
          '--port',
          url.port || '3306',
          '--user',
          decodeURIComponent(url.username),
          database,
        ],
        environment: { MYSQL_PWD: decodeURIComponent(url.password) },
        stdin: `${bounded}\n`,
      };
    if (engine === 'redis')
      return {
        executable: 'redis-cli',
        arguments: ['--host', url.hostname, '--port', url.port || '6379', '--raw'],
        environment: { REDISCLI_AUTH: decodeURIComponent(url.password) },
        stdin: `${bounded}\n`,
      };
    if (engine === 'sqlserver')
      return {
        executable: 'sqlcmd',
        arguments: [
          '-S',
          `${url.hostname},${url.port || '1433'}`,
          '-U',
          decodeURIComponent(url.username),
          '-d',
          database,
        ],
        environment: { SQLCMDPASSWORD: decodeURIComponent(url.password) },
        stdin: `${bounded}\nGO\n`,
      };
    return {
      executable: 'sqlplus',
      arguments: ['-S', '/nolog'],
      environment: { CLAWAI_ORACLE_CONNECTION: connection },
      stdin: `connect $CLAWAI_ORACLE_CONNECTION\n${bounded}\nexit\n`,
    };
  }

  private boundedRead(
    engine: DatabaseProfileMetadata['engine'],
    statement: string,
    rowLimit: number,
  ): string {
    if (classifyDatabaseStatement(statement).classification !== 'read') return statement;
    const body = statement.replace(/;\s*$/u, '');
    if (!/^\s*(?:SELECT|WITH)\b/iu.test(body)) return statement;
    if (engine === 'sqlserver')
      return `SELECT TOP ${String(rowLimit)} * FROM (${body}) AS claw_bounded;`;
    if (engine === 'oracle')
      return `SELECT * FROM (${body}) claw_bounded FETCH FIRST ${String(rowLimit)} ROWS ONLY;`;
    return `SELECT * FROM (${body}) AS claw_bounded LIMIT ${String(rowLimit)};`;
  }
}

export class DocumentCliDatabaseAdapter implements DatabaseAdapter {
  readonly engines = ['mongodb', 'elasticsearch', 'opensearch', 'neo4j'] as const;

  async execute(
    profile: DatabaseProfileMetadata,
    connection: string,
    request: DatabaseRequest,
    statement: string,
    signal?: AbortSignal,
  ): Promise<{ readonly output: string; readonly truncated: boolean }> {
    const command = this.command(profile, connection, request, statement);
    const result = await runCommandSpec(
      {
        executable: command.executable,
        arguments: command.arguments,
        cwdRootKey: 'database-profile',
        cwd: '.',
        environment: {},
        timeoutMs: request.timeoutMs,
        outputLimitBytes: request.outputLimitBytes,
        expectedEffect: 'local-mutation',
        targetId: `database:${profile.profileId}`,
        elevation: false,
        ...(command.stdin === undefined ? {} : { stdin: command.stdin }),
      },
      process.cwd(),
      signal,
      command.environment,
    );
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Database CLI failed');
    return { output: result.stdout, truncated: result.truncated };
  }

  private command(
    profile: DatabaseProfileMetadata,
    connection: string,
    request: DatabaseRequest,
    statement: string,
  ): {
    executable: string;
    arguments: string[];
    environment: Record<string, string>;
    stdin?: string;
  } {
    if (profile.engine === 'mongodb') return this.mongoCommand(connection, request, statement);
    if (profile.engine === 'elasticsearch' || profile.engine === 'opensearch')
      return this.searchCommand(connection, request, statement);
    const url = new URL(connection);
    return {
      executable: 'cypher-shell',
      arguments: ['--format', 'plain'],
      environment: {
        NEO4J_ADDRESS: `${url.protocol}//${url.host}`,
        NEO4J_USERNAME: decodeURIComponent(url.username),
        NEO4J_PASSWORD: decodeURIComponent(url.password),
      },
      stdin: `${statement}\n`,
    };
  }

  private mongoCommand(
    connection: string,
    request: DatabaseRequest,
    statement: string,
  ): { executable: string; arguments: string[]; environment: Record<string, string> } {
    const url = new URL(connection);
    const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
    const command: unknown = JSON.parse(statement);
    const bounded = z.record(z.string(), z.unknown()).parse(command);
    if ('find' in bounded && bounded.limit === undefined) bounded.limit = request.rowLimit;
    const script =
      'const c=new Mongo(process.env.CLAWAI_MONGODB_URI);const d=c.getDB(process.env.CLAWAI_MONGODB_DATABASE);print(EJSON.stringify(d.runCommand(EJSON.parse(process.env.CLAWAI_MONGODB_COMMAND))));';
    return {
      executable: 'mongosh',
      arguments: ['--quiet', '--nodb', '--eval', script],
      environment: {
        CLAWAI_MONGODB_URI: connection,
        CLAWAI_MONGODB_DATABASE: database,
        CLAWAI_MONGODB_COMMAND: JSON.stringify(bounded),
      },
    };
  }

  private searchCommand(
    connection: string,
    request: DatabaseRequest,
    statement: string,
  ): {
    executable: string;
    arguments: string[];
    environment: Record<string, string>;
    stdin: string;
  } {
    const url = new URL(connection);
    const endpoint = request.operation === 'introspect' ? '_mapping' : '_search';
    const cleanOrigin = `${url.protocol}//${url.host}/${endpoint}`;
    const escape = (value: string): string =>
      value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
    const config = [
      `url = "${escape(cleanOrigin)}"`,
      'request = "POST"',
      'header = "Content-Type: application/json"',
      `user = "${escape(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`)}"`,
      `data = "${escape(statement)}"`,
    ].join('\n');
    return {
      executable: 'curl',
      arguments: ['--silent', '--show-error', '--fail', '--config', '-'],
      environment: {},
      stdin: config,
    };
  }
}
