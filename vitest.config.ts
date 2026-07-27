import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/{unit,integration}/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/backend/backend-client.ts',
        'src/core/configuration.ts',
        'src/core/context-collector.ts',
        'src/core/edit-plan.ts',
        'src/core/extension-state.ts',
        'src/core/model-catalog.ts',
        'src/core/redaction.ts',
        'src/core/session-vault.ts',
        'src/core/sse-decoder.ts',
        'src/services/chat-service.ts',
        'src/services/model-service.ts',
        'src/services/safe-edit-service.ts',
        'src/services/workflow-service.ts',
      ],
      thresholds: {
        branches: 80,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
  },
});
