// D7: the clock port. Logic reads time only through it, so a test sets and moves time with
// `FakeClock` (`@ledger/shared/testing`) instead of patching `Date` (pp-testing → fakes).
export interface ClockPort {
  now(): Date;
}
