//! The server's notion of "now" and "today" for the integration API.
//!
//! The web app decides "today" from the device's local clock. The server has
//! no device, so it follows the process's local zone, which `chrono::Local`
//! resolves from the standard `TZ` environment variable (an IANA name looked
//! up under `/usr/share/zoneinfo`, an absolute TZif path, or a POSIX TZ
//! string), falling back to `/etc/localtime`. No zone database crate is used.
//!
//! `chrono` silently treats an unresolvable `TZ` as UTC, so `validate_tz`
//! runs at boot and refuses a value it cannot resolve.

use chrono::{DateTime, Local, NaiveDate, Utc};
use std::path::Path;

pub(super) const ZONEINFO_DIR: &str = "/usr/share/zoneinfo";

/// Injectable clock. Production uses the real time (`fixed_now_ms: None`);
/// tests pin an instant so "today" and `completed_ts` are deterministic.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct Clock {
    pub(super) fixed_now_ms: Option<i64>,
}

impl Clock {
    pub(super) fn now_ms(&self) -> i64 {
        self.fixed_now_ms.unwrap_or_else(|| Utc::now().timestamp_millis())
    }

    /// The calendar date of `now_ms()` in the server's local zone.
    pub(super) fn today(&self) -> NaiveDate {
        local_date_of_ms(self.now_ms()).unwrap_or_else(|| Local::now().date_naive())
    }
}

/// The local-zone calendar date of a millisecond Unix timestamp, or `None`
/// when it is out of chrono's range.
pub(super) fn local_date_of_ms(ms: i64) -> Option<NaiveDate> {
    DateTime::from_timestamp_millis(ms).map(|utc| utc.with_timezone(&Local).date_naive())
}

/// A POSIX TZ string's leading `std` name plus offset — `EST5EDT`,
/// `UTC0`, `<+0530>-5:30`, `CET-1CEST,M3.5.0,M10.5.0/3`. Shape check only:
/// enough to tell a deliberate POSIX value from a misspelled zone name.
fn is_posix_tz(value: &str) -> bool {
    let rest = if let Some(quoted) = value.strip_prefix('<') {
        match quoted.find('>') {
            Some(end) if end > 0 => &quoted[end + 1..],
            _ => return false,
        }
    } else {
        let name_len = value.chars().take_while(|c| c.is_ascii_alphabetic()).count();
        if name_len < 3 {
            return false;
        }
        &value[name_len..]
    };
    rest.trim_start_matches(['+', '-']).starts_with(|c: char| c.is_ascii_digit())
}

/// Boot check for `TZ`. Pure apart from file-existence probes under
/// `zoneinfo_dir`, so the matrix is unit-testable.
///
/// - `Ok(None)`: resolvable.
/// - `Ok(Some(warning))`: unset; the host zone applies.
/// - `Err(message)`: set but unresolvable — chrono would silently use UTC.
pub(super) fn validate_tz(
    value: Option<&str>,
    zoneinfo_dir: &Path,
) -> Result<Option<String>, String> {
    let Some(raw) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(Some(
            "TZ is unset — the integration API's \"today\" follows the host zone (/etc/localtime; UTC in the stock image). Set TZ to your IANA zone, e.g. TZ=America/New_York".to_string(),
        ));
    };
    let name = raw.strip_prefix(':').unwrap_or(raw);
    if name.starts_with('/') {
        return if Path::new(name).is_file() {
            Ok(None)
        } else {
            Err(format!("TZ=\"{raw}\" names a file that does not exist"))
        };
    }
    let safe_name = !name.split('/').any(|part| part.is_empty() || part == "." || part == "..");
    if safe_name && zoneinfo_dir.join(name).is_file() {
        return Ok(None);
    }
    if is_posix_tz(name) {
        return Ok(None);
    }
    Err(format!(
        "TZ=\"{raw}\" is neither a zone under {} (is the tzdata package installed?) nor a POSIX TZ string — chrono would silently fall back to UTC",
        zoneinfo_dir.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zoneinfo() -> &'static Path {
        Path::new(ZONEINFO_DIR)
    }

    #[test]
    fn unset_or_blank_tz_warns() {
        assert!(matches!(validate_tz(None, zoneinfo()), Ok(Some(_))));
        assert!(matches!(validate_tz(Some("  "), zoneinfo()), Ok(Some(_))));
    }

    #[test]
    fn posix_strings_are_accepted_without_zoneinfo() {
        let empty = Path::new("/nonexistent-zoneinfo");
        for value in ["EST5EDT", "EST5EDT,M3.2.0,M11.1.0", "UTC0", "<+0530>-5:30", "CET-1CEST"] {
            assert_eq!(validate_tz(Some(value), empty), Ok(None), "{value}");
        }
    }

    #[test]
    fn unresolvable_names_fail_closed() {
        let empty = Path::new("/nonexistent-zoneinfo");
        for value in ["Not/AZone", "America/New_York", "garbage", "../etc/passwd", "/no/such/file"]
        {
            assert!(validate_tz(Some(value), empty).is_err(), "{value}");
        }
    }

    #[test]
    fn iana_names_resolve_when_tzdata_is_present() {
        if !zoneinfo().join("America/New_York").is_file() {
            eprintln!("skipping: no tzdata on this host");
            return;
        }
        assert_eq!(validate_tz(Some("America/New_York"), zoneinfo()), Ok(None));
        assert_eq!(validate_tz(Some(":America/New_York"), zoneinfo()), Ok(None));
        assert!(validate_tz(Some("America/Not_A_City"), zoneinfo()).is_err());
    }

    /// 2026-11-01T03:30:00Z — 23:30 on Oct 31 in New York (EDT, UTC-4).
    const LATE_EVENING_NY_MS: i64 = 1_793_503_800_000;

    /// Child half of `today_follows_tz_across_local_midnight`: prints
    /// `today()` for a pinned instant when spawned with `CLOCK_CHILD_MS`, and
    /// is a no-op otherwise. A child process is used because `TZ` is
    /// process-global and other tests run on parallel threads.
    #[test]
    fn clock_child_print_today() {
        let Ok(ms) = std::env::var("CLOCK_CHILD_MS") else { return };
        let clock = Clock { fixed_now_ms: Some(ms.parse().expect("CLOCK_CHILD_MS")) };
        println!("TODAY={}", clock.today());
    }

    fn today_in_child(tz: &str) -> String {
        let output = std::process::Command::new(std::env::current_exe().expect("test binary"))
            .args(["--exact", "routes::clock::tests::clock_child_print_today", "--nocapture"])
            .env("TZ", tz)
            .env("CLOCK_CHILD_MS", LATE_EVENING_NY_MS.to_string())
            .output()
            .expect("spawn child test");
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout
            .lines()
            .find_map(|line| line.strip_prefix("TODAY="))
            .unwrap_or_else(|| panic!("child printed no TODAY line: {stdout}"))
            .to_string()
    }

    #[test]
    fn today_follows_tz_across_local_midnight() {
        assert_eq!(today_in_child("UTC0"), "2026-11-01");
        assert_eq!(today_in_child("EST5EDT,M3.2.0,M11.1.0"), "2026-10-31");
        if zoneinfo().join("America/New_York").is_file() {
            assert_eq!(today_in_child("America/New_York"), "2026-10-31");
        }
    }
}
