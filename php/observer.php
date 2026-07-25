<?php
/**
 * Shakedown observer (sandbox mu-plugin; never installed on real sites in v1).
 *
 * Makes a request's inner workings observable via response headers so passes
 * can assert against the Capstan oracle and catch silent PHP issues:
 *
 *   X-Shakedown-Template     basename of the PHP template WordPress chose
 *   X-Shakedown-Controller   snake_case short name of the PressGang controller
 *                            that rendered (from the pressgang_render_{key} action)
 *   X-Shakedown-Php-Issues   count of notices/warnings/deprecations raised,
 *                            excluding any matched by ignore.phpIssues
 *   X-Shakedown-Php-Sample   first few issues, rawurlencoded, for failure output
 *
 * Output is buffered for the whole request so the headers can still be sent
 * from the shutdown handler, after all issues have been counted.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$GLOBALS['shakedown_observer'] = [ 'issues' => [], 'template' => '', 'controller' => '' ];

/**
 * Suppression patterns (ignore.phpIssues), handed over by the sandbox boot in
 * the environment `wp server` inherits.
 *
 * Filtering has to happen HERE rather than in the pass, because the response
 * headers carry only a COUNT plus the first three samples — a test that sees
 * "12 issues" and three examples cannot know whether the nine it can't see are
 * ignorable. Suppressed issues are never counted, so the header reports what is
 * actually outstanding.
 */
$shakedown_ignore = json_decode( (string) getenv( 'SHAKEDOWN_IGNORE_PHP' ), true );
$shakedown_ignore = is_array( $shakedown_ignore ) ? $shakedown_ignore : [];

set_error_handler( static function ( int $errno, string $errstr, string $errfile = '', int $errline = 0 ) use ( $shakedown_ignore ): bool {
	$tracked = E_NOTICE | E_WARNING | E_DEPRECATED | E_USER_NOTICE | E_USER_WARNING | E_USER_DEPRECATED;

	if ( ( $errno & $tracked ) === 0 ) {
		return false;
	}

	// Path relative to the install root, so a pattern can name an ORIGIN
	// ("wp-content/plugins/advanced-custom-fields-pro/") as easily as a
	// message. The old basename-only signature made that impossible: every
	// plugin's deprecations arrived indistinguishable from the theme's own.
	$signature = sprintf( '%s in %s:%d', $errstr, str_replace( ABSPATH, '', $errfile ), $errline );

	foreach ( $shakedown_ignore as $pattern ) {
		if ( is_string( $pattern ) && $pattern !== '' && str_contains( $signature, $pattern ) ) {
			return false; // Judged already; not this theme's to answer for.
		}
	}

	// One signature for matching AND for reporting, so the string quoted in a
	// failure is exactly the string that silences it in ignore.phpIssues.
	$GLOBALS['shakedown_observer']['issues'][] = $signature;

	return false; // Never swallow: default logging/display still applies.
} );

ob_start();

add_filter( 'template_include', static function ( $template ) {
	$GLOBALS['shakedown_observer']['template'] = basename( (string) $template );

	return $template;
}, PHP_INT_MAX );

// AbstractController::render() fires pressgang_render_{snake_case_controller};
// the 'all' hook lets the observer learn which controller ran without
// requiring a framework change.
add_action( 'all', static function (): void {
	$hook = current_filter();

	if ( str_starts_with( $hook, 'pressgang_render_' ) && $hook !== 'pressgang_render_failed' ) {
		$GLOBALS['shakedown_observer']['controller'] = substr( $hook, strlen( 'pressgang_render_' ) );
	}
} );

register_shutdown_function( static function (): void {
	$observer = $GLOBALS['shakedown_observer'];

	if ( ! headers_sent() ) {
		header( 'X-Shakedown-Template: ' . $observer['template'] );
		header( 'X-Shakedown-Controller: ' . $observer['controller'] );
		header( 'X-Shakedown-Php-Issues: ' . count( $observer['issues'] ) );

		if ( $observer['issues'] !== [] ) {
			header( 'X-Shakedown-Php-Sample: ' . substr( rawurlencode( implode( ' | ', array_slice( $observer['issues'], 0, 3 ) ) ), 0, 900 ) );
		}
	}

	while ( ob_get_level() > 0 ) {
		ob_end_flush();
	}
} );
