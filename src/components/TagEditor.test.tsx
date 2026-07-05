import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TagEditor } from './TagEditor';
import type { TagSuggestion } from './tagEditorModel';

const suggestions: TagSuggestion[] = [
  { tag: 'family', count: 3 },
  { tag: 'food', count: 2 },
  { tag: 'garden', count: 2 },
  { tag: 'architecture', count: 1 },
];

describe('TagEditor', () => {
  it('shows existing tags and no resting text input', () => {
    render(<TagEditor label="Home Tags" tags={['family']} suggestions={suggestions} onChange={vi.fn()} />);

    expect(screen.getByRole('group', { name: 'Home Tags' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove tag family' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Add tag' })).not.toBeInTheDocument();
  });

  it('shows a compact empty state before adding tags', () => {
    render(<TagEditor label="Home Tags" tags={[]} suggestions={suggestions} onChange={vi.fn()} />);

    expect(screen.getByText('No tags yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument();
  });

  it('opens an upward add popover with useful suggestions before typing', async () => {
    const user = userEvent.setup();

    render(<TagEditor label="Home Tags" tags={[]} suggestions={suggestions} onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Add tag' }));

    expect(screen.getByRole('textbox', { name: 'Add tag' })).toHaveFocus();
    const list = screen.getByRole('listbox', { name: 'Tag suggestions' });
    expect(within(list).getByRole('button', { name: 'Add tag suggestion family' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Add tag suggestion food' })).toBeInTheDocument();
  });

  it('adds comma-separated tags and dedupes case-insensitively', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<TagEditor label="Home Tags" tags={['Food']} suggestions={suggestions} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Add tag' }));
    await user.type(screen.getByRole('textbox', { name: 'Add tag' }), 'food, garden{Enter}');

    expect(onChange).toHaveBeenCalledWith(['Food', 'garden']);
  });

  it('filters suggestions by typed query and excludes current tags', async () => {
    const user = userEvent.setup();

    render(<TagEditor label="Home Tags" tags={['food']} suggestions={suggestions} onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Add tag' }));
    await user.type(screen.getByRole('textbox', { name: 'Add tag' }), 'ar');

    const list = screen.getByRole('listbox', { name: 'Tag suggestions' });
    expect(within(list).getByRole('button', { name: 'Add tag suggestion architecture' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Add tag suggestion garden' })).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: 'Add tag suggestion food' })).not.toBeInTheDocument();
  });

  it('adds a clicked suggestion and keeps the popover open', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<TagEditor label="Home Tags" tags={[]} suggestions={suggestions} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Add tag' }));
    await user.click(screen.getByRole('button', { name: 'Add tag suggestion family' }));

    expect(onChange).toHaveBeenCalledWith(['family']);
    expect(screen.getByRole('textbox', { name: 'Add tag' })).toBeInTheDocument();
  });

  it('closes without committing typed text when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<TagEditor label="Home Tags" tags={[]} suggestions={suggestions} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Add tag' }));
    await user.type(screen.getByRole('textbox', { name: 'Add tag' }), 'draft');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Add tag' }), { key: 'Escape' });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Add tag' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tag' })).toHaveFocus();
  });
});
