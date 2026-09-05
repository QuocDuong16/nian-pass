//! Non-secret wire-format invariants shared by the gateway server and client.

/// Minimum accepted gateway bearer-token length in bytes.
pub const MIN_GATEWAY_TOKEN_BYTES: usize = 32;

/// Maximum accepted gateway bearer-token length in bytes.
pub const MAX_GATEWAY_TOKEN_BYTES: usize = 512;

/// Returns whether a gateway bearer token has the accepted bounded ASCII format.
///
/// Tokens are intentionally limited to visible ASCII without spaces so that the
/// same value is safe in an HTTP `Authorization` header and a line-oriented
/// environment file.
#[must_use]
pub fn valid_gateway_token(token: &str) -> bool {
    (MIN_GATEWAY_TOKEN_BYTES..=MAX_GATEWAY_TOKEN_BYTES).contains(&token.len())
        && token.bytes().all(|byte| byte.is_ascii_graphic())
}

#[cfg(test)]
mod tests {
    use super::{MAX_GATEWAY_TOKEN_BYTES, MIN_GATEWAY_TOKEN_BYTES, valid_gateway_token};

    #[test]
    fn token_grammar_is_bounded_visible_ascii_without_whitespace() {
        assert!(!valid_gateway_token(""));
        assert!(!valid_gateway_token(
            &"a".repeat(MIN_GATEWAY_TOKEN_BYTES - 1)
        ));
        assert!(valid_gateway_token(&"a".repeat(MIN_GATEWAY_TOKEN_BYTES)));
        assert!(valid_gateway_token(
            "synthetic-high-entropy-gateway-token-0001"
        ));
        assert!(valid_gateway_token(&"a".repeat(MAX_GATEWAY_TOKEN_BYTES)));
        assert!(!valid_gateway_token(
            &"a".repeat(MAX_GATEWAY_TOKEN_BYTES + 1)
        ));
        assert!(!valid_gateway_token(&format!("{}\n", "a".repeat(32))));
        assert!(!valid_gateway_token(&format!("{}\t", "a".repeat(32))));
        assert!(!valid_gateway_token(&format!("{} ", "a".repeat(32))));
    }
}
