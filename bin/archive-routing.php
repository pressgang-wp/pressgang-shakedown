<?php
/**
 * Conservative discovery check, not a request simulator. A matching archive
 * rule keeps a sample even if another rule might shadow it at request time.
 */
function shakedown_archive_is_routed( string $url, string $family, array $rules, string $home ): bool {
	$path = parse_url( $url, PHP_URL_PATH );
	$base = rtrim( (string) parse_url( $home, PHP_URL_PATH ), '/' );
	if ( ! is_string( $path ) || ( $base && ! str_starts_with( $path, $base . '/' ) ) ) {
		return true; // Uncertain URL shape: do not silently lose coverage.
	}
	$path = ltrim( substr( $path, strlen( $base ) ), '/' );
	if ( parse_url( $url, PHP_URL_QUERY ) ) {
		return true; // Explicit query URLs do not require a rewrite rule.
	}
	foreach ( $rules as $pattern => $query ) {
		$regex = '~^' . str_replace( '~', '\\~', $pattern ) . '~';
		$match = @preg_match( $regex, $path );
		$decoded_match = @preg_match( $regex, urldecode( $path ) );
		if ( false === $match || false === $decoded_match ) {
			return true; // Malformed/custom rules should not suppress tests.
		}
		if ( ! $match && ! $decoded_match ) {
			continue;
		}
		parse_str( explode( '?', $query, 2 )[1] ?? '', $vars );
		// A dated single-post or catch-all page rule is not an archive.
		if ( isset( $vars['name'] ) || isset( $vars['pagename'] ) || isset( $vars['p'] ) || isset( $vars['page_id'] ) ) {
			continue;
		}
		if ( 'author' === $family && ( isset( $vars['author_name'] ) || isset( $vars['author'] ) ) ) {
			return true;
		}
		if ( 'date' === $family && ( isset( $vars['year'] ) || isset( $vars['monthnum'] ) || isset( $vars['day'] ) || isset( $vars['m'] ) ) ) {
			return true;
		}
	}
	return false;
}

function shakedown_filter_archive_routes( array $routes ): array {
	global $wp_rewrite;
	$result = [ 'routes' => $routes, 'excluded' => [], 'warnings' => [] ];
	if ( ! $wp_rewrite->using_permalinks() ) {
		return $result;
	}
	try {
		// Unlike wp_rewrite_rules(), this does not refresh/write stored options.
		$rewrite = clone $wp_rewrite;
		$rewrite->matches = 'matches';
		$rules = $rewrite->rewrite_rules();
		if ( ! is_array( $rules ) ) {
			throw new RuntimeException( 'Rewrite generation returned no rule array.' );
		}
		if ( get_option( 'rewrite_rules' ) !== $rules ) {
			$result['warnings'][] = 'Stored rewrite rules differ from current filtered rules; supplementary archive discovery uses current rules. Review and flush permalinks separately if appropriate. Shakedown did not flush them.';
		}
		$result['routes'] = [];
		foreach ( $routes as $route ) {
			$family = 'author' === $route['kind'] ? 'author' : ( str_starts_with( $route['kind'], 'date:' ) ? 'date' : null );
			if ( $family && ! shakedown_archive_is_routed( $route['url'], $family, $rules, home_url( '/' ) ) ) {
				$result['excluded'][] = $route + [ 'reason' => 'No matching ' . $family . ' archive rule in current filtered WordPress rewrite rules.' ];
			} else {
				$result['routes'][] = $route;
			}
		}
	} catch ( Throwable $error ) {
		$result['routes'] = $routes;
		$result['excluded'] = [];
		$result['warnings'][] = 'Archive rewrite discovery unavailable; samples retained: ' . $error->getMessage();
	}
	return $result;
}
