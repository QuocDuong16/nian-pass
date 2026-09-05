use hyper::{HeaderMap, header::AUTHORIZATION};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq as _;
use thiserror::Error;

pub const MAX_TOKEN_BYTES: usize = 512;
const MIN_TOKEN_BYTES: usize = 32;

/// One startup-configured authentication verifier that never retains plaintext.
pub struct TokenVerifier {
    digest: [u8; 32],
}

impl TokenVerifier {
    pub fn new(token: &str) -> Result<Self, TokenConfigurationError> {
        if !valid_token(token) {
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
            && valid_token(token)
            && supplied.ct_eq(&self.digest).into()
    }
}

fn valid_token(token: &str) -> bool {
    (MIN_TOKEN_BYTES..=MAX_TOKEN_BYTES).contains(&token.len())
        && token.bytes().all(|byte| byte.is_ascii_graphic())
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
        assert!(TokenVerifier::new("short").is_err());
    }
}
