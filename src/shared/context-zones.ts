export type Zone = 'stable' | 'evidence' | 'active' | 'external'

export interface ZoneSection {
  zone: Zone
  estimatedTokens: number
  priority: number
  ttl: string
  source: string
}

export interface PressureEvent {
  zones: Record<Zone, ZoneSection>
  totalEstimatedTokens: number
  pressureThreshold: number
  suggestedAction: string
}

export const PRESSURE_THRESHOLD = 8000

export function createZoneSection(
  zone: Zone,
  source: string,
  ttl: string,
  estimatedTokens: number,
  priority = 0,
): ZoneSection {
  return { zone, source, ttl, estimatedTokens, priority }
}

export function tagZoneContent(content: string, section: ZoneSection): string {
  return `${content}\n[oh-my-dsh zone=${section.zone} source=${section.source} ttl=${section.ttl} estimatedTokens=${section.estimatedTokens}]`
}

export function buildPressureEvent(zones: Record<Zone, ZoneSection>, pressureThreshold: number): PressureEvent {
  const totalEstimatedTokens = Object.values(zones).reduce((total, section) => total + section.estimatedTokens, 0)
  return {
    zones,
    totalEstimatedTokens,
    pressureThreshold,
    suggestedAction: 'review evidence, active, and external zones; retain stable constraints',
  }
}
