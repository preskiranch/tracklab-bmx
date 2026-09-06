const APPLE_HEADERS = Object.freeze(["First Name", "Last Name", "Email Address"]);
const FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/u;

export function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\r\n]/u.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function buildAppleTestFlightCsv(signups) {
  const rows = [APPLE_HEADERS, ...signups.map((signup) => [
    signup.firstName,
    signup.lastName,
    signup.email
  ])];

  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
