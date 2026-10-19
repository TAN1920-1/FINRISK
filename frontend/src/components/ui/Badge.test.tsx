import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, RiskScore, SeverityBadge, StatusBadge } from './Badge';
import { EM_DASH } from '@/lib/format';

describe('SeverityBadge', () => {
  it('always shows the severity as text, not by colour alone', () => {
    render(<SeverityBadge severity="critical" />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('says a record has not been assessed rather than implying low severity', () => {
    render(<SeverityBadge severity={null} />);
    expect(screen.getByText('Not assessed')).toBeInTheDocument();
    expect(screen.queryByText('Low')).not.toBeInTheDocument();
  });

  it('appends a caller-supplied suffix', () => {
    render(<SeverityBadge severity="high" suffix="(residual)" />);
    expect(screen.getByText('High (residual)')).toBeInTheDocument();
  });
});

describe('StatusBadge', () => {
  it('humanises the lifecycle value', () => {
    render(<StatusBadge status="in_progress" />);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('labels a missing status as unknown', () => {
    render(<StatusBadge status={null} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});

describe('RiskScore', () => {
  it('renders the number and its 25-point scale', () => {
    render(<RiskScore score={20} severity="critical" />);
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('/25')).toBeInTheDocument();
  });

  it('exposes an accessible label naming the score', () => {
    render(<RiskScore score={12} severity="high" />);
    expect(screen.getByLabelText('Risk score 12 of 25')).toBeInTheDocument();
  });

  it('uses the caller-supplied label when one is given', () => {
    render(<RiskScore score={9} severity="medium" label="Residual risk" />);
    expect(screen.getByLabelText('Residual risk: 9 of 25')).toBeInTheDocument();
  });

  it('states that no score has been recorded instead of showing a zero', () => {
    render(<RiskScore score={null} />);
    expect(screen.getByText('Not assessed')).toBeInTheDocument();
    expect(screen.queryByText(EM_DASH)).not.toBeInTheDocument();
  });

  it('still renders a real zero score', () => {
    render(<RiskScore score={0} severity="low" />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

describe('Badge', () => {
  it('renders children with an optional title for a tooltip', () => {
    render(<Badge title="Derived from the register">Draft</Badge>);
    expect(screen.getByTitle('Derived from the register')).toHaveTextContent('Draft');
  });
});
