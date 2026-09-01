use std::io::{Read, Write};

use browser_native_protocol::{
    BrowserRequest, BrowserResponse, ErrorCode, PROTOCOL_VERSION, connect_desktop, read_request,
    read_response, write_message,
};

pub fn run(mut browser_input: impl Read, mut browser_output: impl Write) -> Result<(), String> {
    let Some(first) = read_request(&mut browser_input).map_err(|_| "invalid browser frame")? else {
        return Ok(());
    };
    if !matches!(first, BrowserRequest::Connect { .. }) {
        return Err("first request must connect".to_owned());
    }
    let request_id = first.request_id().to_owned();
    let mut desktop = match connect_desktop() {
        Ok(stream) => stream,
        Err(_) => {
            let response = BrowserResponse::Error {
                version: PROTOCOL_VERSION,
                request_id,
                code: ErrorCode::DesktopUnavailable,
            };
            write_message(&mut browser_output, &response)
                .map_err(|_| "could not frame response")?;
            return Ok(());
        }
    };
    write_message(&mut desktop, &first).map_err(|_| "desktop write failed")?;

    let Some(pending) = read_response(&mut desktop).map_err(|_| "desktop response failed")? else {
        return Err("desktop closed during approval".to_owned());
    };
    ensure_correlation(&pending, &request_id)?;
    if !matches!(pending, BrowserResponse::ApprovalPending { .. }) {
        return Err("desktop skipped explicit approval".to_owned());
    }
    write_message(&mut browser_output, &pending).map_err(|_| "browser write failed")?;

    let Some(decision) = read_response(&mut desktop).map_err(|_| "desktop response failed")? else {
        return Err("desktop closed during approval".to_owned());
    };
    ensure_correlation(&decision, &request_id)?;
    let authorized = matches!(decision, BrowserResponse::Connected { .. });
    write_message(&mut browser_output, &decision).map_err(|_| "browser write failed")?;
    if !authorized {
        return Ok(());
    }

    while let Some(request) =
        read_request(&mut browser_input).map_err(|_| "invalid browser frame")?
    {
        if matches!(request, BrowserRequest::Connect { .. }) {
            return Err("duplicate connect request".to_owned());
        }
        let request_id = request.request_id().to_owned();
        write_message(&mut desktop, &request).map_err(|_| "desktop write failed")?;
        let Some(response) = read_response(&mut desktop).map_err(|_| "desktop response failed")?
        else {
            return Err("desktop disconnected".to_owned());
        };
        ensure_correlation(&response, &request_id)?;
        write_message(&mut browser_output, &response).map_err(|_| "browser write failed")?;
    }
    Ok(())
}

fn ensure_correlation(response: &BrowserResponse, request_id: &str) -> Result<(), String> {
    if response.request_id() != request_id {
        return Err("response correlation failed".to_owned());
    }
    Ok(())
}
