// Query parameters arrive as strings, and Number() also turns forms no
// user means as a number into one: '' and '   ' become 0, and '0x1F'
// becomes 31. Only ordinary decimal notation (optionally with an
// exponent, which <input type="number"> can produce) is converted here;
// anything else comes back as NaN, so the caller's existing
// Number.isFinite check rejects it with the usual 400 message.
const PLAIN_NUMBER = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function parseNumericParam(raw) {
  return typeof raw === 'string' && PLAIN_NUMBER.test(raw) ? Number(raw) : NaN;
}

module.exports = { parseNumericParam };
