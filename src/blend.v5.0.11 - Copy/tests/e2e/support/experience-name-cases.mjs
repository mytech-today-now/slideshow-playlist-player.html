const DEFAULT_EXPERIENCE_NAME = 'Untitled Session';

export function buildExperienceNameCases(runSuffix) {
  const duplicateAnchor = `Collision Anchor ${runSuffix}`;
  return {
    duplicateAnchor,
    cases: [
      { id: 'valid-normal', category: 'valid', value: `Evening Mix ${runSuffix}` },
      { id: 'min-length', category: 'boundary', value: 'A' },
      { id: 'max-length-boundary', category: 'boundary', value: 'B'.repeat(128) },
      { id: 'empty', category: 'null-equivalent', value: '' },
      { id: 'whitespace-only', category: 'null-equivalent', value: '   \t   \n  ' },
      { id: 'null-literal', category: 'null-equivalent', value: 'null' },
      { id: 'invalid-chars-pattern', category: 'invalid-pattern', value: 'Bad <>:"/\\|?* Name' },
      { id: 'unicode', category: 'unicode', value: `東京 تجربة № ${runSuffix}` },
      { id: 'emoji-special', category: 'unicode', value: `Party 🎉 #${runSuffix}` },
      { id: 'leading-trailing-space', category: 'normalization', value: '   Trim   Me   ' },
      { id: 'case-collision', category: 'collision', value: duplicateAnchor.toUpperCase(), requiresCollisionSeed: true },
      { id: 'exact-duplicate', category: 'duplicate', value: duplicateAnchor, requiresCollisionSeed: true },
      { id: 'very-long-over-limit', category: 'boundary', value: `Long-${runSuffix}-` + 'x'.repeat(700) },
      { id: 'dots-only', category: 'pattern', value: '....' }
    ]
  };
}

export function normalizeExperienceNameLikeApp(value, fallback = DEFAULT_EXPERIENCE_NAME) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

export function ensureUniqueExperienceNameLikeApp(name, existingNames = [], ignoreName = '') {
  const base = normalizeExperienceNameLikeApp(name);
  const used = new Set(
    (existingNames || [])
      .filter(candidate => String(candidate || '').trim())
      .filter(candidate => String(candidate) !== String(ignoreName || ''))
      .map(candidate => normalizeExperienceNameLikeApp(candidate).toLowerCase())
  );
  if (!used.has(base.toLowerCase())) return base;
  let suffix = 2;
  let next = `${base} (${suffix})`;
  while (used.has(next.toLowerCase())) {
    suffix++;
    next = `${base} (${suffix})`;
  }
  return next;
}
