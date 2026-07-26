<?php
/**
 * Supplementary route families for the shakedown matrix.
 *
 * The primary derivation enumerates what the site *has* — post types, terms,
 * templates, menus. These are the surfaces it misses: the ones with their own
 * template (`author.php`, `date.php`), their own query branch (page 2, a search
 * that matches nothing), or their own content type (feeds). Most themes ship an
 * author and date template that nothing was ever visiting, and pagination is
 * where off-by-one and empty-page bugs live.
 *
 * Emitted separately and merged rather than folded into bin/matrix.php, so a
 * site whose matrix came from `wp capstan matrix` gets these families too: only
 * the ORACLE is supposed to differ between the two sources, not the coverage.
 *
 * Run: wp eval-file bin/matrix-supplement.php <samplesPerType>
 * Emits: {"routes": [{url, kind, expect, html?}...]}
 *
 * `html: false` marks a route as HTTP-only — pass 00 checks it, but the browser
 * passes skip it, because running axe or a visual snapshot over an RSS feed
 * measures nothing.
 *
 * Functions are prefixed `shakedown_supp_` because eval-file runs in global scope.
 */

/**
 * Append a route unless the URL is empty or a WP_Error.
 *
 * @param array<int, array<string, mixed>> $routes
 * @param string|\WP_Error|false           $url
 * @param string                           $kind
 * @param array<string, mixed>             $extra
 * @return void
 */
function shakedown_supp_add( array &$routes, $url, string $kind, array $extra = [] ): void {
	if ( $url && ! is_wp_error( $url ) ) {
		$routes[] = array_merge( [ 'url' => (string) $url, 'kind' => $kind, 'expect' => 200 ], $extra );
	}
}

/**
 * Build the page-2 URL for an archive, in whichever permalink shape the site uses.
 *
 * @param string|false $url
 * @param int          $page
 * @return string
 */
function shakedown_supp_paginate( $url, int $page ): string {
	if ( ! $url ) {
		return '';
	}

	return get_option( 'permalink_structure' )
		? trailingslashit( (string) $url ) . "page/{$page}/"
		: (string) add_query_arg( 'paged', $page, (string) $url );
}

/**
 * Author archives for authors who actually have published posts — an author
 * with none would 404 and say nothing about `author.php`.
 *
 * @param int $samples
 * @return array<int, array<string, mixed>>
 */
function shakedown_supp_author_routes( int $samples ): array {
	$routes = [];

	$authors = get_users( [
		'has_published_posts' => true,
		'number'              => max( 1, $samples ),
		'orderby'             => 'ID',
		'order'               => 'ASC',
	] );

	foreach ( $authors as $author ) {
		shakedown_supp_add( $routes, get_author_posts_url( $author->ID ), 'author' );
	}

	return $routes;
}

/**
 * Year and month archives taken from the newest published post, so both are
 * guaranteed to have content.
 *
 * post_date is site-local and date archives are resolved in site-local terms,
 * so the parts are read straight off the string rather than round-tripped
 * through a timezone conversion.
 *
 * @return array<int, array<string, mixed>>
 */
function shakedown_supp_date_routes(): array {
	$routes = [];

	$latest = get_posts( [
		'post_type'   => 'post',
		'numberposts' => 1,
		'post_status' => 'publish',
		'orderby'     => 'date',
		'order'       => 'DESC',
	] );

	if ( ! $latest ) {
		return $routes;
	}

	$year  = (int) substr( $latest[0]->post_date, 0, 4 );
	$month = (int) substr( $latest[0]->post_date, 5, 2 );

	shakedown_supp_add( $routes, get_year_link( $year ), 'date:year' );
	shakedown_supp_add( $routes, get_month_link( $year, $month ), 'date:month' );

	return $routes;
}

/**
 * Page 2 of any archive with more published posts than fit on a page.
 *
 * Deliberately conservative: `posts_per_page` is the global setting, and a theme
 * that RAISES it for a particular archive could leave page 2 legitimately
 * absent. A theme in that position should drop the route via `ignore.routes`.
 *
 * @return array<int, array<string, mixed>>
 */
function shakedown_supp_pagination_routes(): array {
	$routes   = [];
	$per_page = (int) get_option( 'posts_per_page' );

	if ( $per_page < 1 ) {
		return $routes;
	}

	// The posts index: the front page when it lists posts, otherwise whichever
	// page is assigned to them.
	$posts_page = home_url( '/' );
	if ( 'page' === get_option( 'show_on_front' ) ) {
		$assigned   = (int) get_option( 'page_for_posts' );
		$posts_page = $assigned ? get_permalink( $assigned ) : '';
	}

	if ( $posts_page && (int) wp_count_posts( 'post' )->publish > $per_page ) {
		shakedown_supp_add( $routes, shakedown_supp_paginate( $posts_page, 2 ), 'paged:posts' );
	}

	foreach ( get_post_types( [ 'public' => true ], 'objects' ) as $pt ) {
		if ( ! $pt->has_archive || 'post' === $pt->name ) {
			continue;
		}

		if ( (int) wp_count_posts( $pt->name )->publish > $per_page ) {
			shakedown_supp_add(
				$routes,
				shakedown_supp_paginate( get_post_type_archive_link( $pt->name ), 2 ),
				"paged:{$pt->name}"
			);
		}
	}

	return $routes;
}

/**
 * Feeds. HTTP-only: a feed is XML, so the browser passes have nothing to say
 * about it, but a feed that fatals or emits a PHP notice is worth catching.
 *
 * @return array<int, array<string, mixed>>
 */
function shakedown_supp_feed_routes(): array {
	$routes = [];

	shakedown_supp_add( $routes, get_feed_link(), 'feed', [ 'html' => false ] );

	foreach ( get_post_types( [ 'public' => true ], 'objects' ) as $pt ) {
		if ( ! $pt->has_archive || 'post' === $pt->name ) {
			continue;
		}

		shakedown_supp_add(
			$routes,
			get_post_type_archive_feed_link( $pt->name ),
			"feed:{$pt->name}",
			[ 'html' => false ]
		);
	}

	return $routes;
}

$samples = isset( $args[0] ) ? (int) $args[0] : 2;

$routes = array_merge(
	shakedown_supp_author_routes( $samples ),
	shakedown_supp_date_routes(),
	shakedown_supp_pagination_routes(),
	shakedown_supp_feed_routes(),
);

// A search term nothing can match, so the no-results branch is always exercised.
// The configured `searchTerm` is chosen to find things, which means the empty
// state — usually a template branch of its own — never got looked at.
shakedown_supp_add( $routes, home_url( '/?s=' . rawurlencode( 'shakedown-no-such-term-zzq' ) ), 'search:empty' );

echo json_encode( [ 'routes' => $routes ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
