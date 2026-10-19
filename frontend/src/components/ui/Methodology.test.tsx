import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpHint, MethodologyPanel } from './Methodology';

describe('MethodologyPanel', () => {
  it('starts collapsed by default', () => {
    render(<MethodologyPanel methodology="Likelihood times impact." />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Likelihood times impact.')).not.toBeInTheDocument();
  });

  it('reveals the method and its limitations when opened', async () => {
    const user = userEvent.setup();
    render(
      <MethodologyPanel
        methodology="Likelihood times impact."
        limitations="Assumes the two axes are independent."
        formula="score = l * i"
      />,
    );

    await user.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Likelihood times impact.')).toBeInTheDocument();
    expect(screen.getByText('Assumes the two axes are independent.')).toBeInTheDocument();
    expect(screen.getByText('score = l * i')).toBeInTheDocument();
  });

  it('renders the panel open when asked, and collapses on a second click', async () => {
    const user = userEvent.setup();
    render(<MethodologyPanel methodology="Documented method." defaultOpen />);
    expect(screen.getByText('Documented method.')).toBeInTheDocument();

    await user.click(screen.getByRole('button'));
    expect(screen.queryByText('Documented method.')).not.toBeInTheDocument();
  });

  it('uses a caller-supplied title', () => {
    render(<MethodologyPanel title="How this score is derived" methodology="x" />);
    expect(screen.getByText('How this score is derived')).toBeInTheDocument();
  });
});

describe('HelpHint', () => {
  it('exposes the explanation as an accessible label', () => {
    render(<HelpHint text="Gross loss is before insurance recovery." />);
    expect(screen.getByLabelText('Gross loss is before insurance recovery.')).toBeInTheDocument();
  });
});
