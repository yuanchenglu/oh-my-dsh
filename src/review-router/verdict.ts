import type { RiskAssessment, RiskLevel } from '../shared/risk.js'

export type ReviewMode = 'M0' | 'M1' | 'M4'
export type VerdictKind = 'pass' | 'ask' | 'reject' | 'defer'

export interface RiskRecord {
  riskLevel: RiskLevel
  blastRadius: 'single' | 'workspace' | 'external'
  reversibility: 'reversible' | 'partially-reversible' | 'irreversible'
  changedPaths: string[]
  requestedTools: string[]
  requiredEvidence: string[]
  contextHealth: 'healthy' | 'unknown'
  selectedReviewMode: ReviewMode
}

export interface Verdict {
  verdict: VerdictKind
  selectedReviewMode: ReviewMode
  checkpointRef?: string
  evidenceRefs: string[]
  reason: string
  policyVersion: string
  riskRecord: RiskRecord
}

export function selectReviewMode(assessment: RiskAssessment): ReviewMode {
  if (assessment.requiresApproval) return 'M4'
  if (assessment.requiresCheckpoint) return 'M1'
  return 'M0'
}

export function createRiskRecord(
  toolName: string,
  assessment: RiskAssessment,
  changedPaths: string[],
): RiskRecord {
  const mode = selectReviewMode(assessment)
  return {
    riskLevel: assessment.level,
    blastRadius: assessment.level === 'R4' ? 'external' : assessment.level === 'R3' ? 'workspace' : 'single',
    reversibility: assessment.level === 'R3' || assessment.level === 'R4' ? 'irreversible' : assessment.level === 'R1' ? 'partially-reversible' : 'reversible',
    changedPaths,
    requestedTools: [toolName],
    requiredEvidence: mode === 'M1' ? ['test-result'] : [],
    contextHealth: 'unknown',
    selectedReviewMode: mode,
  }
}
