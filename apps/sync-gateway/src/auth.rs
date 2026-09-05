use hyper::{HeaderMap, header::AUTHORIZATION};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq as _;
use sync_gateway_protocol::valid_gateway_token;
use thiserror::Error;

/// One startup-configured authentication verifier that never retains plaintext.
pub struct TokenVerifier {
    digest: [u8; 32],
}

impl TokenVerifier {
    pub fn new(token: &str) -> Result<Self, TokenConfigurationError> {
        if !valid_gateway_token(token) {
            return Err(TokenConfigurationError);
        }
        Ok(Self {
            digest: digest(token.as_bytes()),
        })
    }

    pub fn authenticates(&self, headers: &HeaderMap) -> bool {
        let mut values = headers.get_all(AUTHORIZATION).iter();
        let Some(value) = values.next() else {
            return false;
        };
        if values.next().is_some() {
            return false;
        }
        let Ok(value) = value.to_str() else {
            return false;
        };
        let Some((scheme, token)) = value.split_once(' ') else {
            return false;
        };
        let supplied = digest(token.as_bytes());
        scheme.eq_ignore_ascii_case("bearer")
            && valid_gateway_token(token)
            && supplied.ct_eq(&self.digest).into()
    }
}

fn digest(value: &[u8]) -> [u8; 32] {
    Sha256::digest(value).into()
}

#[derive(Debug, Error)]
#[error("gateway authentication configuration is invalid")]
pub struct TokenConfigurationError;

#[cfg(test)]
mod tests {
    use hyper::{
        HeaderMap,
        header::{AUTHORIZATION, HeaderValue},
    };

    use super::TokenVerifier;

    const TOKEN: &str = "synthetic-high-entropy-gateway-token-0001";

    #[test]
    fn authentication_is_exact_and_bounded() {
        let verifier = TokenVerifier::new(TOKEN).expect("configured token");
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Bearer synthetic-high-entropy-gateway-token-0001"),
        );
        assert!(verifier.authenticates(&headers));
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Bearer synthetic-high-entropy-gateway-token-0002"),
        );
        assert!(!verifier.authenticates(&headers));
        assert!(TokenVerifier::new("").is_err());
        assert!(TokenVerifier::new(&"a".repeat(31)).is_err());
        assert!(TokenVerifier::new(&"a".repeat(32)).is_ok());
        assert!(TokenVerifier::new(&"a".repeat(512)).is_ok());
        assert!(TokenVerifier::new(&"a".repeat(513)).is_err());
        assert!(TokenVerifier::new(&format!("{}\n", "a".repeat(32))).is_err());
        assert!(TokenVerifier::new(&format!("{}\t", "a".repeat(32))).is_err());
        assert!(TokenVerifier::new(&format!("{} ", "a".repeat(32))).is_err());
    }
}
