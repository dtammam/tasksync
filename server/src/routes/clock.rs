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

/// Minimal byte cursor for `is_posix_tz`.
struct Cursor<'a> {
    rest: &'a [u8],
}

impl<'a> Cursor<'a> {
    fn peek(&self) -> Option<u8> {
        self.rest.first().copied()
    }

    fn eat(&mut self, byte: u8) -> bool {
        if self.peek() == Some(byte) {
            self.rest = &self.rest[1..];
            true
        } else {
            false
        }
    }

    fn take_while(&mut self, pred: impl Fn(u8) -> bool) -> &'a [u8] {
        let len = self.rest.iter().take_while(|b| pred(**b)).count();
        let (taken, rest) = self.rest.split_at(len);
        self.rest = rest;
        taken
    }

    fn int(&mut self) -> Option<u32> {
        let digits = self.take_while(|b| b.is_ascii_digit());
        if digits.is_empty() || digits.len() > 3 {
            return None;
        }
        std::str::from_utf8(digits).ok()?.parse().ok()
    }
}

/// `std`/`dst` name: 3–7 letters, or `<…>` quoted (letters, digits, `+`,
/// `-`) — chrono's `TimeZoneName` length bound.
fn posix_name(c: &mut Cursor) -> Option<()> {
    let name = if c.eat(b'<') {
        let quoted = c.take_while(|b| b != b'>');
        if !c.eat(b'>') || !quoted.iter().all(|b| b.is_ascii_alphanumeric() || b"+-".contains(b)) {
            return None;
        }
        quoted
    } else {
        c.take_while(|b| b.is_ascii_alphabetic())
    };
    (3..=7).contains(&name.len()).then_some(())
}

/// `hh[:mm[:ss]]`, with an optional sign when `signed`.
fn posix_hhmmss(c: &mut Cursor, signed: bool) -> Option<()> {
    if signed && !c.eat(b'+') {
        c.eat(b'-');
    }
    if c.int()? > 24 {
        return None;
    }
    for _ in 0..2 {
        if !c.eat(b':') {
            break;
        }
        if c.int()? > 59 {
            return None;
        }
    }
    Some(())
}

/// A DST transition rule: `Mm.w.d`, `Jn` or `n`, then optional `/time`.
fn posix_rule(c: &mut Cursor) -> Option<()> {
    if c.eat(b'M') {
        let month = c.int()?;
        c.eat(b'.').then_some(())?;
        let week = c.int()?;
        c.eat(b'.').then_some(())?;
        let weekday = c.int()?;
        ((1..=12).contains(&month) && (1..=5).contains(&week) && weekday <= 6).then_some(())?;
    } else if c.eat(b'J') {
        (1..=365).contains(&c.int()?).then_some(())?;
    } else {
        (c.int()? <= 365).then_some(())?;
    }
    if c.eat(b'/') {
        posix_hhmmss(c, false)?;
    }
    Some(())
}

/// True when chrono 0.4's `TransitionRule::from_tz_string` (no extensions)
/// would accept `value`: `std offset`, or `std offset dst [offset],start,end`
/// with nothing after. A DST name without both rules is rejected, as chrono
/// rejects it (and would then silently fall back to the host zone).
fn is_posix_tz(value: &str) -> bool {
    let mut c = Cursor { rest: value.as_bytes() };
    let parsed = (|| {
        posix_name(&mut c)?;
        posix_hhmmss(&mut c, true)?;
        if c.peek().is_none() {
            return Some(());
        }
        posix_name(&mut c)?;
        if c.peek() != Some(b',') {
            posix_hhmmss(&mut c, true)?;
        }
        c.eat(b',').then_some(())?;
        posix_rule(&mut c)?;
        c.eat(b',').then_some(())?;
        posix_rule(&mut c)?;
        c.peek().is_none().then_some(())
    })();
    parsed.is_some()
}

/// True when `path` is a compiled zone file (`TZif` magic), the only file
/// chrono can load; any other file (`zone.tab`, `/etc/passwd`) would make it
/// fall back silently.
fn is_tzif_file(path: &Path) -> bool {
    use std::io::Read;
    let mut magic = [0u8; 4];
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut magic)).is_ok()
        && &magic == b"TZif"
}

/// Boot check for `TZ`, mirroring how chrono 0.4.43's `Local` resolves it
/// (`offset/local/tz_info/timezone.rs`, `TimeZone::from_posix_tz`): empty →
/// UTC; `:name` → zone file only; otherwise a zone file (absolute, or under
/// the zoneinfo directory), else a POSIX TZ string. Anything chrono cannot
/// load makes it fall back silently to the host zone, so that is a boot
/// failure here. Pure apart from file reads, so the matrix is unit-testable.
///
/// - `Ok(None)`: resolvable.
/// - `Ok(Some(warning))`: unset or empty — a default zone applies.
/// - `Err(message)`: set but unresolvable.
pub(super) fn validate_tz(
    value: Option<&str>,
    zoneinfo_dir: &Path,
) -> Result<Option<String>, String> {
    let Some(raw) = value else {
        return Ok(Some(
            "TZ is unset — the integration API's \"today\" follows /etc/localtime (UTC in the stock image). Set TZ to your IANA zone, e.g. TZ=America/New_York".to_string(),
        ));
    };
    if raw.is_empty() {
        return Ok(Some(
            "TZ is set but empty — the integration API's \"today\" is UTC. Set TZ to your IANA zone, e.g. TZ=America/New_York".to_string(),
        ));
    }
    if raw.trim() != raw {
        return Err(format!(
            "TZ=\"{raw}\" has leading or trailing whitespace — chrono would not resolve it"
        ));
    }
    let (name, file_only) = match raw.strip_prefix(':') {
        Some(name) => (name, true),
        None => (raw, false),
    };
    let file = if name.starts_with('/') {
        Some(Path::new(name).to_path_buf())
    } else if !name.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
        Some(zoneinfo_dir.join(name))
    } else {
        None
    };
    if file.as_deref().is_some_and(is_tzif_file) {
        return Ok(None);
    }
    if !file_only && is_posix_tz(name) {
        return Ok(None);
    }
    Err(format!(
        "TZ=\"{raw}\" is neither a compiled zone under {} (is the tzdata package installed?) nor a complete POSIX TZ string (a DST zone needs its ,start,end rules) — chrono would silently fall back to the host zone",
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
    fn unset_or_empty_tz_warns() {
        assert!(matches!(validate_tz(None, zoneinfo()), Ok(Some(_))));
        assert!(matches!(validate_tz(Some(""), zoneinfo()), Ok(Some(_))));
    }

    #[test]
    fn complete_posix_strings_are_accepted_without_zoneinfo() {
        let empty = Path::new("/nonexistent-zoneinfo");
        for value in [
            "UTC0",
            "EST5",
            "<+0530>-5:30",
            "EST5EDT,M3.2.0,M11.1.0",
            "CET-1CEST,M3.5.0,M10.5.0/3",
            "AEST-10AEDT,M10.1.0,M4.1.0/3",
            "<-03>3<-02>,M3.5.0/-2,M10.5.0/-1",
        ] {
            let accepted = validate_tz(Some(value), empty) == Ok(None);
            // The last one uses a signed rule time — a TZ string extension
            // chrono rejects without extensions, so it must be refused too.
            assert_eq!(accepted, !value.contains("/-"), "{value}");
        }
    }

    /// Values chrono 0.4.43 cannot load (it would silently fall back),
    /// including the ones found by the gate's Adversary seat.
    #[test]
    fn values_chrono_cannot_load_fail_closed() {
        let empty = Path::new("/nonexistent-zoneinfo");
        for value in [
            "CET-1CEST",
            "AEST-10AEDT",
            "EST5EDT",
            "EST5EDT,M3.2.0",
            "XYZ-3garbage",
            "EST5EDT,M3.2.0,M11.1.0x",
            "EST25",
            "ABCDEFGH5",
            "EST5EDT,M13.2.0,M11.1.0",
            "Not/AZone",
            "America/New_York",
            "garbage",
            "../etc/passwd",
            "/no/such/file",
            " UTC0",
            "UTC0 ",
            ":UTC0",
        ] {
            assert!(validate_tz(Some(value), empty).is_err(), "{value}");
        }
    }

    #[test]
    fn zone_files_must_be_tzif() {
        if !zoneinfo().join("America/New_York").is_file() {
            eprintln!("skipping: no tzdata on this host");
            return;
        }
        assert_eq!(validate_tz(Some("America/New_York"), zoneinfo()), Ok(None));
        assert_eq!(validate_tz(Some(":America/New_York"), zoneinfo()), Ok(None));
        let absolute = zoneinfo().join("America/New_York");
        assert_eq!(validate_tz(absolute.to_str(), zoneinfo()), Ok(None));
        for value in [
            "America/Not_A_City",
            "zone1970.tab",
            "iso3166.tab",
            "/etc/passwd",
            "Europe/Paris ",
            "America/../America/New_York",
        ] {
            assert!(validate_tz(Some(value), zoneinfo()).is_err(), "{value}");
        }
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

    /// 2026-10-31T23:30:00Z — already Nov 1 in CET (UTC+1 after Oct 25).
    const OCT_31_2330_UTC_MS: i64 = 1_793_489_400_000;

    fn today_in_child(tz: &str) -> String {
        today_in_child_at(tz, LATE_EVENING_NY_MS)
    }

    fn today_in_child_at(tz: &str, ms: i64) -> String {
        let output = std::process::Command::new(std::env::current_exe().expect("test binary"))
            .args(["--exact", "routes::clock::tests::clock_child_print_today", "--nocapture"])
            .env("TZ", tz)
            .env("CLOCK_CHILD_MS", ms.to_string())
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
        // 23:30Z on Oct 31 is 00:30 on Nov 1 in CET, while UTC (chrono's
        // silent fallback) would still say Oct 31: pins that an accepted DST
        // string is really applied.
        assert_eq!(
            today_in_child_at("CET-1CEST,M3.5.0,M10.5.0/3", OCT_31_2330_UTC_MS),
            "2026-11-01"
        );
        if zoneinfo().join("America/New_York").is_file() {
            assert_eq!(today_in_child("America/New_York"), "2026-10-31");
        }
    }
}
