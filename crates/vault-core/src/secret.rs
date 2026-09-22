use zeroize::Zeroizing;

/// An owned secret whose backing string is zeroized when dropped.
///
/// Plaintext access is deliberately explicit. This type does not implement
/// `Debug`, `Display`, `Clone`, serialization, or implicit string borrowing.
/// Zeroization reduces accidental residual memory but cannot guarantee removal
/// of copies made by the operating system, runtime, compiler, or dependencies.
///
/// ```compile_fail
/// use vault_core::SecretString;
/// let secret = SecretString::new("public-test-password".to_owned());
/// let duplicate = secret.clone();
/// ```
///
/// ```compile_fail
/// use vault_core::SecretString;
/// let secret = SecretString::new("public-test-password".to_owned());
/// let rendered = format!("{secret:?}");
/// ```
pub struct SecretString {
    inner: Zeroizing<String>,
}

impl SecretString {
    /// Takes ownership of a plaintext secret.
    #[must_use]
    pub fn new(value: String) -> Self {
        Self {
            inner: Zeroizing::new(value),
        }
    }

    /// Explicitly exposes plaintext for the shortest practical use.
    #[must_use]
    pub fn expose_secret(&self) -> &str {
        self.inner.as_str()
    }
}

/// Owned sensitive binary data whose backing allocation is zeroized on drop.
///
/// Attachment contents use this type across adapter/session boundaries so binary
/// plaintext remains explicit and short-lived rather than entering DTOs.
pub struct SecretBytes {
    inner: Zeroizing<Vec<u8>>,
}

impl SecretBytes {
    /// Takes ownership of sensitive binary data.
    #[must_use]
    pub fn new(value: Vec<u8>) -> Self {
        Self {
            inner: Zeroizing::new(value),
        }
    }

    /// Explicitly exposes bytes for the shortest practical use.
    #[must_use]
    pub fn expose_secret(&self) -> &[u8] {
        self.inner.as_slice()
    }
}
