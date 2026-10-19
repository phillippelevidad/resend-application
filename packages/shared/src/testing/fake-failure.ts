// What a failing fake rejects with: a plain error, as an SDK or network failure would be, carrying no
// registry code, so the code under test maps it as it would the real one. Its name makes the
// `error_name` a test reads unmistakable.
export const fakeFailure = (what: string): Error =>
  Object.assign(new Error(`${what} failed (fake)`), { name: 'FakeFailure' });
