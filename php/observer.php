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
 *   X-Shakedown-Php-Issues   count of notices/warnings/deprecations raised
 *   X-Shakedown-Php-Sample   first few issues, rawurlencoded, for failure output
 *
 * Output is buffered for the whole request so the headers can still be sent
 * from the shutdown handler, after all issues have been counted.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$GLOBALS['shakedown_observer'] = [ 'issues' => [], 'template' => '', 'controller' => '' ];

set_error_handler( static function ( int $errno, string $errstr, string $errfile = '', int $errline = 0 ): bool {
	$tracked = E_NOTICE | E_WARNING | E_DEPRECATED | E_USER_NOTICE | E_USER_WARNING | E_USER_DEPRECATED;

	if ( ( $errno & $tracked ) !== 0 ) {
		$GLOBALS['shakedown_observer']['issues'][] = sprintf( '%s in %s:%d', $errstr, basename( $errfile ), $errline );
	}

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
