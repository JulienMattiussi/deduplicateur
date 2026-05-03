use std::io::{Read, Seek, SeekFrom};
use axum::{body::Body, http::{header, Request, Response, StatusCode}, Router};

fn video_mime(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()).as_deref() {
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("flv") => "video/x-flv",
        Some("wmv") => "video/x-ms-wmv",
        _ => "video/mp4",
    }
}

fn parse_range(s: &str, file_size: u64) -> Option<(u64, u64)> {
    let s = s.strip_prefix("bytes=")?;
    let (a, b) = s.split_once('-')?;
    let start: u64 = a.parse().ok()?;
    let end: u64 = b.parse().unwrap_or(file_size.saturating_sub(1));
    let end = end.min(file_size.saturating_sub(1));
    (start <= end).then_some((start, end))
}

async fn handle(req: Request<Body>) -> Response<Body> {
    let path_decoded = percent_encoding::percent_decode_str(req.uri().path())
        .decode_utf8_lossy()
        .into_owned();

    #[cfg(windows)]
    let path = std::path::PathBuf::from(path_decoded.trim_start_matches('/'));
    #[cfg(not(windows))]
    let path = std::path::PathBuf::from(&path_decoded);

    let range_str = req.headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    let mime = video_mime(&path);

    tokio::task::spawn_blocking(move || serve(path, range_str, mime))
        .await
        .unwrap_or_else(|_| not_found())
}

fn serve(path: std::path::PathBuf, range: Option<String>, mime: &'static str) -> Response<Body> {
    let Ok(meta) = std::fs::metadata(&path) else { return not_found(); };
    let file_size = meta.len();
    let Ok(mut file) = std::fs::File::open(&path) else { return not_found(); };

    let range = range.as_deref().and_then(|s| parse_range(s, file_size));

    if let Some((start, end)) = range {
        let len = end - start + 1;
        if file.seek(SeekFrom::Start(start)).is_err() { return not_found(); }
        let mut buf = vec![0u8; len as usize];
        let n = file.read(&mut buf).unwrap_or(0);
        buf.truncate(n);
        Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CONTENT_RANGE, format!("bytes {}-{}/{}", start, end, file_size))
            .header(header::CONTENT_LENGTH, n)
            .header(header::ACCEPT_RANGES, "bytes")
            .header("Access-Control-Allow-Origin", "*")
            .body(Body::from(buf)).unwrap()
    } else {
        let mut buf = Vec::new();
        let _ = file.read_to_end(&mut buf);
        let len = buf.len();
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CONTENT_LENGTH, len)
            .header(header::ACCEPT_RANGES, "bytes")
            .header("Access-Control-Allow-Origin", "*")
            .body(Body::from(buf)).unwrap()
    }
}

fn not_found() -> Response<Body> {
    Response::builder().status(StatusCode::NOT_FOUND).body(Body::empty()).unwrap()
}

pub fn start() -> u16 {
    let std_listener = std::net::TcpListener::bind("127.0.0.1:0")
        .expect("Failed to bind media server port");
    std_listener.set_nonblocking(true).unwrap();
    let port = std_listener.local_addr().unwrap().port();
    tauri::async_runtime::spawn(async move {
        let listener = tokio::net::TcpListener::from_std(std_listener)
            .expect("tokio TcpListener");
        axum::serve(listener, Router::new().fallback(handle)).await.ok();
    });
    port
}
