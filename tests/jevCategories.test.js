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
describe('buildJevCategoryText() — keyword-derived defaults', () => {
  test('returns exactly the three fixed keys', () => {
    const cells = global.__LI.buildJevCategoryText({ include: [], exclude: [] });
    expect(Object.keys(cells).sort()).toEqual(FIXED_KEYS);
  });

  test('relevant default mentions hiring/job/role', () => {
    const cells = global.__LI.buildJevCategoryText({ include: [], exclude: [] });
    expect(cells.relevant).toMatch(/hiring|job|role/i);
  });

  test('excluded default mentions not-interested / off-topic', () => {
    const cells = global.__LI.buildJevCategoryText({ include: [], exclude: [] });
    expect(cells.excluded).toMatch(/not interested|off.?topic/i);
  });

  test('other default is a short "anything else" string', () => {
    const cells = global.__LI.buildJevCategoryText({ include: [], exclude: [] });
    expect(cells.other).toMatch(/anything else/i);
    expect(cells.other.length).toBeLessThan(120);
  });

  test('include keywords flow into relevant; exclude keywords into excluded', () => {
    const cells = global.__LI.buildJevCategoryText({
      include: ['react', 'senior'],
      exclude: ['intern'],
    });
    expect(cells.relevant).toMatch(/react/i);
    expect(cells.relevant).toMatch(/senior/i);
    expect(cells.excluded).toMatch(/intern/i);
    expect(Object.keys(cells).sort()).toEqual(FIXED_KEYS);
  });
});

// ---------------------------------------------------------------------------
// 2. getJevCategoryCells — effective per-key values (override || default)
// ---------------------------------------------------------------------------
describe('getJevCategoryCells() — effective values', () => {
  beforeEach(() => {
    resetCfg();
  });

  test('returns the three fixed keys with defaults when nothing is overridden', () => {
    const cells = global.__LI.getJevCategoryCells();
    expect(Object.keys(cells).sort()).toEqual(FIXED_KEYS);
    expect(cells.relevant).toMatch(/hiring|job|role/i);
    expect(cells.excluded).toMatch(/not interested|off.?topic/i);
    expect(cells.other).toMatch(/anything else/i);
  });

  test('non-blank overrides win; blank overrides fall back to defaults', () => {
    global.__LI.setCfg({
      includeKeywords: ['react'],
      jevCategoryText: { relevant: 'ONLY senior React roles', excluded: '   ' },
    });
    const cells = global.__LI.getJevCategoryCells();
    expect(cells.relevant).toBe('ONLY senior React roles');
    expect(cells.excluded).toMatch(/not interested|off.?topic/i);
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
    expect(global.__LI.getJevCategoryCells().relevant).toMatch(/hiring|job|role/i);
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
    global.__LI.setCfg({ includeKeywords: ['react'] });
    const p = global.__LI.getEffectiveJevPrompt();
    expect(p.startsWith(FIXED_FIRST_LINE)).toBe(true);
    expect(p).toContain(FIXED_TIE_BREAK);
  });

  test('reflects keyword-derived values on the fixed skeleton', () => {
    global.__LI.setCfg({ includeKeywords: ['react'], excludeKeywords: ['intern'] });
    const p = global.__LI.getEffectiveJevPrompt();
    expect(p.startsWith(FIXED_FIRST_LINE)).toBe(true);
    expect(p).toMatch(/react/i);
    expect(p).toMatch(/intern/i);
  });

  test('buildJevPrompt() compat wrapper equals the cells build', () => {
    global.__LI.setCfg({ includeKeywords: ['react'], jevCategoryText: { other: 'misc' } });
    expect(global.__LI.buildJevPrompt()).toBe(
      global.__LI.buildJevPromptFromCells(global.__LI.getJevCategoryCells())
    );
  });

  test('reflects a user override for relevant', () => {
    global.__LI.setCfg({ includeKeywords: ['react'] });
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
      cb(Object.assign({}, defaults, { jevPrompt: 'Legacy single-textarea text', jevCategoryText: {} }));
    });
    const setMock = global.chrome.storage.sync.set;
    setMock.mockClear();
    try {
      // Re-run the init path with the stubbed storage read.
      delete require.cache[require.resolve('../content.js')];
      jest.isolateModules(() => { require('../content.js'); });
      const cfg = global.__LI_AC_TEST__.getCfg();
      expect(cfg.jevCategoryText.relevant).toMatch(/Legacy single-textarea text/);
      expect(cfg.jevPrompt).toBe('');
      expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ jevPrompt: '' }));
    } finally {
      global.chrome.storage.sync.get = original;
      // restore the canonical test surface for later suites
      delete require.cache[require.resolve('../content.js')];
      jest.isolateModules(() => { require('../content.js'); });
      global.__LI = globalThis.__LI_AC_TEST__;
    }
  });
});
