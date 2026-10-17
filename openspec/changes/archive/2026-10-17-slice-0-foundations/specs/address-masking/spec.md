# Spec Delta

## Purpose

Normalizes recipient addresses to one canonical form and masks addresses, senders and subjects so
support can read them without anyone being identified and no mask carries a terminal escape.

## ADDED Requirements

### Requirement: One address normalization
Addresses SHALL be normalized by trimming surrounding whitespace and lowercasing, locale-independently, by one function. Normalization SHALL NOT parse display names.

#### Scenario: Case and whitespace
- **WHEN** `  Delivered@Resend.DEV ` is normalized
- **THEN** the result is `delivered@resend.dev`

### Requirement: Address mask
An address SHALL be split at its last `@`. The local part SHALL keep its first `min(3, ⌊n/3⌋)` characters, each `.`-separated domain label its first character, and every other character SHALL become `*`. An input with no `@` SHALL be masked as a local part.

#### Scenario: Ratified example
- **WHEN** `delivered@resend.dev` is masked
- **THEN** the result is `del******@r*****.d**`

#### Scenario: No at-sign
- **WHEN** a string with no `@` is masked as an address
- **THEN** it is masked as a single local part

### Requirement: Text mask
Subjects and display names SHALL be masked per token: each maximal run of token characters of length `n` keeps its first `min(3, ⌊n/3⌋)` characters and the rest become `*`. Whitespace, punctuation and symbols other than `*` SHALL be kept as separators; `*` SHALL count as a token character.

#### Scenario: Ratified example
- **WHEN** `Your invoice is ready` is masked
- **THEN** the result is `Y*** in***** ** r****`

### Requirement: Sender mask
A sender of the form `Display Name <address>` SHALL mask as the text mask of the name, then ` <`, the address mask, and `>`. Any other sender SHALL mask as an address.

#### Scenario: Sender with display name
- **WHEN** `Billing Team <onboarding@resend.dev>` is masked as a sender
- **THEN** the name part is text-masked, the address part is address-masked, and ` <` and `>` are kept

### Requirement: No digit revealed
Every mask SHALL replace every decimal digit with `*`, wherever it appears, including in characters a rule would otherwise keep.

#### Scenario: One-time code in a subject
- **WHEN** `Code 123456` is masked
- **THEN** the output contains no digit

### Requirement: No control character
Every mask SHALL map every control character (C0, DEL, C1) to `*` before tokenizing, so no mask carries a terminal escape into CLI output.

#### Scenario: Escape sequence in a display name
- **WHEN** a display name containing an ESC character is masked
- **THEN** the output contains no control character

### Requirement: Masks are length-preserving and idempotent
Every mask SHALL preserve length in code points, SHALL reveal at most 3 characters per token, and SHALL satisfy `mask(mask(x)) = mask(x)` for every input.

#### Scenario: Arbitrary input
- **WHEN** a property run masks generated strings that include digits, control characters, astral code points, `*` and separators
- **THEN** each output has the input's code-point length, reveals at most 3 characters per token, and masking it again returns it unchanged
