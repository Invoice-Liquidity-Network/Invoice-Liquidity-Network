import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvidenceViewer } from './EvidenceViewer';
import type { DisputeEvidence } from '@iln/shared';

describe('EvidenceViewer', () => {
  const mockEvidence: DisputeEvidence[] = [
    {
      id: 'ev-1',
      submitter: 'GDHK...PAYER1',
      role: 'payer',
      evidenceCid: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      description: 'Payer submission with defect screenshots.',
      fileName: 'defects.png',
      fileSize: 2048,
      submittedAt: 1700000000,
    },
    {
      id: 'ev-2',
      submitter: 'GA7T...FREELANCER1',
      role: 'freelancer',
      evidenceCid: 'ipfs://bafybeifreelancer123',
      description: 'Freelancer response with Git commit links.',
      submittedAt: 1700003600,
    },
  ];

  it('renders empty state message when evidence list is empty', () => {
    render(<EvidenceViewer evidence={[]} />);
    expect(screen.getByText('No evidence has been submitted yet for this dispute.')).toBeInTheDocument();
  });

  it('renders all evidence items with role badges and descriptions', () => {
    render(<EvidenceViewer evidence={mockEvidence} />);
    expect(screen.getByText('Payer')).toBeInTheDocument();
    expect(screen.getByText('Freelancer')).toBeInTheDocument();
    expect(screen.getByText('Payer submission with defect screenshots.')).toBeInTheDocument();
    expect(screen.getByText('Freelancer response with Git commit links.')).toBeInTheDocument();
    expect(screen.getByText('defects.png')).toBeInTheDocument();
  });
});
