<?php
/**
 * Plugin Name:  Allocation Assist Chat Portal
 * Plugin URI:   https://allocation-assist.com
 * Description:  Adds a Chat Portal page under WP Admin > Tools that silently
 *               signs in the current WordPress user and shows the Allocation
 *               Assist chat interface in a full-screen iframe.
 * Version:      1.0.0
 * Author:       Allocation Assist
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// ─────────────────────────────────────────────────────────────
//  CONFIGURATION — update these two values before activating
// ─────────────────────────────────────────────────────────────

/**
 * URL where the Allocation Assist chat portal is deployed.
 * e.g. 'https://chat.allocation-assist.com' or 'https://portal.allocation-assist.com'
 */
define( 'AA_CHAT_APP_URL', 'https://chat.allocation-assist.com' );

/**
 * Shared secret for HMAC token signing.
 * MUST match the value of VITE_WP_SSO_SECRET in the chat portal's .env file.
 * Generate one: openssl rand -hex 32
 */
define( 'AA_SSO_SECRET', 'caa7e526162b4b5cbf5c76d505760b24b9195b0f75b345ac377c65904587a3dd' );

// ─────────────────────────────────────────────────────────────
//  Admin menu registration
// ─────────────────────────────────────────────────────────────

add_action( 'admin_menu', 'aa_register_chat_page' );

function aa_register_chat_page() {
    add_management_page(
        __( 'Chat Portal', 'allocation-assist' ),   // Page title
        __( 'Chat Portal', 'allocation-assist' ),   // Menu label (Tools > Chat Portal)
        'edit_posts',                                // Min capability (any editor/admin)
        'allocation-assist-chat',                    // Menu slug
        'aa_render_chat_page'
    );
}

// ─────────────────────────────────────────────────────────────
//  Token generation
// ─────────────────────────────────────────────────────────────

/**
 * Generate a signed SSO token.
 * Format: <unix_timestamp>:<base64(HMAC-SHA256(timestamp, secret))>
 * Valid for 5 minutes (validated by the React app).
 */
function aa_generate_sso_token(): string {
    $timestamp = (string) time();
    $raw_hmac  = hash_hmac( 'sha256', $timestamp, AA_SSO_SECRET, true );
    $b64_hmac  = base64_encode( $raw_hmac );
    return $timestamp . ':' . $b64_hmac;
}

// ─────────────────────────────────────────────────────────────
//  Page renderer — full-screen iframe
// ─────────────────────────────────────────────────────────────

function aa_render_chat_page(): void {
    if ( ! current_user_can( 'edit_posts' ) ) {
        wp_die( __( 'You do not have permission to access this page.', 'allocation-assist' ) );
    }

    $token    = aa_generate_sso_token();
    $chat_url = add_query_arg( 'wp_token', rawurlencode( $token ), AA_CHAT_APP_URL );
    ?>
    <style>
        /* Hide WP content padding so the iframe fills everything below the admin bar */
        #wpwrap, #wpcontent, #wpbody, #wpbody-content { padding: 0 !important; margin: 0 !important; }
        #aa-chat-wrapper {
            position: fixed;
            /* 32px = WP admin bar; 160px = WP sidebar (desktop) */
            top: 32px;
            left: 160px;
            right: 0;
            bottom: 0;
            z-index: 9990;
            background: #fff;
        }
        #aa-chat-frame {
            width: 100%;
            height: 100%;
            border: none;
            display: block;
        }
        /* Mobile: WP collapses sidebar */
        @media (max-width: 960px) {
            #aa-chat-wrapper { left: 0; top: 46px; }
        }
        /* Mobile: WP admin bar is taller */
        @media (max-width: 782px) {
            #aa-chat-wrapper { top: 46px; }
        }
    </style>

    <div id="aa-chat-wrapper">
        <iframe
            id="aa-chat-frame"
            src="<?php echo esc_url( $chat_url ); ?>"
            title="<?php esc_attr_e( 'Allocation Assist Chat Portal', 'allocation-assist' ); ?>"
            allow="camera; microphone; clipboard-write; notifications"
            allowfullscreen
        ></iframe>
    </div>
    <?php
}

// ─────────────────────────────────────────────────────────────
//  REST API endpoint (for WP-Remote / headless use)
//
//  POST /wp-json/aa-chat/v1/token
//  Auth: WordPress application password or cookie nonce
//  Returns: { "token": "<sso_token>" }
//  Use this if you want to open the chat in a new tab from a
//  custom button rather than via the admin menu.
// ─────────────────────────────────────────────────────────────

add_action( 'rest_api_init', 'aa_register_token_endpoint' );

function aa_register_token_endpoint(): void {
    register_rest_route(
        'aa-chat/v1',
        '/token',
        [
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => 'aa_token_endpoint_handler',
            'permission_callback' => function () {
                return is_user_logged_in() && current_user_can( 'edit_posts' );
            },
        ]
    );
}

function aa_token_endpoint_handler( WP_REST_Request $request ): WP_REST_Response {
    return new WP_REST_Response(
        [
            'token'    => aa_generate_sso_token(),
            'chat_url' => AA_CHAT_APP_URL,
        ],
        200
    );
}
