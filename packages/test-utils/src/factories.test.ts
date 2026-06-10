import { describe, it, expect } from 'vitest'
import {
  createInvoice,
  createReputationScore,
  createGovernanceProposal,
  createLPStats,
  createContractStats
} from './factories'
import { ProposalStatus } from '../../../sdk/src/governance-types'

describe('Factories', () => {
  describe('createInvoice', () => {
    it('returns valid default fields', () => {
      const invoice = createInvoice()
      expect(typeof invoice.id).toBe('bigint')
      expect(typeof invoice.freelancer).toBe('string')
      expect(typeof invoice.amount).toBe('bigint')
      expect(typeof invoice.dueDate).toBe('number')
      expect(invoice.status).toBe('Pending')
    })

    it('applies overrides', () => {
      const invoice = createInvoice({ status: 'Funded' })
      expect(invoice.status).toBe('Funded')
    })

    it('returns different random data', () => {
      const a = createInvoice()
      const b = createInvoice()
      expect(a.id === b.id && a.freelancer === b.freelancer).toBe(false)
    })
  })

  describe('createReputationScore', () => {
    it('returns valid default fields', () => {
      const score = createReputationScore()
      expect(typeof score.address).toBe('string')
      expect(typeof score.score).toBe('number')
    })

    it('applies overrides', () => {
      const score = createReputationScore({ score: 99 })
      expect(score.score).toBe(99)
    })

    it('returns different random data', () => {
      const a = createReputationScore()
      const b = createReputationScore()
      expect(a.address === b.address).toBe(false)
    })
  })

  describe('createGovernanceProposal', () => {
    it('returns valid default fields', () => {
      const proposal = createGovernanceProposal()
      expect(typeof proposal.id).toBe('bigint')
      expect(proposal.status).toBe(ProposalStatus.Active)
    })

    it('applies overrides', () => {
      const proposal = createGovernanceProposal({ status: ProposalStatus.Passed })
      expect(proposal.status).toBe(ProposalStatus.Passed)
    })

    it('returns different random data', () => {
      const a = createGovernanceProposal()
      const b = createGovernanceProposal()
      expect(a.id === b.id && a.proposer === b.proposer).toBe(false)
    })
  })

  describe('createLPStats', () => {
    it('returns valid default fields', () => {
      const stats = createLPStats()
      expect(typeof stats.address).toBe('string')
      expect(typeof stats.totalFunded).toBe('bigint')
    })

    it('applies overrides', () => {
      const stats = createLPStats({ activeInvoices: 42 })
      expect(stats.activeInvoices).toBe(42)
    })

    it('returns different random data', () => {
      const a = createLPStats()
      const b = createLPStats()
      expect(a.address === b.address).toBe(false)
    })
  })

  describe('createContractStats', () => {
    it('returns valid default fields', () => {
      const stats = createContractStats()
      expect(typeof stats.totalInvoices).toBe('number')
      expect(typeof stats.totalVolume).toBe('bigint')
    })

    it('applies overrides', () => {
      const stats = createContractStats({ totalInvoices: 999 })
      expect(stats.totalInvoices).toBe(999)
    })

    it('returns different random data', () => {
      const a = createContractStats()
      const b = createContractStats()
      expect(a.totalVolume === b.totalVolume && a.totalInvoices === b.totalInvoices).toBe(false)
    })
  })
})
