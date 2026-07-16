<?php
/**
 * Seeds ACF state fixtures inside a shakedown SANDBOX (never a real site —
 * the sandbox isolation witness has already proven this WordPress runs on
 * throwaway SQLite before this script is invoked).
 *
 * Each ACF field group is seeded according to where it is located:
 *   - post types, page and post templates → a dedicated PAIR of fixtures,
 *     `populated` (every generatable field filled) and `minimal` (required
 *     fields only — the sparsest publishable state, where empty-link and
 *     missing-image bugs live), each with a placeholder featured image;
 *   - options pages → the populated values written once (global chrome);
 *   - the front page (`page_type=front_page`) → the populated values onto the
 *     home page, reusing a theme-assigned front page or creating one;
 *   - nav-menu-item groups → left to the theme's own seeder, whose menus carry
 *     the real structure the fields attach to.
 *
 * Run via: wp eval-file bin/seed-states.php <muster-autoload> <acf-json-dir> <seed> <epoch>
 * Emits JSON: {"routes": [{url, kind, expect}...]} for the matrix.
 */

if (count($args) < 4) {
	throw new InvalidArgumentException('seed-states.php requires Muster autoload, ACF JSON directory, seed, and epoch arguments.');
}

[$autoload, $acfJsonDir, $seed, $epoch] = [$args[0], $args[1], (int) $args[2], (string) $args[3]];

if (! preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i', $epoch)) {
	throw new InvalidArgumentException('Fixture epoch must be a timezone-qualified ISO 8601 datetime.');
}

require_once $autoload;

use PressGang\Muster\Acf\AcfJson;
use PressGang\Muster\Acf\AcfValueGenerator;
use PressGang\Muster\Adapters\LiveAcfAdapter;
use PressGang\Muster\Builders\AttachmentBuilder;
use PressGang\Muster\Builders\PostBuilder;
use PressGang\Muster\Builders\TermBuilder;
use PressGang\Muster\Clock\FixtureClock;
use PressGang\Muster\MusterContext;
use PressGang\Muster\Victuals\VictualsFactory;

$context = new MusterContext(
	new VictualsFactory(),
	acf: new LiveAcfAdapter(),
	seed: $seed,
	clock: new FixtureClock($epoch),
);
$fixtureDate = $context->clock()->epoch()->format('Y-m-d H:i:s');

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
$liveAcf = new LiveAcfAdapter();

foreach (AcfJson::groups($acfJsonDir) as $group) {
	$targets = AcfJson::targets($group);

	if ($targets === []) {
		continue; // no seedable location (taxonomy terms, user roles, …)
	}

	$target = $targets[0];
	$fields = (array) $group['fields'];
	$slugBase = sanitize_title($group['title'] ?? $group['key']);

	// Options-page groups are global state, not a URL: seed the populated
	// values once so chrome (header/footer) renders fully. The unseeded fresh
	// install already exercises the empty-options state.
	if ($target['param'] === 'options_page') {
		$liveAcf->updateFields($generator->populated($fields), 'option', 0);
		continue;
	}

	// The front page is a singular surface — seed the populated state onto the
	// one home page. Reuse the front page a theme seeder may already have set;
	// assign one only when none exists, so we never fight a theme-authored home.
	// The matrix's own `/` route covers it, so no dedicated route is emitted.
	// Other page_type values (top_level, …) have no generic surface to seed.
	if ($target['param'] === 'page_type') {
		if ($target['value'] !== 'front_page') {
			continue;
		}

		$frontId = (int) get_option('page_on_front');
		if ($frontId === 0) {
			$frontId = (new PostBuilder($context, 'page'))
				->title('Home')
				->slug('state-front-page')
				->status('publish')
				->date($fixtureDate)
				->save()
				->id();
			update_option('show_on_front', 'page');
			update_option('page_on_front', $frontId);
		}

		$liveAcf->updateFields($generator->populated($fields), 'post', $frontId);
		continue;
	}

	// nav_menu_item groups attach to a menu's items, which exist only once a
	// menu is built with the theme's real structure — that is the theme
	// seeder's job. The derived path leaves them to the baseline rather than
	// inventing a menu here.
	if ($target['param'] === 'nav_menu_item') {
		continue;
	}

	// Per-instance surfaces (post types, page and post templates): a dedicated
	// populated AND minimal fixture, so the sparsest publishable state is
	// exercised alongside the full one.
	foreach (['populated', 'minimal'] as $variant) {
		$values = $variant === 'populated' ? $generator->populated($fields) : $generator->minimal($fields);

		$builder = match ($target['param']) {
			'page_template' => (new PostBuilder($context, 'page'))->template($target['value']),
			'post_template' => (new PostBuilder($context, 'post'))->template($target['value']),
			default         => new PostBuilder($context, $target['value']),
		};

		$ref = $builder
			->title(($group['title'] ?? $group['key']) . ' — ' . $variant)
			->slug("state-{$slugBase}-{$variant}")
			->status('publish')
			->date($fixtureDate)
			->content('State fixture: ' . $slugBase . ' (' . $variant . ')')
			->acf($values)
			->save();

		// A placeholder featured image so archive and card thumbnails render
		// instead of the theme's empty-thumbnail fallback.
		(new AttachmentBuilder($context, "state-thumb-{$slugBase}-{$variant}"))
			->placeholder(1200, 800)
			->featuredOn($ref)
			->save();

		$url = get_permalink($ref->id());

		if ($url) {
			$routes[] = [ 'url' => $url, 'kind' => "state:{$slugBase}:{$variant}", 'expect' => 200 ];
		}
	}
}

echo json_encode([ 'routes' => $routes ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
