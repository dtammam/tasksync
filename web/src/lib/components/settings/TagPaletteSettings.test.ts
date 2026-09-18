import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import TagPaletteSettings from './TagPaletteSettings.svelte';

const CUSTOM = [
	{
		section: 'Custom',
		entries: [
			{ emoji: '🚀', label: 'Launch' },
			{ emoji: '🛰️', label: 'Orbit' }
		]
	}
];

let currentPaletteValue = CUSTOM;
const saveMock = vi.fn();

vi.mock('$lib/stores/tagPalette', () => ({
	tagPalette: { save: (next: unknown) => saveMock(next) },
	currentTagPalette: () => currentPaletteValue
}));

describe('TagPaletteSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		currentPaletteValue = CUSTOM;
	});

	it('renders the current palette contents on mount', () => {
		const { getByDisplayValue } = render(TagPaletteSettings);
		expect(getByDisplayValue('Custom')).toBeTruthy();
		expect(getByDisplayValue('Launch')).toBeTruthy();
		expect(getByDisplayValue('🚀')).toBeTruthy();
	});

	it('Save is disabled until something changes', () => {
		const { getByText } = render(TagPaletteSettings);
		expect(getByText('Save changes').closest('button')).toBeDisabled();
	});

	it('adding a section marks the form dirty and enables Save', async () => {
		const { getByText } = render(TagPaletteSettings);
		await fireEvent.click(getByText('+ Add section'));
		expect(getByText('Save changes').closest('button')).not.toBeDisabled();
		expect(getByText('Unsaved changes')).toBeTruthy();
	});

	it('deleting a tag removes it from the draft', async () => {
		const { getAllByText, queryByDisplayValue } = render(TagPaletteSettings);
		await fireEvent.click(getAllByText('Delete')[0]);
		expect(queryByDisplayValue('Launch')).toBeNull();
	});

	it('rejects saving a palette with a duplicate emoji, client-side, without calling save', async () => {
		const { getByText, getAllByLabelText } = render(TagPaletteSettings);
		const emojiInputs = getAllByLabelText('Tag emoji') as HTMLInputElement[];
		await fireEvent.input(emojiInputs[1], { target: { value: '🚀' } });

		await fireEvent.click(getByText('Save changes'));

		expect(saveMock).not.toHaveBeenCalled();
		expect(getByText(/used more than once/)).toBeTruthy();
	});

	it('saves the draft and shows a confirmation on success', async () => {
		saveMock.mockResolvedValue(CUSTOM);
		const { getByText, getByDisplayValue } = render(TagPaletteSettings);
		await fireEvent.input(getByDisplayValue('Launch'), { target: { value: 'Liftoff' } });

		await fireEvent.click(getByText('Save changes'));
		await Promise.resolve();
		await Promise.resolve();

		expect(saveMock).toHaveBeenCalled();
		expect(getByText('Saved.')).toBeTruthy();
	});

	it('shows an empty state once every section is removed, with confirmation for a non-empty section', async () => {
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
		const { getByText } = render(TagPaletteSettings);

		await fireEvent.click(getByText('Delete section'));

		expect(confirmSpy).toHaveBeenCalled();
		expect(getByText('No tags yet. Add a section below to get started.')).toBeTruthy();
		confirmSpy.mockRestore();
	});

	it('keeps a non-empty section when the cascade-delete confirm is declined', async () => {
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
		const { getByText, getByDisplayValue } = render(TagPaletteSettings);

		await fireEvent.click(getByText('Delete section'));

		expect(getByDisplayValue('Custom')).toBeTruthy();
		confirmSpy.mockRestore();
	});
});
