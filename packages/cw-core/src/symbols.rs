// SPDX-FileCopyrightText: 2026 John Schult, Mark Percival
//
// SPDX-License-Identifier: MIT

//! ITU Morse symbol table: character/prosign ⇄ dit-dah pattern lookup.
//!
//! Ported verbatim from the canonical TypeScript source of truth,
//! `packages/morse-audio/src/utils/morse-code.ts` (`MORSE_CODE` + `PROSIGNS`).
//! Same characters, same patterns — no additions, drops, or "improvements".
//!
//! Patterns use `.` for a dit and `-` for a dah, with no inter-element spacing
//! (the table is per-character; gap/timing logic is a separate primitive).

/// Single-character forward table: A–Z, 0–9, and the ported punctuation set.
///
/// This is the one source of truth for the single-char direction; the lookup
/// functions and the count guard all derive from it. Patterns here are unique
/// (a clean inverse), so [`char_for_pattern`] can scan it directly.
const SYMBOLS: &[(char, &str)] = &[
    // Letters
    ('A', ".-"),
    ('B', "-..."),
    ('C', "-.-."),
    ('D', "-.."),
    ('E', "."),
    ('F', "..-."),
    ('G', "--."),
    ('H', "...."),
    ('I', ".."),
    ('J', ".---"),
    ('K', "-.-"),
    ('L', ".-.."),
    ('M', "--"),
    ('N', "-."),
    ('O', "---"),
    ('P', ".--."),
    ('Q', "--.-"),
    ('R', ".-."),
    ('S', "..."),
    ('T', "-"),
    ('U', "..-"),
    ('V', "...-"),
    ('W', ".--"),
    ('X', "-..-"),
    ('Y', "-.--"),
    ('Z', "--.."),
    // Digits
    ('0', "-----"),
    ('1', ".----"),
    ('2', "..---"),
    ('3', "...--"),
    ('4', "....-"),
    ('5', "....."),
    ('6', "-...."),
    ('7', "--..."),
    ('8', "---.."),
    ('9', "----."),
    // Punctuation / symbols
    ('.', ".-.-.-"),
    (',', "--..--"),
    ('?', "..--.."),
    ('\'', ".----."),
    ('!', "-.-.--"),
    ('/', "-..-."),
    ('(', "-.--."),
    (')', "-.--.-"),
    ('&', ".-..."),
    (':', "---..."),
    (';', "-.-.-."),
    ('=', "-...-"),
    ('+', ".-.-."),
    ('-', "-....-"),
    ('_', "..--.-"),
    ('"', ".-..-."),
    ('$', "...-..-"),
    ('@', ".--.-."),
];

/// Prosigns — sent as a single token with no inter-character gap. Kept separate
/// from [`SYMBOLS`] because their keys are bracketed multi-letter tokens
/// (`<SK>`), not `char`s. Several patterns intentionally collide with base
/// characters (`<AR>`==`+`, `<BT>`==`=`, `<AS>`==`&`, `<KN>`==`(`); these are
/// real Morse facts (letter-pair fusions) and are preserved, not deduped.
const PROSIGNS: &[(&str, &str)] = &[
    ("<AR>", ".-.-."),
    ("<AS>", ".-..."),
    ("<BK>", "-...-.-"),
    ("<BT>", "-...-"),
    ("<CL>", "-.-..-.."),
    ("<CT>", "-.-.-"),
    ("<KN>", "-.--."),
    ("<SK>", "...-.-"),
    ("<SN>", "...-."),
    ("<SOS>", "...---..."),
];

/// Forward lookup: the dit/dah pattern for a single character.
///
/// ASCII letters are case-folded, so `pattern_for('a') == pattern_for('A')`.
/// Returns `None` for anything outside the ported set.
pub fn pattern_for(c: char) -> Option<&'static str> {
    let c = c.to_ascii_uppercase();
    SYMBOLS
        .iter()
        .find(|(k, _)| *k == c)
        .map(|(_, pattern)| *pattern)
}

/// Prosign lookup: the dit/dah pattern for a bracketed token like `"<SK>"`.
///
/// The name is case-folded, so `prosign_pattern("<sk>") == prosign_pattern("<SK>")`.
/// Returns `None` for anything that is not a known prosign token.
pub fn prosign_pattern(name: &str) -> Option<&'static str> {
    let name = name.to_ascii_uppercase();
    PROSIGNS
        .iter()
        .find(|(k, _)| *k == name)
        .map(|(_, pattern)| *pattern)
}

/// Reverse lookup over the **unambiguous single-character space** only.
///
/// Returns the base character for a pattern (letters/digits/punctuation).
/// Prosign-colliding patterns resolve to their **base character**, never the
/// prosign: `char_for_pattern(".-.-.")` is `Some('+')`, not `<AR>`. Prosign
/// reverse-resolution is intentionally out of scope — the decode path emits
/// characters, not prosign tokens, so a clean char inverse is what's needed.
pub fn char_for_pattern(pattern: &str) -> Option<char> {
    SYMBOLS
        .iter()
        .find(|(_, p)| *p == pattern)
        .map(|(c, _)| *c)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every letter A–Z and its exact ITU pattern. Table-driven so a single
    /// typo fails loudly on the offending row.
    const LETTERS: [(char, &str); 26] = [
        ('A', ".-"),
        ('B', "-..."),
        ('C', "-.-."),
        ('D', "-.."),
        ('E', "."),
        ('F', "..-."),
        ('G', "--."),
        ('H', "...."),
        ('I', ".."),
        ('J', ".---"),
        ('K', "-.-"),
        ('L', ".-.."),
        ('M', "--"),
        ('N', "-."),
        ('O', "---"),
        ('P', ".--."),
        ('Q', "--.-"),
        ('R', ".-."),
        ('S', "..."),
        ('T', "-"),
        ('U', "..-"),
        ('V', "...-"),
        ('W', ".--"),
        ('X', "-..-"),
        ('Y', "-.--"),
        ('Z', "--.."),
    ];

    const DIGITS: [(char, &str); 10] = [
        ('0', "-----"),
        ('1', ".----"),
        ('2', "..---"),
        ('3', "...--"),
        ('4', "....-"),
        ('5', "....."),
        ('6', "-...."),
        ('7', "--..."),
        ('8', "---.."),
        ('9', "----."),
    ];

    const PUNCT: [(char, &str); 18] = [
        ('.', ".-.-.-"),
        (',', "--..--"),
        ('?', "..--.."),
        ('\'', ".----."),
        ('!', "-.-.--"),
        ('/', "-..-."),
        ('(', "-.--."),
        (')', "-.--.-"),
        ('&', ".-..."),
        (':', "---..."),
        (';', "-.-.-."),
        ('=', "-...-"),
        ('+', ".-.-."),
        ('-', "-....-"),
        ('_', "..--.-"),
        ('"', ".-..-."),
        ('$', "...-..-"),
        ('@', ".--.-."),
    ];

    const PROSIGN_CASES: [(&str, &str); 10] = [
        ("<AR>", ".-.-."),
        ("<AS>", ".-..."),
        ("<BK>", "-...-.-"),
        ("<BT>", "-...-"),
        ("<CL>", "-.-..-.."),
        ("<CT>", "-.-.-"),
        ("<KN>", "-.--."),
        ("<SK>", "...-.-"),
        ("<SN>", "...-."),
        ("<SOS>", "...---..."),
    ];

    #[test]
    fn letters_map_to_itu_patterns() {
        for (c, expected) in LETTERS {
            assert_eq!(pattern_for(c), Some(expected), "letter {c}");
        }
    }

    #[test]
    fn digits_map_to_itu_patterns() {
        for (c, expected) in DIGITS {
            assert_eq!(pattern_for(c), Some(expected), "digit {c}");
        }
    }

    #[test]
    fn punctuation_maps_to_itu_patterns() {
        for (c, expected) in PUNCT {
            assert_eq!(pattern_for(c), Some(expected), "punct {c}");
        }
    }

    #[test]
    fn lowercase_letters_case_fold() {
        for c in 'a'..='z' {
            assert_eq!(
                pattern_for(c),
                pattern_for(c.to_ascii_uppercase()),
                "case fold {c}"
            );
        }
    }

    #[test]
    fn unknown_chars_return_none() {
        for c in ['%', ' ', '\n', '\t', '*', '\0', '£'] {
            assert_eq!(pattern_for(c), None, "unknown {c:?}");
        }
    }

    #[test]
    fn prosigns_map_to_patterns_case_insensitive() {
        for (name, expected) in PROSIGN_CASES {
            assert_eq!(prosign_pattern(name), Some(expected), "prosign {name}");
            assert_eq!(
                prosign_pattern(&name.to_lowercase()),
                Some(expected),
                "prosign lowercase {name}"
            );
        }
    }

    #[test]
    fn unknown_prosign_returns_none() {
        for name in ["<ZZ>", "<>", "SK", "", "<sos"] {
            assert_eq!(prosign_pattern(name), None, "unknown prosign {name:?}");
        }
    }

    /// Intentional prosign/base-char pattern collisions. Locks the duplicates so
    /// a future "cleanup" that breaks them fails here.
    #[test]
    fn prosign_collisions_are_preserved() {
        assert_eq!(prosign_pattern("<AR>"), pattern_for('+'));
        assert_eq!(prosign_pattern("<BT>"), pattern_for('='));
        assert_eq!(prosign_pattern("<AS>"), pattern_for('&'));
        assert_eq!(prosign_pattern("<KN>"), pattern_for('('));
    }

    #[test]
    fn reverse_lookup_resolves_base_char_not_prosign() {
        // Collision patterns resolve to the base char, never the prosign token.
        assert_eq!(char_for_pattern(".-.-."), Some('+'));
        assert_eq!(char_for_pattern("-...-"), Some('='));
        assert_eq!(char_for_pattern(".-..."), Some('&'));
        assert_eq!(char_for_pattern("-.--."), Some('('));
    }

    #[test]
    fn reverse_lookup_clean_round_trips() {
        assert_eq!(char_for_pattern(".-"), Some('A'));
        assert_eq!(char_for_pattern("....."), Some('5'));
        assert_eq!(char_for_pattern("...-..-"), Some('$'));
        // Every single-char entry round-trips through pattern_for/char_for_pattern.
        for (c, pattern) in SYMBOLS {
            assert_eq!(char_for_pattern(pattern), Some(*c), "round trip {c}");
        }
    }

    #[test]
    fn reverse_lookup_nonsense_returns_none() {
        for p in ["......."/* 7 dits, no such char */, "", "x", ".-.-.-.-"] {
            assert_eq!(char_for_pattern(p), None, "nonsense {p:?}");
        }
    }

    /// Count guard: catches an accidental add/drop. Expected counts derive from
    /// the ported lists: 26 letters + 10 digits + 18 punctuation = 54 single
    /// chars, and 10 prosigns.
    #[test]
    fn table_counts_match_expected() {
        assert_eq!(SYMBOLS.len(), 26 + 10 + 18, "single-char entries");
        assert_eq!(PROSIGNS.len(), 10, "prosign entries");
    }
}
