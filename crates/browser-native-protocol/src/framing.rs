use std::io::{self, Read, Write};

use serde::{Serialize, de::DeserializeOwned};
use zeroize::Zeroizing;

use crate::{BrowserRequest, BrowserResponse, MAX_FRAME_BYTES};

#[derive(Debug)]
pub enum FrameError {
    Io(io::Error),
    Empty,
    Oversized,
    InvalidJson,
    InvalidProtocol,
}

impl From<io::Error> for FrameError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

pub fn read_frame(reader: &mut impl Read) -> Result<Option<Zeroizing<Vec<u8>>>, FrameError> {
    let mut prefix = [0_u8; 4];
    match reader.read(&mut prefix[..1]) {
        Ok(0) => return Ok(None),
        Ok(_) => {}
        Err(error) => return Err(FrameError::Io(error)),
    }
    reader
        .read_exact(&mut prefix[1..])
        .map_err(FrameError::Io)?;
    let declared = u32::from_ne_bytes(prefix) as usize;
    if declared == 0 {
        return Err(FrameError::Empty);
    }
    if declared > MAX_FRAME_BYTES {
        return Err(FrameError::Oversized);
    }
    let mut payload = Zeroizing::new(vec![0_u8; declared]);
    reader.read_exact(&mut payload).map_err(FrameError::Io)?;
    Ok(Some(payload))
}

pub fn read_request(reader: &mut impl Read) -> Result<Option<BrowserRequest>, FrameError> {
    read_message(reader)
}

pub fn read_response(reader: &mut impl Read) -> Result<Option<BrowserResponse>, FrameError> {
    read_message(reader)
}

fn read_message<T: DeserializeOwned + Validate>(
    reader: &mut impl Read,
) -> Result<Option<T>, FrameError> {
    let Some(payload) = read_frame(reader)? else {
        return Ok(None);
    };
    let message: T = serde_json::from_slice(&payload).map_err(|_| FrameError::InvalidJson)?;
    message
        .validate()
        .map_err(|_| FrameError::InvalidProtocol)?;
    Ok(Some(message))
}

pub fn write_message(writer: &mut impl Write, message: &impl Serialize) -> Result<(), FrameError> {
    let payload = Zeroizing::new(serde_json::to_vec(message).map_err(|_| FrameError::InvalidJson)?);
    if payload.is_empty() {
        return Err(FrameError::Empty);
    }
    if payload.len() > MAX_FRAME_BYTES {
        return Err(FrameError::Oversized);
    }
    let length = u32::try_from(payload.len()).map_err(|_| FrameError::Oversized)?;
    writer
        .write_all(&length.to_ne_bytes())
        .map_err(FrameError::Io)?;
    writer.write_all(&payload).map_err(FrameError::Io)?;
    writer.flush().map_err(FrameError::Io)
}

trait Validate {
    fn validate(&self) -> Result<(), crate::ProtocolError>;
}

impl Validate for BrowserRequest {
    fn validate(&self) -> Result<(), crate::ProtocolError> {
        self.validate()
    }
}

impl Validate for BrowserResponse {
    fn validate(&self) -> Result<(), crate::ProtocolError> {
        self.validate()
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, ErrorKind};

    use zeroize::Zeroizing;

    use crate::{
        BrowserRequest, BrowserResponse, Candidate, CandidateText, FrameError,
        MAX_CANDIDATE_SUMMARY_BYTES, MAX_CANDIDATES, MAX_CREDENTIAL_FIELD_BYTES, MAX_FRAME_BYTES,
        PROTOCOL_VERSION, read_request, write_message,
    };

    fn connect_request() -> BrowserRequest {
        BrowserRequest::Connect {
            version: 1,
            request_id: "00112233445566778899aabbccddeeff".to_owned(),
        }
    }

    #[test]
    fn valid_and_multiple_frames_round_trip_exactly() {
        let mut bytes = Vec::new();
        assert!(write_message(&mut bytes, &connect_request()).is_ok());
        assert!(write_message(&mut bytes, &connect_request()).is_ok());
        let mut reader = Cursor::new(bytes);
        assert!(read_request(&mut reader).is_ok_and(|value| value.is_some()));
        assert!(read_request(&mut reader).is_ok_and(|value| value.is_some()));
        assert!(read_request(&mut reader).is_ok_and(|value| value.is_none()));
    }

    #[test]
    fn zero_invalid_json_oversized_and_truncated_frames_fail_closed() {
        let cases = [
            0_u32.to_ne_bytes().to_vec(),
            {
                let mut value = 1_u32.to_ne_bytes().to_vec();
                value.push(b'{');
                value
            },
            u32::try_from(MAX_FRAME_BYTES + 1)
                .unwrap_or(u32::MAX)
                .to_ne_bytes()
                .to_vec(),
            {
                let mut value = 8_u32.to_ne_bytes().to_vec();
                value.extend_from_slice(b"short");
                value
            },
        ];
        assert!(matches!(
            read_request(&mut Cursor::new(&cases[0])),
            Err(FrameError::Empty)
        ));
        assert!(matches!(
            read_request(&mut Cursor::new(&cases[1])),
            Err(FrameError::InvalidJson)
        ));
        assert!(matches!(
            read_request(&mut Cursor::new(&cases[2])),
            Err(FrameError::Oversized)
        ));
        assert!(matches!(
            read_request(&mut Cursor::new(&cases[3])),
            Err(FrameError::Io(error)) if error.kind() == ErrorKind::UnexpectedEof
        ));
    }

    #[test]
    fn unknown_message_and_protocol_version_are_rejected() {
        for json in [
            br#"{"version":1,"type":"unknown","requestId":"00112233445566778899aabbccddeeff"}"#
                .as_slice(),
            br#"{"version":99,"type":"connect","requestId":"00112233445566778899aabbccddeeff"}"#
                .as_slice(),
        ] {
            let mut bytes = u32::try_from(json.len())
                .unwrap_or_default()
                .to_ne_bytes()
                .to_vec();
            bytes.extend_from_slice(json);
            assert!(read_request(&mut Cursor::new(bytes)).is_err());
        }
    }

    #[test]
    fn maximum_candidate_and_credential_outputs_remain_bounded() {
        let candidates = BrowserResponse::Candidates {
            version: PROTOCOL_VERSION,
            request_id: "a".repeat(32),
            vault_session_id: "b".repeat(32),
            candidates: (0..MAX_CANDIDATES)
                .map(|index| Candidate {
                    entry_id: format!("entry-{index}"),
                    title: CandidateText::Visible {
                        value: "\0".repeat(MAX_CANDIDATE_SUMMARY_BYTES),
                    },
                    username: CandidateText::Visible {
                        value: "\0".repeat(MAX_CANDIDATE_SUMMARY_BYTES),
                    },
                })
                .collect(),
            truncated: true,
        };
        let credential = BrowserResponse::Credential {
            version: PROTOCOL_VERSION,
            request_id: "c".repeat(32),
            username: Zeroizing::new("\0".repeat(MAX_CREDENTIAL_FIELD_BYTES)),
            password: Zeroizing::new("\0".repeat(MAX_CREDENTIAL_FIELD_BYTES)),
        };
        for response in [candidates, credential] {
            let mut bytes = Vec::new();
            assert!(write_message(&mut bytes, &response).is_ok());
            assert!(bytes.len() <= MAX_FRAME_BYTES + 4);
        }
    }
}
