import { resolve, relative, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * A caller of the SDK must be able to NAME every type an option takes or a result returns.
 *
 * An option typed with an interface the entry does not export compiles for the
 * author (inference) and leaves everyone else with `any`-shaped workarounds. This
 * walks the public config, call, permission and result types, collects every named
 * type they reach, and fails when one is not exported from `src/sdk/index.ts`.
 */
const CONFIG_PATH = resolve('tsconfig.sdk-types.json');
const ENTRY = 'src/sdk/index.ts';
const ROOTS = [
  'AgentConfig',
  'AgentRunCallOptions',
  'AgentPermissions',
  'AgentResult',
  'AgentEvent',
  'AgentBrowserOptions',
  'AgentVisionOptions',
  'AgentMcpOptions',
];
/** Options added with the 1.96 tools; each must stay a property of its public type. */
const REQUIRED_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  AgentConfig: [
    'browser',
    'vision',
    'taskPlan',
    'loadKnowledge',
    'maxAgents',
    'planSteps',
    'requirePlan',
  ],
  AgentPermissions: ['allow', 'httpAllowHosts', 'shell', 'approve', 'writeScope', 'writeDeny'],
  AgentBrowserOptions: ['allowHosts', 'executablePath', 'maxPages', 'maxRunMs'],
};
/** Declared for the runtime's own plumbing; a caller never names them. */
const INTERNAL = new Set(['TeamLink', 'TeamBus', 'TeamHub', 'TeamMessage']);

function fromRoot(path: string): string {
  return relative(resolve('.'), resolve(path)).split(sep).join('/');
}

function buildProgram(): ts.Program {
  const read = ts.readConfigFile(CONFIG_PATH, (path) => ts.sys.readFile(path));
  const config = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    resolve('.'),
    undefined,
    CONFIG_PATH,
  );
  return ts.createProgram({
    rootNames: config.fileNames,
    options: { ...config.options, noEmit: true, emitDeclarationOnly: false, declaration: false },
  });
}

function namedDeclaration(symbol: ts.Symbol | undefined): ts.Symbol | undefined {
  if (symbol === undefined) return undefined;
  const declaration = symbol.declarations?.[0];
  if (declaration === undefined) return undefined;
  const isNamed = ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration);
  if (!isNamed || !fromRoot(declaration.getSourceFile().fileName).startsWith('src/'))
    return undefined;
  return symbol;
}

function isOwnSource(type: ts.Type): boolean {
  const declaration = (type.aliasSymbol ?? type.getSymbol())?.declarations?.[0];
  return (
    declaration !== undefined && fromRoot(declaration.getSourceFile().fileName).startsWith('src/')
  );
}

function reachableNames(program: ts.Program): { exported: Set<string>; reached: Set<string> } {
  const checker = program.getTypeChecker();
  const entry = program.getSourceFile(resolve(ENTRY));
  if (entry === undefined) throw new Error('missing SDK entry');
  const moduleSymbol = checker.getSymbolAtLocation(entry);
  if (moduleSymbol === undefined) throw new Error('SDK entry has no exports');
  const exports = checker.getExportsOfModule(moduleSymbol);
  const exported = new Set<string>(exports.map((symbol) => symbol.name));
  const byName = new Map(
    exports.map((symbol) => [
      symbol.name,
      checker.getDeclaredTypeOfSymbol(
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol,
      ),
    ]),
  );
  const nested = (type: ts.Type): readonly ts.Type[] => [
    ...(type.isUnionOrIntersection() ? type.types : []),
    ...(type.aliasTypeArguments ?? []),
    ...(checker.isArrayType(type) || checker.isTupleType(type)
      ? checker.getTypeArguments(type as ts.TypeReference)
      : []),
  ];
  const reached = new Set<string>();
  const seen = new Set<ts.Type>();
  const visit = (type: ts.Type): void => {
    if (seen.has(type)) return;
    seen.add(type);
    const named = namedDeclaration(type.aliasSymbol ?? type.getSymbol());
    if (named !== undefined) reached.add(named.name);
    nested(type).forEach(visit);
    type.getCallSignatures().forEach((signature) => {
      signature.getParameters().forEach((parameter) => {
        visit(checker.getTypeOfSymbol(parameter));
      });
      visit(signature.getReturnType());
    });
    if ((type.flags & ts.TypeFlags.Object) !== 0 && isOwnSource(type)) {
      type.getProperties().forEach((property) => {
        visit(checker.getTypeOfSymbol(property));
      });
    }
  };
  for (const root of ROOTS) {
    const type = byName.get(root);
    if (type === undefined) throw new Error(`${root} is not exported from ${ENTRY}`);
    visit(type);
  }
  return { exported, reached };
}

describe('SDK type surface', () => {
  const program = buildProgram();

  it('exports every named type the public options, permissions and results reach', () => {
    const { exported, reached } = reachableNames(program);
    const missing = [...reached].filter((name) => !exported.has(name) && !INTERNAL.has(name));
    expect(missing.sort()).toEqual([]);
  }, 60_000);

  it('keeps each option the new tools rely on in its public type', () => {
    const checker = program.getTypeChecker();
    const entry = program.getSourceFile(resolve(ENTRY));
    const moduleSymbol = entry === undefined ? undefined : checker.getSymbolAtLocation(entry);
    const exports = moduleSymbol === undefined ? [] : checker.getExportsOfModule(moduleSymbol);
    for (const [typeName, options] of Object.entries(REQUIRED_OPTIONS)) {
      const symbol = exports.find((candidate) => candidate.name === typeName);
      expect(symbol, typeName).toBeDefined();
      if (symbol === undefined) continue;
      const resolved =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const properties = checker
        .getDeclaredTypeOfSymbol(resolved)
        .getProperties()
        .map((p) => p.name);
      expect(properties, typeName).toEqual(expect.arrayContaining([...options]));
    }
  }, 60_000);
});
