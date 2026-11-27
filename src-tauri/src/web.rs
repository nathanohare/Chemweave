// Data > Get Data > From Web: a page, CSV or JSON file read from the internet for a query. The
// page itself can't fetch from other sites (they don't allow it), so the app does, and hands
// back the bytes for the page to read the tables in. Only http and https addresses are read.

use std::time::Duration;

/// The largest answer read (a web table or data file, not a download of anything else).
const MAX_BYTES: usize = 50 * 1024 * 1024;

#[tauri::command]
pub async fn web_get(url: String) -> Result<tauri::ipc::Response, String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("Only http:// and https:// addresses can be read.".into());
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("Chemweave/", env!("CARGO_PKG_VERSION")))
        // (only a transfer that stalls is cut off, however long a big file takes to arrive)
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Could not get ready to read the address: {e}"))?;
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Could not read {url}: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("{url} answered with an error ({}).", res.status()));
    }
    if res.content_length().is_some_and(|n| n as usize > MAX_BYTES) {
        return Err("The answer is larger than 50 MB.".into());
    }
    let bytes = read_capped(res, MAX_BYTES)
        .await
        .map_err(|e| format!("Could not read {url}: {e}"))?
        .ok_or("The answer is larger than 50 MB.")?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// The body of an answer, read piece by piece and given up on (None) as soon as it passes `max`
/// bytes, so an answer with no length given (sent in chunks) is never held whole before being refused.
pub(crate) async fn read_capped(mut res: reqwest::Response, max: usize) -> Result<Option<Vec<u8>>, reqwest::Error> {
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await? {
        if body.len() + chunk.len() > max {
            return Ok(None);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(Some(body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn local_client() -> reqwest::Client {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        reqwest::Client::builder().no_proxy().build().unwrap()
    }

    /// A server that answers in chunks (no length given) until the other side hangs up or it has
    /// sent `limit` bytes; says how many it sent.
    fn chunked_server(limit: usize) -> (u16, Arc<AtomicUsize>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let sent = Arc::new(AtomicUsize::new(0));
        let count = sent.clone();
        std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = [0u8; 1024];
            let _ = s.read(&mut buf);
            let _ = s.write_all(b"HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n");
            let piece = vec![b'x'; 64 * 1024];
            while count.load(Ordering::SeqCst) < limit {
                let mut chunk = format!("{:x}\r\n", piece.len()).into_bytes();
                chunk.extend_from_slice(&piece);
                chunk.extend_from_slice(b"\r\n");
                if s.write_all(&chunk).is_err() {
                    break;
                }
                count.fetch_add(piece.len(), Ordering::SeqCst);
            }
            let _ = s.write_all(b"0\r\n\r\n");
        });
        (port, sent)
    }

    #[test]
    fn an_answer_over_the_limit_is_refused_without_reading_all_of_it() {
        let (port, sent) = chunked_server(2_000_000_000);
        let got = tauri::async_runtime::block_on(async {
            let res = local_client().get(format!("http://127.0.0.1:{port}/")).send().await.unwrap();
            read_capped(res, 1_000_000).await.unwrap()
        });
        assert!(got.is_none());
        // only a little more than the limit was taken (the socket buffers hold the rest)
        assert!(sent.load(Ordering::SeqCst) < 200_000_000, "{}", sent.load(Ordering::SeqCst));
    }

    #[test]
    fn an_answer_within_the_limit_is_read_whole() {
        let (port, _) = chunked_server(300_000);
        let got = tauri::async_runtime::block_on(async {
            let res = local_client().get(format!("http://127.0.0.1:{port}/")).send().await.unwrap();
            read_capped(res, 10_000_000).await.unwrap()
        });
        assert!(got.unwrap().len() >= 300_000);
    }
}
