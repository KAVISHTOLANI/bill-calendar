import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

const KEY = 'dueboard:store';

describe('Dueboard', () => {
  it('shows this month with the overdue demo bill', () => {
    window.location.hash = '/calendar';
    render(<App />);
    expect(screen.getByTestId('month-summary')).toHaveTextContent('Overdue');
    expect(screen.getByRole('grid', { name: /Bills in/ })).toBeInTheDocument();
    expect(screen.getAllByText('Council tax').length).toBeGreaterThan(0);
  });

  it('marks a bill paid with the real amount and can undo', async () => {
    window.location.hash = '/calendar';
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Amount paid for Council tax');
    await user.clear(input);
    await user.type(input, '133.10');
    const item = input.closest('li')!;
    await user.click(within(item).getByRole('button', { name: 'Mark paid' }));
    expect(screen.getByText('Council tax marked paid ($133.10).')).toBeInTheDocument();
  });

  it('rejects a bad amount', async () => {
    window.location.hash = '/calendar';
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByLabelText('Amount paid for Council tax');
    await user.clear(input);
    await user.click(within(input.closest('li')!).getByRole('button', { name: 'Mark paid' }));
    expect(screen.getByText('Enter the amount paid for Council tax.')).toBeInTheDocument();
  });

  it('adds a quarterly bill with validation and a live preview', async () => {
    localStorage.setItem(KEY, JSON.stringify({ bills: [], payments: [] }));
    window.location.hash = '/bills';
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText('No bills yet')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Add bill' }));
    await user.click(await screen.findByRole('button', { name: 'Save bill' }));
    expect(screen.getByText('Name the bill.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Bill name'), 'Water');
    await user.type(screen.getByLabelText('Amount (USD)'), '90');
    await user.clear(screen.getByLabelText('Every (months)'));
    await user.type(screen.getByLabelText('Every (months)'), '3');
    expect(screen.getByText('$360.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save bill' }));
    expect(await screen.findByRole('link', { name: 'Water' })).toBeInTheDocument();
    expect(screen.getByText(/Quarterly on the/)).toBeInTheDocument();
  });

  it('shows the year ahead', () => {
    window.location.hash = '/year';
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Cost per year, by bill' })).toBeInTheDocument();
    expect(screen.getByText('$13,800.00')).toBeInTheDocument();
  });
});
