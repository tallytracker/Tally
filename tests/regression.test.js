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
  extractFn('projNetBalances'),
  extractFn('calcPairwiseMatrix'),
  extractFn('pairNet'),
  extractFn('calcPairwiseTransfers'),
  extractFn('_mts'),
  extractFn('mergeHistories'),
  extractFn('_projNewer'),
  extractFn('mergeProjectPair'),
  extractFn('mergeCloudAndLocal'),
  extractFn('calcBalance'),
  extractFn('syncBalance'),
  extractFn('calcRunningBalances'),
  extractFn('removeEntriesByIds'),
  extractFn('sessionNet'),
  extractFn('remainingMins'),
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

section('projNetBalances — standalone helper matches the inline screen math');
FX.rates = { USD: 1 };
const pNet = { participants: ['A', 'B', 'C'], mainCur: 'USD', currency: '$', history: [
  { type: 'charge', amount: 90, paidBy: 'A' },
  { type: 'charge', amount: 30, paidBy: 'C' },
] };
let nb = projNetBalances(pNet);
check('A +50', nb.A, 50); check('B -40', nb.B, -40); check('C -10', nb.C, -10);
const rInline = balances(pNet);
check('identical to inline balances', JSON.stringify(nb), JSON.stringify(rInline.balances));

section('Direct-pay plan — pairwise, mutual debts cancel inside each pair');
let pw = calcPairwiseTransfers(pNet);
transfers('pairwise plan', pw, [
  { from: 'B', to: 'A', amount: 30 },
  { from: 'C', to: 'A', amount: 20 },
  { from: 'B', to: 'C', amount: 10 },
]);
// per-person pairwise nets must equal the overall balances
const sumFor = n => rd2(pw.reduce((s, t) => s + (t.to === n ? t.amount : 0) - (t.from === n ? t.amount : 0), 0));
check('A pairwise net = balance', sumFor('A'), 50);
check('B pairwise net = balance', sumFor('B'), -40);
check('C pairwise net = balance', sumFor('C'), -10);

section('Direct-pay plan — a payment reduces that pair only');
const pNet2 = { participants: ['A', 'B', 'C'], mainCur: 'USD', currency: '$', history: [
  { type: 'payment', from: 'B', to: 'A', amount: 30 },
  { type: 'charge', amount: 90, paidBy: 'A' },
  { type: 'charge', amount: 30, paidBy: 'C' },
] };
pw = calcPairwiseTransfers(pNet2);
transfers('B→A cleared, others untouched', pw, [
  { from: 'C', to: 'A', amount: 20 },
  { from: 'B', to: 'C', amount: 10 },
]);

section('Pairwise matrix — custom splits and multi-currency');
FX.rates = { USD: 1, LKR: 300 };
const pPair3 = { participants: ['A', 'B'], multiCur: true, curList: ['USD', 'LKR'], mainCur: 'USD', currency: '$', history: [
  { type: 'charge', amount: 3000, ccy: 'LKR', paidBy: 'A', customSplit: { A: 1500, B: 1500 } },
] };
pw = calcPairwiseTransfers(pPair3);
transfers('LKR custom split → USD pair debt', pw, [{ from: 'B', to: 'A', amount: 5 }]);

section('History settled marks — kept below the Settle All divider');
FX.rates = { USD: 1 };
const pAfterSettle = { type: 'group', participants: ['A', 'B'], mainCur: 'USD', currency: '$', history: [
  { id: 'newC', type: 'charge', amount: 50, paidBy: 'A', date: '2026-07-03' },
  { id: 'div', type: 'settlement', date: '2026-07-02' },
  { id: 'oldC', type: 'charge', amount: 80, paidBy: 'A', date: '2026-07-01' },
  { id: 'oldP', type: 'payment', from: 'B', to: 'A', amount: 40, date: '2026-07-01' },
] };
stm = calcHistoryStatusMap(pAfterSettle);
check('old expense keeps its Settled tag', stm.oldC.st, 'settled');
check('new expense after reset is open', stm.newC.st, 'open');
check('payments get no tag', stm.oldP, undefined);

section('Sign-out data-loss guard — a transaction logged while signed out survives re-sign-in');
// The reported bug: session was revoked (email password changed), user logged a
// transaction as a guest, then signed back in — and it vanished. Cloud has the
// activity WITHOUT the new entry; local has the SAME activity WITH it.
const _cloudA = { projects: [
  { id: 'act1', name: 'Piano lessons', type: 'fixed', history: [
    { id: 'e1', type: 'charge', amount: 40, date: '2026-07-08', updatedAt: '2026-07-08T10:00:00Z' },
  ] },
], groups: [], settings: { name: 'Rachel' } };
const _localA = { projects: [
  { id: 'act1', name: 'Piano lessons', type: 'fixed', updatedAt: '2026-07-10T09:00:00Z', history: [
    { id: 'e2', type: 'charge', amount: 40, date: '2026-07-10', updatedAt: '2026-07-10T09:00:00Z' },
    { id: 'e1', type: 'charge', amount: 40, date: '2026-07-08', updatedAt: '2026-07-08T10:00:00Z' },
  ] },
], groups: [], settings: { name: 'Rachel' } };
let _mg = mergeCloudAndLocal(_cloudA, _localA);
check('activity still present', _mg.projects.length, 1);
check('offline entry survives merge', _mg.projects[0].history.some(e => e.id === 'e2'), true);
check('original cloud entry kept', _mg.projects[0].history.some(e => e.id === 'e1'), true);
check('no duplicate of the shared entry', _mg.projects[0].history.filter(e => e.id === 'e1').length, 1);
check('history stays newest-first', _mg.projects[0].history.map(e => e.id).join(','), 'e2,e1');

section('Sign-out data-loss guard — brand-new guest project is added, cloud-only project kept');
const _cloudB = { projects: [ { id: 'p1', name: 'Cloud only', history: [] } ], groups: [] };
const _localB = { projects: [
  { id: 'p1', name: 'Cloud only', history: [] },
  { id: 'p2', name: 'Made while signed out', history: [ { id: 'n1', type: 'charge', amount: 12, date: '2026-07-10' } ] },
], groups: [] };
_mg = mergeCloudAndLocal(_cloudB, _localB);
check('both projects present', _mg.projects.map(p => p.id).sort().join(','), 'p1,p2');
check('new guest project keeps its entry', _mg.projects.find(p => p.id === 'p2').history.length, 1);

section('Sign-out data-loss guard — union is symmetric (entry added on another device is kept too)');
const _cloudC = { projects: [ { id: 'a', name: 'A', history: [
  { id: 'x1', type: 'charge', amount: 5, date: '2026-07-09' },
  { id: 'x2', type: 'charge', amount: 7, date: '2026-07-10' },
] } ] };
const _localC = { projects: [ { id: 'a', name: 'A', history: [
  { id: 'x1', type: 'charge', amount: 5, date: '2026-07-09' },
  { id: 'x3', type: 'charge', amount: 9, date: '2026-07-08' },
] } ] };
_mg = mergeCloudAndLocal(_cloudC, _localC);
check('all three entries present', _mg.projects[0].history.map(e => e.id).sort().join(','), 'x1,x2,x3');

section('Sign-out data-loss guard — an edit made while signed out wins by updatedAt (no dup)');
const _cloudD = { projects: [ { id: 'a', name: 'A', history: [
  { id: 'y1', type: 'charge', amount: 40, note: 'old', date: '2026-07-01', updatedAt: '2026-07-01T00:00:00Z' },
] } ] };
const _localD = { projects: [ { id: 'a', name: 'A', history: [
  { id: 'y1', type: 'charge', amount: 55, note: 'fixed while offline', date: '2026-07-01', updatedAt: '2026-07-10T00:00:00Z' },
] } ] };
_mg = mergeCloudAndLocal(_cloudD, _localD);
check('one entry, not two', _mg.projects[0].history.length, 1);
check('newer edit wins', _mg.projects[0].history[0].amount, 55);


/* ---- Running balance in the history log + Undo Settle (v56) ---- */
section('Running balance — 1-on-1: charges add, payments subtract (newest first)');
FX.rates = { USD: 1 };
const _rbAct = { type: 'hourly', currency: '$', history: [
  { id: 'r3', type: 'payment', amount: 50, date: '2026-07-03' },
  { id: 'r2', type: 'charge', amount: 80, date: '2026-07-02' },
  { id: 'r1', type: 'charge', amount: 100, date: '2026-07-01' },
] };
let _rb = calcRunningBalances(_rbAct);
check('after 1st charge', _rb.r1, 100);
check('after 2nd charge', _rb.r2, 180);
check('after payment', _rb.r3, 130);

section('Running balance — settlement divider resets the figure to zero');
const _rbSet = { type: 'hourly', currency: '$', history: [
  { id: 'n1', type: 'charge', amount: 25, date: '2026-07-05' },
  { id: 'sd', type: 'settlement', amount: 130, date: '2026-07-04' },
  { id: 'o1', type: 'charge', amount: 130, date: '2026-07-01' },
] };
_rb = calcRunningBalances(_rbSet);
check('pre-divider entry keeps its own figure', _rb.o1, 130);
check('divider itself gets no figure', _rb.sd, undefined);
check('post-divider entry restarts from zero', _rb.n1, 25);

section('Running balance — prepayment goes negative (prepaid)');
const _rbNeg = { type: 'hourly', currency: '$', history: [
  { id: 'p1', type: 'payment', amount: 200, date: '2026-07-01' },
] };
check('overpaid balance is negative', calcRunningBalances(_rbNeg).p1, -200);

section('Running balance — group project shows running total spent on charges only');
const _rbGrp = { participants: ['A', 'B'], mainCur: 'USD', currency: '$', history: [
  { id: 'g3', type: 'payment', from: 'B', to: 'A', amount: 40, date: '2026-07-03' },
  { id: 'g2', type: 'charge', amount: 60, paidBy: 'B', date: '2026-07-02' },
  { id: 'g1', type: 'charge', amount: 90, paidBy: 'A', date: '2026-07-01' },
] };
_rb = calcRunningBalances(_rbGrp);
check('total after 1st expense', _rb.g1, 90);
check('total after 2nd expense', _rb.g2, 150);
check('member payment gets no figure', _rb.g3, undefined);

section('Running balance — pending exchange rate suppresses figures instead of faking them');
FX.rates = { USD: 1 };          // no LKR rate
const _rbFx = { multiCur: true, curList: ['USD', 'LKR'], mainCur: 'USD', currency: '$', history: [
  { id: 'f2', type: 'charge', amount: 10, ccy: 'USD', date: '2026-07-02' },
  { id: 'f1', type: 'charge', amount: 9000, ccy: 'LKR', date: '2026-07-01' },
] };
_rb = calcRunningBalances(_rbFx);
check('unconvertible entry suppressed', _rb.f1, null);
check('everything after it suppressed too', _rb.f2, null);

section('Undo Settle All — removing the settlement lines restores the balance');
const _un = { type: 'hourly', currency: '$', history: [
  { id: 'sX', type: 'settlement', amount: 130, date: '2026-07-04' },
  { id: 'c2', type: 'charge', amount: 30, date: '2026-07-02' },
  { id: 'c1', type: 'charge', amount: 100, date: '2026-07-01' },
] };
syncBalance(_un);
check('settled balance is zero', _un.balance, 0);
removeEntriesByIds(_un, ['sX']);
check('settlement line removed', _un.history.length, 2);
check('balance recomputes itself', _un.balance, 130);
check('original entries untouched', _un.history.map(h => h.id).join(','), 'c2,c1');

section('Remaining time drops when a payment is logged (22 Jul 2026 bug)');
// Hourly @ 43.73/hr: 37h30m logged = 1639.875. Payment of 1399.4 leaves
// 240.475 → 240.475/43.73*60 ≈ 330 min = 5h30m. Before the fix the count
// stayed frozen at the gross logged 37h30m.
const _rem = { type: 'hourly', rate: 43.73, currency: '$', history: [
  { id: 'rp1', type: 'payment', amount: 1399.4, date: '2026-07-22' },
  { id: 'rc1', type: 'charge', amount: 1639.875, durationMins: 2250, date: '2026-07-20' },
] };
check('hourly: remaining mins after payment', remainingMins(_rem), 330);
check('hourly: no payment yet = full logged time', remainingMins({ type: 'hourly', rate: 40, history: [ { id: 'a', type: 'charge', amount: 1500, durationMins: 2250, date: '2026-07-20' } ] }), 2250);
check('hourly: fully paid = 0 mins', remainingMins({ type: 'hourly', rate: 40, history: [
  { id: 'b2', type: 'payment', amount: 1500, date: '2026-07-21' },
  { id: 'b1', type: 'charge', amount: 1500, date: '2026-07-20' },
] }), 0);
check('hourly: overpaid goes negative (prepaid)', remainingMins({ type: 'hourly', rate: 40, history: [
  { id: 'c2', type: 'payment', amount: 1700, date: '2026-07-21' },
  { id: 'c1', type: 'charge', amount: 1500, date: '2026-07-20' },
] }), -300);
check('custom hr-rate: payment reduces mins', remainingMins({ type: 'customrate', customRateUnit: 'hr', customRateAmt: 100, customRateMin: 2, history: [
  { id: 'd2', type: 'payment', amount: 100, date: '2026-07-21' },
  { id: 'd1', type: 'charge', amount: 200, date: '2026-07-20' },
] }), 120);
check('one-off charge excluded from time count', remainingMins({ type: 'hourly', rate: 40, history: [
  { id: 'e2', type: 'charge', amount: 55, oneOff: true, date: '2026-07-21' },
  { id: 'e1', type: 'charge', amount: 400, date: '2026-07-20' },
] }), 600);
check('settlement resets the window', remainingMins({ type: 'hourly', rate: 40, history: [
  { id: 'f3', type: 'charge', amount: 80, date: '2026-07-23' },
  { id: 'f2', type: 'settlement', amount: 0, date: '2026-07-22' },
  { id: 'f1', type: 'charge', amount: 1500, date: '2026-07-20' },
] }), 120);

/* ===================== ACCOUNT DELETION (App Store 5.1.1(v)) =====================
 * Added 6 Aug 2026. This is the one flow that destroys user data and the one
 * Apple checks by hand, so it gets real execution tests, not just a smoke read.
 *
 * The deletion code touches Firebase, the DOM and localStorage, none of which
 * exist here — so we run the REAL extracted functions inside a sandbox of
 * stubs and assert on what they did and, crucially, IN WHAT ORDER.
 * ============================================================================ */
section('Account deletion — order of operations');

// extractFn() above drops a leading `async`, which matters for these.
function extractAsyncFn(name) {
  const m = new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  if (!m) throw new Error('Function not found in index.html: ' + name +
    ' (renamed? update regression.test.js)');
  let i = src.indexOf('{', m.index), depth = 0, j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
    j++;
  }
  return src.slice(m.index, j);
}

// Build a fresh sandbox per scenario so one test can't leak into the next.
function runDeletion(opts) {
  opts = opts || {};
  const log = [];
  const store = { u1: true };
  const local = { 'tally-projects': 'x', 'tally-settings': 'y', 'tally-fx': 'z' };

  const user = {
    uid: 'u1',
    isAnonymous: !!opts.anonymous,
    email: 'r@example.com',
    providerData: [{ providerId: opts.provider || 'google.com' }],
    delete: async function () {
      if (opts.requiresRecentLogin && !log.includes('reauth')) {
        log.push('user.delete:rejected');
        const e = new Error('recent login'); e.code = 'auth/requires-recent-login'; throw e;
      }
      log.push('user.delete'); delete store.u1;
    }
  };

  const sandbox = {
    firebaseAvailable: opts.offline ? false : true,
    APPLE_SIGNIN_ENABLED: !!opts.appleEnabled,
    auth: {
      currentUser: user,
      signInAnonymously: async function () { log.push('signInAnonymously'); }
    },
    firestore: {
      collection: function (c) {
        return { doc: function () { return { delete: async function () { log.push('delete:' + c); } }; } };
      }
    },
    firebase: {
      functions: function () {
        return { httpsCallable: function (n) {
          return async function () {
            log.push('call:' + n);
            if (opts.revokeThrows && n === 'revokeAppleToken') throw new Error('boom');
            return { data: { ok: true, revoked: true } };
          };
        } };
      },
      auth: { OAuthProvider: function () { return { addScope: function () {} }; },
              GoogleAuthProvider: function () { return {}; } }
    },
    firestoreUnsubscribe: function () { log.push('unsubscribe'); },
    LOCAL_KEYS: { a: 'tally-projects' },
    SYNCED_KEYS: { b: 'tally-settings' },
    FX_KEY: 'tally-fx',
    projects: [{ id: 1 }], groups: [{ id: 2 }],
    localStorage: { removeItem: function (k) { log.push('rm:' + k); delete local[k]; } },
    sessionStorage: { setItem: function () {}, removeItem: function () {}, getItem: function () { return null; } },
    showToast: function (m) { log.push('toast:' + String(m).slice(0, 28)); },
    closeOverlay: function () { log.push('closeOverlay'); },
    esc: function (s) { return s; },
    document: { getElementById: function () { return { innerHTML: '' }; } },
    location: { reload: function () { log.push('reload'); } },
    setTimeout: function (fn) { return 0; },   // don't actually reload
    console: { error: function () {}, warn: function () {}, log: function () {} },
    _accountDeleting: false,
    _preferRedirectAuth: function () { return false; }
  };

  const body = [
    extractAsyncFn('_revokeAppleTokenIfNeeded'),
    extractAsyncFn('_reauthenticateForDelete'),
    extractFn('_clearAllLocalData'),
    extractAsyncFn('doDeleteAccount')
  ].join('\n');

  const run = new Function('sb', 'log',
    'with(sb){' + body +
    ' if(sb.__reauthOk!==undefined){_reauthenticateForDelete=async function(){log.push("reauth");return sb.__reauthOk};}' +
    ' return doDeleteAccount();}'
  );
  if (opts.requiresRecentLogin) sandbox.__reauthOk = opts.reauthOk !== false;

  return run(sandbox, log).then(function () {
    return { log: log, store: store, local: local, sandbox: sandbox };
  });
}

// Node runs this file top-to-bottom, so collect the async results then assert.
const _deletionChecks = [];

_deletionChecks.push(runDeletion({ appleEnabled: true, provider: 'apple.com' }).then(function (r) {
  const iRevoke = r.log.indexOf('call:revokeAppleToken');
  const iUsers = r.log.indexOf('delete:users');
  const iDelete = r.log.indexOf('user.delete');
  check('Apple token revoked before the Auth user is deleted', iRevoke > -1 && iRevoke < iDelete, true);
  check('cloud data deleted before the Auth user (else it orphans)', iUsers > -1 && iUsers < iDelete, true);
  check('reminders doc deleted too', r.log.includes('delete:reminders'), true);
  check('live listener detached first', r.log.indexOf('unsubscribe') < iUsers, true);
  check('Auth user actually deleted', r.store.u1, undefined);
  check('drops back to an anonymous session', r.log.includes('signInAnonymously'), true);
}));

_deletionChecks.push(runDeletion({ provider: 'google.com', appleEnabled: true }).then(function (r) {
  check('Google-only user: no pointless revoke call', r.log.includes('call:revokeAppleToken'), false);
  check('Google-only user: still fully deleted', r.store.u1, undefined);
}));

_deletionChecks.push(runDeletion({ appleEnabled: true, provider: 'apple.com', revokeThrows: true }).then(function (r) {
  check('revoke failure does NOT strand the user', r.store.u1, undefined);
  check('revoke failure still wipes local data', Object.keys(r.local).length, 0);
}));

_deletionChecks.push(runDeletion({ anonymous: true }).then(function (r) {
  check('anonymous user cannot delete an account', r.log.includes('user.delete'), false);
}));

_deletionChecks.push(runDeletion({ offline: true }).then(function (r) {
  check('offline: refuses rather than half-deleting', r.log.includes('user.delete'), false);
  check('offline: local data left intact', Object.keys(r.local).length, 3);
}));

_deletionChecks.push(runDeletion({ requiresRecentLogin: true, reauthOk: true }).then(function (r) {
  check('stale login: re-authenticates then deletes', r.log.includes('user.delete'), true);
}));

_deletionChecks.push(runDeletion({ requiresRecentLogin: true, reauthOk: false }).then(function (r) {
  check('failed re-auth: aborts without deleting', r.store.u1, true);
  check('failed re-auth: local data NOT wiped', Object.keys(r.local).length, 3);
}));


/* ===== WELCOME FLOW — TWO STEPS (added 11 Aug 2026) =====
 * Step 1 = sign-in choices, step 2 = the name. The bug class these guard
 * against: landing a user on the wrong step, or letting the account's display
 * name silently override what the user actually typed. */
function runWelcome(opts) {
  const els = {};
  function el(id) {
    if (!els[id]) els[id] = { style: {}, textContent: '', innerHTML: '', value: '', focus: function () {} };
    return els[id];
  }
  const sandbox = {
    currentUser: opts.signedIn ? { isAnonymous: false } : (opts.anonymous ? { isAnonymous: true } : null),
    settings: { name: opts.name || '', nameNeedsConfirm: !!opts.needsConfirm },
    welcomeSignInSkipped: !!opts.skipped,
    document: { getElementById: el },
    setTimeout: function () { return 0; },
    showToast: function () {},
    db: { saveSettings: function () {} }
  };
  const body = [extractFn('renderWelcome'), extractFn('skipWelcomeSignIn'), extractFn('welcomeBackToSignIn')].join('\n');
  new Function('sb', 'with(sb){' + body + ' renderWelcome();}')(sandbox);
  return { els: els, sb: sandbox };
}

let w = runWelcome({ anonymous: true });
check('welcome: brand-new user starts on the sign-in step', w.els.welcomeStep1.style.display, '');
check('welcome: name step hidden until sign-in is answered', w.els.welcomeStep2.style.display, 'none');

w = runWelcome({ anonymous: true, skipped: true });
check('welcome: "Sign in later" moves to the name step', w.els.welcomeStep2.style.display, '');
check('welcome: sign-in step hidden after skipping', w.els.welcomeStep1.style.display, 'none');
check('welcome: skipper can go Back to the sign-in buttons', w.els.welcomeBackBtn.style.display, '');

w = runWelcome({ signedIn: true, name: 'Rachel', needsConfirm: true });
check('welcome: signed-in user lands on the name step', w.els.welcomeStep2.style.display, '');
check('welcome: name prefilled from the account', w.els.welcomeName.value, 'Rachel');
check('welcome: no Back for a signed-in user', w.els.welcomeBackBtn.style.display, 'none');

// A half-typed name must never be clobbered by a re-render.
(function () {
  const r = runWelcome({ signedIn: true, name: 'Rachel' });
  r.els.welcomeName.value = 'Rach';
  new Function('sb', 'with(sb){' + extractFn('renderWelcome') + ' renderWelcome();}')({
    currentUser: { isAnonymous: false }, settings: { name: 'Rachel' }, welcomeSignInSkipped: false,
    document: { getElementById: function (id) { return r.els[id] || (r.els[id] = { style: {}, value: '', focus: function () {} }); } },
    setTimeout: function () { return 0; }
  });
  check('welcome: a name being typed is not overwritten by the account name', r.els.welcomeName.value, 'Rach');
})();

/* ===== SIGN OUT CLEARS THE SCREEN (added 11 Aug 2026) =====
 * The screen must empty, but NEVER at the cost of unsynced work. */
function runSignOut(opts) {
  const log = [];
  const local = { 'tally-projects': 1, 'tally-settings': 1, 'tally-fx': 1 };
  const sandbox = {
    firebaseAvailable: opts.offline ? false : true,
    syncStatus: opts.syncStatus || 'synced',
    auth: {
      signOut: async function () { log.push('signOut'); },
      signInAnonymously: async function () { log.push('signInAnonymously'); }
    },
    firebase: {
      firestore: function () {
        return { waitForPendingWrites: async function () {
          if (opts.flushFails) throw new Error('offline');
          log.push('flushed');
        } };
      }
    },
    firestoreUnsubscribe: function () { log.push('unsubscribe'); },
    LOCAL_KEYS: { a: 'tally-projects' }, SYNCED_KEYS: { b: 'tally-settings' }, FX_KEY: 'tally-fx',
    projects: [{ id: 1 }], groups: [{ id: 2 }],
    settings: { name: 'Rachel', email: 'r@example.com' },
    welcomeSignInSkipped: true,
    appStarted: true,
    startApp: function () { log.push('startApp'); },
    localStorage: { removeItem: function (k) { log.push('rm:' + k); delete local[k]; } },
    showToast: function (m) { log.push('toast:' + m); },
    closeOverlay: function () {},
    doBackupExport: function () { log.push('export'); },
    document: { getElementById: function () { return { innerHTML: '' }; } },
    console: { error: function () {}, warn: function () {}, log: function () {} },
    setTimeout: function (fn, ms) { return 0; },
    Promise: Promise
  };
  const body = [
    extractAsyncFn('_flushPendingWrites'),
    extractFn('_clearAllLocalData'),
    extractFn('confirmUnsyncedSignOut'),
    extractAsyncFn('_doSignOut'),
    extractAsyncFn('signOutUser')
  ].join('\n');
  const run = new Function('sb', 'log', 'with(sb){' + body + ' return signOutUser();}');
  return run(sandbox, log).then(function () { return { log: log, local: local, sb: sandbox }; });
}

const _signOutChecks = [];

_signOutChecks.push(runSignOut({ syncStatus: 'synced' }).then(function (r) {
  check('sign-out: synced user is signed out', r.log.includes('signOut'), true);
  check('sign-out: local cache cleared so the screen empties', Object.keys(r.local).length, 0);
  check('sign-out: in-memory trackers dropped too', r.sb.projects.length, 0);
  check('sign-out: previous name does not linger', r.sb.settings.name, '');
  check('sign-out: live listener detached first', r.log.indexOf('unsubscribe') < r.log.indexOf('signOut'), true);
  check('sign-out: back to an anonymous session', r.log.includes('signInAnonymously'), true);
  check('sign-out: returns to the welcome screen', r.log.includes('startApp'), true);
}));

_signOutChecks.push(runSignOut({ syncStatus: 'syncing' }).then(function (r) {
  check('sign-out: waits for pending writes before clearing', r.log.includes('flushed'), true);
  check('sign-out: clears once the flush succeeds', Object.keys(r.local).length, 0);
}));

// THE IMPORTANT ONE — unsynced work must survive.
_signOutChecks.push(runSignOut({ syncStatus: 'offline', flushFails: true }).then(function (r) {
  check('sign-out: unsynced data is NOT wiped', Object.keys(r.local).length, 3);
  check('sign-out: unsynced user is not signed out behind their back', r.log.includes('signOut'), false);
  check('sign-out: trackers stay on screen when unsynced', r.sb.projects.length, 1);
}));

_signOutChecks.push(runSignOut({ offline: true }).then(function (r) {
  check('sign-out: offline refuses outright', r.log.includes('signOut'), false);
  check('sign-out: offline leaves local data intact', Object.keys(r.local).length, 3);
}));


/* ==================================================================
   DATA-LOSS GUARDS  (added 17 Aug 2026)

   These exist because of a real incident. On 17 Aug 2026 an account
   holding 15 trackers and 240 history entries was reduced to an empty
   projects[] by the app itself: a cleared local cache plus a
   "cloud looks stale" verdict caused an empty in-memory state to be
   pushed over a full account. {merge:true} does NOT protect arrays —
   a whole array field is replaced.

   Every check below encodes one rule that would have prevented it.
   ================================================================== */

// Pull a METHOD (name(){...}) out of the db object literal and hand it back
// as a standalone function declaration.
function extractMethod(name) {
  const m = new RegExp('(?:^|[\\s,{])' + name + '\\s*\\(\\s*\\)\\s*\\{').exec(src);
  if (!m) throw new Error('Method not found in index.html: ' + name);
  let i = src.indexOf('{', m.index + m[0].length - 1);
  let depth = 0, j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
    j++;
  }
  return 'function ' + name + '()' + src.slice(i, j);
}

/* ---- scopedKey: the offline cache must be per account ---- */
(function () {
  const run = new Function('sb', 'with(sb){' +
    extractFn('setCacheScope') + '\n' + extractFn('scopedKey') +
    '\nreturn {setCacheScope:setCacheScope,scopedKey:scopedKey};}');
  const sb = { _cacheScope: '' };
  const api = run(sb);
  // A signed-out (guest) session keeps the bare legacy key, so guest data
  // still follows the user into whichever account they sign into.
  api.setCacheScope('');
  check('cache scope: guest uses the bare key', api.scopedKey('ledger-app-data'), 'ledger-app-data');
  // A signed-in account gets its own namespace.
  api.setCacheScope('UID_A');
  check('cache scope: account A namespaced', api.scopedKey('ledger-app-data'), 'ledger-app-data::UID_A');
  api.setCacheScope('UID_B');
  check('cache scope: account B namespaced', api.scopedKey('ledger-app-data'), 'ledger-app-data::UID_B');
  // THE BUG THIS PREVENTS: two accounts sharing one cache entry, which is how
  // an Apple sign-in ended up displaying the Google account's name.
  api.setCacheScope('UID_A');
  const a = api.scopedKey('ledger-settings');
  api.setCacheScope('UID_B');
  check('cache scope: two accounts never share a settings key', a === api.scopedKey('ledger-settings'), false);
})();

/* ---- _clearAllLocalData: must also wipe per-account variants ---- */
(function () {
  const local = {
    'tally-projects': 1, 'tally-settings': 1, 'tally-fx': 1,
    'tally-projects::UID_A': 1, 'tally-settings::UID_A': 1,
    'tally-projects::UID_B': 1, 'unrelated-key': 1
  };
  const sandbox = {
    LOCAL_KEYS: { a: 'tally-projects' }, SYNCED_KEYS: { b: 'tally-settings' }, FX_KEY: 'tally-fx',
    projects: [{ id: 1 }], groups: [{ id: 2 }],
    console: { error: function () {} },
    localStorage: {
      removeItem: function (k) { delete local[k]; },
      get length() { return Object.keys(local).length; },
      key: function (i) { return Object.keys(local)[i]; }
    }
  };
  const run = new Function('sb', 'with(sb){' + extractFn('_clearAllLocalData') + ' _clearAllLocalData();}');
  run(sandbox);
  check('wipe: bare keys removed', local['tally-projects'] === undefined && local['tally-settings'] === undefined, true);
  check('wipe: account A cache removed', local['tally-projects::UID_A'] === undefined, true);
  check('wipe: account B cache removed', local['tally-projects::UID_B'] === undefined, true);
  check('wipe: unrelated keys left alone', local['unrelated-key'], 1);
})();

/* ---- The empty-write guard ---- */
function runPush(opts) {
  const written = [];
  const sandbox = {
    firebaseAvailable: true,
    currentUser: { uid: 'UID_A', isAnonymous: false },
    _accountDeleting: false,
    _syncLoadedUid: opts.loadedUid,
    projects: opts.projects, groups: [], settings: { name: 'Rachel' },
    syncStatus: '', updateSyncBadge: function () {},
    console: { error: function () {}, warn: function () {} },
    Date: Date,
    firebase: { firestore: { FieldValue: { serverTimestamp: function () { return 'TS'; } } } },
    firestore: {
      collection: function () {
        return { doc: function () {
          return { set: function (payload) { written.push(payload); return { then: function (f) { f(); return { catch: function () {} }; } }; } };
        } };
      }
    }
  };
  const run = new Function('sb', 'with(sb){' + extractMethod('_pushSyncedToFirestore') +
    '\n_pushSyncedToFirestore.call({setLocalUpdatedAt:function(){}});}');
  run(sandbox);
  return written;
}

// THE INCIDENT, REPRODUCED: memory is empty because the cache was wiped, and
// the account has not been loaded yet. This write must never leave the device.
check('empty-write guard: refuses empty projects before the account has loaded',
  runPush({ projects: [], loadedUid: '' }).length, 0);
// Same, but the app has loaded a DIFFERENT account — still not authoritative.
check('empty-write guard: refuses when only another account was loaded',
  runPush({ projects: [], loadedUid: 'UID_OTHER' }).length, 0);
// Deleting your last tracker is legitimate — it can only happen after load.
check('empty-write guard: allows a genuine empty once the account is loaded',
  runPush({ projects: [], loadedUid: 'UID_A' }).length, 1);
// Normal saves are never affected.
check('empty-write guard: normal save still writes',
  runPush({ projects: [{ id: 1 }], loadedUid: 'UID_A' }).length, 1);
check('empty-write guard: non-empty save allowed even pre-load',
  runPush({ projects: [{ id: 1 }], loadedUid: '' }).length, 1);

/* ---- GUARD 2: "cloud is stale" must not become "blank the cloud" ---- */
function runSnapshot(opts) {
  const acted = [];
  let snapCb = null;
  const sandbox = {
    syncStatus: '', updateSyncBadge: function () {}, firestoreUnsubscribe: null,
    isFirestoreLoaded: opts.isFirestoreLoaded !== false,
    _syncLoadedUid: opts.loadedUid,
    projects: opts.localProjects, groups: [], settings: {},
    migrateData: function () {}, startApp: function () {}, refreshCurrentView: function () {},
    ensureNameFromAccount: function () { return false; },
    console: { error: function () {}, warn: function () { acted.push('warn'); } },
    Date: Date,
    firebase: { firestore: { FieldValue: { serverTimestamp: function () { return 'TS'; } } } },
    db: {
      getLocalUpdatedAt: function () { return opts.localStamp; },
      setLocalUpdatedAt: function () {},
      loadSyncedFromLocalCache: function () {},
      applyCloudSnapshot: function () { acted.push('applied'); },
      saveSettings: function () {},
      _pushSyncedToFirestore: function () { acted.push('pushed'); }
    },
    firestore: {
      collection: function () {
        return { doc: function () {
          return {
            onSnapshot: function (cb) { snapCb = cb; return function () {}; },
            set: function () { return { then: function () { return { catch: function () {} }; } }; }
          };
        } };
      }
    }
  };
  const run = new Function('sb', 'with(sb){' + extractFn('startFirestoreSync') +
    ' startFirestoreSync("UID_A"); return null;}');
  run(sandbox);
  snapCb({
    exists: true,
    metadata: { hasPendingWrites: false, fromCache: false },
    data: function () { return { clientUpdatedAt: opts.cloudStamp, projects: opts.cloudProjects, groups: [] }; }
  });
  return acted;
}

// THE EXACT 17 AUG PATH: local stamp is newer (a merge had just stamped it),
// memory is empty, the account was never loaded, and the cloud holds 15
// trackers. The old code pushed. It must now apply the cloud copy instead.
(function () {
  const acted = runSnapshot({ localStamp: 2000, cloudStamp: 1000, localProjects: [], cloudProjects: new Array(15).fill({ id: 1 }), loadedUid: '' });
  check('guard 2: does NOT push an unloaded empty state over a full account', acted.includes('pushed'), false);
  check('guard 2: applies the cloud copy instead', acted.includes('applied'), true);
})();
// Even once loaded, empty-over-full is never a legitimate re-push.
(function () {
  const acted = runSnapshot({ localStamp: 2000, cloudStamp: 1000, localProjects: [], cloudProjects: [{ id: 1 }], loadedUid: 'UID_A' });
  check('guard 2: refuses to blank a non-empty account even when loaded', acted.includes('pushed'), false);
})();
// The genuine case the guard exists for: we hold real newer work offline.
(function () {
  const acted = runSnapshot({ localStamp: 2000, cloudStamp: 1000, localProjects: [{ id: 1 }, { id: 2 }], cloudProjects: [{ id: 1 }], loadedUid: 'UID_A' });
  check('guard 2: still re-pushes genuinely newer local work', acted.includes('pushed'), true);
  check('guard 2: and does not apply the stale cloud copy over it', acted.includes('applied'), false);
})();
// A fresh cloud snapshot is applied normally and opens the load gate.
(function () {
  const acted = runSnapshot({ localStamp: 1000, cloudStamp: 2000, localProjects: [], cloudProjects: [{ id: 1 }], loadedUid: '' });
  check('guard 2: newer cloud snapshot is applied', acted.includes('applied'), true);
})();

/* ---- iOS backup export ---- */
function runExport(canShareFiles) {
  const log = [];
  const sandbox = {
    projects: [{ id: 1 }], groups: [], collapsedGroups: {}, settings: {}, timers: {},
    Blob: function (parts, o) { this.parts = parts; this.type = o && o.type; },
    File: function (parts, name, o) { this.name = name; this.type = o && o.type; },
    Date: Date, JSON: JSON,
    URL: { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} },
    navigator: canShareFiles ? {
      canShare: function (d) { return !!(d && d.files); },
      share: function (d) { log.push('share:' + d.files[0].name); return Promise.resolve(); }
    } : {},
    document: {
      createElement: function () { return { click: function () { log.push('download'); } }; },
      getElementById: function () { return {}; }
    },
    showToast: function (m) { log.push('toast:' + m); }
  };
  const run = new Function('sb', 'with(sb){' + extractFn('doBackupExport') + '\n' +
    extractFn('_downloadBackupFallback') + '\ndoBackupExport();}');
  run(sandbox);
  return log;
}
// iOS: the share sheet is the only route to "Save to Files".
check('export: uses the share sheet when files can be shared',
  runExport(true).some(function (l) { return l.indexOf('share:tally-backup-') === 0; }), true);
check('export: does not also trigger a dead-end download on iOS',
  runExport(true).includes('download'), false);
// Everywhere else: unchanged behaviour.
check('export: falls back to a normal download when sharing files is unsupported',
  runExport(false).includes('download'), true);



/* ---- Account switch must blank in-memory state (added 17 Aug 2026, v78) ----
   Scoping the storage keys was not enough: the in-memory settings object
   survived an account switch, so account A's first name appeared under
   account B and was then written up into B's document. Reported by Rachel
   after v77 shipped. */
function runSwitch(seq) {
  const sb = {
    _lastAuthUid: '',
    settings: { name: 'Rachel', exportName: 'Rachel G' },
    projects: [{ id: 1 }, { id: 2 }],
    groups: [{ id: 9 }]
  };
  const run = new Function('sb', 'uid', 'with(sb){' + extractFn('resetStateOnAccountSwitch') +
    ' return resetStateOnAccountSwitch(uid);}');
  const results = seq.map(function (uid) { return run(sb, uid); });
  return { sb: sb, results: results };
}
// Guest -> account A: state must SURVIVE (a name typed on the welcome screen,
// and anything logged before signing in, belongs to the account being created).
(function () {
  const r = runSwitch(['UID_A']);
  check('account switch: guest -> A keeps the name', r.sb.settings.name, 'Rachel');
  check('account switch: guest -> A keeps local trackers', r.sb.projects.length, 2);
  check('account switch: guest -> A is not a switch', r.results[0], false);
})();
// A -> A (token refresh fires this constantly): must NOT reset.
(function () {
  const r = runSwitch(['UID_A', 'UID_A']);
  check('account switch: same account again does not reset', r.results[1], false);
  check('account switch: same account keeps state', r.sb.settings.name, 'Rachel');
})();
// A -> B: THE BUG. Nothing of A may survive into B.
(function () {
  const r = runSwitch(['UID_A', 'UID_B']);
  check('account switch: A -> B is detected', r.results[1], true);
  check('account switch: A -> B clears the previous name', r.sb.settings.name, '');
  check('account switch: A -> B clears the export name', r.sb.settings.exportName, '');
  check('account switch: A -> B clears trackers', r.sb.projects.length, 0);
  check('account switch: A -> B clears groups', r.sb.groups.length, 0);
})();
// A -> guest -> B (sign out, then sign in as someone else) still counts as A -> B.
(function () {
  const r = runSwitch(['UID_A', '', 'UID_B']);
  check('account switch: signing out in between still resets', r.sb.settings.name, '');
})();
// A -> guest -> A (sign out and back in as yourself) must not be treated as a switch.
(function () {
  const r = runSwitch(['UID_A', '', 'UID_A']);
  check('account switch: back to the same account is not a switch', r.results[2], false);
})();


/* ============================ RESULTS ============================ */
Promise.all(_deletionChecks.concat(_signOutChecks)).then(function () {
  console.log('\n' + (fail ? `❌ ${fail} FAILED, ${pass} passed` : `✅ ALL ${pass} TESTS PASSED`));
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.error('\n❌ Deletion tests threw: ' + (e && e.stack || e));
  process.exit(1);
});
