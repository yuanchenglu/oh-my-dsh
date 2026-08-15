import { describe, expect, it } from 'vitest'
import { buildPressureEvent, createZoneSection, PRESSURE_THRESHOLD, type Zone } from '../../src/shared/context-zones.js'

describe('four-zone context budget', () => {
  it('describes stable content with source, ttl, and estimated tokens', () => {
    const section = createZoneSection('stable', 'cognition-gate', 'session', 12)
    expect(section).toEqual({ zone: 'stable', source: 'cognition-gate', ttl: 'session', estimatedTokens: 12, priority: 0 })
  })

  it('emits a pressure signal without eviction instructions', () => {
    const zones: Record<Zone, ReturnType<typeof createZoneSection>> = {
      stable: createZoneSection('stable', 'constraints', 'session', 10),
      evidence: createZoneSection('evidence', 'tests', 'turn', 5),
      active: createZoneSection('active', 'workspace', 'turn', 8),
      external: createZoneSection('external', 'index', 'ttl', 2),
    }
    const event = buildPressureEvent(zones, PRESSURE_THRESHOLD - 1)
    expect(event.totalEstimatedTokens).toBe(25)
    expect(event.zones.stable).toEqual(zones.stable)
    expect(event.suggestedAction).toContain('stable')
    expect(event.suggestedAction).not.toContain('delete')
  })
})
