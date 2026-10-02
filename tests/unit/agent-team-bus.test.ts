import { describe, expect, it } from 'vitest';

import { createTeamBus } from '../../src/sdk/agent-team-bus';

function bus() {
  const made = createTeamBus();
  for (const name of ['lead', 'a', 'b']) made.register(name);
  return made;
}

describe('the team message bus', () => {
  it('delivers in order, with the sender the caller gave', () => {
    const made = bus();
    made.post('a', 'lead', 'one');
    made.post('b', 'lead', 'two');
    expect(made.drain('lead', 1_000).map((m) => `${m.from}:${m.text}`)).toEqual(['a:one', 'b:two']);
    expect(made.pending('lead')).toBe(0);
  });

  it('numbers messages so none is mistaken for another', () => {
    const made = bus();
    const first = made.post('a', 'lead', 'x');
    const second = made.post('a', 'lead', 'y');
    expect(second.id).toBe(first.id + 1);
  });

  it('refuses an empty text and cuts a long one', () => {
    const made = bus();
    expect(() => made.post('a', 'lead', '   ')).toThrow('non-empty');
    expect(made.post('a', 'lead', 'x'.repeat(5_000)).text).toHaveLength(2_000);
  });

  it('hands out messages up to a character limit and keeps the rest for next time', () => {
    const made = bus();
    for (let index = 0; index < 5; index += 1) made.post('a', 'lead', 'x'.repeat(100));
    expect(made.drain('lead', 250)).toHaveLength(2);
    expect(made.pending('lead')).toBe(3);
    expect(made.drain('lead', 10)).toHaveLength(1);
  });

  it('refuses a closed or unknown recipient, and a message to oneself', () => {
    const made = bus();
    made.close('b');
    expect(() => made.post('a', 'b', 'x')).toThrow('has finished');
    expect(() => made.post('a', 'nobody', 'x')).toThrow('No agent named');
    expect(() => made.post('a', 'a', 'x')).toThrow('yourself');
  });

  it('refuses the 21st unread message and the 61st sent one', () => {
    const made = bus();
    for (let index = 0; index < 20; index += 1) made.post('a', 'lead', 'x');
    expect(() => made.post('a', 'lead', 'x')).toThrow('20 unread');
    for (let index = 0; index < 40; index += 1) {
      made.drain('lead', 100_000);
      made.post('a', 'lead', 'x');
    }
    made.drain('lead', 100_000);
    expect(() => made.post('a', 'lead', 'x')).toThrow('no more are accepted');
  });

  it('redacts a secret before it is stored', () => {
    const made = bus();
    made.post('a', 'lead', 'use Bearer abcdefghijklmnop1234567890 now');
    expect(made.drain('lead', 1_000)[0]?.text).not.toContain('abcdefghijklmnop1234567890');
  });

  it('tells a listener who was written to, and stops when it is removed', () => {
    const made = bus();
    const heard: string[] = [];
    const off = made.onPost((to) => heard.push(to));
    made.post('a', 'lead', 'x');
    off();
    made.post('a', 'b', 'y');
    expect(heard).toEqual(['lead']);
  });
});
