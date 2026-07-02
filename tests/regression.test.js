/* Tally — automated regression tests
 *
 * WHAT THIS DOES
 *   Reads the live app (index.html), pulls the real money/currency functions
 *   straight out of it, and runs them against known scenarios with known
 *   answers. If a future edit changes a result, this fails — so a broken
 *   calculation can't ship silently.
 *
 * HOW TO RUN LOCALLY
 *   1. Install Node.js (https://nodejs.org) — any version 16+.
 *   2. From the repo folder, run:   node tests/regression.test.js
 *   It prints PASS/FAIL per check and exits non-zero if anything failed.
 *
 * IT ALSO RUNS AUTOMATICALLY on every push via GitHub Actions
 *   (see .github/workflows/regression.yml). A red X on a commit = a test broke.
 *
 * HOW TO ADD A NEW TEST
 *   Scroll to the "SCENARIOS" section and copy an existing block. Give it
 *   known inputs and the exact answer you expect. That's it.
 *
 * IF A TEST BREAKS AFTER AN INTENTIONAL CHANGE
 *   Either the change has a bug, OR the expected number genuinely changed —
 *   in which case update the expected value here on purpose.
 */

const fs = require('fs');
const path = require('path');

// ---- Locate index.html (repo root, regardless of where this is run from) ----
const HTML_PATH = path.join(__dirname, '..', 'index.html');
let src;
try {
  src = fs.readFileSync(HTML_PATH, 'utf8');
} catch (e) {
  console.error('Could not read index.html at ' + HTML_PATH);
  process.exit(2);
}

// ---- Pull a named function out of the source by matching braces ----
function extractFn(name) {
  const m = new RegExp('function\\s+' + name + '\\s*\\(').exec(src);
  if (!m) throw new Error('Function not found in index.html: ' + name +
    ' (did it get renamed? update tests/regression.test.js)');
  let i = src.indexOf('{', m.index);
  let depth = 0, j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
    j++;
  }
  return src.slice(m.index, j);
}
function extractConstLine(prefix) {
  // Minification-tolerant: find the declaration anywhere (the shipped file is
  // one long line), then scan to the semicolon that ends it, respecting
  // strings and nested brackets/braces.
  const i = src.indexOf(prefix);
  if (i < 0) throw new Error('Constant not found in index.html: ' + prefix);
  let j = i + prefix.length, depth = 0, q = null;
  while (j < src.length) {
    const c = src[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; }
    else if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ';' && depth === 0) { j++; break; }
    j++;
  }
  return src.slice(i, j);
}

// ---- Rebuild a tiny sandbox with the real code ----
let FX = { base: 'USD', rates: { USD: 1 }, date: '' };   // over/written per test

const CURRENCIES_SRC = (/const CURRENCIES=\[[\s\S]*?\];/).exec(src)[0];

const code = [
  CURRENCIES_SRC,
  'const CCY_BY_CODE={};CURRENCIES.forEach(c=>{CCY_BY_CODE[c.code]=c});',
  extractConstLine('const MAJOR_SYM='),
  extractConstLine('const LEGACY_SYM_TO_CODE='),
  extractConstLine('const PINNED_CCY='),
  extractFn('rd2'),
  extractFn('fmtN'),
  extractFn('isMultiCur'),
  extractFn('entryCcy'),
  extractFn('amtMain'),
  extractFn('amtMainOr'),
  extractFn('fxConvert'),
  extractFn('calcTransfers'),
  extractFn('getEntriesSinceLastSettlement'),
  extractFn('ccyPrefix'),
  extractFn('toCode'),
  extractFn('fmtCcy'),
  extractFn('projSym'),
  extractFn('cur'),
  extractFn('currencyGroups'),
  extractFn('isPay'),
  extractFn('myName'),
  extractFn('otherName'),
  extractFn('payerName'),
  extractFn('receiverName'),
  extractFn('paidBtnLabel'),
  extractFn('entryShareOf'),
  extractFn('calcPersonDues'),
  extractFn('calcPersonExpenseBreakdown'),
  extractFn('calcHistoryStatusMap'),
].join('\n');

// The per-person balance logic lives inline inside renderProjectDetail.
// Slice it out and wrap it as a callable function so we can test it directly.
(function buildComputeBalances() {
  const rpd = extractFn('renderProjectDetail');
  const start = rpd.indexOf('const parts=p.participants;');
  const endAnchor = 'const allSettled=transfers.length===0;';
  const end = rpd.indexOf(endAnchor);
  if (start < 0 || end < 0) throw new Error('Balance block markers not found in renderProjectDetail (was it refactored? update the anchors in regression.test.js)');
  global.__BAL__ = rpd.slice(start, end + endAnchor.length);
})();

// Evaluate the extracted code into this scope.
var settings = { name: 'Rachel' };
eval(code);
const computeBalances = new Function('p', 'FX',
  'with(this){' + global.__BAL__ + ' return {paid,owes,balances,transfers,allSettled};}'
);
// bind helpers the balance block calls
const ctx = { isMultiCur, entryCcy, amtMain, fxConvert, rd2, calcTransfers, getEntriesSinceLastSettlement };
function balances(p) { return computeBalances.call(ctx, p, FX); }

// ---- Tiny assertion helpers ----
let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + '  → ' + JSON.stringify(got) + (ok ? '' : '  (expected ' + JSON.stringify(want) + ')'));
}
function near(label, got, want) {
  const ok = Math.abs(got - want) < 0.011;
  ok ? pass++ : fail++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + '  → ' + got + (ok ? '' : '  (expected ~' + want + ')'));
}
function transfers(label, list, want) {
  const norm = t => t.map(x => x.from + '->' + x.to + ':' + x.amount).sort().join(' | ');
  const ok = norm(list) === norm(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + '  → ' + norm(list) + (ok ? '' : '  (expected ' + norm(want) + ')'));
}
function section(t) { console.log('\n' + t); }

/* ============================ SCENARIOS ============================ *
 * Add new tests by copying a block below. Keep inputs + expected answer
 * together so the intent is obvious.
 * =================================================================== */

section('Currency display rule (multi-currency shows the three-letter ISO code)');
check('USD', fmtCcy(1200, 'USD'), 'USD 1,200');
check('EUR', fmtCcy(1200, 'EUR'), 'EUR 1,200');
check('GBP', fmtCcy(1200, 'GBP'), 'GBP 1,200');
check('JPY → code', fmtCcy(1200, 'JPY'), 'JPY 1,200');
check('AED → code', fmtCcy(50, 'AED'), 'AED 50');
check('LKR → code', fmtCcy(450, 'LKR'), 'LKR 450');

section('Single-currency display (legacy symbols pass through, codes follow rule)');
check('legacy "$" unchanged', cur({ currency: '$' }) + '75', '$75');
check('legacy "KSh" unchanged', cur({ currency: 'KSh' }) + '75', 'KSh75');
check('new code USD → $', cur({ currency: 'USD' }) + '75', '$75');
check('new code LKR → code', cur({ currency: 'LKR' }) + '450', 'LKR 450');

section('Edit pre-select mapping (legacy symbol → ISO code)');
check('$ → USD', toCode('$'), 'USD');
check('KSh → KES', toCode('KSh'), 'KES');
check('LKR stays LKR', toCode('LKR'), 'LKR');

section('Pinned currencies (Common group order)');
const g = currencyGroups();
check('8 pinned', g.top.length, 8);
check('order', g.top.map(c => c.code).join(','), 'USD,EUR,GBP,JPY,AUD,CAD,CNY,AED');
check('LKR is in the A–Z list', g.rest.some(c => c.code === 'LKR'), true);

section('FX conversion — never fakes a missing rate');
FX.rates = { USD: 1, LKR: 300 };
near('450 LKR ≈ 1.5 USD', fxConvert(450, 'LKR', 'USD'), 1.5);
check('same currency', fxConvert(100, 'USD', 'USD'), 100);
FX.rates = { USD: 1 };
check('missing rate → null (not 1:1)', fxConvert(450, 'LKR', 'USD'), null);

section('Group split — equal');
FX.rates = { USD: 1 };
let r = balances({ participants: ['A', 'B', 'C'], mainCur: 'USD', currency: '$', history: [
  { type: 'charge', amount: 90, paidBy: 'A' },
  { type: 'charge', amount: 30, paidBy: 'C' },
] });
check('A balance', r.balances.A, 50);
check('B balance', r.balances.B, -40);
check('C balance', r.balances.C, -10);
transfers('settle-up', r.transfers, [{ from: 'B', to: 'A', amount: 40 }, { from: 'C', to: 'A', amount: 10 }]);

section('Group split — custom amounts');
r = balances({ participants: ['A', 'B', 'C'], mainCur: 'USD', currency: '$', history: [
  { type: 'charge', amount: 100, paidBy: 'B', splitAmong: ['A', 'B', 'C'], customSplit: { A: 50, B: 30, C: 20 } },
] });
check('A', r.balances.A, -50); check('B', r.balances.B, 70); check('C', r.balances.C, -20);
transfers('settle-up', r.transfers, [{ from: 'A', to: 'B', amount: 50 }, { from: 'C', to: 'B', amount: 20 }]);

section('Settlement clears a debt');
r = balances({ participants: ['A', 'B', 'C'], mainCur: 'USD', currency: '$', history: [
  { type: 'charge', amount: 90, paidBy: 'A' },
  { type: 'charge', amount: 30, paidBy: 'C' },
  { type: 'payment', from: 'B', to: 'A', amount: 40 },
] });
check('A', r.balances.A, 10); check('B', r.balances.B, 0); check('C', r.balances.C, -10);
transfers('settle-up', r.transfers, [{ from: 'C', to: 'A', amount: 10 }]);

section('Multi-currency custom split (1 USD = 300 LKR)');
FX.rates = { USD: 1, LKR: 300 };
r = balances({ participants: ['A', 'B', 'C'], multiCur: true, curList: ['USD', 'LKR'], mainCur: 'USD', currency: '$', history: [
  { type: 'charge', amount: 3000, ccy: 'LKR', paidBy: 'A', splitAmong: ['A', 'B', 'C'], customSplit: { A: 1500, B: 900, C: 600 } },
] });
near('A +5', r.balances.A, 5); near('B -3', r.balances.B, -3); near('C -2', r.balances.C, -2);

section('Foreign-currency settlement zeroes a USD debt (1 EUR = 2 USD)');
FX.rates = { USD: 1, EUR: 0.5 };
r = balances({ participants: ['A', 'B'], multiCur: true, curList: ['USD', 'EUR'], mainCur: 'USD', currency: '$', history: [
  { type: 'payment', from: 'B', to: 'A', amount: 25, ccy: 'EUR' },
  { type: 'charge', amount: 100, ccy: 'USD', paidBy: 'A' },
] });
near('A 0', r.balances.A, 0); near('B 0', r.balances.B, 0); check('all settled', r.allSettled, true);

section('Pending state — unconvertible excluded, USD still settles');
FX.rates = { USD: 1 };          // no LKR rate
const pPending = { participants: ['A', 'B'], multiCur: true, curList: ['USD', 'LKR'], mainCur: 'USD', currency: '$', history: [
  { type: 'charge', amount: 9000, ccy: 'LKR', paidBy: 'B' },
  { type: 'charge', amount: 100, ccy: 'USD', paidBy: 'A' },
] };
r = balances(pPending);
check('LKR entry not convertible', amtMain(pPending, pPending.history[0]), null);
near('A paid 100', r.paid.A, 100);
transfers('settle-up (USD only)', r.transfers, [{ from: 'B', to: 'A', amount: 50 }]);

section('Solo button labels — first person, direction-driven (paidBtnLabel)');
check('I pay -> "I Paid"', paidBtnLabel({ direction: 'pay' }), 'I Paid');
check('I earn -> "I Got Paid"', paidBtnLabel({ direction: 'earn' }), 'I Got Paid');
check('missing direction defaults to pay', paidBtnLabel({}), 'I Paid');

section('Live-sharing: counterparty perspective flips the label');
check('pay activity, other side', paidBtnLabel({ direction: 'pay' }, 'other'), 'I Got Paid');
check('earn activity, other side', paidBtnLabel({ direction: 'earn' }, 'other'), 'I Paid');

section('Neutral share naming - both parties named');
check('pay: payer is me', payerName({ direction: 'pay', counterparty: 'Coach Mike' }), 'Rachel');
check('pay: receiver is counterparty', receiverName({ direction: 'pay', counterparty: 'Coach Mike' }), 'Coach Mike');
check('earn: payer is counterparty', payerName({ direction: 'earn', counterparty: 'Acme Studio' }), 'Acme Studio');
check('earn: receiver is me', receiverName({ direction: 'earn', counterparty: 'Acme Studio' }), 'Rachel');

section('Settle-up breakdown — FIFO allocation of payments to oldest expenses');
FX.rates = { USD: 1 };
const pBrk = { participants: ['Amal', 'Youssef'], mainCur: 'USD', currency: '$', history: [
  { id: 'bpay', type: 'payment', from: 'Amal', to: 'Youssef', amount: 600, date: '2026-06-04' },
  { id: 'bwood', type: 'charge', amount: 400, paidBy: 'Youssef', note: 'Woodwork', date: '2026-06-03' },
  { id: 'bwash', type: 'charge', amount: 800, paidBy: 'Youssef', note: 'Washing machine', date: '2026-06-02' },
  { id: 'btv', type: 'charge', amount: 1000, paidBy: 'Youssef', note: 'TV', date: '2026-06-01' },
] };
let brk = calcPersonExpenseBreakdown(pBrk, 'Amal');
check('3 expense shares', brk.items.length, 3);
check('oldest first', brk.items.map(i => i.note).join(','), 'TV,Washing machine,Woodwork');
check('TV settled', brk.items[0].status, 'settled');
check('TV paid-by recorded', brk.items[0].paidBy, 'Youssef');
check('washer partial', brk.items[1].status, 'partial');
near('washer remaining', brk.items[1].remaining, 300);
check('woodwork open', brk.items[2].status, 'open');
near('woodwork remaining', brk.items[2].remaining, 200);
near('remaining reconciles with net balance', brk.items.reduce((s, i) => s + i.remaining, 0) + brk.excessReceived, 500);

section('Settle-up breakdown — creditor side (self-first: no dues, fronted items show who owes)');
brk = calcPersonExpenseBreakdown(pBrk, 'Youssef');
check('no dues of his own', brk.items.length, 0);
near('credit left to receive', brk.creditLeft, 500);
check('fronted TV fully reimbursed', brk.paidItems[0].status, 'settled');
near('washer due from Amal', brk.paidItems[1].othersRemaining, 300);
near('woodwork due from Amal', brk.paidItems[2].othersRemaining, 200);

section('Settle-up breakdown — debtor who also fronted an expense');
const pBrk2 = { participants: ['Amal', 'Youssef'], mainCur: 'USD', currency: '$', history: [
  { id: 'b2lamp', type: 'charge', amount: 300, paidBy: 'Amal', note: 'Lamp', date: '2026-06-02' },
  { id: 'b2tv', type: 'charge', amount: 1000, paidBy: 'Youssef', note: 'TV', date: '2026-06-01' },
] };
brk = calcPersonExpenseBreakdown(pBrk2, 'Amal');
check('own lamp never appears in her dues', brk.items.length, 1);
check('TV partial (lamp credit applied)', brk.items[0].status, 'partial');
near('TV remaining = net balance', brk.items[0].remaining, 350);
check('fronted lamp — other side settled by netting', brk.paidItems[0].status, 'settled');

section('Settle-up breakdown — custom split: non-participant has no items');
const pBrk3 = { participants: ['A', 'B', 'C'], mainCur: 'USD', currency: '$', history: [
  { id: 'b3cs', type: 'charge', amount: 100, paidBy: 'B', customSplit: { A: 60, B: 40 }, date: '2026-06-01' },
] };
brk = calcPersonExpenseBreakdown(pBrk3, 'C');
check('C has no shares', brk.items.length, 0);
brk = calcPersonExpenseBreakdown(pBrk3, 'A');
near('A owes custom share', brk.items[0].remaining, 60);


section('History settled marks — activity FIFO (payments cover oldest sessions)');
FX.rates = { USD: 1 };
const pAct = { type: 'fixed', mainCur: 'USD', currency: '$', history: [
  { id: 'pay1', type: 'payment', amount: 60, date: '2026-06-20' },
  { id: 's3', type: 'charge', amount: 40, note: 'Session 3', date: '2026-06-15' },
  { id: 's2', type: 'charge', amount: 40, note: 'Session 2', date: '2026-06-10' },
  { id: 's1', type: 'charge', amount: 40, note: 'Session 1', date: '2026-06-05' },
] };
let stm = calcHistoryStatusMap(pAct);
check('oldest session settled', stm.s1.st, 'settled');
check('second session partial', stm.s2.st, 'partial');
near('second session remaining', stm.s2.remaining, 20);
check('newest session open', stm.s3.st, 'open');

section('History settled marks — advance payment auto-settles new sessions');
const pAdv = { type: 'fixed', mainCur: 'USD', currency: '$', history: [
  { id: 'a2', type: 'charge', amount: 40, date: '2026-06-22' },
  { id: 'a1', type: 'charge', amount: 40, date: '2026-06-21' },
  { id: 'adv', type: 'payment', amount: 100, date: '2026-06-01' },
] };
stm = calcHistoryStatusMap(pAdv);
check('first session pre-covered', stm.a1.st, 'settled');
check('second session pre-covered', stm.a2.st, 'settled');

section('History settled marks — split project aggregates all shares');
const pGrp = { type: 'group', participants: ['Amal', 'Youssef'], mainCur: 'USD', currency: '$', history: [
  { id: 'gpay', type: 'payment', from: 'Amal', to: 'Youssef', amount: 600, date: '2026-06-04' },
  { id: 'wood', type: 'charge', amount: 400, paidBy: 'Youssef', note: 'Woodwork', date: '2026-06-03' },
  { id: 'wash', type: 'charge', amount: 800, paidBy: 'Youssef', note: 'Washer', date: '2026-06-02' },
  { id: 'tv', type: 'charge', amount: 1000, paidBy: 'Youssef', note: 'TV', date: '2026-06-01' },
] };
stm = calcHistoryStatusMap(pGrp);
check('TV settled (both shares covered)', stm.tv.st, 'settled');
check('washer partial', stm.wash.st, 'partial');
near('washer remaining across group', stm.wash.remaining, 300);
check('woodwork open (payer share auto-covered, Amal share untouched)', stm.wood.st, 'open');
check('no marks for track-only projects', JSON.stringify(calcHistoryStatusMap({ type: 'group', trackOnly: true, participants: ['A'], history: [] })), '{}');
check('no marks for lending circles', JSON.stringify(calcHistoryStatusMap({ type: 'lending', participants: ['A'], history: [] })), '{}');

/* ============================ RESULTS ============================ */
console.log('\n' + (fail ? `❌ ${fail} FAILED, ${pass} passed` : `✅ ALL ${pass} TESTS PASSED`));
process.exit(fail ? 1 : 0);
