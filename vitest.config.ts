import { defineConfig } from 'vitest/config'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
  resolve: {
    alias: {
      '@deepseek-ai/schemastery': resolve(__dirname, 'tests/stubs/schemastery.ts'),
      '@deepseek-ai/cordis': resolve(__dirname, 'tests/stubs/cordis.ts'),
      '@deepseek-ai/dsh-tools': resolve(__dirname, 'tests/stubs/dsh-tools.ts'),
    },
  },
})
