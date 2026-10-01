import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { compareVerdictFromMetadata, parseCompareVerdict } from '../../src/core/compare-verdict';

const stored = (
  JSON.parse(
    readFileSync(
      join(process.cwd(), 'tests', 'fixtures', 'compare', 'real-compare-run.json'),
      'utf8',
    ),
  ) as { stored: { metadata: Record<string, unknown> }[] }
).stored;

const scale = { min: 0, max: 10 };

describe('parseCompareVerdict', () => {
  it('reads the verdict the server stored on a real lane message', () => {
    const verdict = parseCompareVerdict(stored[0]?.metadata.compareJudge);

    expect(verdict).toMatchObject({
      status: 'ranked',
      judgeModel: 'OLLAMA/kimi-k2.6',
      winnerLaneIndex: 1,
      tiedLaneIndices: [],
      scale,
    });
    expect(verdict?.lanes[0]).toEqual({
      label: 'B',
      laneIndex: 1,
      model: 'gpt-oss:120b',
      provider: 'OLLAMA',
      rank: 1,
      reason: expect.stringContaining('two short sentences'),
      score: 9,
    });
  });

  it('keeps only what a card shows', () => {
    const verdict = parseCompareVerdict(stored[0]?.metadata.compareJudge);

    expect(Object.keys(verdict ?? {}).sort()).toEqual([
      'judgeModel',
      'lanes',
      'rationale',
      'scale',
      'status',
      'tiedLaneIndices',
      'winnerLaneIndex',
    ]);
  });

  it('reads an unavailable verdict that carries no lanes and no rationale', () => {
    expect(
      parseCompareVerdict({
        status: 'unavailable',
        judgeModel: 'OLLAMA/kimi-k2.6',
        failureReason: 'call_failed',
        lanes: [],
        winnerLaneIndex: null,
        tiedLaneIndices: [],
        rationale: null,
        scale,
      }),
    ).toMatchObject({ status: 'unavailable', lanes: [], rationale: null });
  });

  it.each([
    ['nothing', undefined],
    ['a string', 'ranked'],
    ['an unknown status', { status: 'winner', judgeModel: 'j', lanes: [], scale }],
    [
      'a lane without a score',
      {
        status: 'ranked',
        judgeModel: 'j',
        scale,
        lanes: [{ rank: 1, laneIndex: 0, model: 'm', provider: 'p' }],
      },
    ],
  ])('rejects %s', (_name, value) => {
    expect(parseCompareVerdict(value)).toBeNull();
  });

  it('shortens an oversized rationale instead of refusing the verdict', () => {
    const verdict = parseCompareVerdict({
      status: 'ranked',
      judgeModel: 'j',
      lanes: [],
      rationale: 'x'.repeat(10_000),
      scale,
    });

    expect(verdict?.rationale).toHaveLength(2_000);
  });
});

describe('compareVerdictFromMetadata', () => {
  it('takes the first lane message that carries a readable verdict', () => {
    const verdict = compareVerdictFromMetadata([
      null,
      undefined,
      { compareJudge: 'garbage' },
      ...stored.map((message) => message.metadata),
    ]);

    expect(verdict?.status).toBe('ranked');
  });

  it('is null when no lane message has one', () => {
    expect(compareVerdictFromMetadata([{ parallelGroupId: 'g' }])).toBeNull();
    expect(compareVerdictFromMetadata([])).toBeNull();
  });
});
