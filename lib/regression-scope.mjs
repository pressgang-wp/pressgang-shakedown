/** Explicit run scope, shared by configuration, capture and report. */
export const viewportPresets = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

export function selectViewports(configured, defaults, flag) {
  const available = new Map(viewportPresets.map(v => [v.name, v]));
  for (const v of configured ?? []) available.set(v.name, v);
  const validate = names => {
    if (!Array.isArray(names) || !names.length || names.some(n => typeof n !== 'string' || !available.has(n)) || new Set(names).size !== names.length) {
      throw new Error('Viewports must be unique known names: ' + [...available.keys()].join(', '));
    }
    return names;
  };
  if (defaults !== undefined) validate(defaults);
  const names = flag === undefined
    ? defaults ?? configured?.map(v => v.name) ?? ['desktop', 'tablet', 'mobile']
    : flag.split(',').map(n => n.trim());
  return validate(names).map(name => ({ ...available.get(name) }));
}

export function parseRegressionFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const match = args[i].match(/^--(against|candidate|level|viewports|coverage|routes)(?:=(.*))?$/);
    if (!match) throw new Error('Unsupported regression argument: ' + args[i] + '. Use --against, --candidate, --level, --viewports or --coverage.');
    const name = match[1], value = match[2] ?? args[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing regression argument value: ' + name);
    if (Object.hasOwn(flags, name)) throw new Error('Duplicate regression argument: ' + name);
    flags[name] = value;
  }
  return flags;
}

export const levels = {
  errors: {
    description: 'Candidate application health only',
    comparison: false, accessibility: false, screenshots: false,
    differenceKeys: [],
    skipped: ['Reference comparison and reference navigation discovery', 'Accessibility audit', 'Content, structure and screenshot comparison'],
  },
  core: {
    description: 'Application health, serious accessibility and core comparisons',
    comparison: true, accessibility: true, screenshots: false,
    differenceKeys: ['status', 'redirects', 'forms', 'emptyLinks'],
    skipped: ['Minor/moderate accessibility findings (axe may evaluate them)', 'Title, heading, image and layout/structure differences', 'Paired page screenshots'],
  },
  full: {
    description: 'All application, accessibility and comparison evidence',
    comparison: true, accessibility: true, screenshots: true,
    differenceKeys: ['status', 'redirects', 'title', 'h1', 'landmarks', 'forms', 'emptyLinks', 'emptyHeadings', 'images', 'structure'],
    skipped: [],
  },
};

export function runScope(options = {}) {
  const level = options.level ?? 'full';
  if (!Object.hasOwn(levels, level)) throw new Error('Unknown regression level: ' + level + '. Choose errors, core or full.');
  return { level, ...levels[level] };
}

export function reviewGroups(result) {
  const groups = [];
  const accessibility = result.candidate?.accessibility?.findings ?? [];
  const a11yMessages = new Set(accessibility.map(f => f.message));
  if (result.health.some(message => !a11yMessages.has(message))) groups.push('errors');
  if (accessibility.some(f => f.blocking)) groups.push('accessibility');
  const differences = result.differences.filter(d => !d.suppressed);
  if (differences.some(d => levels.core.differenceKeys.includes(d.key))) groups.push('core');
  if (differences.some(d => !levels.core.differenceKeys.includes(d.key)) || accessibility.some(f => !f.blocking) || result.visual?.percent > 0 || result.visual?.unavailable) groups.push('other');
  if (['inconclusive', 'unmatched'].includes(result.classification)) groups.push('inconclusive');
  return groups.length ? groups : ['clear'];
}

export const reviewLabels = {
  errors: 'Broken candidate pages',
  accessibility: 'Serious accessibility issues',
  core: 'Behaviour changes to review',
  other: 'Presentation and content changes',
  inconclusive: 'Inconclusive / unmatched',
  clear: 'No findings in selected checks',
};

/** A display verdict, distinct from route matching and scoped to collected checks. */
export function observationVerdict(result) {
  if (result.health.length) return { kind: 'failed', label: '✗ Failed', detail: 'Candidate health checks found errors.' };
  if (['inconclusive', 'unmatched'].includes(result.classification) ||
      [result.reference, result.candidate].some(side => side?.error || side?.unavailableReason)) {
    return { kind: 'incomplete', label: '? Inconclusive', detail: 'The selected checks could not establish a complete result.' };
  }
  if (result.visual?.percent > 0 || result.visual?.unavailable || result.differences.some(d => !d.suppressed) ||
      ['candidate-only', 'reference-only'].includes(result.classification) ||
      [result.reference, result.candidate].some(side => side?.advisory?.length) ||
      result.candidate?.accessibility?.findings?.length) {
    return { kind: 'review', label: '⚠ Review needed', detail: 'No candidate health failures; changes or advisories need review.' };
  }
  return { kind: 'passed', label: '✓ Passed', detail: 'Passed the selected checks only; excluded checks and test restrictions still apply.' };
}
