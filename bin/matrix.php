<?php
/**
 * Emits the shakedown route matrix as JSON.
 * Run via: wp eval-file bin/matrix.php [samplesPerType]
 */
$samples = isset( $args[0] ) ? (int) $args[0] : 2;

$matrix = [ 'generated' => gmdate( 'c' ), 'home' => home_url( '/' ), 'routes' => [] ];
$add    = function ( $url, $kind, $expect = 200 ) use ( &$matrix ) {
	if ( $url && ! is_wp_error( $url ) ) {
		$matrix['routes'][] = [ 'url' => $url, 'kind' => $kind, 'expect' => $expect ];
	}
};

$add( home_url( '/' ), 'home' );

foreach ( get_post_types( [ 'public' => true ], 'objects' ) as $pt ) {
	if ( $pt->has_archive ) {
		$add( get_post_type_archive_link( $pt->name ), "archive:{$pt->name}" );
	}
	$posts = get_posts( [ 'post_type' => $pt->name, 'numberposts' => $samples, 'post_status' => 'publish' ] );
	foreach ( $posts as $p ) {
		$add( get_permalink( $p ), "single:{$pt->name}" );
	}
}

foreach ( get_taxonomies( [ 'public' => true ], 'names' ) as $tax ) {
	$terms = get_terms( [ 'taxonomy' => $tax, 'number' => 3, 'hide_empty' => true ] );
	if ( is_wp_error( $terms ) ) {
		continue;
	}
	foreach ( $terms as $t ) {
		$add( get_term_link( $t ), "term:{$tax}" );
	}
}

$pages = get_posts( [ 'post_type' => 'page', 'numberposts' => -1, 'post_status' => 'publish', 'meta_key' => '_wp_page_template' ] );
foreach ( $pages as $p ) {
	$tpl = get_page_template_slug( $p );
	if ( $tpl && 'default' !== $tpl ) {
		$add( get_permalink( $p ), "template:{$tpl}" );
	}
}

foreach ( wp_get_nav_menus() as $menu ) {
	$items = wp_get_nav_menu_items( $menu ) ?: [];
	foreach ( $items as $item ) {
		if ( 0 === strpos( (string) $item->url, home_url() ) ) {
			$add( $item->url, "menu:{$menu->slug}" );
		}
	}
}

$add( home_url( '/?s=health' ), 'search' );
$add( home_url( '/shakedown-404-probe' ), '404', 404 );

$seen             = [];
$matrix['routes'] = array_values( array_filter( $matrix['routes'], function ( $r ) use ( &$seen ) {
	if ( isset( $seen[ $r['url'] ] ) ) {
		return false;
	}
	$seen[ $r['url'] ] = true;
	return true;
} ) );

echo json_encode( $matrix, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
