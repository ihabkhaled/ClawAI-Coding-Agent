import { z } from 'zod';

import type { RuntimeBindingStorePort } from './backend-runtime-transport';
import type { RuntimeCommandBinding } from '../backend/backend-client.types';
export interface RuntimeBindingMemento {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}

const bindingSchema = z
  .object({
    threadId: z.string().min(1).max(200),
    runId: z.string().min(1).max(200),
    generation: z.string().min(1).max(200),
    epochs: z
      .object({
        account: z.number().int().nonnegative(),
        workspace: z.number().int().nonnegative(),
        target: z.number().int().nonnegative(),
        policy: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export class VscodeRuntimeBindingStore implements RuntimeBindingStorePort {
  private readonly key = 'clawAI.runtimeBindings.v2';

  constructor(private readonly state: RuntimeBindingMemento) {}

  load(runId: string): Promise<RuntimeCommandBinding | undefined> {
    const bindings = this.read();
    return Promise.resolve(bindings.find((binding) => binding.runId === runId));
  }

  async save(binding: RuntimeCommandBinding): Promise<void> {
    const bindings = this.read().filter(({ runId }) => runId !== binding.runId);
    await this.state.update(this.key, [...bindings.slice(-99), binding]);
  }

  async delete(runId: string): Promise<void> {
    await this.state.update(
      this.key,
      this.read().filter((binding) => binding.runId !== runId),
    );
  }

  private read(): RuntimeCommandBinding[] {
    return z
      .array(bindingSchema)
      .max(100)
      .parse(this.state.get(this.key) ?? []);
  }
}
