<?php
/**
 * Emits the shakedown route matrix for the current site as JSON.
 *
 * Runs inside WordPress via `wp eval-file bin/matrix.php <samplesPerType> <searchTerm>`
 * (invoked by bin/derive-matrix.mjs, which supplies the args from shakedown.config.json).
 *
 * Route shape: `['url' => string, 'kind' => string, 'expect' => int]` where
 * `kind` is a `family:detail` label (`archive:event`, `template:contact-page.php`, …)
 * and `expect` is the intended HTTP status.
 *
 * Functions are prefixed `shakedown_` because eval-file executes in global scope.
 */

/**
 * Append a route unless the URL is empty or a WP_Error.
 *
 * @param array<int, array<string, mixed>> $routes
 * @param string|\WP_Error|false           $url
 * @param string                           $kind
 * @param int                              $expect
 * @return void
 */
function shakedown_add( array &$routes, $url, string $kind, int $expect = 200 ): void {
	if ( $url && ! is_wp_error( $url ) ) {
		$routes[] = [ 'url' => $url, 'kind' => $kind, 'expect' => $expect ];
	}
}

/**
 * Archive link plus sample singles for every public post type.
 *
 * @param int $samples Published singles to include per type.
 * @return array<int, array<string, mixed>>
 */
function shakedown_post_type_routes( int $samples ): array {
	$routes = [];

	foreach ( get_post_types( [ 'public' => true ], 'objects' ) as $pt ) {
		if ( $pt->has_archive ) {
			shakedown_add( $routes, get_post_type_archive_link( $pt->name ), "archive:{$pt->name}" );
		}

		$posts = get_posts( [ 'post_type' => $pt->name, 'numberposts' => $samples, 'post_status' => 'publish' ] );
		foreach ( $posts as $p ) {
			shakedown_add( $routes, get_permalink( $p ), "single:{$pt->name}" );
		}
	}

	return $routes;
}

/**
 * Sample term pages for every public taxonomy (non-empty terms only).
 *
 * @return array<int, array<string, mixed>>
 */
function shakedown_taxonomy_routes(): array {
	$routes = [];

	foreach ( get_taxonomies( [ 'public' => true ], 'names' ) as $tax ) {
		$terms = get_terms( [ 'taxonomy' => $tax, 'number' => 3, 'hide_empty' => true ] );
		if ( is_wp_error( $terms ) ) {
			continue;
		}
		foreach ( $terms as $t ) {
			shakedown_add( $routes, get_term_link( $t ), "term:{$tax}" );
		}
	}

	return $routes;
}

/**
 * Every published page assigned a non-default page template.
 *
 * These exercise the theme's registered templates end-to-end, keyed by
 * template slug so failures name the template, not just the page.
 *
 * @return array<int, array<string, mixed>>
 */
function shakedown_template_routes(): array {
	$routes = [];

	$pages = get_posts( [
		'post_type'      => 'page',
		'numberposts'    => -1,
		'post_status'    => 'publish',
		'meta_key'       => '_wp_page_template',
	] );

	foreach ( $pages as $p ) {
		$tpl = get_page_template_slug( $p );
		if ( $tpl && 'default' !== $tpl ) {
			shakedown_add( $routes, get_permalink( $p ), "template:{$tpl}" );
		}
	}

	return $routes;
}

/**
 * Internal targets of every registered nav menu (external links are skipped —
 * shakedown only tests the site under trial).
 *
 * @return array<int, array<string, mixed>>
 */
function shakedown_menu_routes(): array {
	$routes = [];

	foreach ( wp_get_nav_menus() as $menu ) {
		$items = wp_get_nav_menu_items( $menu ) ?: [];
		foreach ( $items as $item ) {
			if ( 0 === strpos( (string) $item->url, home_url() ) ) {
				shakedown_add( $routes, $item->url, "menu:{$menu->slug}" );
			}
		}
	}

	return $routes;
}

/**
 * Drop duplicate URLs, keeping the first (most specific) kind label.
 *
 * @param array<int, array<string, mixed>> $routes
 * @return array<int, array<string, mixed>>
 */
function shakedown_dedupe( array $routes ): array {
	$seen = [];

	return array_values( array_filter( $routes, function ( array $r ) use ( &$seen ): bool {
		if ( isset( $seen[ $r['url'] ] ) ) {
			return false;
		}
		$seen[ $r['url'] ] = true;

		return true;
	} ) );
}

$samples     = isset( $args[0] ) ? (int) $args[0] : 2;
$search_term = isset( $args[1] ) ? (string) $args[1] : 'test';

$routes = [];
shakedown_add( $routes, home_url( '/' ), 'home' );

$routes = array_merge(
	$routes,
	shakedown_post_type_routes( $samples ),
	shakedown_taxonomy_routes(),
	shakedown_template_routes(),
	shakedown_menu_routes(),
);

shakedown_add( $routes, home_url( '/?s=' . rawurlencode( $search_term ) ), 'search' );
shakedown_add( $routes, home_url( '/shakedown-404-probe' ), '404', 404 );

echo json_encode(
	[
		'generated' => gmdate( 'c' ),
		'home'      => home_url( '/' ),
		'routes'    => shakedown_dedupe( $routes ),
	],
	JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
);
