import test from "node:test";
import assert from "node:assert/strict";
import { buildAppleTestFlightCsv, csvCell } from "../server/csv.mjs";

test("TestFlight export uses Apple tester fields and CRLF rows", () => {
  const csv = buildAppleTestFlightCsv([
    { firstName: "Rinzell", lastName: "Hicks", email: "rider@example.com" }
  ]);
  assert.equal(
    csv,
    "First Name,Last Name,Email Address\r\nRinzell,Hicks,rider@example.com\r\n"
  );
});

test("CSV values follow RFC escaping", () => {
  assert.equal(csvCell('Preski, "Labs"'), '"Preski, ""Labs"""');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
});

test("CSV values that could execute spreadsheet formulas are neutralized", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("  @SUM(A1:A2)"), "'  @SUM(A1:A2)");
  assert.equal(csvCell("ordinary"), "ordinary");
});
