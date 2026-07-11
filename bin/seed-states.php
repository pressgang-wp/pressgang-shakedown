<?php
/**
 * Seeds ACF state fixtures inside a shakedown SANDBOX (never a real site —
 * the sandbox isolation witness has already proven this WordPress runs on
 * throwaway SQLite before this script is invoked).
 *
 * For every ACF field group with a seedable location target, creates two
 * published fixtures via Muster:
 *   - populated: every generatable field filled (deterministic, seeded)
 *   - minimal:   required fields only — the sparsest state an editor can
 *                legally publish, where empty-link/missing-image bugs live
 *
 * Run via: wp eval-file bin/seed-states.php <muster-autoload> <acf-json-dir> <seed>
 * Emits JSON: {"routes": [{url, kind, expect}...]} for the matrix.
 */

[$autoload, $acfJsonDir, $seed] = [$args[0], $args[1], (int) ($args[2] ?? 42)];

require_once $autoload;

use PressGang\Muster\Acf\AcfJson;
use PressGang\Muster\Acf\AcfValueGenerator;
use PressGang\Muster\Adapters\LiveAcfAdapter;
use PressGang\Muster\Builders\AttachmentBuilder;
use PressGang\Muster\Builders\PostBuilder;
use PressGang\Muster\Builders\TermBuilder;
use PressGang\Muster\MusterContext;
use PressGang\Muster\Victuals\VictualsFactory;

$context = new MusterContext(new VictualsFactory(), acf: new LiveAcfAdapter(), seed: $seed);

$generator = new AcfValueGenerator($context->victuals(), [
	'attachment' => fn (string $name): int => (new AttachmentBuilder($context, 'state-' . sanitize_title($name)))
		->placeholder(1200, 800)
		->save()
		->id(),
	'post' => function (array $types) use ($context): int {
		$type = $types[0] ?? 'post';

		return (new PostBuilder($context, $type))
			->title('State related ' . $type)
			->slug('state-related-' . sanitize_title($type))
			->status('publish')
			->save()
			->id();
	},
	'term' => fn (string $taxonomy): int => (new TermBuilder($context, $taxonomy))
		->name('State term')
		->slug('state-term')
		->save()
		->termId(),
	'user' => fn (): int => 1,
]);

$routes = [];

foreach (AcfJson::groups($acfJsonDir) as $group) {
	$targets = AcfJson::targets($group);

	if ($targets === []) {
		continue; // options pages, menu items — not seedable as a URL (v1)
	}

	$target = $targets[0];
	$slugBase = sanitize_title($group['title'] ?? $group['key']);

	foreach (['populated', 'minimal'] as $variant) {
		$fields = (array) $group['fields'];
		$values = $variant === 'populated' ? $generator->populated($fields) : $generator->minimal($fields);

		$builder = $target['param'] === 'page_template'
			? (new PostBuilder($context, 'page'))->template($target['value'])
			: new PostBuilder($context, $target['value']);

		$ref = $builder
			->title(($group['title'] ?? $group['key']) . ' — ' . $variant)
			->slug("state-{$slugBase}-{$variant}")
			->status('publish')
			->content('State fixture: ' . $slugBase . ' (' . $variant . ')')
			->acf($values)
			->save();

		$url = get_permalink($ref->id());

		if ($url) {
			$routes[] = [ 'url' => $url, 'kind' => "state:{$slugBase}:{$variant}", 'expect' => 200 ];
		}
	}
}

echo json_encode([ 'routes' => $routes ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
