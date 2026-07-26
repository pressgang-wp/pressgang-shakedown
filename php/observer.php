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

/**
 * Reduce a file path to its portable, WordPress-relative tail.
 *
 * Themes, plugins and core directories are SYMLINKED into the sandbox and PHP
 * reports realpaths, so most files resolve to the real project location rather
 * than anywhere under ABSPATH — stripping ABSPATH alone leaves an absolute path
 * containing somebody's home directory. An ignore.phpIssues pattern has to be
 * committable and work on the next machine, so keep the recognisable tail.
 *
 * @param string $file
 * @return string
 */
function shakedown_observer_relative_path( string $file ): string {
	$relative = str_replace( ABSPATH, '', $file );

	foreach ( [ '/wp-content/', '/wp-includes/', '/wp-admin/' ] as $marker ) {
		$at = strrpos( $relative, $marker );

		if ( false !== $at ) {
			return ltrim( substr( $relative, $at ), '/' );
		}
	}

	return $relative;
}

set_error_handler( static function ( int $errno, string $errstr, string $errfile = '', int $errline = 0 ) use ( $shakedown_ignore ): bool {
	$tracked = E_NOTICE | E_WARNING | E_DEPRECATED | E_USER_NOTICE | E_USER_WARNING | E_USER_DEPRECATED;

	if ( ( $errno & $tracked ) === 0 ) {
		return false;
	}

	// WordPress-relative path, so a pattern can name an ORIGIN
	// ("wp-content/plugins/advanced-custom-fields-pro/") as easily as a
	// message. The old basename-only signature made that impossible: every
	// plugin's deprecations arrived indistinguishable from the theme's own.
	$signature = sprintf( '%s in %s:%d', $errstr, shakedown_observer_relative_path( $errfile ), $errline );

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

/**
 * Emit the observation headers.
 *
 * Has to run while the ob_start() buffer above still holds the body: under
 * `php -S` output_buffering is off, so the first echo would otherwise commit the
 * response and headers_sent() would be true for good.
 */
function shakedown_observer_send_headers(): void {
	if ( headers_sent() ) {
		return;
	}

	$observer = $GLOBALS['shakedown_observer'];

	header( 'X-Shakedown-Template: ' . $observer['template'] );
	header( 'X-Shakedown-Controller: ' . $observer['controller'] );
	header( 'X-Shakedown-Php-Issues: ' . count( $observer['issues'] ) );

	if ( $observer['issues'] !== [] ) {
		header( 'X-Shakedown-Php-Sample: ' . substr( rawurlencode( implode( ' | ', array_slice( $observer['issues'], 0, 3 ) ) ), 0, 900 ) );
	}
}

/*
 * Priority 0 puts this AHEAD of wp_ob_end_flush_all (hooked to `shutdown` at
 * priority 1), which is what flushes our buffer and commits the response.
 *
 * This used to be a plain register_shutdown_function(), which could never work:
 * WordPress registers its own shutdown handler at wp-settings.php:166, while
 * mu-plugins do not load until :498, so WP's always ran first, flushed every
 * buffer, and left headers_sent() true — every header() call here was skipped
 * and the template/controller oracle and PHP-issue assertions in pass 00
 * silently became no-ops that reported success.
 *
 * Everything raised during rendering is therefore counted. Issues raised LATER
 * — by shutdown callbacks at priority 1 or beyond — are not, which is the
 * honest cost of having to commit headers before the body goes out.
 */
add_action( 'shutdown', 'shakedown_observer_send_headers', 0 );

/*
 * Fallback for any path where the `shutdown` ACTION never fires (a hard exit
 * before WordPress finishes booting, say): still try the headers, and still
 * flush, so a buffered response is never simply lost.
 */
register_shutdown_function( static function (): void {
	shakedown_observer_send_headers();

	while ( ob_get_level() > 0 ) {
		ob_end_flush();
	}
} );
