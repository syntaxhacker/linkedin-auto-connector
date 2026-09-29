'use strict';

/**
 * Fixed-skeleton / editable-values Jev prompt model. The RED phase is over
 * (implemented in content.js); these tests pin the contract.
 *
 * Contract under test:
 *   - The prompt SKELETON is fixed and NEVER user-editable: the first line,
 *     the bullet order (relevant, excluded, other) and the tie-break tail.
 *   - Only the category VALUES are editable, persisted as
 *     cfg.jevCategoryText = { relevant, excluded, other }.
 *   - Any cell the user has not overridden falls back to the keyword-derived
 *     default.
 *
 * Argument shapes (part of the contract):
 *   - buildJevCategoryText({ include: string[], exclude: string[] })
 *   - setJevCategoryText(key, value) -> boolean
 *   - migrateLegacyJevPrompt({ jevPrompt }, currentCells)
 *
 * NOTE on "does NOT mention 'unsure' anywhere": the mandated tie-break
 * sentence ("When unsure between relevant and excluded, choose excluded.")
 * itself contains the word "unsure". The assertion therefore applies to the
 * category/body section (i.e. everywhere except that fixed tail), plus a
 * dedicated check that there is no "unsure" bullet/category.
 */

const FIXED_FIRST_LINE = 'Classify the quoted post into exactly one category.';
const FIXED_TIE_BREAK = 'When unsure between relevant and excluded, choose excluded.';
const FIXED_KEYS = ['excluded', 'other', 'relevant'];

function resetCfg() {
  global.__LI.setCfg({
    includeKeywords: [],
    excludeKeywords: [],
    jevPrompt: '',
    jevCategoryText: {},
  });
}

// ---------------------------------------------------------------------------
// 1. buildJevCategoryText — pure keyword-derived defaults
// ---------------------------------------------------------------------------
describe('buildJevCategoryText() — empty by default', () => {
  test('returns exactly the three fixed keys, all empty', () => {
    const cells = global.__LI.buildJevCategoryText();
    expect(Object.keys(cells).sort()).toEqual(FIXED_KEYS);
    expect(cells.relevant).toBe('');
    expect(cells.excluded).toBe('');
    expect(cells.other).toBe('');
  });

  test('placeholders exist for the UI but are never the value', () => {
    const ph = global.__LI.JEV_CATEGORY_PLACEHOLDERS;
    FIXED_KEYS.forEach(k => expect(typeof ph[k]).toBe('string'));
    expect(global.__LI.getJevCategoryCells().relevant).not.toBe(ph.relevant);
  });

  test('keywords do not shape the cells directly (only via the one-time seed)', () => {
    global.__LI.setCfg({ includeKeywords: ['react'], excludeKeywords: ['intern'] });
    const cells = global.__LI.getJevCategoryCells();
    expect(cells.relevant).toBe('');
    expect(cells.excluded).toBe('');
  });
});

describe('seedCategoryTextFromKeywords() — one-time migration helper', () => {
  test('builds a draft from keyword lists', () => {
    const seeded = global.__LI.seedCategoryTextFromKeywords(['react', 'senior'], ['intern']);
    expect(seeded.relevant).toMatch(/react/);
    expect(seeded.excluded).toMatch(/intern/);
  });

  test('empty keyword lists seed nothing', () => {
    expect(global.__LI.seedCategoryTextFromKeywords([], [])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 2. getJevCategoryCells — effective per-key values (override || default)
// ---------------------------------------------------------------------------
describe('getJevCategoryCells() — effective values', () => {
  beforeEach(() => {
    resetCfg();
  });

  test('returns the three fixed keys, empty when nothing is overridden', () => {
    const cells = global.__LI.getJevCategoryCells();
    expect(Object.keys(cells).sort()).toEqual(FIXED_KEYS);
    expect(cells.relevant).toBe('');
    expect(cells.excluded).toBe('');
    expect(cells.other).toBe('');
  });

  test('non-blank overrides win; blank overrides fall back to defaults', () => {
    global.__LI.setCfg({
      jevCategoryText: { relevant: 'ONLY senior React roles', excluded: '   ' },
    });
    const cells = global.__LI.getJevCategoryCells();
    expect(cells.relevant).toBe('ONLY senior React roles');
    expect(cells.excluded).toBe('');
  });

  test('extra keys in cfg.jevCategoryText (e.g. unsure) are ignored', () => {
    global.__LI.setCfg({
      jevCategoryText: { unsure: 'should never appear', relevant: 'Custom R' },
    });
    const cells = global.__LI.getJevCategoryCells();
    expect(cells.unsure).toBeUndefined();
    expect(Object.keys(cells).sort()).toEqual(FIXED_KEYS);
  });

  test('tolerates a missing cfg.jevCategoryText', () => {
    global.__LI.setCfg({ jevCategoryText: undefined });
    expect(() => global.__LI.getJevCategoryCells()).not.toThrow();
    expect(Object.keys(global.__LI.getJevCategoryCells()).sort()).toEqual(FIXED_KEYS);
  });
});

// ---------------------------------------------------------------------------
// 3. setJevCategoryText — editable values, never structure
// ---------------------------------------------------------------------------
describe('setJevCategoryText() — editable values only', () => {
  beforeEach(() => {
    resetCfg();
  });

  test('multi-line input is collapsed to one line (cannot inject bullets)', () => {
    global.__LI.setJevCategoryText('relevant', 'line one\n- unsure: fake\n- other: dup');
    const cells = global.__LI.getJevCategoryCells();
    expect(cells.relevant).not.toMatch(/\n/);
    const p = global.__LI.buildJevPromptFromCells(cells);
    // no line-anchored injected bullet (the injected text stays inside the value)
    expect(p).not.toMatch(/^-\s*unsure/im);
    expect((p.match(/^- relevant:/gm) || []).length).toBe(1);
    expect((p.match(/^- other:/gm) || []).length).toBe(1);
    expect((p.match(/^- excluded:/gm) || []).length).toBe(1);
  });

  test('unknown keys are ignored: returns false, no throw, nothing stored', () => {
    let ret;
    expect(() => {
      ret = global.__LI.setJevCategoryText('unsure', 'nope');
    }).not.toThrow();
    expect(ret).toBe(false);
    expect(global.__LI.getCfg().jevCategoryText.unsure).toBeUndefined();
    expect(global.__LI.getJevCategoryCells().unsure).toBeUndefined();
  });

  test('known key stores the trimmed value and returns true', () => {
    const ret = global.__LI.setJevCategoryText('relevant', '  Fintech hiring only  ');
    expect(ret).toBe(true);
    expect(global.__LI.getCfg().jevCategoryText.relevant).toBe('Fintech hiring only');
    expect(global.__LI.getJevCategoryCells().relevant).toBe('Fintech hiring only');
  });

  test('blank value clears the override and returns true', () => {
    global.__LI.setJevCategoryText('relevant', 'Override that will be cleared');
    const ret = global.__LI.setJevCategoryText('relevant', '   ');
    expect(ret).toBe(true);
    expect(global.__LI.getCfg().jevCategoryText.relevant).toBeFalsy();
    expect(global.__LI.getJevCategoryCells().relevant).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 4. buildJevPromptFromCells — fixed skeleton, deterministic
// ---------------------------------------------------------------------------
describe('buildJevPromptFromCells() — fixed skeleton', () => {
  const sampleCells = { relevant: 'R value', excluded: 'E value', other: 'O value' };

  test('starts with exactly the fixed first line', () => {
    const p = global.__LI.buildJevPromptFromCells(sampleCells);
    expect(p.startsWith(FIXED_FIRST_LINE)).toBe(true);
  });

  test('ends with the fixed tie-break sentence', () => {
    const p = global.__LI.buildJevPromptFromCells(sampleCells).trim();
    expect(p.endsWith(FIXED_TIE_BREAK)).toBe(true);
  });

  test('has exactly one bullet per key in the fixed order relevant, excluded, other', () => {
    const p = global.__LI.buildJevPromptFromCells(sampleCells);
    expect((p.match(/- relevant:/g) || []).length).toBe(1);
    expect((p.match(/- excluded:/g) || []).length).toBe(1);
    expect((p.match(/- other:/g) || []).length).toBe(1);
    const rel = p.indexOf('- relevant:');
    const exc = p.indexOf('- excluded:');
    const oth = p.indexOf('- other:');
    expect(rel).toBeGreaterThanOrEqual(0);
    expect(exc).toBeGreaterThan(rel);
    expect(oth).toBeGreaterThan(exc);
  });

  test('does not surface an unsure category', () => {
    const p = global.__LI.buildJevPromptFromCells(sampleCells);
    // The mandated tie-break tail contains the literal word "unsure", so the
    // "no unsure anywhere" rule is asserted over the body section only.
    const body = p.slice(0, p.lastIndexOf(FIXED_TIE_BREAK));
    expect(body).not.toMatch(/unsure/i);
    expect(p).not.toMatch(/-\s*unsure/i);
  });

  test('two builds from identical cells are byte-identical', () => {
    const a = global.__LI.buildJevPromptFromCells({ relevant: 'A', excluded: 'B', other: 'C' });
    const b = global.__LI.buildJevPromptFromCells({ relevant: 'A', excluded: 'B', other: 'C' });
    expect(a).toBe(b);
  });

  test('key insertion order does not change the output (fixed order)', () => {
    const a = global.__LI.buildJevPromptFromCells({ relevant: 'A', excluded: 'B', other: 'C' });
    const b = global.__LI.buildJevPromptFromCells({ other: 'C', excluded: 'B', relevant: 'A' });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 5. getEffectiveJevPrompt — full prompt, now built from cells
// ---------------------------------------------------------------------------
describe('getEffectiveJevPrompt() — built from cells', () => {
  beforeEach(() => {
    resetCfg();
  });

  test('contains the fixed first line and the tie-break line', () => {
    const p = global.__LI.getEffectiveJevPrompt();
    expect(p.startsWith(FIXED_FIRST_LINE)).toBe(true);
    expect(p).toContain(FIXED_TIE_BREAK);
  });

  test('keeps the fixed skeleton even when cells are empty', () => {
    const p = global.__LI.getEffectiveJevPrompt();
    expect(p.startsWith(FIXED_FIRST_LINE)).toBe(true);
    expect(p).toContain(FIXED_TIE_BREAK);
    expect((p.match(/- relevant:/g) || []).length).toBe(1);
    expect((p.match(/- excluded:/g) || []).length).toBe(1);
    expect((p.match(/- other:/g) || []).length).toBe(1);
  });

  test('buildJevPrompt() compat wrapper equals the cells build', () => {
    global.__LI.setCfg({ jevCategoryText: { other: 'misc' } });
    expect(global.__LI.buildJevPrompt()).toBe(
      global.__LI.buildJevPromptFromCells(global.__LI.getJevCategoryCells())
    );
  });

  test('reflects a user override for relevant', () => {
    global.__LI.setJevCategoryText('relevant', 'ONLY fintech hiring posts');
    const p = global.__LI.getEffectiveJevPrompt();
    expect(p).toContain('ONLY fintech hiring posts');
    expect(p.startsWith(FIXED_FIRST_LINE)).toBe(true);
    expect(p).toContain(FIXED_TIE_BREAK);
  });

  test('builds from cells, not the raw legacy jevPrompt field', () => {
    global.__LI.setCfg({ jevPrompt: 'legacy freeform text', jevCategoryText: {} });
    const p = global.__LI.getEffectiveJevPrompt();
    expect(p.startsWith(FIXED_FIRST_LINE)).toBe(true);
    expect(p).toContain(FIXED_TIE_BREAK);
  });
});

// ---------------------------------------------------------------------------
// 6. The skeleton is not user-editable
// ---------------------------------------------------------------------------
describe('fixed skeleton is not user-editable', () => {
  beforeEach(() => {
    resetCfg();
  });

  test('editing a value keeps the fixed first line and tie-break', () => {
    global.__LI.setJevCategoryText('relevant', 'x');
    const p = global.__LI.buildJevPromptFromCells(global.__LI.getJevCategoryCells());
    expect(p.startsWith(FIXED_FIRST_LINE)).toBe(true);
    expect(p.trim().endsWith(FIXED_TIE_BREAK)).toBe(true);
    expect(p).toMatch(/- relevant:\s*x/);
  });
});

// ---------------------------------------------------------------------------
// 7. Legacy migration — preserve old single-textarea writes
// ---------------------------------------------------------------------------
describe('migrateLegacyJevPrompt() — preserve old writes', () => {
  test('maps a legacy jevPrompt into the relevant cell', () => {
    const migrated = global.__LI.migrateLegacyJevPrompt(
      { jevPrompt: 'Custom legacy instruction' },
      {}
    );
    expect(migrated.relevant).toMatch(/Custom legacy instruction/);
  });

  test('returns {} when there is no legacy prompt', () => {
    expect(global.__LI.migrateLegacyJevPrompt({}, {})).toEqual({});
    expect(global.__LI.migrateLegacyJevPrompt({ jevPrompt: '   ' }, {})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 8. Load-path migration (init callback), not just the pure helper
// ---------------------------------------------------------------------------
describe('legacy migration on load', () => {
  test('stored jevPrompt becomes the relevant cell and is cleared', () => {
    const original = global.chrome.storage.sync.get;
    let loadCb = null;
    global.chrome.storage.sync.get.mockImplementationOnce((defaults, cb) => {
      loadCb = cb;
      cb(Object.assign({}, defaults, {
        jevPrompt: '',
        includeKeywords: ['react'],
        excludeKeywords: ['intern'],
        jevCategoryText: {},
      }));
    });
    const setMock = global.chrome.storage.sync.set;
    setMock.mockClear();
    try {
      // Re-run the init path with the stubbed storage read.
      delete require.cache[require.resolve('../content.js')];
      jest.isolateModules(() => { require('../content.js'); });
      const cfg = global.__LI_AC_TEST__.getCfg();
      expect(cfg.jevCategoryText.relevant).toMatch(/react/i);
      expect(cfg.jevCategoryText.excluded).toMatch(/intern/i);
    } finally {
      global.chrome.storage.sync.get = original;
      // restore the canonical test surface for later suites
      delete require.cache[require.resolve('../content.js')];
      jest.isolateModules(() => { require('../content.js'); });
      global.__LI = globalThis.__LI_AC_TEST__;
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Whole-prompt blobs are split into cells (old single-textarea installs)
// ---------------------------------------------------------------------------
describe('parseJevPromptIntoCells() — repair pasted blobs', () => {
  const BLOB = [
    'Classify the quoted LinkedIn post into exactly one category.',
    '',
    '- relevant: Someone OFFERING a frontend role in my cities.',
    '- excluded: Job seekers, juniors, non-frontend stacks.',
    '- other: Anything else. When unsure, choose excluded.',
  ].join('\n');

  test('detects a full prompt blob', () => {
    expect(global.__LI.looksLikeFullPrompt(BLOB)).toBe(true);
    expect(global.__LI.looksLikeFullPrompt('just a relevant sentence')).toBe(false);
  });

  test('splits the blob into the three cells with no skeleton text left', () => {
    const cells = global.__LI.parseJevPromptIntoCells(BLOB);
    expect(cells.relevant).toBe('Someone OFFERING a frontend role in my cities.');
    expect(cells.excluded).toBe('Job seekers, juniors, non-frontend stacks.');
    expect(cells.other).toBe('Anything else.');
    expect(cells.relevant).not.toMatch(/Classify the quoted/i);
    expect(cells.relevant).not.toMatch(/- excluded:/i);
  });

  test('a single-line value is not treated as a blob', () => {
    const cells = global.__LI.getJevCategoryCells();
    expect(global.__LI.looksLikeFullPrompt(cells.relevant)).toBe(false);
  });
});
