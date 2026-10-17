# Spec Delta

## Purpose

Gives TypeScript callers a typed client for the read API, generated from its OpenAPI document, that
returns every API failure as a value in the one error shape instead of throwing.

## ADDED Requirements

### Requirement: Client configuration and auth header
The client SHALL be created from a required `baseUrl` and a required `token`, and SHALL send `Authorization: Bearer <token>` on every request, so no client changes when the API starts enforcing tokens.

#### Scenario: Bearer header sent
- **WHEN** any client method is called
- **THEN** the request carries `Authorization: Bearer <token>` with the configured token

### Requirement: Read methods
The client SHALL expose `emails.get(emailId)` for `email.get` and `recipients.get(address)` for `recipient.get`. `recipients.get` SHALL send the address in the JSON request body only, never in the URL.

#### Scenario: Email lookup
- **WHEN** `emails.get` is called for a stored email
- **THEN** it returns `{ data }` equal to the API's `200` body

#### Scenario: Address stays out of the URL
- **WHEN** `recipients.get('delivered@resend.dev')` is called
- **THEN** the request URL holds no part of the address, and the body is `{ "address": "delivered@resend.dev" }`

### Requirement: Errors are returned, never thrown
Each method SHALL return `{ data, error }` and SHALL NOT throw for an API error. An error-shaped response SHALL come back as `error` unchanged, an unknown `code` included.

#### Scenario: Registry error
- **WHEN** the API answers `404` with `code` `email_not_found`
- **THEN** the method returns `error.code` `email_not_found` and does not throw

#### Scenario: Unknown code
- **WHEN** the API answers an error-shaped body whose `code` the client does not know
- **THEN** that `code` is returned unchanged in `error`

### Requirement: A missing Ledger response is api_unavailable
A response without the error shape, a network failure, or no answer within 31 seconds SHALL return `error.code` `api_unavailable`.

#### Scenario: Shapeless 502
- **WHEN** the server answers `502` with a body that is not the error shape
- **THEN** the method returns `error.code` `api_unavailable`

#### Scenario: Nothing listening
- **WHEN** the base URL points at a closed port
- **THEN** the method returns `error.code` `api_unavailable` and does not throw

### Requirement: SDK and API agree
The SDK's generated types SHALL come from the read API's committed OpenAPI document, and every operation's success and error paths SHALL be exercised through the SDK against the real read API served over HTTP.

#### Scenario: Contract round trip
- **WHEN** the SDK calls each operation against the served read API for a stored email, a stored recipient, an unknown id, an invalid input and an unmatched path
- **THEN** each result's `data` or `error` matches the API's documented response, `route_not_found` included
