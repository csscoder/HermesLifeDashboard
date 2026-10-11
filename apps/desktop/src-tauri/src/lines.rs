//! Parsers for the API's stdout lines (spec 2026-10-11 «Wrapper»).

const PAIRING_PREFIX: &str = "LifeDashboard pairing code: ";

/// `(code, until)` from `LifeDashboard pairing code: 123456 (valid until 9:46:10 AM)`.
/// `until` is whatever `toLocaleTimeString` printed, including non-ASCII spaces.
pub fn pairing_code(line: &str) -> Option<(&str, &str)> {
    let rest = line.trim().strip_prefix(PAIRING_PREFIX)?;
    let (code, rest) = rest.split_at_checked(6)?;
    if !code.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let until = rest.strip_prefix(" (valid until ")?.strip_suffix(')')?;
    Some((code, until))
}

/// The line `server.ts` prints after `listen` on `port`.
pub fn is_ready(line: &str, port: u16) -> bool {
    line.trim() == format!("LifeDashboard API listening on http://127.0.0.1:{port}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_pairing_line() {
        assert_eq!(
            pairing_code("LifeDashboard pairing code: 012345 (valid until 9:46:10 AM)"),
            Some(("012345", "9:46:10 AM"))
        );
    }

    #[test]
    fn accepts_a_narrow_no_break_space_in_the_time() {
        assert_eq!(
            pairing_code("LifeDashboard pairing code: 721108 (valid until 9:46:10\u{202f}AM)"),
            Some(("721108", "9:46:10\u{202f}AM"))
        );
    }

    #[test]
    fn rejects_a_code_that_is_not_six_digits() {
        assert_eq!(pairing_code("LifeDashboard pairing code: 12345 (valid until 9:46 AM)"), None);
        assert_eq!(pairing_code("LifeDashboard pairing code: 1234567 (valid until 9:46 AM)"), None);
        assert_eq!(pairing_code("LifeDashboard pairing code: 12a456 (valid until 9:46 AM)"), None);
    }

    #[test]
    fn ignores_other_lines() {
        assert_eq!(pairing_code(""), None);
        assert_eq!(
            pairing_code(r#"{"level":30,"msg":"Server listening at http://127.0.0.1:3101"}"#),
            None
        );
    }

    #[test]
    fn ready_line_matches_only_its_port() {
        assert!(is_ready("LifeDashboard API listening on http://127.0.0.1:3101", 3101));
        assert!(!is_ready("LifeDashboard API listening on http://127.0.0.1:3001", 3101));
        assert!(!is_ready(r#"{"level":30,"msg":"Server listening at http://127.0.0.1:3101"}"#, 3101));
        assert!(!is_ready("", 3101));
    }
}
