<?php
/**
 * Read-only inventory of published public singles and public terms (including empty terms).
 * This describes finite content routes, not every possible query/pagination URL.
 */
$routes = [];
$excluded = [];
$limit = 20000;
$add = static function ( $url, string $kind ) use ( &$routes, &$excluded, $limit ): void {
	if ( is_wp_error( $url ) || ! $url ) {
		throw new RuntimeException( 'Could not resolve inventory URL for ' . $kind );
	}
	if ( count( $routes ) >= $limit ) {
		throw new RuntimeException( 'Inventory exceeds 20000 routes; exhaustive coverage cannot be established.' );
	}
	$routes[] = [ 'url' => (string) $url, 'kind' => $kind, 'expect' => 200 ];
};
foreach ( get_post_types( [ 'public' => true ], 'objects' ) as $type ) {
	if ( ! is_post_type_viewable( $type ) ) {
		$excluded[] = [ 'family' => 'single:' . $type->name, 'reason' => 'Post type is not publicly viewable.' ];
		continue;
	}
	for ( $offset = 0; ; $offset += 500 ) {
		$posts = get_posts( [
			'post_type' => $type->name, 'post_status' => 'publish',
			'posts_per_page' => 500, 'offset' => $offset, 'orderby' => 'ID', 'order' => 'ASC',
		] );
		foreach ( $posts as $post ) {
			$add( get_permalink( $post ), 'single:' . $type->name );
		}
		if ( count( $posts ) < 500 ) {
			break;
		}
	}
}
foreach ( get_taxonomies( [ 'public' => true ], 'objects' ) as $taxonomy ) {
	if ( ! is_taxonomy_viewable( $taxonomy ) ) {
		$excluded[] = [ 'family' => 'term:' . $taxonomy->name, 'reason' => 'Taxonomy is not publicly viewable.' ];
		continue;
	}
	for ( $offset = 0; ; $offset += 500 ) {
		$terms = get_terms( [
			'taxonomy' => $taxonomy->name, 'hide_empty' => false, 'number' => 500,
			'offset' => $offset, 'orderby' => 'term_id', 'order' => 'ASC',
		] );
		if ( is_wp_error( $terms ) ) {
			throw new RuntimeException( 'Term inventory failed: ' . $taxonomy->name );
		}
		foreach ( $terms as $term ) {
			$add( get_term_link( $term ), 'term:' . $taxonomy->name );
		}
		if ( count( $terms ) < 500 ) {
			break;
		}
	}
}
echo json_encode( [ 'routes' => $routes, 'excluded' => $excluded ], JSON_UNESCAPED_SLASHES );
