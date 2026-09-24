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
  extractConstLine('const SHARING_ENABLED='),
  extractConstLine('const SHARING_ALLOWED_ACCOUNTS='),
  extractFn('sharingUnlocked'),
  extractFn('_flipView'),
  extractFn('isPay'),
  extractFn('myName'),
  extractFn('hasOther'),
  extractFn('otherName'),
  extractFn('payerName'),
  extractFn('receiverName'),
  extractFn('paidBtnLabel'),
  extractFn('entryShareOf'),
  extractFn('calcPersonDues'),
  extractFn('calcPersonExpenseBreakdown'),
  extractFn('calcHistoryStatusMap'),
  extractFn('projNetBalances'),
  /* The two the WhatsApp messages are built from. calcGroupSettlement was
     never exercised here, which is how it spent its whole life filtering on
     an entry type the app has never written (10 Sep 2026). */
  extractFn('calcGroupSettlement'),
  extractFn('inviteGroupBlock'),
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
  extractConstLine('const LEDGER_LOCAL_KEYS='),
  'var _lgBase={};',   // module state in the app; the sandbox needs its own
  'function showToast(){}',  // deleteEntry reports the not-found case through it
  'const db={saveProject(){}};',
  extractFn('findEntry'),
  extractFn('deleteEntry'),
  extractFn('isShared'),
  extractFn('ledgerRole'),
  extractFn('canEditLedger'),
  extractFn('canAdminLedger'),
  /* The 9 Sep 2026 permission seam. addEntry/updateEntry/deleteEntry and the
     three doEdit*Entry writers all go through requireEditRights now, so it has
     to exist in the sandbox or every write test throws. */
  extractFn('canWriteEntries'),
  extractFn('requireEditRights'),
  extractFn('entryRowAttrs'),
  extractFn('markEntriesDeleted'),
  extractFn('reconcileLedgerHistory'),
  extractFn('hydrateStub'),
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
var currentUser = { email: 'someone.else@example.com', isAnonymous: false };
eval(code);
const computeBalances = new Function('p', 'FX',
  'with(this){' + global.__BAL__ + ' return {paid,owes,balances,transfers,allSettled};}'
);
// bind helpers the balance block calls
const ctx = { isMultiCur, entryCcy, amtMain, fxConvert, rd2, calcTransfers, getEntriesSinceLastSettlement };
function balances(p) { return computeBalances.call(ctx, p, FX); }

// The shared-ledger snapshot handler lives inline inside attachLedgerListener.
// The 5 Sep 2026 bug was in the ORDER of the statements, not in any one
// function, so slice the real block out and run it — a re-typed copy here
// would keep passing while the app broke.
/* THE ANCHORS ARE SHAPES, NOT NAMES (fixed 9 Sep 2026).
   These two markers were spelled out with their local names — `const keep=` and
   `p.role=me.role||p.role;` — and the minifier renames every one of them. So
   this threw on the shipped file and the suite could not be run against it at
   all, which is BUILD NOTES step 7 and the exact trap the handoff warns about:
   "green on the minified build WAS A LIE". Match the shape instead: the
   FUNCTION names survive mangling, the locals around them do not. */
(function buildApplySnapshot() {
  const fn = extractFn('attachLedgerListener');
  const startRe = /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*reconcileLedgerHistory\(/;
  // Stop before the member/role bookkeeping — this test is about history only.
  const endRe = /\.role\s*=\s*[A-Za-z_$][\w$]*\.role\s*\|\|\s*[A-Za-z_$][\w$]*\.role\s*;/;
  const sm = startRe.exec(fn);
  const em = sm ? endRe.exec(fn.slice(sm.index)) : null;
  if (!sm || !em) throw new Error('Ledger-snapshot markers not found in attachLedgerListener (was it refactored? update the anchors in regression.test.js)');
  global.__SNAP__ = fn.slice(sm.index, sm.index + em.index);
  /* The block reads the ledger document out of a LOCAL, and that local is `d`
     in the master and something like `n` in the shipped file. `p` survives only
     because it is in build-minified.js's reserved list, and reserving one more
     single letter for a test's convenience is a worse trade than reading the
     name back out of the code. It is the first argument of the
     reconcileLedgerHistory call the slice starts with. */
  const dm = /reconcileLedgerHistory\(\s*([A-Za-z_$][\w$]*)\.data/.exec(global.__SNAP__);
  if (!dm) throw new Error('Could not tell which local holds the ledger document in attachLedgerListener');
  global.__SNAP_DATA_VAR__ = dm[1];
})();

/* MATCHES EITHER QUOTE CHARACTER. This suite is run twice — once against the
   readable master and once against the shipped, minified file (BUILD NOTES
   step 7) — and terser rewrites every single-quoted string as double-quoted.
   A structural check that spells the quote is a check that only ever runs
   once. */
const Q = '["\']';

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
check('I pay -> "Log Payment"', paidBtnLabel({ direction: 'pay' }), 'Log Payment');
check('I earn -> "Log Payment"', paidBtnLabel({ direction: 'earn' }), 'Log Payment');
check('missing direction -> "Log Payment"', paidBtnLabel({}), 'Log Payment');

section('Live-sharing: counterparty perspective flips the label');
check('pay activity, other side sees the same button', paidBtnLabel({ direction: 'pay' }, 'other'), 'Log Payment');
check('earn activity, other side sees the same button', paidBtnLabel({ direction: 'earn' }, 'other'), 'Log Payment');

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

section('Shared ledger: a delete stays deleted (5 Sep 2026 bug)');
// REPORTED: a project was shared with an editor, the editor added an entry,
// and neither member could delete it. The toast said "Entry deleted" and the
// entry came straight back.
// TWO causes, both pinned here:
//   1. The snapshot handler copied the server's history over local state and
//      then only put the reconciled copy back when the two differed in LENGTH.
//      A delete the server has not heard about yet is exactly the same-length,
//      different-contents case, so the entry returned.
//   2. With the entry back in p.history there was nothing for the next push to
//      subtract, so the tombstone was never written and the delete was lost.
let _pushed = false;
function pushDirtyLedgers() { _pushed = true; }
// Tombstones are only kept for SHARED ledgers, so this section has to run as an
// account that has sharing unlocked. Restored at the end of the section.
// THIS USED TO LIFT THE FIRST ADDRESS OUT OF SHARING_ALLOWED_ACCOUNTS, which
// stopped working the day the gate came off (11 Sep 2026) and the list went
// empty — it produced an account with no email and no uid, which reads as a
// guest, and three tombstone tests failed as though the tombstone logic had
// broken. The fix is the general lesson: set up the CONDITION the code cares
// about (a signed-in account), never scrape it out of a constant that exists
// for a different reason.
const _savedUser = currentUser;
currentUser = { uid: 'TOMBSTONE_UID', email: 'owner@example.com', isAnonymous: false };
const applySnapshot = new Function('p', global.__SNAP_DATA_VAR__, 'ctx',
  'with(ctx){' + global.__SNAP__ + '} return p;');
function snapshot(p, serverData) {
  _lgBase[p.ledgerId] = serverData;
  const ctx = {
    reconcileLedgerHistory, hydrateStub, pushDirtyLedgers, isShared,
    setTimeout: (f) => f(),
  };
  return applySnapshot(p, { data: serverData }, ctx);
}
const _E = (id) => ({ id, type: 'charge', amount: id * 10, note: 'e' + id,
                      date: '2026-09-0' + id + 'T10:00:00.000Z',
                      updatedAt: '2026-09-0' + id + 'T10:00:00.000Z' });
const _shared = { id: 'p1', shared: true, ledgerId: 'L1', role: 'owner', type: 'project',
                  currency: '$', history: [_E(3), _E(2), _E(1)] };
snapshot(_shared, { history: [_E(3), _E(2), _E(1)] });
check('both members see all three entries', _shared.history.map(h => h.id).join(','), '3,2,1');

// The owner deletes the entry the editor added.
deleteEntry(_shared, 2);
check('it leaves the screen at once', _shared.history.map(h => h.id).join(','), '3,1');
check('and a local tombstone is recorded', (_shared.deletedIds || []).join(','), '2');

// A snapshot lands before the tombstone reaches the ledger: the server still
// has all three and knows nothing about the delete.
snapshot(_shared, { history: [_E(3), _E(2), _E(1)] });
check('the deleted entry does NOT come back', _shared.history.map(h => h.id).join(','), '3,1');
check('the tombstone survives to be pushed', (_shared.deletedIds || []).join(','), '2');

// Once the ledger carries the tombstone, this device stops holding its own.
snapshot(_shared, { history: [_E(3), _E(1)], deletedIds: ['2'] });
check('still deleted once the ledger agrees', _shared.history.map(h => h.id).join(','), '3,1');
check('local tombstone is pruned', (_shared.deletedIds || []).length, 0);

// The other half of the report: the app announced a delete that never happened.
const _missing = { id: 'p2', type: 'project', currency: '$', history: [_E(1)] };
check('deleting an entry that is gone reports failure', deleteEntry(_missing, 99), false);
check('deleting one that is there reports success', deleteEntry(_missing, 1), true);
check('an UNSHARED tracker keeps no tombstones', (_missing.deletedIds || []).length, 0);
currentUser = _savedUser;

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
    // doDeleteAccount now consults the sharing switch before it touches the
    // auth user, and _clearAllLocalData drops ledger listeners.
    extractConstLine('const SHARING_ENABLED='),
    extractConstLine('const SHARING_ALLOWED_ACCOUNTS='),
    extractFn('sharingUnlocked'),
    'var _ledgerDeletionChoice="";',
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
    _deferredPushUid: '',
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
  // The push now maps its payload through projectsForCloud(), so the stub
  // rewrite has to be in the sandbox with it.
  const run = new Function('sb', 'with(sb){' +
    extractConstLine('const SHARING_ENABLED=') + '\n' +
    extractConstLine('const SHARING_ALLOWED_ACCOUNTS=') + '\n' +
    extractFn('sharingUnlocked') + '\n' +
    extractConstLine('const LEDGER_LOCAL_KEYS=') + '\n' +
    extractFn('isShared') + '\n' + extractFn('stubOf') + '\n' +
    extractFn('projectsForCloud') + '\n' +
    extractMethod('_pushSyncedToFirestore') +
    '\n_pushSyncedToFirestore.call({setLocalUpdatedAt:function(){}});}');
  run(sandbox);
  // The 9 Sep 2026 additions: what the user was TOLD, and whether the refused
  // write was remembered for a retry.
  written.status = sandbox.syncStatus;
  written.deferred = sandbox._deferredPushUid;
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

/* ---- The 9 Sep 2026 report: the FIRST Google sign-in said "Sync error" ----
   Rachel, on two different Android handsets: the first Google sign-in on a
   device showed a sync error, the sign-in repeated, and the second attempt was
   fine. It was never a sign-in fault. A brand-new account has no trackers
   (projects.length === 0) and its first snapshot has not landed yet
   (_syncLoadedUid !== uid) — which is precisely the guard above. The welcome
   screen's name step saves inside that window, hit the guard, and the guard
   painted 'error' and threw the write away.

   The refusal is correct and must stay. These checks pin the two things that
   were wrong about it: what the user is told, and that the write comes back. */
(function () {
  const r = runPush({ projects: [], loadedUid: '' });
  check('a deferred write is not reported to the user as a sync error', r.status === 'error', false);
  check('it reports the honest state instead — still syncing', r.status, 'syncing');
  check('and the refused write is remembered, not dropped', r.deferred, 'UID_A');
  const ok = runPush({ projects: [{ id: 1 }], loadedUid: '' });
  check('a write that was never refused leaves nothing deferred', ok.deferred, '');
})();
// THE RETRY ITSELF. A snapshot for the account opens the load gate, and the
// write the guard deferred goes up with it — otherwise the name typed on the
// welcome screen would sit in the local cache until something else saved.
(function () {
  const acted = runSnapshot({ localStamp: 0, cloudStamp: 1000, localProjects: [],
                              cloudProjects: [], loadedUid: '', deferredUid: 'UID_A' });
  check('the deferred write is retried when the account finishes loading',
    acted.includes('pushed'), true);
})();
(function () {
  const acted = runSnapshot({ localStamp: 0, cloudStamp: 1000, localProjects: [],
                              cloudProjects: [], loadedUid: '', deferredUid: 'UID_OTHER' });
  check('a write deferred for another account is NOT sent for this one',
    acted.includes('pushed'), false);
})();

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
    _deferredPushUid: opts.deferredUid || '',
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
  // _openLoadGate is the one place _syncLoadedUid is now assigned, and it is
  // what retries a write the empty-write guard deferred. Extract the REAL one —
  // a stub here would let the retry break without a single test noticing.
  const run = new Function('sb', 'with(sb){' + extractFn('_openLoadGate') + '\n' +
    extractFn('startFirestoreSync') +
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
function runSwitch(seq, startUid) {
  const sb = {
    // `startUid` simulates the value RESTORED FROM STORAGE at launch — see the
    // cold-start test below. Defaults to '' (a device that has never signed in).
    _lastAuthUid: startUid || '',
    settings: { name: 'Rachel', exportName: 'Rachel G' },
    projects: [{ id: 1 }, { id: 2 }],
    groups: [{ id: 9 }],
    // Real dependencies, stubbed so they can be OBSERVED rather than worked
    // around. resetStateOnAccountSwitch persists the uid and drops the guest
    // cache; both are part of the contract now, so both get asserted.
    guestCacheCleared: 0,
    clearGuestCache: function () { this.guestCacheCleared++; },
    stored: {},
    LAST_AUTH_UID_KEY: 'tally.lastAuthUid',
    localStorage: {
      setItem: function (k, v) { sb.stored[k] = v; },
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(sb.stored, k) ? sb.stored[k] : null; }
    }
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
/* ---- THE SWITCH THAT SPANNED A RESTART (Rachel, 21 Aug 2026) ----
   The v78 fix above was right about WHAT to blank and wrong about how long to
   remember. `_lastAuthUid` lived only in memory, so it was '' on every cold
   start and this sequence slipped straight past it:

       sign out of A  ->  CLOSE THE APP  ->  reopen  ->  sign in as B

   With no remembered uid, B looked like a first-ever sign-in, nothing was
   blanked, and A's first name rode the guest cache into B's cloud document —
   after which it came back on every future sign-in, because by then the
   snapshot legitimately carried it. Rachel reported exactly this, twice.

   The uid is now persisted, so a relaunch cannot erase the fact of the switch. */
(function () {
  // A cold start where storage remembers A, then a sign-in as B.
  const r = runSwitch(['UID_B'], 'UID_A');
  check('account switch: a switch across an app restart is still detected', r.results[0], true);
  check('account switch: ...and the old name does not survive it', r.sb.settings.name, '');
  check('account switch: ...and neither do the old trackers', r.sb.projects.length, 0);
})();
// The same cold start, signing back in as YOURSELF, must stay untouched —
// otherwise every relaunch would wipe the user's own name.
(function () {
  const r = runSwitch(['UID_A'], 'UID_A');
  check('account switch: relaunching into the SAME account is not a switch', r.results[0], false);
  check('account switch: ...and keeps the name', r.sb.settings.name, 'Rachel');
})();
/* The uid has to reach storage, or the next cold start is blind again. */
(function () {
  const r = runSwitch(['UID_A']);
  check('account switch: the uid is persisted for the next launch',
    r.sb.stored['tally.lastAuthUid'], 'UID_A');
})();
/* The unscoped GUEST cache can still hold the previous account's settings and
   is read on any later anonymous hydration — which would undo the reset. It is
   dropped on a real switch, and ONLY on a real switch: a guest signing in for
   the first time is carrying data that legitimately belongs to the new account. */
(function () {
  const sw = runSwitch(['UID_A', 'UID_B']);
  check('account switch: A -> B drops the guest cache', sw.sb.guestCacheCleared, 1);
  const first = runSwitch(['UID_A']);
  check('account switch: guest -> A KEEPS the guest cache', first.sb.guestCacheCleared, 0);
})();
// A -> guest -> A (sign out and back in as yourself) must not be treated as a switch.
(function () {
  const r = runSwitch(['UID_A', '', 'UID_A']);
  check('account switch: back to the same account is not a switch', r.results[2], false);
})();



/* ---- Apple sign-in: the code exchange must name the right flow ----
   Apple issues a NATIVE authorization code against the app's bundle ID and a
   WEB code against the Services ID, and the exchange must use the matching
   client_id. Between 11 and 17 Aug 2026 the client sent no flow at all and the
   server always assumed web, so every native iOS sign-in failed with
   "client_id mismatch" and stored no refresh token — meaning account deletion
   could not revoke the Apple token, which Apple requires. */
(function () {
  const sent = [];
  const sb = {
    firebase: { functions: function () { return { httpsCallable: function () {
      return function (payload) { sent.push(payload); return Promise.resolve({}); };
    } }; } },
    console: { error: function () {} }
  };
  const run = new Function('sb', 'with(sb){' + extractAsyncFn('_storeAppleRefreshToken') +
    ' return _storeAppleRefreshToken;}');
  const fn = run(sb);
  return Promise.all([fn('CODE1', 'native'), fn('CODE2', 'web'), fn('CODE3', undefined)])
    .then(function () {
      check('apple exchange: native flow is reported as native', sent[0].flow, 'native');
      check('apple exchange: web flow is reported as web', sent[1].flow, 'web');
      check('apple exchange: unknown flow falls back to web', sent[2].flow, 'web');
      check('apple exchange: the code is still sent', sent[0].code, 'CODE1');
    });
})();
// The native bridge and the Apple JS path must each label themselves, or the
// server has nothing to go on.
(function () {
  const nativeSrc = extractAsyncFn('_appleCredential');
  const webSrc = extractAsyncFn('_appleCredentialViaAppleJs');
  check('apple exchange: native credential is labelled', /flow\s*:\s*['"]native['"]/.test(nativeSrc), true);
  check('apple exchange: web credential is labelled', /flow\s*:\s*['"]web['"]/.test(webSrc), true);
})();



/* ---- Account deletion must survive a stale sign-in (added 17 Aug 2026) ----
   Firebase refuses to delete a user whose sign-in is older than ~5 minutes.
   _reauthenticateForDelete() only knew the WEB flows, so inside the iOS
   wrapper it fired reauthenticateWithRedirect (which a WKWebView cannot
   complete) and returned false by design. Result: anyone signed in for more
   than five minutes could not delete their account on iOS at all — and Apple
   REQUIRES in-app deletion to work (5.1.1(v)). Reported on device 17 Aug. */
function runReauth(opts) {
  const log = [];
  const sb = {
    _hasNativeAppleBridge: function () { return !!opts.appleBridge; },
    _hasNativeGoogleBridge: function () { return !!opts.googleBridge; },
    _appleCredential: async function () {
      log.push('appleSheet');
      if (opts.nativeThrows) throw new Error('sheet cancelled');
      return { credential: 'APPLE_CRED' };
    },
    _googleCredential: async function () {
      log.push('googleSheet');
      if (opts.nativeThrows) throw new Error('sheet cancelled');
      return { credential: 'GOOGLE_CRED' };
    },
    _preferRedirectAuth: function () { return !!opts.preferRedirect; },
    firebase: {
      auth: {
        OAuthProvider: function () { this.addScope = function () {}; },
        GoogleAuthProvider: function () {}
      }
    },
    auth: { reauthenticateWithRedirect: async function () { log.push('webRedirect'); } },
    sessionStorage: { setItem: function () {} },
    console: { error: function () {} }
  };
  const user = {
    providerData: [{ providerId: opts.provider }],
    reauthenticateWithCredential: async function (c) { log.push('reauthWithCredential:' + c); },
    reauthenticateWithPopup: async function () { log.push('webPopup'); }
  };
  const run = new Function('sb', 'with(sb){' + extractAsyncFn('_reauthenticateForDelete') +
    ' return _reauthenticateForDelete;}');
  return run(sb)(user).then(function (ok) { return { ok: ok, log: log }; });
}

const _reauthChecks = [];
// THE BUG: Apple user in the iOS wrapper, signed in over 5 minutes ago.
_reauthChecks.push(runReauth({ provider: 'apple.com', appleBridge: true, preferRedirect: true })
  .then(function (r) {
    check('delete reauth: apple uses the native sheet', r.log.includes('appleSheet'), true);
    check('delete reauth: apple reauthenticates with the credential', r.log.includes('reauthWithCredential:APPLE_CRED'), true);
    check('delete reauth: apple never hits the dead-end redirect', r.log.includes('webRedirect'), false);
    check('delete reauth: apple succeeds so deletion continues', r.ok, true);
  }));
// Same for a Google user in the wrapper.
_reauthChecks.push(runReauth({ provider: 'google.com', googleBridge: true, preferRedirect: true })
  .then(function (r) {
    check('delete reauth: google uses the native sheet', r.log.includes('googleSheet'), true);
    check('delete reauth: google reauthenticates with the credential', r.log.includes('reauthWithCredential:GOOGLE_CRED'), true);
    check('delete reauth: google succeeds so deletion continues', r.ok, true);
  }));
// A cancelled or broken sheet must fall back, not make deletion impossible.
_reauthChecks.push(runReauth({ provider: 'apple.com', appleBridge: true, preferRedirect: false, nativeThrows: true })
  .then(function (r) {
    check('delete reauth: a failed native sheet falls back to the web flow', r.log.includes('webPopup'), true);
    check('delete reauth: fallback still succeeds', r.ok, true);
  }));
// Browsers and real installed PWAs keep their existing behaviour exactly.
_reauthChecks.push(runReauth({ provider: 'apple.com', appleBridge: false, preferRedirect: false })
  .then(function (r) {
    check('delete reauth: plain browser still uses the popup', r.log.includes('webPopup'), true);
  }));
_reauthChecks.push(runReauth({ provider: 'apple.com', appleBridge: false, preferRedirect: true })
  .then(function (r) {
    check('delete reauth: installed PWA still uses the redirect', r.log.includes('webRedirect'), true);
    check('delete reauth: redirect returns false so the caller waits', r.ok, false);
  }));



/* ---- The welcome screen must follow the auth state (added 17 Aug 2026) ----
   Sign in from the welcome screen in the iOS wrapper, see the "Signed in!"
   toast, and stay on step 1 as if nothing happened. Force-closing and
   reopening lands on the name step, proving the sign-in worked and only the
   screen was stale. On the web a redirect reloads the page and everything
   redraws for free; the native sheets reload nothing. */
function runWelcomeSync(opts) {
  const calls = [];
  const sb = {
    currentUser: opts.currentUser,
    welcomeAwaitingName: false,
    document: {
      getElementById: function (id) {
        if (id !== 'welcomeView') return null;
        if (!opts.welcomeExists) return null;
        return { classList: { contains: function () { return !!opts.welcomeActive; } } };
      }
    },
    renderWelcome: function () { calls.push('renderWelcome'); }
  };
  const run = new Function('sb', 'with(sb){' + extractFn('_syncWelcomeToAuthState') +
    ' var r=_syncWelcomeToAuthState(' + (opts.passUser ? 'sb.passedUser' : 'undefined') +
    '); return {r:r,awaiting:welcomeAwaitingName};}');
  sb.passedUser = opts.passedUser;
  const out = run(sb);
  return { returned: out.r, awaiting: out.awaiting, calls: calls };
}
const SIGNED_IN = { isAnonymous: false, uid: 'UID_A' };
const ANON = { isAnonymous: true, uid: 'ANON' };

// THE BUG: signed in, welcome screen on screen, nothing redraws.
(function () {
  const r = runWelcomeSync({ currentUser: SIGNED_IN, welcomeExists: true, welcomeActive: true });
  check('welcome sync: redraws when signed in on the welcome screen', r.calls.includes('renderWelcome'), true);
  check('welcome sync: holds the name step until the name is confirmed', r.awaiting, true);
  check('welcome sync: reports that it acted', r.returned, true);
})();
// An anonymous session must NOT be pushed onto the name step.
(function () {
  const r = runWelcomeSync({ currentUser: ANON, welcomeExists: true, welcomeActive: true });
  check('welcome sync: anonymous does not trigger the name step', r.awaiting, false);
  check('welcome sync: anonymous still redraws step 1', r.calls.includes('renderWelcome'), true);
})();
// Anywhere other than the welcome screen, it must do nothing at all.
(function () {
  const r = runWelcomeSync({ currentUser: SIGNED_IN, welcomeExists: true, welcomeActive: false });
  check('welcome sync: does nothing when the welcome screen is not showing', r.calls.length, 0);
  check('welcome sync: reports that it did not act', r.returned, false);
})();
(function () {
  const r = runWelcomeSync({ currentUser: SIGNED_IN, welcomeExists: false });
  check('welcome sync: safe when the welcome view is absent', r.calls.length, 0);
})();
// Every sign-in success path must drive the screen itself rather than relying
// on the auth observer winning a race it does not control.
(function () {
  // Quote-agnostic on purpose: the minifier rewrites single quotes to double,
  // so a regex hard-coded to ' passes on the readable master and silently
  // matches nothing on the shipped file (caught 17 Aug 2026).
  const toasts = (src.match(/showToast\(.(?:Account linked! Your data is now synced\.|Signed in! Data merged\.|Signed in with Apple!|Signed in with Google!).\)/g) || []).length;
  const driven = (src.match(/_syncWelcomeToAuthState\(\)/g) || []).length;
  check('welcome sync: every sign-in success point drives the screen', driven >= toasts && toasts > 0, true);
})();



/* ---- iOS push must take the native route (added 17 Aug 2026) ----
   registerPushAndSchedule() used messaging.getToken() — the WEB PUSH API.
   iOS exposes Web Notifications only to PWAs installed from Safari, never
   inside the WKWebView that hosts the App Store app, so the old path failed
   at its first guard and NO token was ever obtained. Push has therefore never
   worked on iPhone. The wrapper's native bridge was complete but unused. */
function runPushBridge(opts) {
  const posted = [];
  const listeners = {};
  const sb = {
    window: {
      webkit: opts.bridge ? { messageHandlers: {
        'push-token': { postMessage: function () { posted.push('push-token'); setTimeout(function () { fire('push-token', opts.token); }, 0); } },
        // Mirrors returnPermissionResult() in PushNotifications.swift: it replies
        // on 'push-permission-request' (the same name it was posted to) with the
        // string 'granted' or 'denied'. Corrected 17 Aug 2026 — the earlier mock
        // encoded a guessed contract, so it happily passed against code that
        // could never work on a real device.
        'push-permission-request': { postMessage: function () { posted.push('push-permission-request'); setTimeout(function () { fire('push-permission-request', opts.granted); }, 0); } }
      } } : undefined,
      addEventListener: function (n, f) { (listeners[n] = listeners[n] || []).push(f); },
      removeEventListener: function (n, f) { listeners[n] = (listeners[n] || []).filter(function (x) { return x !== f; }); }
    },
    setTimeout: setTimeout, clearTimeout: clearTimeout
  };
  function fire(name, detail) { (listeners[name] || []).slice().forEach(function (f) { f({ detail: detail }); }); }
  const run = new Function('sb', 'with(sb){' +
    extractFn('_hasNativePushBridge') + '\n' + extractFn('_nativePushToken') + '\n' + extractFn('_nativePushPermission') +
    ' return {has:_hasNativePushBridge,token:_nativePushToken,perm:_nativePushPermission};}');
  const api = run(sb);
  return { api: api, posted: posted };
}
// Detection: only inside the wrapper.
check('ios push: bridge detected in the wrapper', runPushBridge({ bridge: true }).api.has(), true);
check('ios push: no bridge in a plain browser', runPushBridge({ bridge: false }).api.has(), false);

const _pushChecks = [];
// The token comes back through the CustomEvent the wrapper dispatches.
(function () {
  const r = runPushBridge({ bridge: true, token: 'APNS_FCM_TOKEN' });
  _pushChecks.push(r.api.token().then(function (t) {
    check('ios push: asks the wrapper for a token', r.posted.includes('push-token'), true);
    check('ios push: resolves the token', t, 'APNS_FCM_TOKEN');
  }));
})();
// PushNotifications.swift sends this literal string when it fails — it is not
// a token and must never be stored as one.
(function () {
  const r = runPushBridge({ bridge: true, token: 'ERROR GET TOKEN' });
  _pushChecks.push(r.api.token().then(function (t) {
    check('ios push: the failure sentinel is not treated as a token', t, '');
  }));
})();
// Permission result is relayed faithfully.
(function () {
  const r = runPushBridge({ bridge: true, granted: 'granted' });
  _pushChecks.push(r.api.perm().then(function (g) {
    check('ios push: permission granted is relayed', g, true);
  }));
})();
(function () {
  const r = runPushBridge({ bridge: true, granted: 'denied' });
  _pushChecks.push(r.api.perm().then(function (g) {
    check('ios push: permission refused is relayed', g, false);
  }));
})();
// Both write paths must state tokenType explicitly. The reminders document is
// merged, so an absent tag would let a user who registered on iOS keep a stale
// 'apns' value after later signing in on the web — and be sent a payload shape
// their browser cannot render.
(function () {
  const nativeSrc = extractFn('_enableRemindersNative');
  const refreshSrc = extractAsyncFn('registerPushAndSchedule');
  check('ios push: native path tags the token apns', /tokenType\s*:\s*['"]apns['"]/.test(nativeSrc), true);
  check('ios push: launch refresh tags the token apns', /tokenType\s*:\s*['"]apns['"]/.test(refreshSrc), true);
  check('ios push: web path tags the token web', /tokenType\s*:\s*['"]web['"]/.test(refreshSrc), true);
})();
/* ONE ENTRY PER DEVICE — 20 Aug 2026.
   `reminders/{uid}.token` was ONE SLOT FOR THE WHOLE ACCOUNT, and both paths
   below write it on launch, so opening Tally on the iPhone unregistered the
   Android phone and vice versa. Only the last-opened device could ever be
   notified — which is why Android looked like it "regressed" in August when in
   fact it had been evicted by the first iPhone launch.

   This is precisely the class of bug that hides for weeks, because it is
   INVISIBLE ON ONE DEVICE: a single test phone passes every manual check. So
   it gets pinned here. Every write site must carry a `tokens` map keyed by the
   token itself. */
(function () {
  const nativeSrc = extractFn('_enableRemindersNative');
  const refreshSrc = extractAsyncFn('registerPushAndSchedule');
  // Quote- and whitespace-agnostic: the minifier rewrites both.
  const perDevice = /tokens\s*:\s*\{\s*\[/;
  check('push: native enable writes a per-device tokens map', perDevice.test(nativeSrc), true);
  // registerPushAndSchedule holds BOTH the apns launch-refresh and the web
  // path, so it must contain two of them, not one.
  check('push: launch refresh and web path both write a tokens map',
    (refreshSrc.match(/tokens\s*:\s*\{\s*\[/g) || []).length, 2);
  // The map must be keyed BY THE TOKEN. A fixed key such as tokens:{apns:...}
  // would reintroduce one slot per platform — better than one per account but
  // still wrong for two Android phones, and it would pass the check above.
  // The variable name is not pinned: the minifier renames locals.
  check('push: the map is keyed by the token variable, not a fixed name',
    /tokens\s*:\s*\{\s*\[\s*[A-Za-z_$][\w$]*\s*\]\s*:/.test(nativeSrc), true);
})();
/* THE DOUBLE-READ — 20 Aug 2026.
   enableReminders() awaits Notification.requestPermission(), gets 'granted',
   and tells the user "Reminders enabled". registerPushAndSchedule() then
   re-read the Notification.permission GLOBAL and bailed, because on Samsung
   Internet that global still reads 'default' after a successful grant. Android
   push was dead for weeks and the only symptom was a toast blaming "this
   browser".

   Two things are pinned. The caller must pass what it just learned, and the
   guard must yield to it. The guard itself STAYS for the no-arg launch call —
   there, nobody has just asked, so the global is the only source and the
   18 Jul protection against getToken popping its own prompt still matters.
   Both patterns are minifier-proof: `true` becomes `!0`, and the parameter
   name is mangled to a single letter, so neither is matched literally. */
(function () {
  const enableSrc = extractAsyncFn('enableReminders');
  const refreshSrc = extractAsyncFn('registerPushAndSchedule');
  check('push: enableReminders vouches for the permission it just obtained',
    /registerPushAndSchedule\s*\(\s*(?:true|!0)\s*\)/.test(enableSrc), true);
  // An `&&` before the Notification-in-window test means that test is no
  // longer the FIRST condition — i.e. something gates it. If the guard is ever
  // reverted to reading the global unconditionally, this goes back to false.
  check('push: the permission guard yields to a vouching caller',
    /&&\s*\(?\s*!\s*\(?\s*["']Notification["']\s*in\s*window/.test(refreshSrc), true);
})();
/* pushHelp — the failure message must name the switch to flip (20 Aug 2026).
   A blocked origin is recoverable in two taps, but only if the app says where.
   The old text blamed "this browser" for every cause alike, which sent Rachel
   looking at her phone for a fault that was one setting. */
(function () {
  const fn = new Function('return ' + extractFn('pushHelp'))();
  const blocked = fn('messaging/permission-blocked: Messaging: The notification permission was not granted and blocked instead.');
  check('pushHelp: a blocked origin says it is blocked', /blocked/i.test(blocked), true);
  check('pushHelp: ...and points at the permission setting', /Allow/.test(blocked), true);
  // The old copy told a blocked user to install the app. That does not fix a
  // blocked ORIGIN, and sending them to the store is a dead end.
  check('pushHelp: ...and does NOT send them to the app store', /Google Play|App Store/.test(blocked), false);

  const dflt = fn('permission is default');
  check('pushHelp: never-asked also points at the setting', /Allow/.test(dflt), true);

  const unsup = fn('unsupported browser');
  check('pushHelp: a browser with no web push IS told to install the app',
    /Google Play|App Store/.test(unsup), true);

  // Anything unrecognised must still carry the raw reason through. Losing it is
  // what made this class of bug invisible for three weeks.
  const odd = fn('messaging/some-future-code');
  check('pushHelp: an unknown reason is still reported verbatim',
    odd.indexOf('messaging/some-future-code') > -1, true);
  check('pushHelp: no reason at all degrades to plain advice',
    fn('').indexOf('[reason:') === -1, true);
})();
// enableReminders() must branch BEFORE the 'Notification' guard, which is the
// exact line iOS fails on.
(function () {
  const src2 = extractAsyncFn('enableReminders');
  const bridgeAt = src2.indexOf('_hasNativePushBridge');
  // Quote- AND whitespace-agnostic. The minifier rewrites
  //   'Notification' in window   ->   "Notification"in window
  // so a literal match passes on the readable master and silently matches
  // nothing on the shipped file. Second time this exact trap was hit today
  // (see the sign-in toast check above) — assert on shape, not on spelling.
  const guardMatch = /["']Notification["']\s*in\s*window/.exec(src2);
  const guardAt = guardMatch ? guardMatch.index : -1;
  check('ios push: the Notification guard is still present', guardAt > -1, true);
  check('ios push: the native branch precedes the Notification guard', bridgeAt > -1 && bridgeAt < guardAt, true);
})();



/* ---- The reminders UI must be reachable on iOS (added 17 Aug 2026) ----
   v82 fixed enableReminders() but NOT renderNotifSettings(), which gated the
   whole section on ('Notification' in window). Inside the wrapper that is
   false, so the user only ever saw "Your browser doesn't support
   notifications… add it to your home screen" and could never reach the
   toggle. Fixing the function while leaving the gate shut achieved nothing —
   reported on device immediately after v82 shipped. */
(function () {
  const src3 = extractFn('renderNotifSettings');
  const bridgeAt = src3.indexOf('_hasNativePushBridge');
  const supportedMatch = /["']Notification["']\s*in\s*window/.exec(src3);
  const supportedAt = supportedMatch ? supportedMatch.index : -1;
  check('reminders ui: renderNotifSettings knows about the native bridge', bridgeAt > -1, true);
  check('reminders ui: the bridge check precedes the browser-support check', bridgeAt > -1 && supportedAt > -1 && bridgeAt < supportedAt, true);
})();
// The save-time nudge must not be silently suppressed on iOS either.
(function () {
  const src4 = extractFn('maybePromptEnableReminders');
  check('reminders ui: the save-time nudge knows about the native bridge', src4.indexOf('_hasNativePushBridge') > -1, true);
})();
// The native renderer must offer an actual toggle wired to enableReminders.
(function () {
  const src5 = extractFn('_renderNotifSettingsNative');
  check('reminders ui: native path renders a toggle', /toggle-switch/.test(src5), true);
  check('reminders ui: native toggle can turn reminders on', /enableReminders\(\)/.test(src5), true);
  check('reminders ui: native toggle can turn reminders off', /disableReminders\(\)/.test(src5), true);
})();
// Permission state is read from the wrapper, and only 'denied' hides the toggle.
function runNativeState(state) {
  const posted = [];
  const listeners = {};
  const sb = {
    window: {
      webkit: { messageHandlers: { 'push-permission-state': { postMessage: function () {
        posted.push('push-permission-state');
        setTimeout(function () { (listeners['push-permission-state'] || []).slice().forEach(function (f) { f({ detail: state }); }); }, 0);
      } } } },
      addEventListener: function (n, f) { (listeners[n] = listeners[n] || []).push(f); },
      removeEventListener: function (n, f) { listeners[n] = (listeners[n] || []).filter(function (x) { return x !== f; }); }
    },
    setTimeout: setTimeout, clearTimeout: clearTimeout
  };
  const run = new Function('sb', 'with(sb){' + extractFn('_nativePushState') + ' return _nativePushState;}');
  return run(sb)().then(function (s) { return { state: s, posted: posted }; });
}
_pushChecks.push(runNativeState('authorized').then(function (r) {
  check('reminders ui: asks iOS for the permission state', r.posted.includes('push-permission-state'), true);
  check('reminders ui: relays authorized', r.state, 'authorized');
}));
_pushChecks.push(runNativeState('denied').then(function (r) {
  check('reminders ui: relays denied', r.state, 'denied');
}));
_pushChecks.push(runNativeState('notDetermined').then(function (r) {
  check('reminders ui: relays notDetermined', r.state, 'notDetermined');
}));



/* ---- The permission event name must match the Swift (added 17 Aug 2026) ----
   v83 GUESSED that the wrapper replies on 'push-permission-result'. It does
   not. returnPermissionResult() in PushNotifications.swift dispatches
   'push-permission-request' — the SAME name as the handler we post to — with
   detail 'granted' or 'denied'. So the listener never fired, tapping the
   toggle did nothing for two minutes and then silently timed out. Read the
   Swift; do not infer the contract. */
(function () {
  const src6 = extractFn('_nativePushPermission');
  check('push permission: listens on the name the Swift actually dispatches',
    /addEventListener\(\s*['"]push-permission-request['"]/.test(src6), true);
  check('push permission: does not listen on the guessed name',
    /['"]push-permission-result['"]/.test(src6), false);
  check('push permission: compares against the string granted',
    /===\s*['"]granted['"]|['"]granted['"]\s*===/.test(src6), true);
})();
// End to end through a mock of the real Swift contract.
function runRealPermission(detail) {
  const listeners = {};
  const sb = {
    window: {
      webkit: { messageHandlers: { 'push-permission-request': { postMessage: function () {
        setTimeout(function () { (listeners['push-permission-request'] || []).slice().forEach(function (f) { f({ detail: detail }); }); }, 0);
      } } } },
      addEventListener: function (n, f) { (listeners[n] = listeners[n] || []).push(f); },
      removeEventListener: function (n, f) { listeners[n] = (listeners[n] || []).filter(function (x) { return x !== f; }); }
    },
    setTimeout: setTimeout, clearTimeout: clearTimeout
  };
  return new Function('sb', 'with(sb){' + extractFn('_nativePushPermission') + ' return _nativePushPermission;}')(sb)();
}
_pushChecks.push(runRealPermission('granted').then(function (g) {
  check('push permission: granted resolves true', g, true);
}));
_pushChecks.push(runRealPermission('denied').then(function (g) {
  check('push permission: denied resolves false', g, false);
}));

/* ---- Reminder timing copy must not lie (added 17 Aug 2026) ----
   Settings said flatly "Get an evening reminder (around 9pm)". That is only
   true for an activity with NO reminder time; every activity that has one is
   reminded at ITS OWN time. Someone whose pilates reminder was set to 1pm was
   being told it would arrive at 9pm. */
function runTimingCopy(list) {
  return new Function('sb', 'with(sb){' + extractFn('_reminderTimingCopy') +
    ' return _reminderTimingCopy();}')({ scheduledActivities: function () { return list; } });
}
(function () {
  const allTimed = runTimingCopy([{ name: 'Pilates', time: '13:00' }, { name: 'Cello', time: '18:30' }]);
  check('reminder copy: never claims 9pm when every activity has a time', /9pm/.test(allTimed), false);
  check('reminder copy: says the time is per activity', /time you set on it/.test(allTimed), true);
  const noneTimed = runTimingCopy([{ name: 'Pilates', time: '' }]);
  check('reminder copy: mentions the 9pm fallback when nothing has a time', /9pm/.test(noneTimed), true);
  const mixed = runTimingCopy([{ name: 'Pilates', time: '13:00' }, { name: 'Cello', time: '' }]);
  check('reminder copy: mixed case explains both', /time you set on it/.test(mixed) && /9pm/.test(mixed), true);
  check('reminder copy: mixed case counts the untimed ones', /1 of yours has no time/.test(mixed), true);
})();


/* ---- Counterparty is optional on PROJECTS, mandatory on ACTIVITIES
        (added 27 Aug 2026) ----------------------------------------------
   The project form used to refuse to save a solo project without a name for
   "the other side". A trip, a house move or a wedding is paid to many
   vendors and has no single counterparty, so that guard blocked those
   projects outright. Activities keep the requirement: their whole balance
   sentence ("Rita to pay You") is built from the name and there is nothing
   sensible to print in its place.
   These checks pin BOTH halves — the one that was loosened and the one that
   must not be. */
section('Counterparty optional on projects, required on activities');

check('hasOther: named counterparty', hasOther({ counterparty: 'Joe' }), true);
check('hasOther: blank counterparty', hasOther({ counterparty: '' }), false);
check('hasOther: field absent', hasOther({ type: 'project', name: 'Rome trip' }), false);
check('hasOther: null item', hasOther(null), false);

// An unnamed PROJECT must never borrow its own name for a sentence — "Payment
// from Rome Trip" and "Between Rachel and Rome Trip" both read as nonsense.
check('unnamed pay project → neutral role word',
  otherName({ type: 'project', direction: 'pay', name: 'Rome trip' }), 'Provider');
check('unnamed earn project → neutral role word',
  otherName({ type: 'project', direction: 'earn', name: 'Logo job' }), 'Client');
check('named project still uses the name',
  otherName({ type: 'project', direction: 'pay', name: 'Kitchen', counterparty: 'Joe' }), 'Joe');
// Activities are unchanged: they always have a counterparty, and the old
// name fallback stays as the last line of defence for legacy data.
check('activity keeps its name fallback',
  otherName({ direction: 'pay', name: 'Pilates' }), 'Pilates');
check('activity with counterparty unchanged',
  otherName({ direction: 'pay', name: 'Pilates', counterparty: 'Rita' }), 'Rita');

// Source-level guards. Quote-agnostic on purpose: the minifier rewrites single
// quotes to double, so a regex hard-coded to ' passes on the readable master
// and matches nothing on the shipped file.
(function () {
  // Match on the TOAST STRINGS, not on local variable names: the minifier
  // renames locals (`counterparty` -> `o`), so a name-based regex passes on
  // the readable master and matches nothing on the shipped file. String
  // literals survive both.
  const projSave = extractFn('saveProjectForm');
  check('project form no longer refuses a blank counterparty',
    /enter who is on the other side/.test(projSave), false);
  check('project form still requires a name',
    /Please enter a name/.test(projSave), true);
  const actSave = extractFn('saveProject');   // legacy name: this is the ACTIVITY form
  check('activity form still refuses a blank counterparty',
    /enter who is on the other side/.test(actSave), true);
})();

// The solo-project WhatsApp summary must DROP the "Between X and Y" clause
// when there is no counterparty, not print a stand-in for it.
(function () {
  // 16 Sep 2026: showShareSummary became the three-way chooser and the text it
  // used to build moved into buildShareSummaryText. LATER THE SAME DAY the
  // one-sided figures moved again, out into soloFiguresBlock, so that the
  // INVITE message could call the very same code - see "The invite message no
  // longer calls a solo project a debt". Same two requirements, asserted
  // against the function that now holds the copy.
  const share = extractFn('soloFiguresBlock');
  check('share: the Between clause is guarded by hasOther',
    /hasOther\(p\)\)\s*\w+\+=.Between /.test(share), true);
  check('share: the paid line has an unnamed fallback',
    /hasOther\(p\)\?[^;]*Total spent/.test(share), true);
})();

// A received project payment must not default its note to "Payment from
// <project name>" when nobody is named.
(function () {
  const pay = extractFn('confirmProjectPay');
  check('project pay note falls back to a neutral phrase',
    /hasOther\(p\)\?[^;]*Payment received/.test(pay), true);
})();

/* ==========================================================================
   v100 - USER FEEDBACK, 16 Sep 2026
   ========================================================================== */

/* ---- v101 HOTFIX: REMOVING AN ELEMENT MEANS FIXING EVERY READER ----
   v100 deleted the Section select from the three creation forms and made the
   SAVE paths null-safe. It did not make the OPEN paths null-safe, and those run
   when the form is opened: sel.innerHTML on a null threw, the throw killed the
   open, and New Activity / New Project / New Lending Circle did NOTHING when
   tapped. New Section still worked because it is a different code path, which
   is what made the report look so strange.
   Behavioural: each function is run with a DOM that has no such element. */
section('The creation forms open with no Section select present');
(function () {
  const noDom = { getElementById: () => null };
  ['populateGroupSelect', 'populatePfGroupSelect', 'populateLfGroupSelect'].forEach((fn) => {
    const f = new Function('document', 'groups', 'esc',
      extractFn(fn) + '; return ' + fn + ';')(noDom, [], (x) => x);
    let threw = null;
    try { f(''); } catch (e) { threw = e.message; }
    check(fn + ': survives the select being gone', threw, 'null');
  });
  ['onGroupSelectChange', 'onPfGroupSelectChange', 'onLfGroupSelectChange'].forEach((fn) => {
    const f = new Function('document', 'showToast',
      extractFn(fn) + '; return ' + fn + ';')(noDom, () => {});
    let threw = null;
    try { f(); } catch (e) { threw = e.message; }
    check(fn + ': survives the select being gone', threw, 'null');
  });
  // Belt and braces: no reader of those ids may dereference without a guard.
  ['populateGroupSelect', 'populatePfGroupSelect', 'populateLfGroupSelect'].forEach((fn) => {
    check(fn + ': returns early when the element is missing',
      /if\(!\w+\)return/.test(extractFn(fn)), true);
  });
})();

/* ---- THE VIEWER SAW THE WRONG DASHBOARD (the one that mattered) ----
   A solo PAYING project shared as viewer rendered the EARNING dashboard on the
   viewer's phone: "Total Earned 0 / Spent 155 / Net Loss 155", where the owner
   correctly saw "Total Spent 155". _flipView is the design-section-10
   perspective flip, and it excluded group and lending but not `project`. A
   solo project is neither, and has no participants, so it flipped - and
   flipping isPay() inverts the project's DIRECTION.
   Behavioural, because the minifier renames every local in these functions. */
section('The perspective flip only applies where there are two sides');
(function () {
  const mk = (on) => new Function('sharingUnlocked',
    extractFn('_flipView') + '; return _flipView;')(() => on);
  const flip = mk(true);
  const viewer = (type) => ({ type, shared: true, ledgerId: 'lg1', role: 'viewer', participants: [] });

  check('a solo PROJECT never flips - direction belongs to the project',
    flip(viewer('project')), false);
  check('a one-to-one hourly activity does flip', flip(viewer('hourly')), true);
  check('daily flips', flip(viewer('daily')), true);
  check('fixed flips', flip(viewer('fixed')), true);
  check('customrate flips', flip(viewer('customrate')), true);
  check('group never flips', flip(viewer('group')), false);
  check('lending never flips', flip(viewer('lending')), false);
  check('an UNKNOWN type added later cannot inherit the flip',
    flip(viewer('somethingnew')), false);
  check('the owner never flips',
    flip(Object.assign(viewer('hourly'), { role: 'owner' })), false);
  check('a multi-participant item never flips',
    flip(Object.assign(viewer('hourly'), { participants: ['A', 'B'] })), false);
  check('nothing flips while sharing is off', mk(false)(viewer('hourly')), false);

  // And the consequence, which is what the user actually saw.
  const isPay = new Function('_flipView',
    extractFn('isPay') + '; return isPay;')(flip);
  const payingProject = viewer('project'); payingProject.direction = 'pay';
  check('a viewer of a paying project still gets the PAYING dashboard',
    isPay(payingProject), true);
  const earningProject = viewer('project'); earningProject.direction = 'earn';
  check('a viewer of an earning project still gets the EARNING dashboard',
    isPay(earningProject), false);
})();

/* ---- "I Paid" DID NOT READ AS A BUTTON ----
   The control is a solid full-width green button, so the styling was never the
   problem: "I Paid" is a statement about the past where every other action in
   the app is an instruction. Projects now use the app's own verb. Activities
   keep the first-person wording, because there it says which side of a
   two-person balance you are on. */
section('Project action buttons are instructions, not statements');
(function () {
  const label = new Function('isPay',
    extractFn('paidBtnLabel') + '; return paidBtnLabel;')((p) => p.direction !== 'earn');
  check('a paying project says Log Payment',
    label({ type: 'project', direction: 'pay' }), 'Log Payment');
  check('an earning project says Log Received Payment',
    label({ type: 'project', direction: 'earn' }), 'Log Received Payment');
  check('a paying activity says Log Payment', label({ type: 'hourly', direction: 'pay' }), 'Log Payment');
  check('an earning activity says Log Payment', label({ type: 'hourly', direction: 'earn' }), 'Log Payment');
  check('the counterparty sees the same Log Payment',
    label({ type: 'hourly', direction: 'pay' }, 'them'), 'Log Payment');
  check('v116: no Add Expense / Add Settlement buttons left',
    /> Add Expense<|['"] Add Settlement</.test(src), false);
  check('v116: Log Expense and Log Settlement',
    /> Log Expense</.test(src) && /['"] Log Settlement</.test(src), true);
  // The icon is the other half of the affordance: + is what the app uses for
  // "add one of these", and $ read as a currency label.
  check('the project button carries the add glyph',
    /btn-icon">＋<\/span> '\+esc\(paidBtnLabel/.test(src), true);
})();

/* ---- PARTICIPANTS ARE THE PEOPLE SHARING THE COST ----
   A user listed everyone who came on the outing, not everyone who was paying,
   and the split then came out wrong. */
section('Who to list as a participant');
(function () {
  /* v114 (Rachel, 23 Sep): the hint went; the label alone asks the question. */
  check('the extra hint is gone', /sharing the cost<\/b>/.test(src), false);
  // 16 Sep 2026, Rachel: the second sentence went. "no need for it" - the
  // first sentence is the whole instruction. This assertion is INVERTED on
  // purpose rather than deleted, so the sentence cannot quietly come back.
  check('it does not lecture about who came along',
    /someone who owes nothing does not belong here/.test(src), false);
  check('the vague old hint is gone',
    /Add everyone involved — including yourself/.test(src), false);
  check('the label asks the question directly',
    /Who is splitting the cost\?/.test(src), true);
})();

/* ---- SECTION IS NOT ASKED AT CREATION ----
   A user typed "Flights" into Section believing it was a category. Sections are
   a home-screen filing device; being asked before anything exists invites the
   mistake. The selects are REMOVED, not hidden, so there is no dead control. */
section('Sections are filed on the home screen, not asked at creation');
(function () {
  check('the activity form has no section select', /id="fGroup"/.test(src), false);
  check('the project form has no section select', /id="pfGroup"/.test(src), false);
  check('the lending form has no section select', /id="lfGroup"/.test(src), false);
  // The save paths must survive the element being gone, or creating anything
  // throws on a null .value.
  // saveProjectForm is the PROJECT form; saveProject is the ACTIVITY form.
  // The names do not match the screens, which is worth knowing before editing.
  ['saveProjectForm', 'saveProject', 'saveLendingCircle'].forEach((fn) => {
    const body = extractFn(fn);
    if (/getElementById\((['"])(pf|lf|f)Group\1\)/.test(body)) {
      // SHAPE, NOT NAME. The guard variable is a local, so the minifier renames
      // it: matching `_gSel?_gSel.value:` passed on the master and matched
      // nothing on the shipped file. \w+ matches whatever terser calls it.
      check(fn + ': reads the missing section select defensively',
        /\?\w+\.value:/.test(body), true);
    }
  });
  check('sections can still be created on the home screen',
    /New Section/.test(src) && /Create Section/.test(src), true);
})();

/* ---- THE SHARE BUTTON SENDS A MESSAGE. THAT IS ALL IT DOES ----
   (Rachel, 18 Sep 2026: "first the whatsapp share icon is only for sharing the
   balance as a text message, no ledger invitation. no three options anymore.
   it just prepares teh text message and thats it.")

   THE HISTORY OF THIS ONE BUTTON IS THE ARGUMENT FOR THE CHANGE. v98 made
   showShareSummary begin `if(sharingOn()){startInviteFlow();return}`, which
   left the text-only summary unreachable. v103 replaced that with
   showShareChoice, a chooser of three. v107 then had to route three MORE share
   buttons into that chooser, because each carried its own copy of the v98 line
   - the "four front doors" release. Every step answered the same question in
   the wrong place: a button that both sends a balance AND grants access has to
   ask which you meant, of everybody, every time.
   Inviting is its own button in the header now, so there is nothing to ask.
   These assertions pin the ABSENCE of the chooser as hard as the old ones
   pinned its contents - that is the point of the release. */
section('The share button sends the balance and nothing else');
(function () {
  const entry = extractFn('showShareSummary');
  check('the share button sends the balance text', /shareTextFor\(/.test(entry), true);
  check('it opens WhatsApp itself rather than a dialog',
    /openWhatsApp\(/.test(entry), true);
  check('it does not start an invite', /startInviteFlow/.test(entry), false);
  check('and there is no chooser left to open',
    /function showShareChoice/.test(src), false);
  /* THE WHOLE POINT: no route from any share control to an invite. Four
     buttons called some show*ShareSummary and v107 had to fix them one by one;
     a guard on all four is cheaper than remembering. */
  ['showGroupShareSummary', 'showLendingShareSummary', 'showActivityShareSummary'].forEach(function (fn) {
    const f = extractFn(fn);
    check(fn + ' goes through the one share function', /showShareSummary\(\)/.test(f), true);
    check('and ' + fn + ' does not start an invite',
      /startInviteFlow/.test(f), false);
  });
  /* Each type still sends its OWN text - a lending circle's summary is not a
     project's - so shareTextFor decides which one to build. */
  const dispatch = extractFn('shareTextFor');
  check('the balance text is chosen by tracker type',
    /buildLendingSummaryText\(/.test(dispatch) && /buildActivitySummaryText\(/.test(dispatch) &&
    /buildShareSummaryText\(/.test(dispatch), true);
  /* `text` is a local the minifier renames, so say the thing that matters:
     a BUILDER does not send. openWhatsApp is a function name and survives. */
  ['buildGroupSummaryText', 'buildLendingSummaryText', 'buildActivitySummaryText'].forEach(function (fn) {
    check(fn + ' builds the text and does not send it',
      /openWhatsApp\(/.test(extractFn(fn)), false);
  });
})();

/* ---- INVITE IS ITS OWN BUTTON, IN THE HEADER (Rachel, 18 Sep 2026) ----
   "on gthe other hand, we add an Invite button next to Edit and Remove on the
   top, so it will be Invite, Edit, Remove. when they click invite thats where
   they get to select viewer or editor, teh code gets generated." */
section('Invite is a header button next to Edit and Remove');
(function () {
  /* THE MARKUP, not a comment: three ids, one per detail screen. The lending
     screen's Edit and Remove had no ids at all until this release, which is
     exactly why applyRoleLockdown could never reach them. */
  ['projInviteBtn', 'detailInviteBtn', 'lendInviteBtn'].forEach(function (id) {
    check(id + ' is in the page header', new RegExp('id="' + id + '"').test(src), true);
  });
  check('the lending header gained ids so it can be locked down too',
    /id="lendEditBtn"/.test(src) && /id="lendRemoveBtn"/.test(src), true);
  /* ORDER MATTERS AND WAS ASKED FOR: "it will be Invite, Edit, Remove". */
  ['proj', 'detail', 'lend'].forEach(function (pre) {
    const i = src.indexOf('id="' + pre + 'InviteBtn"');
    const e = src.indexOf('id="' + pre + 'EditBtn"');
    const r = src.indexOf('id="' + pre + 'RemoveBtn"');
    check(pre + ': Invite comes before Edit, which comes before Remove',
      i > -1 && e > i && r > e, true);
  });
  /* v114 (Rachel, 23 Sep): a user read "Remove" as removing an invitee. */
  check('the tracker header says Delete, not Remove',
    (src.match(/onclick="archiveCurrentProject\(\)">Delete</g) || []).length === 3 &&
    !/onclick="archiveCurrentProject\(\)">Remove</.test(src), true);
  const lock = extractFn('applyRoleLockdown');
  check('all three invite buttons are driven from one place',
    /projInviteBtn/.test(lock) && /detailInviteBtn/.test(lock) && /lendInviteBtn/.test(lock), true);
  check('the label is set on every render, not once',
    /Manage Invites/.test(lock) && /hasInvitesOrMembers\(/.test(lock), true);
  /* OWNER ONLY. `admin` is a local the minifier renames, so read the flag back
     OUT of the function by the control that is known to use it, exactly as the
     viewer-lockdown assertions do. */
  const am = new RegExp('([\\w$]+)\\(' + Q + 'projEditBtn' + Q + ',([\\w$]+)\\)').exec(lock) || [];
  check('the invite button is gated on the same owner flag as Edit and Remove',
    !!(am[2] && new RegExp('=\\s*sharingOn\\(\\)&&' + am[2]).test(lock)), true);
  const open = extractFn('openInviteOrManage');
  check('tapping it invites when nobody has joined', /startInviteFlow\(\)/.test(open), true);
  check('and manages when somebody has', /showLedgerMembers\(\)/.test(open), true);
  check('which door opens is the same question the label answers',
    /hasInvitesOrMembers\(/.test(open), true);

  /* Having chosen the role up front, nobody should be asked for it again.
     `role` is a parameter and therefore renamed by the minifier, so these
     assert on the GLOBAL function names the branches call - those survive. */
  const flow = extractFn('startInviteFlow');
  check('a preselected role can go straight to creating the invite',
    /doCreateInvite\(/.test(flow), true);
  check('with no role preselected the role question is asked',
    /showInviteRolePick\(/.test(flow), true);
  const pick = extractFn('pickInviteParticipant');
  check('picking a participant can go straight to creating the invite',
    /doCreateInvite\(/.test(pick), true);
  /* AND THE ROLE PICKER KEEPS THE LIGHT BUTTONS. It is the invite flow itself
     now that the chooser is gone, so this is the screen a tap on Invite
     reaches - it must not go back to the two black slabs. */
  const rolePick = extractFn('showInviteRolePick');
  check('the role picker uses the light buttons',
    /share-choice-btn/.test(rolePick), true);
  check('and not the ink button', /dialog-btn-save/.test(rolePick), false);
  check('it still offers exactly the two capacities',
    /doCreateInvite\(\\?.viewer/.test(rolePick) && /doCreateInvite\(\\?.editor/.test(rolePick), true);
})();

/* ---- Category examples cover trips as well as builds (27 Aug 2026) ----
   The Categorize-expenses explainer only ever named building-site
   categories, which reads as a closed list to someone tracking a trip.
   16 Sep 2026: the explainer became a real tool, showCategorizeExpenses, and
   the examples moved into it. The 27 Aug requirement is unchanged and is
   asserted against the new home; a rental example was added alongside. */
section('Categorize is a tool, not a leaflet');
(function () {
  const hint = extractFn('showCategorizeExpenses');
  // v116 (Rachel, 24 Sep 2026): no introductory text, the dialog opens on the categories.
  check('categorize: no intro paragraph', /Pick a category or name a new one, tick/.test(hint), false);
  check('categorize: no example list', /Woodwork/.test(hint), false);
  check('category examples: Utilities dropped', /Utilities/.test(hint), false);
  check('category examples: Cleaning dropped', /Cleaning/.test(hint), false);

  // The whole point of the 16 Sep change: the dialog ASSIGNS, it does not just
  // describe. These are string literals, so they survive minification; the
  // old dead end is identified by its lone "Got it" acknowledgement.
  check('categorize: offers an assign action', /Assign to category/.test(hint), true);
  check('categorize: lists tickable transactions', /bulk-cat-cb/.test(hint), true);
  check('categorize: reuses the real category picker',
    /buildCategoryPicker/.test(hint), true);
  check('categorize: is no longer an acknowledge-only dialog',
    /Got it/.test(hint), false);
  check('categorize: refuses a viewer', /canWriteEntries/.test(hint), true);

  // doBulkCategorize must go through the shared guard rather than writing
  // directly, which is the mistake doEditProjectEntry made until 9 Sep.
  const bulk = extractFn('doBulkCategorize');
  check('bulk categorize: passes through requireEditRights',
    /requireEditRights/.test(bulk), true);
  check('bulk categorize: saves through db.saveProject so a ledger syncs',
    /db\.saveProject/.test(bulk), true);
})();

/* ---- Income is categorizable, and the two suggestion lists stay apart ----
   Rachel, 16 Sep 2026: "there's no logic in categorizing expenses but not
   categorizing revenue". Behavioural, not structural: the minifier renames
   every local in these functions, so the assertions run the code. */
section('Income categories');
(function () {
  const getUsedCategories = new Function(
    extractFn('getUsedCategories') + '; return getUsedCategories;')();
  const p = { history: [
    { type: 'charge',  costItem: 'Plumber' },
    { type: 'charge',  costItem: 'Bills' },
    { type: 'payment', costItem: 'Rent' },
    { type: 'payment', costItem: '' },
  ] };
  check('used categories: no filter returns both sides',
    getUsedCategories(p).join(','), 'Bills,Plumber,Rent');
  check('used categories: expense picker never offers an income category',
    getUsedCategories(p, 'charge').join(','), 'Bills,Plumber');
  check('used categories: income picker never offers an expense category',
    getUsedCategories(p, 'payment').join(','), 'Rent');

  // The edit dialog must build a picker for income too. 'editCostItem' and
  // 'payment' are string literals and survive the minifier; the local entry
  // variable does not, so it is deliberately not spelled here.
  const actions = extractFn('showProjectEntryActions');
  check('edit dialog: still wires the category field',
    /editCostItem/.test(actions), true);
  check('edit dialog: builds the picker for income as well as expenses',
    new RegExp(Q + 'payment' + Q).test(actions), true);

  // The add-income form must offer it too, or every income entry would have to
  // be saved and then edited to be categorized.
  const payInput = extractFn('showProjectPayInput');
  check('income form: offers a category picker',
    /projPayCat/.test(payInput) && /buildCategoryPicker/.test(payInput), true);
  const confirmPay = extractFn('confirmProjectPay');
  check('income form: saves the chosen category',
    /getCategoryValue\(/.test(confirmPay) && /projPayCat/.test(confirmPay), true);
})();

/* ---- uncategorizedEntries: income in, settlements out ---- */
(function () {
  const uncategorizedEntries = new Function(
    extractFn('uncategorizedEntries') + '; return uncategorizedEntries;')();
  const p = { history: [
    { id: 'a', type: 'charge',     amount: 10 },
    { id: 'b', type: 'payment',    amount: 20 },
    { id: 'c', type: 'charge',     amount: 30, costItem: 'Bills' },
    { id: 'd', type: 'settlement', amount: 40 },
  ] };
  check('uncategorized: picks up an untagged expense AND an untagged income',
    uncategorizedEntries(p).map(h => h.id).join(','), 'a,b');
  check('uncategorized: never offers a settlement a category',
    uncategorizedEntries(p).some(h => h.type === 'settlement'), false);
  check('uncategorized: empties once everything is tagged',
    uncategorizedEntries({ history: [{ type: 'charge', costItem: 'Bills' }] }).length, 0);
  // v116: in a group every payment is a Log Settlement, never categorizable.
  const grp = { participants: ['A', 'B'], history: [
    { id: 'e', type: 'charge', amount: 10, paidBy: 'A' },
    { id: 's', type: 'payment', amount: 5, from: 'B', to: 'A' },
    { id: 't', type: 'payment', amount: 5 } ] };
  check('uncategorized: a group offers only its expenses',
    uncategorizedEntries(grp).map(h => h.id).join(','), 'e');
  check('uncategorized: a from/to payment is a settlement anywhere',
    uncategorizedEntries({ history: [{ id: 'x', type: 'payment', from: 'A', to: 'B' }] }).length, 0);
})();

/* ---- v116 (Rachel, 24 Sep 2026): tracker Menu, Transaction History, Add a section ---- */
section('v116 tracker Menu and wording');
(function () {
  check('Transaction History, singular', /Transactions History/.test(src), false);
  ['projMenuItems', 'detailMenuItems', 'lendMenuItems'].forEach(function (id) {
    check(id + ' is opened from a header Menu button',
      new RegExp('showTrackerMenu\\([\'"]' + id + '[\'"]\\)[\'"]>Menu<').test(src), true);
  });
  check('nothing sits under History any more', /hist-tools/.test(src), false);
  const html = src.slice(src.indexOf('id="detailMenuItems"'), src.indexOf('</div>', src.indexOf('id="detailMenuItems"')));
  ['detailEditBtn', 'detailShareBtn', 'detailExportBtn', 'oneOffToggle', 'settleResetBtn', 'detailRemoveBtn'].forEach(function (id) {
    check('activity Menu holds ' + id, html.indexOf('id="' + id + '"') >= 0, true);
  });
  ['proj', 'detail', 'lend'].forEach(function (k) {
    const box = src.slice(src.indexOf('id="' + k + 'MenuItems"'), src.indexOf('</div>', src.indexOf('id="' + k + 'MenuItems"')));
    check(k + ': Edit and Delete live in the Menu',
      box.indexOf('id="' + k + 'EditBtn"') >= 0 && box.indexOf('id="' + k + 'RemoveBtn"') >= 0, true);
    check(k + ': Delete is set apart in red', /RemoveBtn" data-danger/.test(box), true);
  });
  check('the header no longer carries Edit or Delete', /header-act-btn[^>]*>(Edit|Delete)</.test(src), false);
  const menu = extractFn('showTrackerMenu');
  check('Menu honours what the role lockdown hid', /display!==.none./.test(menu), true);
  // v116 round 3: Clear All is gone; Settle All & Reset takes its place, Delete is red.
  check('no Clear All in any Menu', /id="?\w*ClearBtn/.test(src), false);
  check('Delete is drawn in red', /danger/.test(menu), true);
  const order = function (k) { const a = src.indexOf('id="' + k + 'MenuItems"');
    return (src.slice(a, src.indexOf('</div>', a)).match(/>([^<]+)<\/button>/g) || []).map(x => x.slice(1, -9)).join('|'); };
  check('project Menu order', order('proj'), 'Edit|Share Balance|Export|Settle All &amp; Reset|Delete');
  check('activity Menu order', order('detail'), 'Edit|Share Balance|Export|Add a one-off charge|Settle All &amp; Reset|Delete');
  // ---- round 4 (24 Sep 2026) ----
  check('no tagline under the logo', /The simple balance tracker<\/p>/.test(src), false);
  check('the payment box says Amount only', /Amount I (paid|received)/.test(src), false);
  const rpd4 = extractFn('renderProjectDetail');
  check('no Owes / Gets back wording left', /'Owes |'Gets back /.test(rpd4), false);
  const ppb = extractFn('perPersonBreakdownHtml');
  // 24 Sep 2026 (tester suggestion): one card per person; + owed back, - their share, = net.
  check('breakdown: one folding card per person, closed', /<details class="pp-table">/.test(ppb) && !/pp-table" open/.test(ppb), true);
  check('breakdown: the two folding rows', /Owed back to /.test(ppb) && /’s share /.test(ppb) && /pp-part/.test(ppb), true);
  check('breakdown: then the net', /Net to pay/.test(ppb) && /Net to receive/.test(ppb), true);
  check('breakdown: blue person icons', /\.pp-ico\{[^}]*#2f6fce/.test(src), true);
  // v127 (24 Sep 2026)
  check('home: Add a section is smaller', /\.nsb-title\{font-size:14px/.test(src), true);
  // Admin analytics (24 Sep 2026): the door is hidden for everyone else; the lock is on the server.
  check('admin: only the admin email opens analytics', /mabelrach9@gmail\.com/.test(src) && /isAnonymous/.test(extractFn('isAdminUser')), true);
  check('admin: the card is synced on Settings and on sign-in changes', /syncAdminCard\(\)/.test(extractFn('openSettings')) && /syncAdminCard\(\)/.test(extractFn('renderAuthCard')), true);
  check('admin: numbers come from the adminStats function', /httpsCallable\(.adminStats.\)/.test(src), true);
  check('admin: totals only, the screen never lists a user', !/email|displayName|\.name\b/.test(extractFn('adminStatsHtml')), true);
  check('shared badge survives a restart: the stub keeps memberCount', /memberCount:/.test(extractFn('stubOf')), true);
  check('every shared badge carries the people icon', (extractFn('roleChipHtml').match(/👥/g) || []).length >= 3, true);
  check('inside a tracker the same badge shows', /roleChipHtml\(/.test(extractFn('sharedMarkHtml')) && (src.match(/sharedMarkHtml\([\w$]+\)\+sharedStripHtml/g) || []).length === 3, true);
  const ppn = new Function('rd2', 'amtMain', 'entryShareOf', 'getEntriesSinceLastSettlement',
    extractFn('perPersonNet') + '; return perPersonNet;')(
    x => Math.round(x * 100) / 100, (p, h) => h.amount,
    (p, h, n) => { const a = h.splitAmong || p.participants; return a.indexOf(n) > -1 ? h.amount / a.length : 0; },
    p => p.history);
  const ski = { participants: ['R', 'S', 'D'], history: [
    { id: 'e1', type: 'charge', amount: 300, paidBy: 'R' }, { id: 'e2', type: 'charge', amount: 90, paidBy: 'S' },
    { id: 'e3', type: 'charge', amount: 60, paidBy: 'D' }, { id: 'e4', type: 'charge', amount: 45, paidBy: 'R' },
    { id: 'p1', type: 'payment', from: 'D', to: 'R', amount: 50 } ] };
  const rr = ppn(ski, 'R');
  check('net: R is owed back 230 (200 + 30)', rr.back, 230);
  check('net: R\'s share of the others is 50 (30 + 20)', rr.share, 50);
  check('net: R received 50', rr.setl, -50);
  check('net: R nets +130', rr.net, 130);
  check('net: S nets -75', ppn(ski, 'S').net, -75);
  check('net: D nets -55', ppn(ski, 'D').net, -55);
  check('breakdown: a folding table per payer, closed by default', /<details class="pp-table">/.test(ppb) && !/pp-table" open/.test(ppb), true);
  check('breakdown: tables are headed by the name, not "paid by you"', /Transactions paid by (you|.\+)/.test(ppb), false);
  check('breakdown: a person icon on every table and net card', (ppb.match(/[\w$]+\+\s*.<span class="pp-who">/g) || []).length >= 2 && /pp-ico/.test(ppb), true);
  check('breakdown: no "You" in place of a name', /'You'/.test(ppb), false);
  check('breakdown: someone who paid nothing still gets a card', /Nothing paid yet/.test(ppb) && !/if\(![\w$]+\.length\)return;/.test(ppb), true);
  // 24 Sep 2026 (tester): the create buttons must sit inside a frame. Light blue frame, white buttons, folds open by default.
  check('home: Create new is a light-blue frame again', /\.create-zone\{[^}]*rgba\(47,111,206,\.08\)/.test(src) && !/\.create-zone \.act-btn\{[^}]*#1d3557/.test(src), true);
  check('home: Create new folds and starts open', /toggleCreateZone\(/.test(extractFn('homeActionsHtml')) && /collapsedGroups\[.__create__.\]/.test(extractFn('homeActionsHtml')), true);
  check('settings: reminders are one switch and one line', /When turned on, you/.test(extractFn('renderNotifSettings')) && !/Remind me to log sessions/.test(extractFn('renderNotifSettings')) && !/_reminderTimingCopy\(\)/.test(extractFn('renderNotifSettings')), true);
  check('settings: the iPhone app draws the same', /When turned on, you/.test(extractFn('_renderNotifSettingsNative')), true);
  check('home: create icons keep their own tints again', /\.create-zone \.act-pic/.test(src) === false, true);
  check('home: an empty section says how to fill it', /Press and hold any tracker, then drag it here/.test(extractFn('renderProjects')), true);
  check('home: naming a new section shows the drag arrow', /maybeShowDragHint\(\)/.test(extractFn('commitRenameSection')) && /coachShow\(/.test(extractFn('maybeShowDragHint')), true);
  check('home: invite line breaks before Enter it here', /Got a code from someone\?<br>Enter it here/.test(src), true);
  check('no "Tap a person" hint', /Tap a person to see/.test(rpd4), false);
  check('no "Tap an entry to edit" hint', /Tap an entry to edit/.test(src), false);
  check('order: Categories, Per-Person Breakdown, then Fastest way', /Per-Person Breakdown.,[^;]*\)\+[\w$]+[;}]/.test(rpd4) && /Spending Categories.,[\s\S]*?projCategoryRollups.\)\.innerHTML=([\w$]+)\+/.test(rpd4), true);
  check('History starts open', /_histOpen\[[\w$]+\.id\]!==false/.test(extractFn('syncHistFold')), true);
  check('shared settle-up text says to pay', /' → '/.test(src), false);
  const pb = extractFn('showPersonBreakdown');
  check('person popup: one section per payer', /Transactions paid by /.test(pb) && /pb-sec/.test(pb), true);
  check('person popup: statuses', /Partially settled/.test(pb) && /Outstanding/.test(pb) && /Settled/.test(pb), true);
  check('person popup: net and plan', /Net to pay/.test(pb) && /Net to receive/.test(pb) && /Fastest way to settle up/.test(pb), true);
  check('person popup: no "Tap a section" hint', /Tap a section/.test(pb), false);
  const ppl = new Function('rd2', 'amtMain', 'entryShareOf', 'getEntriesSinceLastSettlement',
    extractFn('personPairLedger') + '; return personPairLedger;')(
    x => Math.round(x * 100) / 100, (p, h) => h.amount,
    (p, h, n) => { const a = h.splitAmong || p.participants; return a.indexOf(n) > -1 ? h.amount / a.length : 0; },
    p => p.history);
  const trip = { participants: ['R', 'S', 'L'], history: [
    { id: 'e1', type: 'charge', amount: 300, paidBy: 'R', date: '2026-09-19' },
    { id: 'e2', type: 'charge', amount: 90, paidBy: 'S', date: '2026-09-20' },
    { id: 'e3', type: 'charge', amount: 60, paidBy: 'L', date: '2026-09-21' },
    { id: 'p1', type: 'payment', from: 'L', to: 'R', amount: 50, date: '2026-09-22' } ] };
  const net = who => ppl(trip, who).reduce((t, x) => t + x.net, 0);
  check('pairs add up to the balance: R receives 100', net('R'), 100);
  check('pairs add up to the balance: S pays 60', net('S'), -60);
  check('pairs add up to the balance: L pays 40', net('L'), -40);
  const r = ppl(trip, 'R');
  check('R/S: S still owes 70 after the dinner cancels 30', r[0].net, 70);
  check('R/L: L owes 30 after the taxi and the 50 paid', r[1].net, 30);
  check('Sam\'s dinner is settled for R (cancelled out)', r[0].bItems[0].left, 0);
  check('the hotel is partly settled: 100 of 200 left', r[0].aItems[0].left + r[1].aItems[0].left, 100);
  const render = extractFn('renderProjects');
  check('Add a section waits for 3 trackers', /\.length>=3\|\|/.test(render), true);
})();

/* ---- Deleting an EXPENSE category must not blank an INCOME entry ----
   doRenameCategory has always filtered on type==='charge'; deleteCategory did
   not. Harmless while only expenses carried categories, and a silent data loss
   the moment income did: "Rent" exists on both sides of a rental. */
(function () {
  const del = extractFn('deleteCategory');
  check('delete category: filters to charges, so income keeps its category',
    new RegExp(Q + 'charge' + Q).test(del), true);
})();



/* ---- A settled group trip still knows what the trip cost (3 Sep 2026) ----
   "Settle All & Reset" settles the BALANCES; it does not un-spend the money.
   Every dashboard figure was scoped to entries since the last settlement, so a
   fully settled trip reported Total Expenses 0 and an empty category chart.
   dashHist() splits the two windows: whole trip for a group, current round for
   a 1-on-1 tracker (where a balance is the only thing a total can mean). */
section('Settled group trip still reports what the trip cost');
(function () {
  const dashHist = new Function('getEntriesSinceLastSettlement',
    extractFn('dashHist') + '; return dashHist;')(getEntriesSinceLastSettlement);
  const hasSettlement = new Function(extractFn('hasSettlement') + '; return hasSettlement;')();
  const sum = h => h.filter(x => x.type === 'charge').reduce((s, x) => s + x.amount, 0);

  const trip = {
    participants: ['Rachel', 'Sam'],
    history: [
      { id: 's1', type: 'settlement', amount: 20, date: '2026-08-10T10:00:00.000Z' },
      { id: 'e2', type: 'charge', amount: 40, paidBy: 'Sam',    date: '2026-08-09T10:00:00.000Z' },
      { id: 'e1', type: 'charge', amount: 80, paidBy: 'Rachel', date: '2026-08-08T10:00:00.000Z' }
    ]
  };

  check('group: the settle-up really does empty the current round',
    sum(getEntriesSinceLastSettlement(trip)), 0);
  check('group: but the dashboard still sees the whole trip', sum(dashHist(trip)), 120);
  check('1-on-1 tracker: unchanged — still the current round only',
    sum(dashHist({ history: trip.history })), 0);
  check('an unsettled trip: both windows agree', sum(dashHist({
    participants: ['A', 'B'],
    history: [{ id: 'x', type: 'charge', amount: 25, date: '2026-08-01T00:00:00.000Z' }]
  })), 25);
  check('hasSettlement: true once settled', hasSettlement(trip), true);
  check('hasSettlement: false before any settle-up',
    hasSettlement({ history: [{ type: 'charge' }] }), false);
  // v116 (Rachel, 24 Sep 2026): Outstanding removed, headline reads Total Paid.
  check('the group dashboard no longer shows Outstanding', /Outstanding<\/div>/.test(src), false);
  check('the group dashboard headline is Total Paid', /balance-label">Total Paid</.test(src), true);
  check('each person can see their own trip total', /Own share/.test(src), true);
})();

/* ---- The orange settlement line can now be removed (3 Sep 2026) ----
   Reported by Rachel: a settlement's figures could be reversed but the orange
   divider it left in the history log could not — the row had no tap target in
   any of the three detail views. Deleting one removes the whole batch, because
   Settle All & Reset writes one line per transfer and
   getEntriesSinceLastSettlement stops at the FIRST it finds. */
section('The orange settlement line can be deleted from the history log');
(function () {
  const settlementBatchIds = new Function(
    extractFn('settlementBatchIds') + '; return settlementBatchIds;')();
  const hist = [
    { id: 'a', type: 'settlement', amount: 30, date: '2026-08-10T10:00:00.000Z' },
    { id: 'b', type: 'settlement', amount: 20, date: '2026-08-10T10:00:00.000Z' },
    { id: 'c', type: 'charge',     amount: 50, date: '2026-08-09T10:00:00.000Z' },
    { id: 'd', type: 'settlement', amount: 10, date: '2026-05-01T10:00:00.000Z' }
  ];
  const p = { history: hist.slice() };
  check('one settle-up is one batch, however many lines it wrote',
    settlementBatchIds(p, 'a').sort().join(','), 'a,b');
  check('an older settle-up is a separate batch', settlementBatchIds(p, 'd').join(','), 'd');
  check('an expense is not a settlement', settlementBatchIds(p, 'c').length, 0);
  check('an unknown id is harmless', settlementBatchIds(p, 'zz').length, 0);

  const p2 = { history: hist.slice() };
  removeEntriesByIds(p2, settlementBatchIds(p2, 'a'));
  check('deleting it removes every orange line that settle-up drew',
    p2.history.filter(h => h.type === 'settlement' && h.date === '2026-08-10T10:00:00.000Z').length, 0);
  check('deleting it re-opens the round',
    getEntriesSinceLastSettlement(p2).filter(h => h.type === 'charge').length, 1);
  check('the settlement row is tappable in all three detail views',
    (src.split("showSettlementActions('").length - 1) >= 3, true);
})();

/* ---- The reminder says what it is FOR (real user feedback, 3 Sep 2026) ----
   A user read the session reminder as a reminder to GO to the session. It is a
   reminder to RECORD it (or mark it skipped). Say so where the reminder is set
   up, and again in the notification that arrives. */
section('Reminder copy says it is a nudge to log, not to attend');
(function () {
  /* v113: the callout became the label itself - a question, not a paragraph. */
  check('the activity form spells it out where the reminder is set up',
    /Which days should we remind you to log a session\?/.test(src) && /What time should we remind you\?/.test(src), true);
  check('and the long callout is gone', /never tells you to go/.test(src), false);
  check('the vague old hint is gone',
    /The app will prompt you on those days\./.test(src), false);
  check('the save-time nudge says log or skip',
    /to log the session or mark it skipped/.test(src), true);
  check('the home banner asks for a record, not attendance',
    /sessions to log/.test(src), true);
  check('settings says the same thing',
    /a reminder to record, not a reminder to attend/.test(src), true);

  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  check('the delivered notification itself asks you to log or skip',
    sw.indexOf('Tap to log it, or mark it skipped.') > -1, true);
  check('...and only when the server copy has not already said so',
    sw.indexOf('log it|log or skip|log the|record|skipped') > -1, true);
  // The backend's own single-activity body is "Open Tally to log or skip it."
  // If the guard does not recognise that phrasing the two stack up into a
  // duplicate sentence on the handset. Simulate the real payload.
  (function () {
    const guard = /log it|log or skip|log the|record|skipped/i;
    check('the real server body is left alone, not doubled',
      guard.test('Open Tally to log or skip it.'), true);
    check('a bare list of activity names still gets the ask',
      guard.test('Pilates, Tennis, Guitar'), false);
    const t = s => s.replace(/^Session today:/i, "Log today's session:")
                    .replace(/^(\d+) sessions scheduled today$/i, '$1 sessions to log today');
    check('the attendance-sounding title is rewritten',
      t('Session today: Pilates'), "Log today's session: Pilates");
    check('the plural title is rewritten too',
      t('3 sessions scheduled today'), '3 sessions to log today');
    check('an unrelated title is untouched', t('Tally'), 'Tally');
  })();
  check('the service worker rewrites the title, not just the body',
    sw.indexOf("Log today's session:") > -1, true);
})();

/* ---- A shared link lands on the right store (16 Sep 2026) ----------------
   BOTH HALVES OF THE HISTORY, because this has been reversed once already.
   Until 3 Sep the landing page sniffed the user agent and jumped to a store; it
   was turned OFF that day because a wrong guess dead-ended somebody on a store
   for a phone they do not own. On 16 Sep Rachel asked for it back - the menu
   made every recipient choose, and she does not want the browser offered.
   THE DIFFERENCE THIS TIME, and it is the whole reason it is safe: the jump
   happens only on a POSITIVE signal ("android" in the agent, or iOS with an App
   Store URL actually set). Nothing is inferred from an absence, so an
   unplaceable device is shown the page rather than sent somewhere.
   The behavioural assertions are in "/get/ sends a phone to its own store". */
section('Every message sends people to a store, never to the web');
(function () {
  /* THIRD AND LAST TIME THROUGH THIS (Rachel, 18 Sep 2026: "the whatsapp
     messages still have the web link, please remove that from everywhere, i
     only wnat users to the get the app form teh stores - remove it from
     everywhere, i thought we already removed that before").
     THE HISTORY, because the two earlier passes each did half the job. 16 Sep
     removed the PROSE "App Store, Google Play or web" and left the /get/ link.
     17 Sep added the two store addresses BEHIND that link, on the report that a
     reader "sees a web address and cannot tell there is an app at the end of
     it" - which was true and did not go far enough, because the web address was
     still the first thing in the message. Now there is no web address at all.
     /get/ IS STILL DEPLOYED and still routes by device: the Android build is a
     TWA that loads the web host, and links already sent in other people's chats
     have to keep working. It is only no longer advertised. */
  check('the prose listing destinations is still gone',
    /App Store, Google Play or web/.test(src), false);
  check('no message carries the /get/ web address any more',
    /web\.app\/Tally\/get/.test(src), false);
  check('and the constant that held it is gone with it',
    /const GET_TALLY_URL\s*=/.test(src), false);
  /* SHARE_HOST held the "Open it in Tally" deep link that buildMemberMessage
     sent to an existing member. Both went: the link was a web address, and the
     share button no longer starts an invite for anybody. The ?open= HANDLER
     stays - links already in other people's chats must keep working - so this
     asserts on the SENT STRING, not on the handler. */
  check('no message offers to open the ledger on the web',
    /Open it in Tally:/.test(src), false);
  check('and the host constant is gone', /const SHARE_HOST\s*=/.test(src), false);
  check('the deep-link handler is untouched, for links already sent',
    new RegExp('get\\(' + Q + 'open' + Q + '\\)').test(src), true);
  /* ONE FOOTER, NOT FOUR COPIES OF ONE. The tail used to be the same string
     written out in four places, which is how three of them keep an old link
     when the fourth is fixed. */
  check('the per-tracker footer is built in one place',
    (src.split('_Tracked with Tally').length - 1), 1);
  check('and every summary uses it',
    (src.split('appShareFooter()').length - 1) >= 5, true);
  /* THE APP STORE LINK IS FIRST, AND THAT IS LOAD-BEARING (Rachel, same day:
     "when the whatsapp message is shared, in prior version, the logo used to
     appear on top, now when i tried yesterday, the logo doesnt appear
     anymore"). WhatsApp draws its preview card - the logo at the top of the
     bubble - from the FIRST url in the text. apps.apple.com serves the app's
     own icon and name; /get/ never served an og:image at all, which is why the
     logo came and went. So the order of these two lines is a feature.
     Spell the QUOTE with Q - terser rewrites every single one as a double. */
  const footer = extractFn('appShareFooter');
  check('the footer carries both stores and nothing else',
    /APPSTORE_URL/.test(footer) && /PLAY_URL/.test(footer), true);
  /* 23 Sep 2026: PLAY FIRST. Apple's card says "by <seller>" and the seller
     is Rachel's own name; Play's card names AppBerry Studio. */
  check('Google Play comes first, so the preview card has the logo and not a personal name',
    footer.indexOf('PLAY_URL') > -1 && footer.indexOf('PLAY_URL') < footer.indexOf('APPSTORE_URL'), true);
  check('and no third link can get in front of them',
    (footer.match(/https?:\/\//g) || []).length, 0);
  const appMsg0 = extractFn('buildAppShareMessage');
  check('Tell a friend leads with Google Play too',
    appMsg0.indexOf('PLAY_URL') > -1 &&
    appMsg0.indexOf('PLAY_URL') < appMsg0.indexOf('APPSTORE_URL'), true);
  const inviteMsg0 = extractFn('buildInviteMessage');
  check('and so does the invite',
    inviteMsg0.indexOf('PLAY_URL') > -1 &&
    inviteMsg0.indexOf('PLAY_URL') < inviteMsg0.indexOf('APPSTORE_URL'), true);
  check('Tell a friend no longer advertises the browser version',
    /works in a browser too/.test(appMsg0), false);
  check('no footer still claims one link fits every device',
    /_Get Tally free \(any device\):_/.test(src), false);
  const getPage = fs.readFileSync(path.join(__dirname, '..', 'get', 'index.html'), 'utf8');
  check('the landing page offers Google Play',
    /play\.google\.com\/store\/apps/.test(getPage), true);
  check('the landing page still knows about the App Store', /App Store/.test(getPage), true);
  /* The PAGE may still mention the web app - it is the fallback for a desktop
     that has no store to be sent to. What changed is that no MESSAGE links
     here any more. */
  check('the web app is still reachable from it',
    /tally-app-c82c6\.web\.app\/Tally\//.test(getPage), true);
  check('the landing page routes by device again',
    /location\.replace\(/.test(getPage), true);
})();

/* ---- Creation forms are compact (3 Sep 2026) ---- */
section('New Activity / New Project forms pair short fields');
(function () {
  /* v113 (Rachel, 23 Sep): every row is label-left, field-right (.frow), so the form looks short. */
  check('rows put the label beside the field', /\.form-group\.frow\{display:flex/.test(src), true);
  check('billing type and currency each get a row',
    /class="form-group frow">\s*<label class="form-label">Billing type<\/label>\s*<select class="form-select" id="fType"/.test(src) &&
    /class="form-group frow">\s*<label class="form-label">Currency<\/label>\s*<select class="form-select" id="fCurrency"/.test(src), true);
  check('the project currency picker is a row too',
    /form-group frow"[^>]*id="pfSingleCurGroup"/.test(src), true);
  check('the week starts on Monday', /\[1,2,3,4,5,6,0\]\.map/.test(extractFn('renderDayChips')), true);
  check('Note is not marked optional', /Note <span/.test(src), false);
})();


/* ---- Ledger sharing (4 Sep 2026) ------------------------------------------
   The feature ships behind SHARING_ENABLED. These tests do two separate jobs:
   the first block proves the flag is OFF and that the app therefore behaves
   exactly as it did before, and the second re-evaluates the same functions in
   a sandbox where the flag is ON, so the sharing logic itself is covered
   before it is ever switched on for a real user. */
/* THE GATE CAME OFF ON 11 SEP 2026 (Rachel). Until then this block asserted the
   opposite of what it asserts now — that the allowlist held exactly eight named
   accounts and that everybody else was locked out. Sharing is now open to every
   signed-in account, so the thing worth protecting changed with it.

   THE PROPERTY THAT NEARLY DISAPPEARED WITHOUT ANYONE NOTICING. While the list
   had names in it, "a guest session is never unlocked" came free: a guest has
   no email, so the indexOf could never match, and the comment in index.html
   said as much. Emptying the list to open the rollout would have returned true
   for guests too — silently, with no test failing, because the test that
   covered it was written against the mechanism rather than the property. It is
   now asserted directly, and the empty-list branch says signed-in out loud. */
section('Sharing is open to every signed-in account, and to no guest');
(function () {
  const LIST = /SHARING_ALLOWED_ACCOUNTS\s*=\s*\[([^\]]*)\]/.exec(src)[1];
  const entries = (LIST.match(/['"][^'"]+['"]/g) || []).map(x => x.slice(1, -1));
  check('the allowlist is empty — sharing is open to everyone signed in',
    entries.length, 0);
  check('the feature itself is still on',
    /SHARING_ENABLED\s*=\s*(true|!0)/.test(src), true);
  check('a signed-in account is unlocked',
    (function () { const u = currentUser; currentUser = { uid: 'u1', email: 'anyone@example.com', isAnonymous: false };
      const r = sharingUnlocked(); currentUser = u; return r; })(), true);
  /* THE ONE THAT MATTERS. A shared group needs an account to hang permission
     on, so a guest must stay exactly where v92 left them. */
  check('a guest session is still locked out',
    (function () { const u = currentUser; currentUser = { uid: 'a1', isAnonymous: true };
      const r = sharingUnlocked(); currentUser = u; return r; })(), false);
  check('so is no session at all',
    (function () { const u = currentUser; currentUser = null;
      const r = sharingUnlocked(); currentUser = u; return r; })(), false);
  /* And the account with no email at all — a provider that hides it — is still
     let in, because the empty-list branch asks about the ACCOUNT, not the
     address. Written as a separate check because keying that branch on email
     was the tempting version of this change and would have failed here. */
  check('a signed-in account with no email address is still unlocked',
    (function () { const u = currentUser; currentUser = { uid: 'u2', isAnonymous: false };
      const r = sharingUnlocked(); currentUser = u; return r; })(), true);
  /* The rollback route, kept honest: putting addresses back must still gate. */
  check('putting addresses back would gate it again',
    /SHARING_ALLOWED_ACCOUNTS\.indexOf\(/.test(extractFn('sharingUnlocked')), true);
  check('a shared group flips nothing for a user who is not unlocked',
    _flipView({ shared: true, ledgerId: 'lg_1', role: 'viewer', type: 'fixed' }), false);
  check('an ordinary pay activity still reads as pay', isPay({ direction: 'pay' }), true);
  check('an ordinary earn activity still reads as earn', isPay({ direction: 'earn' }), false);
  check('a project with no direction still defaults to pay', isPay({ type: 'project' }), true);
})();

/* Re-evaluate the same source with the switch ON. */
var SH = (function () {
  const on = [
    'const SHARING_ENABLED=true;',
    'const SHARING_ALLOWED_ACCOUNTS=[];',   // unlocked, to exercise the logic itself
    // AND A SIGNED-IN ACCOUNT TO GO WITH IT (11 Sep 2026). An empty allowlist
    // is no longer sufficient on its own: since the gate came off, the empty
    // branch of sharingUnlocked asks whether anybody is signed in, so a sandbox
    // with no currentUser at all reads as a guest and every sharing check below
    // silently returns the unshared answer. Twelve tests failed as one when
    // this was missing, all of them in ways that looked like sharing bugs.
    'var currentUser={uid:"SANDBOX_UID",email:"sandbox@example.com",isAnonymous:false};',
    extractFn('sharingUnlocked'),
    extractConstLine('const LEDGER_ALPHABET='),
    extractConstLine('const LEDGER_LOCAL_KEYS='),
    'function showToast(){}',  // requireEditRights reports the refusal through it
    extractFn('_flipView'),
    extractFn('isPay'),
    extractFn('myName'),
    extractFn('hasOther'),
    extractFn('otherName'),
    extractFn('payerName'),
    extractFn('receiverName'),
    extractFn('paidBtnLabel'),
    extractFn('balLabel'),
    extractFn('isShared'),
    extractFn('ledgerRole'),
    extractFn('canEditLedger'),
    extractFn('isLedgerOwner'),
    extractFn('canAdminLedger'),
    extractFn('canWriteEntries'),
    extractFn('requireEditRights'),
    extractFn('entryRowAttrs'),
    extractFn('ledgerDataOf'),
    extractFn('stubOf'),
    extractFn('normalizeJoinCode'),
    extractFn('isWellFormedCode'),
    extractFn('_mts'),
    extractFn('mergeHistories'),
    extractFn('_projNewer'),
    extractFn('mergeProjectPair'),
    extractFn('reconcileLedgerHistory'),
    // The participant-slot answer (11 Sep 2026). _lgMeta is the members cache
    // the real app fills from a ledger snapshot; here it is an empty object a
    // test seeds through __setMeta, which is the only reason that setter exists.
    'var _lgMeta={};',
    'function __setMeta(id,m){_lgMeta[id]=m}',
    // ownerParticipantSlot reads settings.name, and the sandbox's settings is
    // fixed at 'Mike' for the one-to-one flip tests above. This lets a test say
    // who is signed in without disturbing them.
    'function __setName(n){settings.name=n}',
    extractFn('pendingInvites'),
    extractFn('_slotKey'),
    extractFn('ownerParticipantSlot'),
    extractFn('openParticipantSlots'),
    extractFn('invitableSlots'),
    'return {_flipView,isPay,otherName,payerName,receiverName,paidBtnLabel,balLabel,reconcileLedgerHistory,' +
    'isShared,ledgerRole,canEditLedger,isLedgerOwner,canAdminLedger,ledgerDataOf,stubOf,' +
    'canWriteEntries,requireEditRights,entryRowAttrs,__setMeta,__setName,' +
    'ownerParticipantSlot,openParticipantSlots,invitableSlots,' +
    'normalizeJoinCode,isWellFormedCode,mergeProjectPair};'
  ].join('\n');
  return new Function('settings', 'cur', 'rd2', on)({ name: 'Mike' }, function () { return '$'; }, function (n) { return n; });
})();

section('The coach sees his own side of a shared one-to-one ledger');
(function () {
  // Rachel owns "Tennis with Coach Mike", a PAY activity: she pays him.
  const asMike = { name: 'Tennis', type: 'fixed', direction: 'pay', counterparty: 'Coach Mike',
                   shared: true, ledgerId: 'lg_7chq2m', role: 'editor', ownerName: 'Rachel' };
  const asRachel = { name: 'Tennis', type: 'fixed', direction: 'pay', counterparty: 'Coach Mike',
                     shared: true, ledgerId: 'lg_7chq2m', role: 'owner', ownerName: 'Rachel' };
  check('the non-owner view is flipped', SH._flipView(asMike), true);
  check('the owner view is never flipped', SH._flipView(asRachel), false);
  check('to Mike the activity reads as earning', SH.isPay(asMike), false);
  check('to Rachel it still reads as paying', SH.isPay(asRachel), true);
  check('Mike sees Rachel as the payer', SH.payerName(asMike), 'Rachel');
  check('Mike sees himself as the receiver', SH.receiverName(asMike), 'Mike');
  check('Mike’s button reads "Log Payment" too', SH.paidBtnLabel(asMike), 'Log Payment');
  check('the other side is the ledger owner, not the typed counterparty',
    SH.otherName(asMike), 'Rachel');
  // A split has no "you" and "them", so a group is never flipped.
  check('a group project is not flipped',
    SH._flipView({ type: 'group', shared: true, ledgerId: 'lg_2', role: 'viewer' }), false);
  check('a project with participants is not flipped',
    SH._flipView({ type: 'project', participants: ['Sam', 'Ana'], shared: true, ledgerId: 'lg_3', role: 'viewer' }), false);
  check('a lending circle is not flipped',
    SH._flipView({ type: 'lending', shared: true, ledgerId: 'lg_4', role: 'viewer' }), false);
})();

section('What each role can do');
(function () {
  const mk = r => ({ shared: true, ledgerId: 'lg_1', role: r });
  check('a viewer cannot write', SH.canEditLedger(mk('viewer')), false);
  check('an editor can write', SH.canEditLedger(mk('editor')), true);
  check('an owner can write', SH.canEditLedger(mk('owner')), true);
  check('an editor is not an admin', SH.canAdminLedger(mk('editor')), false);
  check('an owner is an admin', SH.canAdminLedger(mk('owner')), true);
  check('an unshared tracker is always yours to admin', SH.canAdminLedger({ id: 'x' }), true);
  check('a missing role is treated as the least privilege', SH.ledgerRole(mk(undefined)), 'viewer');
})();

section('A shared item is a STUB in users/{uid}, never a second copy of the money');
(function () {
  const p = { id: 'k3f9a1', name: 'Tennis with Coach Mike', type: 'fixed', rate: 30,
              direction: 'pay', counterparty: 'Coach Mike', ledgerId: 'lg_7chq2m',
              role: 'owner', shared: true, ownerName: 'Rachel', groupId: 'g1',
              history: [{ id: 'e1', type: 'charge', amount: 30, date: '2026-09-01' }] };
  const stub = SH.stubOf(p);
  check('the stub carries no history', 'history' in stub, false);
  check('the stub carries no rate', 'rate' in stub, false);
  check('the stub keeps the name so an older client shows something',
    stub.name, 'Tennis with Coach Mike');
  check('the stub keeps the type', stub.type, 'fixed');
  check('the stub keeps the ledger id', stub.ledgerId, 'lg_7chq2m');
  check('the stub keeps the section it sits in', stub.groupId, 'g1');
  const data = SH.ledgerDataOf(p);
  check('the ledger data keeps the history', (data.history || []).length, 1);
  check('the ledger data keeps the rate', data.rate, 30);
  check('the ledger data carries no role', 'role' in data, false);
  check('the ledger data carries no ledger id', 'ledgerId' in data, false);
  check('the ledger data carries no membership', 'shared' in data, false);
})();

section('The sign-in merge must never resurrect a shared ledger');
(function () {
  // Two cloud copies of the same money is exactly what lets a stale one come
  // back. On a shared pair the merge keeps the stub and drops the history.
  const cloud = { id: 'k1', name: 'Paris Trip', shared: true, ledgerId: 'lg_9', role: 'owner',
                  updatedAt: '2026-09-03T10:00:00.000Z' };
  const local = { id: 'k1', name: 'Paris Trip', shared: true, ledgerId: 'lg_9', role: 'owner',
                  updatedAt: '2026-09-01T10:00:00.000Z',
                  history: [{ id: 'stale', type: 'charge', amount: 999, date: '2026-09-01' }] };
  const merged = SH.mergeProjectPair(cloud, local);
  check('a stale local history is not folded back into a shared item',
    'history' in merged, false);
  check('the stub itself survives the merge', merged.ledgerId, 'lg_9');
  // An ordinary tracker still merges entry by entry, exactly as before.
  const c2 = { id: 'k2', updatedAt: '2026-09-03T10:00:00.000Z',
               history: [{ id: 'a', type: 'charge', amount: 10, date: '2026-09-02' }] };
  const l2 = { id: 'k2', updatedAt: '2026-09-01T10:00:00.000Z',
               history: [{ id: 'b', type: 'charge', amount: 20, date: '2026-09-01' }] };
  check('an unshared tracker still unions its history', SH.mergeProjectPair(c2, l2).history.length, 2);
})();

section('Join codes');
(function () {
  const ALPHA = /LEDGER_ALPHABET\s*=\s*["']([A-Z0-9]+)["']/.exec(src)[1];
  check('the alphabet has 32 characters', ALPHA.length, 32);
  check('the alphabet excludes O and 0', /[O0]/.test(ALPHA), false);
  check('the alphabet excludes I and 1', /[I1]/.test(ALPHA), false);
  check('input is case-insensitive', SH.normalizeJoinCode('t7km2x'), 'T7KM2X');
  check('spaces and dashes are forgiven', SH.normalizeJoinCode(' t7-km 2x '), 'T7KM2X');
  check('a good code is accepted', SH.isWellFormedCode('T7KM2X'), true);
  check('a code containing 0 is rejected — it is not in the alphabet',
    SH.isWellFormedCode('T0KM2X'), false);
  check('a short code is rejected', SH.isWellFormedCode('T7KM2'), false);
  check('an empty code is rejected', SH.isWellFormedCode(''), false);
  check('codes expire after seven days', /INVITE_DAYS\s*=\s*7/.test(src), true);
})();

section('Sharing is always an invite, and it says what it is');
(function () {
  /* Rachel's copy, 9 Sep 2026. The message is matched on its LITERAL strings
     rather than on any function name, because the minifier renames names and
     leaves string literals alone — the lesson three v90 tests learned. */
  /* v114 (Rachel, 23 Sep): short and code-first; a tester almost missed the code. */
  check('the message opens as a person, not a notification',
    /invited you to /.test(extractFn('buildInviteMessage')), true);
  check('the invite carries no figures now',
    /inviteGroupBlock|inviteBalanceLine|inviteActivityLine/.test(extractFn('buildInviteMessage')), false);
  check('the code comes before the store links',
    extractFn('buildInviteMessage').indexOf('join code') < extractFn('buildInviteMessage').indexOf('PLAY_URL'), true);
  check('the message carries the balance, labelled', /📌 Current Balance: /.test(src), true);
  check('the balance is stamped as of today', /as of today\./.test(src), true);
  check('the message carries a join code', /Use the following join code: \*/.test(src), true);
  /* QUOTES ARE NOT PART OF THE CODE. terser rewrites every single-quoted
     string as double-quoted, so a check that spells the quote passes on the
     master and fails on the shipped file — which is the whole point of running
     this suite twice. Q matches either. */
  /* 16 Sep 2026: THE MESSAGE WAS SHORTENED, on user feedback that it was too
     long, and the "Already have Tally? Tap here to auto-fill your code" block
     was removed outright. It was the longest part of the message AND the
     autofill never actually happened, so it sent people looking for something
     that did not occur. These four assertions moved with the copy. */
  check('the code says how long it lasts and that it is single use',
    new RegExp('valid ' + Q + '\\+INVITE_DAYS\\+' + Q + ' days, one use').test(src), true);
  check('the invite no longer promises autofill it cannot deliver',
    /Tap here to auto-fill your code/.test(src), false);
  check('the message tells a new user where to type the code',
    /on the home screen and enter the code/.test(src), true);
  check('the message still points a new user at the download',
    /Get Tally free/.test(src), true);
  check('the invite is shorter: the two-route New\/Already split is gone',
    /New to Tally\?/.test(src), false);
  /* THIS ASSERTION CAUGHT ITSELF, WHICH IS THE OLDEST TRAP IN THIS PROJECT.
     It used to read `/\?open=/.test(src) === true`, for the "Open it in Tally"
     link buildMemberMessage sent to an existing member. That message went on
     18 Sep 2026 with every other web address - and the test still PASSED on
     the readable master, because the comment above the deep-link handler
     contains the characters "?open=". The minifier strips comments, so it
     failed on the shipped build and only there.
     MATCH THE CODE, NOT THE PROSE. The handler is what has to survive - links
     already sitting in other people's chats must keep working - and it survives
     as a call, which the minifier keeps. */
  check('the deep-link handler still reads an open= link somebody was sent',
    new RegExp('get\\(' + Q + 'open' + Q + '\\)').test(src), true);
  check('but no message builds one any more', /Open it in Tally:/.test(src), false);
  check('the entry screen exists', /Access Your Invites/.test(src), true);
  check('a viewer is told why, not shown a dead button',
    src.indexOf('a viewer') >= 0, true);
  /* THE ROLE STILL CHANGES THE SENTENCE. Rachel's template said "invited you to
     view your live balance" for every invite; an editor invite that reads
     exactly like a viewer invite is a promise the app then breaks. Agreed
     before it went in: the verb is the only thing that moves. */
  const rs = extractFn('roleSentence');
  check('an editor invite does not read like a viewer invite',
    new RegExp(Q + 'view and update' + Q).test(rs) && new RegExp(Q + 'editor' + Q).test(rs), true);
})();

/* ---- A viewer may not share the LEDGER (Rachel, 9 Sep 2026) ---------------
   This reverses the design's section 9 line "send the invite message: viewer ✓".
   The reason is the message itself: every share now carries the balance, and a
   person let in to look does not get to pass that on. An EDITOR keeps the
   button — they cannot mint a code, so all they can send is the balance plus an
   ?open= link only an existing member can use. */
section('A viewer cannot share the ledger, and is not left with nothing');
(function () {
  const lockdown = extractFn('applyRoleLockdown');
  /* Read the flag's name OUT of the function rather than spelling it, so this
     still means something on the minified build where it is called `e`. It has
     to be the SAME flag the write controls use, or "hidden" would be a
     different question from "read-only". */
  /* Both the local helper (`show`, mangled to a letter) and the flag it is
     handed are read back OUT of the function, so this means the same thing on
     the master and on the shipped file. Asserting the SAME flag matters: it is
     what makes "hidden" the same question as "read-only". */
  const lm = new RegExp('([\\w$]+)\\(' + Q + 'oneOffToggle' + Q + ',([\\w$]+)\\)').exec(lockdown) || [];
  const showFn = lm[1], ed = lm[2];
  check('the share controls are tied to the same read-only flag as the write controls',
    !!(showFn && ed), true);
  ['projShareBtn', 'detailShareBtn', 'detailWaShareBtn', 'lendShareBtn'].forEach(function (id) {
    check(id + ' is hidden from a viewer',
      new RegExp(showFn + '\\(' + Q + id + Q + ',' + ed + '\\)').test(lockdown), true);
  });
  const flow = extractFn('startInviteFlow');
  check('and the guard is behind the button too, not only in the CSS',
    /canWriteEntries\(/.test(flow), true);
  check('the refusal points them at the share they DO have',
    /share the app from Settings/.test(src), true);
  /* THE APP SHARE NAMES NO MONEY. That is the whole reason it is allowed. */
  const appMsg = extractFn('buildAppShareMessage');
  check('the app share exists', appMsg.length > 0, true);
  check('the app share carries no balance', /Current Balance|balance:/i.test(appMsg.replace(/live balance|the balance is/gi, '')), false);
  /* 18 Sep 2026: the smart /get/ link has gone from this message with all the
     others. Two store addresses, App Store first. */
  check('the app share offers the download',
    /Get it free/.test(appMsg), true);
  check('it names the two stores and nothing else',
    /APPSTORE_URL/.test(appMsg) && /PLAY_URL/.test(appMsg) &&
    !/GET_TALLY_URL/.test(appMsg), true);
  check('but still does not list destinations in prose',
    /App Store, Google Play or web/.test(appMsg), false);
  check('Settings offers it to every role', /onclick="shareTallyApp\(\)"/.test(src), true);
})();

/* ---- The owner can change access without throwing anyone out -------------- */
section('The owner can promote, demote or revoke a member');
(function () {
  const setRole = extractFn('setLedgerMemberRole');
  check('the role write exists', setRole.length > 0, true);
  check('it writes ONE field, not the whole members map',
    new RegExp('\\[' + Q + 'members\\.' + Q + '\\+[\\w$]+\\+' + Q + '\\.role' + Q + '\\]\\s*=').test(setRole), true);
  check('it refuses a role that is not editor or viewer',
    new RegExp('!==\\s*' + Q + 'editor' + Q + '\\s*&&\\s*[\\w$]+\\s*!==\\s*' + Q + 'viewer' + Q).test(setRole), true);
  /* The owner branch of the ledger rules is unfenced, so no rules change was
     needed — but the member must never be able to reach this. */
  const sheet = extractFn('showLedgerMembers');
  check('only the owner sees the controls', /isLedgerOwner\(/.test(sheet), true);
  /* THE OWNER'S ROW IS BUILT SEPARATELY AND CARRIES NO CONTROLS (18 Sep 2026).
     It used to be one loop over every member with a three-way guard inside it;
     the owner is now a row of its own above the loop, and the loop runs over
     everybody except the owner. Handing a ledger over is a different decision
     with its own flow in the account-deletion path. */
  check('the owner is a row of its own, and it says You',
    new RegExp(Q + 'You' + Q).test(sheet) && /role-chip role-owner">Owner/.test(sheet), true);
  check('and a guest still sees the owner named rather than "You"',
    /ownerName/.test(sheet), true);
  check('a member cannot be offered controls over themselves',
    /isMe/.test(sheet) || /\|\|\s*[\w$]+\)\s*return/.test(sheet), true);
  /* CAPACITY IN WORDS, NOT ROLE NAMES (Rachel: "their capacity whetrher
     view-only or edit rights"). "Viewer" and "Editor" are what the code calls
     them. */
  check('the capacity is named the way the owner thinks of it',
    /Edit rights/.test(sheet) && /View only/.test(sheet), true);
  check('a promotion is offered to a viewer', /Give edit rights/.test(sheet), true);
  check('a demotion is offered to an editor', /Make view only/.test(sheet), true);
  check('the dialog and the confirm that follows it use the SAME words',
    /Give edit rights/.test(extractFn('confirmChangeRole')) &&
    /Make view only/.test(extractFn('confirmChangeRole')), true);
  /* CANCEL INVITE, PER INVITEE (Rachel: "cancel invite is better coz its per
     invitee not for all"). The word "Revoke" is gone from both screens. */
  check('each invitee can be cancelled individually',
    /confirmRemoveMember\(/.test(sheet) && /Cancel invite/.test(sheet), true);
  check('and nothing says "Revoke" any more',
    /Revoke/.test(sheet) || /Revoke/.test(extractFn('confirmRemoveMember')), false);
  /* The member finds out by themselves: the snapshot handler already re-reads
     the role on every ledger update. If that line ever goes, a demoted editor
     keeps their buttons until they restart the app. */
  check('a role change reaches the member through the ledger snapshot',
    /\.role\s*=\s*[\w$]+\.role\s*\|\|\s*[\w$]+\.role/.test(extractFn('attachLedgerListener')), true);
})();

/* ---- The 9 Sep 2026 bug: a viewer could still EDIT an entry --------------
   addEntry, updateEntry and deleteEntry were all guarded. The three functions
   that actually save an edit were not: doEditEntry, doEditProjectEntry and
   doEditLendingEntry mutate the entry object and call db.saveProject directly,
   so updateEntry's guard was dead code and never ran. */
section('A viewer cannot edit an entry');
(function () {
  ['doEditEntry', 'doEditProjectEntry', 'doEditLendingEntry',
   'doClearAll', 'doDeleteSettlement', 'undoLastSettle'].forEach(function (fn) {
    check(fn + ' asks permission before it saves', /requireEditRights\(/.test(extractFn(fn)), true);
  });
  check('Settle All & Reset is owner-only, not merely editor-writable',
    /canAdminHere\(/.test(extractFn('doSettleReset')), true);
  /* updateEntry was never called by anything. It is still the right guard to
     keep, but it was not the one that mattered. */
  check('the guard is one function now, not three inline copies',
    (src.split('requireEditRights(').length - 1) >= 9, true);
  const mk = r => ({ shared: true, ledgerId: 'lg_1', role: r });
  check('a viewer may not write', SH.canWriteEntries(mk('viewer')), false);
  check('an editor may write', SH.canWriteEntries(mk('editor')), true);
  check('an owner may write', SH.canWriteEntries(mk('owner')), true);
  check('an UNSHARED tracker is always writable — it has no role at all',
    SH.canWriteEntries({ id: 'x' }), true);
  /* HIDDEN, NOT DISABLED (design section 9). A history row that opens an edit
     sheet a viewer cannot use is the same dead control the design rejected for
     the action buttons, so for a viewer the row stops being tappable. */
  check('a viewer\'s history row is not tappable',
    SH.entryRowAttrs(mk('viewer'), 'showEntryActions', 'e1'), '');
  check('an editor\'s history row still opens the sheet',
    /showEntryActions\('e1'\)/.test(SH.entryRowAttrs(mk('editor'), 'showEntryActions', 'e1')), true);
})();

/* ---- THE 11 SEPTEMBER 2026 REPORTS ----------------------------------------
   Four things Rachel found by sharing a real group with two real people, and
   each one is a different KIND of fault, which is why they are pinned together.

   Two of them are controls a non-owner could see. Both had guards behind them
   that worked — the write was always refused — so nothing was ever corrupted;
   what was wrong is that the app OFFERED an action it would then refuse, which
   design section 9 rejects as loudly as it rejects a missing guard.

   AND THE REASON BOTH SLIPPED THROUGH applyRoleLockdown. That function hides
   things two ways: a CSS selector over `.detail-actions`, and a list of element
   ids. The group screen's "Settle All & Reset" sits in a bare <div> outside
   `.detail-actions` and carries no id, so neither half could reach it — while
   #settleResetBtn, the OTHER settle control on the detail screen, was gated
   correctly and made the gating look done. The lesson is in the test below:
   assert that the button is not RENDERED, not that something hid it. */
section('A non-owner is not offered the owner-only controls (11 Sep 2026)');
(function () {
  const render = extractFn('renderProjectDetail');
  /* HOW THIS IS WRITTEN, AND WHY IT IS NOT WRITTEN THE OBVIOUS WAY. The first
     draft matched `canAdminHere(p))actionsHtml+=` on whitespace-stripped source
     and was green on the master and meaningless on the shipped file, because
     `actionsHtml` is a local and the minifier owns every local name. So the
     anchor is the BUTTON'S LABEL — a string literal, which survives — and the
     assertion is that a canAdminHere call sits close in front of it.
     `canAdminHere` itself is a top-level function name and is in the reserved
     list, so it survives too. */
  const guardsLabel = function (fnSrc, label, within) {
    const at = fnSrc.indexOf(label);
    if (at < 0) return 'label not found: ' + label;
    const before = fnSrc.slice(Math.max(0, at - (within || 300)), at);
    return /canAdminHere\(/.test(before) ? true : 'no admin guard within ' + (within || 300) + ' chars';
  };
  check('Settle All & Reset is not listed unless the viewer may admin',
    guardsLabel(render, 'projSettleBtn', 60) === 'no admin guard within 60 chars' &&
    /projSettleBtn[\s\S]{0,160}canAdminHere\(/.test(render), true);
  check('and it is no longer a button on the main screen', /btn-settle[^>]*showProjectSettleConfirm/.test(render), false);
  check('and it is the same predicate that refuses the write',
    /canAdminHere\(/.test(extractFn('doSettleReset')), true);
  /* Splitting costs / Just tracking rewrites what the group MEANS for every
     member at once, so it is owner-only too — not merely editor-writable. */
  // v118 (Rachel, 24 Sep 2026): the toggle and Set Budget left the screen; both are set in Edit.
  check('no Splitting / Just tracking toggle on the project screen', />Splitting costs</.test(render), false);
  check('no Set Budget link on the project screen', /showEditBudget\(/.test(render), false);
  check('toggleSettleMode still refuses a non-owner',
    /canAdminHere\(/.test(extractFn('toggleSettleMode')), true);
  check('the project form carries the budget', /id="pfBudget"/.test(src) && /pfBudget/.test(extractFn('saveProjectForm')), true);
  check('and still carries Split costs / Just track', /setPfSettle\(.track.\)/.test(src), true);
})();

/* ---- "Invite someone" with nobody left to invite -------------------------
   Rachel's group named three participants; two had joined and she held the
   third slot herself, and the button was still there. Behind it: a dialog of
   greyed-out names and no way forward.

   The visible fault was the button. The fault UNDER it was that the app could
   not tell the owner held a slot at all — ensureLedger wrote the owner's member
   record from settings.name, which lines up with a participant only by
   coincidence and was compared case-sensitively. Fixing only the button would
   have left a group where the owner's own name could be invited to. */
section('Every participant slot is accounted for, including the owner\'s');
(function () {
  const P = (parts, pend) => ({ id: 'p1', shared: true, ledgerId: 'L9', role: 'owner',
                                name: 'Ski trip', participants: parts,
                                pendingInvites: pend || [] });
  const members = (names) => {
    const m = {};
    names.forEach((n, i) => { m['u' + i] = { role: i ? 'editor' : 'owner', name: n }; });
    return { members: m };
  };
  const FUTURE = Date.now() + 86400000, PAST = Date.now() - 86400000;

  /* The owner's slot, matched case-insensitively but returned in the
     PARTICIPANT LIST's spelling — that spelling is what every comparison
     downstream is made against, so returning the profile's casing would put
     the original bug straight back. */
  SH.__setName('rachel');   // deliberately lower-case; the list is not
  check('the owner takes the participant slot that bears their name',
    SH.ownerParticipantSlot({ participants: ['Rachel', 'Sabine', 'Diana'] }), 'Rachel');
  check('the match ignores capitals but keeps the list\'s spelling',
    SH.ownerParticipantSlot({ participants: ['RACHEL', 'Sabine'] }), 'RACHEL');
  check('a name that is nobody\'s participant claims no slot',
    SH.ownerParticipantSlot({ participants: ['Sabine', 'Diana'] }), '');
  check('a one-to-one group names no participants and has no slot to take',
    SH.ownerParticipantSlot({ participants: [] }), '');
  SH.__setName('Mike');     // restore, so nothing after this sees 'rachel'

  /* null is not the same answer as [] and the difference is the whole point:
     a group that names nobody can always be invited into, a group whose names
     are all spoken for cannot. */
  check('a group with no named participants never runs out of slots',
    SH.openParticipantSlots(P([])), null);

  SH.__setMeta('L9', members(['Rachel']));
  check('with only the owner in, the other two are still open',
    SH.openParticipantSlots(P(['Rachel', 'Sabine', 'Diana'])).join(','), 'Sabine,Diana');

  SH.__setMeta('L9', members(['Rachel', 'Sabine', 'Diana']));
  check('once all three have joined, nobody is left to invite',
    SH.openParticipantSlots(P(['Rachel', 'Sabine', 'Diana'])).length, 0);

  /* AN INVITE THAT IS OUT HOLDS ITS SLOT. Without this the last name looked
     open right up until the moment it was accepted, which is how one slot
     used to end up with two live codes. */
  SH.__setMeta('L9', members(['Rachel']));
  check('an unaccepted invite holds the slot it was sent for',
    SH.openParticipantSlots(P(['Rachel', 'Sabine', 'Diana'],
      [{ code: 'AAA111', participant: 'Sabine', expiresAt: FUTURE }])).join(','), 'Diana');
  check('an EXPIRED invite releases it again',
    SH.openParticipantSlots(P(['Rachel', 'Sabine', 'Diana'],
      [{ code: 'AAA111', participant: 'Sabine', expiresAt: PAST }])).join(','), 'Sabine,Diana');
  check('a member joined under different capitals still fills the slot',
    SH.openParticipantSlots(Object.assign(P(['Rachel', 'sabine', 'Diana']), {})).join(','),
    'sabine,Diana');

  /* 23 Sep 2026: "a user shouldnt be able to invite himself". Before the
     group is shared there are no members, so only the recorded slot keeps the
     owner's own name out of the invite list. */
  SH.__setMeta('L9', { members: {} });
  SH.__setName('Rachel');
  check('before sharing, your own name is not offered for an invite',
    SH.openParticipantSlots(P(['Rachel', 'Sabine'])).join(','), 'Sabine');
  SH.__setName('Rachel Sawan');
  check('a recorded slot works when the list spells you differently',
    SH.openParticipantSlots(Object.assign(P(['Me', 'Sabine']), { ownerSlot: 'me' })).join(','), 'Sabine');
  check('and it returns the list\'s spelling',
    SH.ownerParticipantSlot({ participants: ['Me', 'Sabine'], ownerSlot: 'me' }), 'Me');
  check('"I\'m not one of them" claims no slot, even on a name match',
    SH.ownerParticipantSlot({ participants: ['Rachel Sawan', 'Sabine'], ownerSlotNone: true }), '');
  SH.__setName('Mike');
  check('the picker asks which one is you when it cannot tell',
    /showWhichIsYou\(/.test(extractFn('showInviteParticipantPick')), true);
  check('a new group starts with you in it',
    /pfParticipants=settings\.name\?\[settings\.name\]/.test(extractFn('openNewProjectForm')), true);
  check('and so does a new lending circle',
    /lfParticipants=settings\.name\?\[settings\.name\]/.test(extractFn('openNewLendingCircle')), true);

  /* And the screens that ask the question. Both must ASK it rather than count
     members themselves — counting members is what each of them used to do. */
  const sheet = extractFn('showLedgerMembers');
  check('the members sheet asks before offering Invite someone',
    /invitableSlots\(/.test(sheet), true);
  check('and says so plainly when there is nobody left',
    /has joined\./.test(sheet), true);
  check('the invite flow guards the same way behind the hidden button',
    /invitableSlots\(/.test(extractFn('startInviteFlow')), true);
  check('the participant picker marks an invited name differently from a joined one',
    /send a new code/.test(extractFn('showInviteParticipantPick')), true);

  /* 23 Sep 2026: "what if their code has expired and i need to issue a new
     code?" A code still out must not lock the name: re-inviting replaces it. */
  SH.__setMeta('L9', members(['Rachel']));
  SH.__setName('Rachel');
  check('A name with a code still out can be invited again',
    SH.invitableSlots(P(['Rachel', 'Sabine', 'Diana'],
      [{ code: 'AAA111', participant: 'Sabine', expiresAt: FUTURE }])).join(','), 'Sabine,Diana');
  SH.__setMeta('L9', members(['Rachel', 'Sabine']));
  check('but a name that has joined cannot',
    SH.invitableSlots(P(['Rachel', 'Sabine', 'Diana'])).join(','), 'Diana');
  SH.__setMeta('L9', { members: {} });
  check('and neither can your own',
    SH.invitableSlots(P(['Rachel', 'Sabine'])).join(','), 'Sabine');
  check('a group with no named participants is never full',
    SH.invitableSlots(P([])), null);
  SH.__setName('Mike');
  check('a waiting name in the picker is tappable and says a new code replaces the old',
    / · send a new code["']/.test(extractFn('showInviteParticipantPick')), true);
  check('re-inviting a name kills the code it was sent before',
    /revokeInviteCode\(/.test(extractFn('doCreateInvite')), true);
  check('no screen says "or been invited" any more',
    /or been invited/.test(src), false);
  check('the owner is bound to their slot at the moment the group is shared',
    /ownerParticipantSlot\(/.test(extractFn('ensureLedger')), true);
})();

/* ---- "Ledger" is not a word users should meet (Rachel, 11 Sep 2026) -------
   It stays everywhere in the CODE — it is the right name for the document, the
   listener and the cache, and renaming those would be churn with no reader.
   What changed is every string a user can read. This test is written against
   the rendered strings only, which is also why it can run on the minified
   build: string literals survive minification, local names do not. */
section('No screen says "ledger" to a user');
(function () {
  /* HOW THIS FINDS COPY WITHOUT PARSING JAVASCRIPT. Pulling string literals out
     with a regex worked on the readable master and produced nonsense on the
     shipped file — one long line, an apostrophe inside some label, and the
     quote-matching desynchronises for a thousand characters. So this does not
     try to find strings at all. It looks for `ledger` as a WHOLE WORD, which
     is the shape the word only ever has in prose:

       ledgerId, showLedgerMembers, canAdminLedger   — a word character follows
       or precedes, so \b does not match them at all, and no list is needed.
       'ledgers', 'ledger-gone', 'ledger-app-data'   — real standalone words in
       code, and the only ones, so they are named below.

     Comments are the one thing that can produce a false positive, and only on
     the readable master: terser strips them, so the shipped file has none. */
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(function (l) {
      const i = l.indexOf('//');
      /* Only strip // where nothing quoted precedes it, so a URL inside a
         string survives — and so the shipped file, whose single line always
         has a quote before its first //, is left entirely alone. */
      return (i >= 0 && !/['"]/.test(l.slice(0, i))) ? l.slice(0, i) : l;
    }).join('\n');
  const ALLOWED = /^(ledger-gone|ledger-app-data|ledger-timers|ledger-settings)$/;
  const offenders = [];
  const re = /[A-Za-z0-9_$]?ledger([A-Za-z0-9_$-]*)/gi;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (/[A-Za-z0-9_$]/.test(m[0][0])) continue;              // …Ledger… inside a name
    const word = ('ledger' + (m[1] || '')).toLowerCase();
    if (word !== 'ledger' && !ALLOWED.test(word)) continue;    // ledgerId, ledgers, …
    const ctx = code.slice(Math.max(0, m.index - 70), m.index + 70).replace(/\s+/g, ' ');
    if (ALLOWED.test(word)) continue;
    /* A console message is not a screen. Named one at a time on purpose, so a
       new one has to be looked at rather than pattern-matched away. */
    if (/handling on deletion failed|Ledger listen error|Ledger write failed|refused to empty a shared ledger/.test(ctx)) continue;
    offenders.push(ctx);
  }
  check('no user-facing string contains the word', offenders.join(' | '), '');
  /* The button that prompted it, and the two replacements most likely to be
     "corrected" back by someone reading the design document. */
  check('leaving says group', /Leave this group/.test(src), true);
  check('the viewer refusal says group', /you can't change this group|you can’t change this group/.test(src), true);
  check('the settle refusal says group', /can settle and reset this group/.test(src), true);
})();

section('Failures name the actual reason, never just "invalid code"');
(function () {
  check('expired', /has expired/.test(src), true);
  check('already used', /already been used/.test(src), true);
  check('withdrawn by the owner', /withdrawn by the person who sent it/.test(src), true);
  check('no such code', /No invite with that code/.test(src), true);
  check('already a member', /already a member of that group/.test(src), true);
})();

/* ---- The 4 Sep 2026 bug: a snapshot erased an unpushed entry --------------
   Reported from a real two-account test: an activity was shared, sessions were
   logged, and the joiner saw an empty ledger. The ledger document had
   history:[] and version:1 - no update had ever been written to it. Cause: the
   WRITE path merged by entry id but the READ path copied the server's history
   straight over local state, so an entry logged before its ledger write landed
   was erased in memory and left nothing dirty to retry. */
section('A ledger snapshot can never delete an entry this device still holds');
(function () {
  const e = (id, d) => ({ id: id, type: 'charge', amount: 25, date: d });
  // The reported case: server empty, this device holding two logged sessions.
  const kept = SH.reconcileLedgerHistory({ history: [] },
    [e('a', '2026-09-04'), e('b', '2026-09-03')]);
  check('two unpushed entries survive an empty snapshot', kept.length, 2);
  check('and they are the right ones', kept.map(h => h.id).sort().join(','), 'a,b');
  // The ordinary case: both sides have entries, union by id, no duplicates.
  const both = SH.reconcileLedgerHistory({ history: [e('a', '2026-09-04'), e('c', '2026-09-02')] },
    [e('a', '2026-09-04'), e('b', '2026-09-03')]);
  check('union by id, nothing duplicated', both.map(h => h.id).sort().join(','), 'a,b,c');
  // A deliberate deletion must NOT come back - that is what tombstones are for.
  const tombed = SH.reconcileLedgerHistory({ history: [], deletedIds: ['b'] },
    [e('a', '2026-09-04'), e('b', '2026-09-03')]);
  check('a deliberately deleted entry stays deleted',
    tombed.map(h => h.id).join(','), 'a');
  // The other direction: a snapshot carrying entries this device lacks.
  const fromServer = SH.reconcileLedgerHistory({ history: [e('x', '2026-09-05')] }, []);
  check('an entry that only the server has still arrives', fromServer.length, 1);
  // Nothing at all, from either side.
  check('empty on both sides stays empty',
    SH.reconcileLedgerHistory({}, undefined).length, 0);
})();

section('The data-loss guards have a per-ledger sibling');
(function () {
  check('a ledger write is a transaction', /runTransaction/.test(src), true);
  // The sharing write calls the SAME mergeHistories the sign-in merge uses.
  // Two merges with different rules is how the two sides start disagreeing.
  check('it reuses the one merge the app already has, not a second one',
    (src.split('mergeHistories(').length - 1) >= 3, true);
  check('no member may empty a non-empty ledger', /empty-history-refused/.test(src), true);
  check('a deletion is remembered, so the union cannot hand the entry back',
    /deletedIds/.test(src), true);
  check('nobody writes to a ledger before its first snapshot arrives',
    /_lgLoaded/.test(src), true);
  check('the read path merges instead of overwriting',
    /reconcileLedgerHistory\(/.test(src), true);
  check('account deletion asks what happens to shared trackers',
    /Pass to the longest-standing editor/.test(src), true);
  // Ledgers must be dealt with while the account still has permission to touch
  // them — once the auth user is gone, so is the permission.
  const _dd = extractAsyncFn('doDeleteAccount');
  check('shared ledgers are handled before anything is deleted',
    _dd.indexOf('handOverOwnedLedgers') >= 0 &&
    _dd.indexOf('handOverOwnedLedgers') < _dd.indexOf('.delete()'), true);
  check('handing over picks the longest-standing editor',
    /function longestStandingEditor/.test(src), true);
})();

section('A shared group message must say what the screen says');
/* THE BUG THIS PINS (10 Sep 2026). calcGroupSettlement filtered history on
   h.type==='expense'. The app writes 'charge' — everywhere, always — so the
   filter matched nothing, every balance came out 0, calcTransfers returned an
   empty list and every group WhatsApp message ever sent read "Total: 0" and
   "✅ All settled!". The screen was right the whole time, because
   renderProjectDetail and projNetBalances do their own sum on 'charge'.
   Rachel found it inviting Diana to a project with 2,011 outstanding.
   The test is deliberately written as an AGREEMENT between the message and
   the screen rather than as a fixed expected number: the failure mode was two
   implementations of one calculation drifting apart, so the assertion is that
   they cannot. */
(function () {
  FX = { base: 'USD', rates: { USD: 1 }, date: '' };
  // Rachel pays for everything; Diana and Sabine owe her their shares.
  const p = {
    id: 'g9', name: 'Beirut weekend', type: 'project',
    participants: ['Rachel', 'Diana', 'Sabine'], mainCur: 'USD',
    history: [
      { id: 'e1', type: 'charge', amount: 2000, paidBy: 'Rachel', date: '2026-09-02' },
      { id: 'e2', type: 'charge', amount: 1011, paidBy: 'Rachel', date: '2026-09-03' },
      { id: 'e3', type: 'payment', amount: 6, from: 'Diana', to: 'Rachel', date: '2026-09-04' }
    ]
  };
  const s = calcGroupSettlement(p);
  near('the trip total is the money actually spent', s.totalExpenses, 3011);
  check('it is not zero, which is what "all settled" was built on',
    s.totalExpenses > 0, true);
  // Every charge is split three ways: each owes 1003.67; Rachel paid 3011 and
  // Diana has already handed back 6.
  near('Rachel is owed the rest', s.balances.Rachel, 2001.33);
  near('Diana owes her share less what she has paid back', s.balances.Diana, -997.67);
  near('Sabine owes her full share', s.balances.Sabine, -1003.67);
  const msgTransfers = calcTransfers(s.balances);
  check('the message has somebody owing somebody', msgTransfers.length > 0, true);
  // THE REAL ASSERTION: the figures behind the message and the figures behind
  // the screen are the same figures.
  const screenTransfers = calcTransfers(projNetBalances(p));
  transfers('the message agrees with the project screen, transfer for transfer',
    msgTransfers, screenTransfers);
  const block = inviteGroupBlock(p);
  check('the invite does not claim the group is square',
    block.indexOf('All settled') >= 0, false);
  check('the invite names who owes whom', /Diana|Sabine/.test(block), true);
  check('the invite states what is still outstanding', /Outstanding/.test(block), true);
  // And when it really IS settled, it still says so.
  const even = {
    id: 'g10', name: 'Even', type: 'project', participants: ['Rachel', 'Diana'], mainCur: 'USD',
    history: [
      { id: 'f1', type: 'charge', amount: 100, paidBy: 'Rachel', date: '2026-09-02' },
      { id: 'f2', type: 'payment', amount: 50, from: 'Diana', to: 'Rachel', date: '2026-09-03' }
    ]
  };
  check('a genuinely settled group still reads as settled',
    inviteGroupBlock(even).indexOf('All settled') >= 0, true);
  check('and it still reports what the trip cost',
    calcGroupSettlement(even).totalExpenses, 100);
})();

section('Leaving is not the first thing a guest is offered');
/* Rachel, 10 Sep 2026: the strip across the top of a shared ledger carried a
   single Leave button, so the most prominent control a guest ever saw was the
   one that threw away their access. It moved into the members dialog, beside
   the owner's equivalent. These match on FUNCTION names inside string
   literals, which survive minification; local names would not. */
(function () {
  const strip = extractFn('sharedStripHtml');
  check('the strip no longer offers Leave', strip.indexOf('confirmLeaveLedger') >= 0, false);
  check('the strip opens the members dialog instead', strip.indexOf('showLedgerMembers') >= 0, true);
  const members = extractFn('showLedgerMembers');
  check('Leave is reachable from the members dialog', members.indexOf('confirmLeaveLedger') >= 0, true);
  /* `owner` is a local the minifier renames, so match the SHAPE: a negated
     one-token test, then the button, inside 300 characters. */
  check('and only a non-owner is offered it',
    /![\w$]+\s*\?[\s\S]{0,300}confirmLeaveLedger/.test(members), true);
  check('leaving still confirms before it happens', /function confirmLeaveLedger/.test(src), true);
})();

/* ---- AN INVITE NOBODY HAS ACCEPTED IS NOT SHOWN AT ALL (18 Sep 2026) ----
   Rachel: "after the code is generated, i dont want to show the user who was
   invited but did not accept. its not worth it. the user sees nothing until his
   invitee joins."
   THE VERSION THIS REPLACES SHOWED IT IN FOUR PLACES - a chip on the home card,
   a strip across the top of the tracker, a block in this dialog with the live
   join code printed in it, and a Remind button that resent the same code. All
   of it was accurate, and all of it was about a state the owner can do nothing
   useful about: they sent the message, they know they sent it, and no button
   here makes it get read. These assertions pin the absence, which is the
   release. */
section('A waiting invite shows no code, no Remind, no Send again');
(function () {
  const members = extractFn('showLedgerMembers');
  check('the dialog no longer lists outstanding invites',
    /livePendingInvites/.test(members), false);
  check('and that function is gone, not merely unused',
    /function livePendingInvites/.test(src), false);
  check('no join code is printed on screen', /Code <b>/.test(src), false);
  /* SCOPED TO THE FUNCTION, NOT THE FILE. The comments above showLedgerMembers
     say what was removed and name it; the minifier strips comments, so a
     whole-file search for those words would fail here and pass on the shipped
     build. extractFn starts at `function`, so the prose is not in `members`. */
  check('there is no Send again', /Send again/.test(members), false);
  check('there is no Remind in the dialog', /Remind/.test(members), false);
  check('and the Remind handler is gone from the app',
    /function resendInvite/.test(src), false);
  check('no Stop sharing button in the dialog', /Stop sharing/.test(members), false);
  check('and its dialog is gone from the app',
    /function confirmUnshare/.test(src) || /function doUnshare/.test(src), false);
  const chip = extractFn('roleChipHtml');
  check('the home card carries no "Invited" badge', /Invited/.test(chip), false);
  check('it badges an owner only once somebody else is counted',
    /memberCount/.test(chip) && /Shared/.test(chip), true);
  const strip = extractFn('sharedStripHtml');
  check('and an owner gets no strip at all',
    /isLedgerOwner\(p\)\)?\s*return\s*''|isLedgerOwner\(p\)\)return""/.test(strip) ||
    new RegExp('isLedgerOwner\\(p\\)\\)\\s*return\\s*' + Q + Q).test(strip), true);
  check('the guest strip survives, because it tells a guest something new',
    /Shared by /.test(strip), true);
  /* THE ONE SIGNAL THE OWNER GETS is the header button's wording, so the line
     it draws has to be "is somebody in", not "has a code been sent". */
  const has = extractFn('hasJoinedMembers');
  check('joined means somebody other than the owner is in members',
    /memberCount/.test(has), true);
  check('it does not count a code that was merely sent',
    /pendingInvites/.test(has), false);
  check('a member who has since LEFT still counts, or their row is unreachable',
    /joinedMembers/.test(has), true);
})();

/* ---- LEFT GROUP (Rachel, 18 Sep 2026) ------------------------------------
   "if an invitee has joined then left the ledger, the user sees Left Group next
   to that invitee's name."
   WHY IT IS THE OWNER'S OWN RECORD AND NOT A FIELD ON THE LEDGER: leaving is
   `leavingMyself()` in firestore.rules, which allows a member to change only
   members, memberUids, clientUpdatedAt and updatedAt AND requires their own uid
   to be absent from the new members map. A leaver therefore cannot write a
   tombstone anywhere in that document without a rules change published by hand
   in the console. The owner's ledger listener already sees every membership
   change, so the owner writes it down locally instead. */
section('An invitee who joined and left is still named, with Left Group');
(function () {
  check('the record is on the never-published list',
    extractConstLine('const LEDGER_LOCAL_KEYS=').indexOf('joinedMembers') >= 0, true);
  check('and it travels on the owner\'s own stub, across their devices',
    /joinedMembers/.test(extractFn('stubOf')), true);
  check('the snapshot handler is what maintains it',
    /recordJoinedMembers\(/.test(extractFn('attachLedgerListener')), true);
  const rec = extractFn('recordJoinedMembers');
  check('only the owner keeps it', /isLedgerOwner\(/.test(rec), true);
  check('somebody missing from the live members map is marked left',
    /left\s*=\s*(!0|true)/.test(rec), true);
  const members = extractFn('showLedgerMembers');
  check('the dialog reads it', /joinedMembers/.test(members), true);
  check('and writes Left Group beside the name', /Left Group/.test(members), true);
  check('in its own muted chip, not a third kind of access',
    /role-left/.test(members) && /\.role-left\{/.test(src), true);
  /* NO BUTTONS ON A LEFT ROW. The literal is one string, so the markup proves
     the row ends at the chip - there is nothing to cancel and no code to kill. */
  check('a Left Group row carries no controls',
    /role-left">Left Group<\/span><\/span><\/div>/.test(members), true);
  /* BEING SHOWN THE DOOR IS NOT LEAVING. doRemoveMember deletes the row rather
     than marking it, or the owner's own screen would tell them a lie. */
  const rm = extractAsyncFn('doRemoveMember');
  check('cancelling an invite deletes the row instead of marking it left',
    /delete [\w$]+\.joinedMembers\[/.test(rm), true);
  /* AND CANCELLING THE LAST ONE IS WHAT STOP SHARING USED TO BE (Rachel: "stop
     sharing button is not needed, because it can be done by user: cancel
     invite"). unshareLedger is unchanged, with the four guards added on 17 Sep
     after an unshare destroyed an activity - so this is a new CALLER, not new
     deletion code. */
  check('cancelling the last invitee folds the activity back',
    /unshareLedger\(/.test(rm), true);
  check('the confirm says so before it happens',
    /ordinary activity on your phone/.test(extractFn('confirmRemoveMember')), true);
  check('and "last one" is asked of the members map, not of memberCount',
    /_isLastOtherMember\(/.test(rm) && /function _isLastOtherMember/.test(src), true);
  check('unshareLedger itself still refuses to delete an unloaded ledger',
    /ledger-not-loaded/.test(extractAsyncFn('unshareLedger')), true);
})();

/* ---- A SENT INVITE IS SHOWN, AND CAN BE RECALLED (Rachel, 23 Sep 2026) ----
   "when an invite is sent, the user's screen is not switching from Invite to
   Manage Invites... the user cant see what happened and whats the status" and
   "recalling an invite is not working ... the user is not even seeing it".
   Reverses the 18 Sep "show nothing until they join" for the owner's dialog
   only. The code is still never printed. */
section('A sent invite shows as Waiting to join, and can be recalled');
(function () {
  const both = extractFn('hasInvitesOrMembers');
  check('the button counts a waiting invite as well as a member',
    /hasJoinedMembers\(/.test(both) && /waitingInvites\(/.test(both), true);
  const wait = extractFn('waitingInvites');
  check('waiting invites are the owner\'s own live codes', /pendingInvites\(/.test(wait) && /isLedgerOwner\(/.test(wait), true);
  check('a code the ledger says was used is not waiting', /joinCode/.test(wait), true);
  check('nor is a name that has joined', /_slotKey\(/.test(wait), true);
  check('used or withdrawn codes are pruned by asking the invite',
    /redeemedBy/.test(extractAsyncFn('pruneUsedInvites')) && /dropPendingInvite\(/.test(extractAsyncFn('pruneUsedInvites')), true);
  const members = extractFn('showLedgerMembers');
  check('the dialog lists waiting invites', /waitingInvites\(/.test(members) && /Waiting to join/.test(members), true);
  check('each one has Recall invite', /Recall invite/.test(members) && /confirmRecallInvite\(/.test(members), true);
  check('the waiting chip is styled', /\.role-waiting\{/.test(src), true);
  check('recall confirms first', /doRecallInvite\(/.test(extractFn('confirmRecallInvite')), true);
  const rc = extractAsyncFn('doRecallInvite');
  check('recall kills the code on the server', /revokeInviteCode\(/.test(rc), true);
  check('and forgets it on the phone', /dropPendingInvite\(/.test(rc), true);
  check('re-finding the group after the await, by id', /getProject\(/.test(rc.slice(rc.indexOf('revokeInviteCode'))), true);
  const create = extractAsyncFn('doCreateInvite');
  check('after sending, the screen moves to Manage Invites',
    create.indexOf('showLedgerMembers') > create.indexOf('createInviteCode'), true);
  check('ledger meta keeps the last used code', /joinCode:[\w$.]+\|\|/.test(src), true);
})();

section('Resharing supersedes the old code instead of running two');
/* Rachel's question, 10 Sep 2026: "if they reshare the new code, which code is
   active if both are still within the 7 days expiry?" Both were. Either could
   be redeemed, by anyone holding it — on a group project that meant a stranger
   could take a named participant's slot. The previous code is now revoked
   before the new one is handed over. */
(function () {
  const create = extractAsyncFn('doCreateInvite');
  check('the earlier invite is revoked', create.indexOf('revokeInviteCode') >= 0, true);
  check('it is revoked BEFORE the new code is minted',
    create.indexOf('revokeInviteCode') < create.indexOf('createInviteCode'), true);
  check('the superseded code is forgotten locally too', create.indexOf('dropPendingInvite') >= 0, true);
  check('revoking sets the flag the join path already checks',
    /revoked\s*:\s*!0|revoked\s*:\s*true/.test(extractAsyncFn('revokeInviteCode')), true);
  check('a revoked code is refused at redemption', /revoked[\s\S]{0,40}revoked/.test(extractAsyncFn('lookupInvite')), true);
})();

section('A live join code never leaves the owner');
/* pendingInvites holds unredeemed codes. Everything not in LEDGER_LOCAL_KEYS
   is copied into the ledger document, which every member reads — so leaving it
   off that list would publish the owner's codes to every viewer in the ledger,
   and a viewer passing a join code on is exactly what v96 closed. */
(function () {
  check('pendingInvites is on the never-share list',
    extractConstLine('const LEDGER_LOCAL_KEYS=').indexOf('pendingInvites') >= 0, true);
  const p = { id: 'k1', name: 'Trip', type: 'project', ledgerId: 'lg_9', role: 'owner',
              shared: true, history: [],
              pendingInvites: [{ code: 'T7KM2X', role: 'editor', participant: 'Diana',
                                 createdAt: 1, expiresAt: Date.now() + 86400000 }] };
  check('the ledger copy carries no codes', 'pendingInvites' in SH.ledgerDataOf(p), false);
  const stub = SH.stubOf(p);
  check('the owner’s own stub does carry them', (stub.pendingInvites || []).length, 1);
  const stale = SH.stubOf({ id: 'k2', name: 'Trip', ledgerId: 'lg_9', role: 'owner', shared: true,
    pendingInvites: [{ code: 'OLDCOD', role: 'viewer', participant: 'Sam', createdAt: 1, expiresAt: Date.now() - 1000 }] });
  check('an expired code is not carried forward', (stale.pendingInvites || []).length, 0);
})();

section('Per-Person Breakdown opens closed on a group project');
/* Rachel, 10 Sep 2026: five person cards sat open under Settle Up and pushed
   the history a screen and a half down. "Team", not "Member", because on a
   SHARED group project "member" already means someone with access to the
   ledger, which is a different set of people from the trip's participants. */
(function () {
  const rpd = extractFn('renderProjectDetail');
  check('the section is named Per-Person Breakdown', rpd.indexOf('Per-Person Breakdown') >= 0, true);
  check('the old always-open People heading is gone', rpd.indexOf('>People<') >= 0, false);
  // v116: every project section is drawn by projSectionHtml; Team starts closed.
  check('it is a control, not a label', /projSectionHtml\([\w$]+,.team./.test(rpd), true);
  check('the cards start hidden', /team:false/.test(src), true);
  check('the toggle exists and flips the state', /function togglePeopleDetails/.test(src), true);
  check('the collapsed state is not persisted to the project',
    extractFn('togglePeopleDetails').indexOf('saveProject') >= 0, false);
  check('the row still says how many people are in there',
    /.Per-Person Breakdown.,[\w$]+\.length/.test(rpd), true);
  check('Spending Categories heading', /.Spending Categories./.test(rpd), true);
  const sec = extractFn('projSectionHtml');
  check('sections share the History heading', /history-header/.test(sec) && /history-toggle/.test(sec) && /group-count/.test(sec), true);
  ['settle', 'cats'].forEach(function (k) {
    check(k + ' is a folding section', new RegExp('projSectionHtml\\([\\w$]+,.' + k + '.').test(rpd), true);
  });
  check('Settle up, Per-Person and Categories start closed (24 Sep)', /settle:false,team:false,cats:false/.test(src), true);
})();


/* ======================================================================
   v102 — THREE THINGS RACHEL REPORTED ON 16 SEP 2026, ONE OF THEM UGLY
   ====================================================================== */

section('The invite message no longer calls a solo project a debt');
/* THE REPORT, and it is the worst kind of bug because the number was right and
   the sentence was wrong. Rachel shares a project where SHE pays her interior
   designer. Sent as a plain WhatsApp summary it read correctly: "Rachel paid
   5,900 / Remaining to pay 600". Sent as a VIEWER or EDITOR invite — the same
   project, the same moment — it told the designer "you're owed 5,900", naming
   every penny she had already paid him as an outstanding debt.

   CAUSE: p.balance is charges minus payments. In an ACTIVITY that is a real
   two-sided debt. In a solo PROJECT a charge is money already spent and there
   are normally no payment entries at all, so the balance is just the running
   total spent. inviteBalanceLine called it a debt for every non-group type.
   Third bug in this family in two days (v98 guest unlock, v100 _flipView):
   A RULE THAT HOLDS FOR ACTIVITIES BEING APPLIED TO EVERYTHING THAT IS NOT A
   GROUP. The whitelist is the fix, as it was in v100.

   Behavioural, not textual: every local in these functions is renamed by the
   minifier, so the assertions run the real code. */
(function () {
  const FIG = extractFn('hasTwoSidedBalance') + ';' + extractFn('isGoalMode') + ';' +
              extractFn('figuresHeader') + ';' + extractFn('soloFiguresBlock') + ';';
  const DEPS = ['cur', 'projSym', 'getEntriesSinceLastSettlement', 'amtMain', 'rd2',
                'isPay', 'isMultiCur', 'hasOther', 'myName', 'otherName', 'payerName',
                'syncBalance', 'dashHist', 'calcTransfers'];
  const stubs = [
    () => '$', () => '$',
    (x) => x.history || [],
    (x, h) => h.amount,
    (n) => Math.round(n * 100) / 100,
    (x) => x.direction !== 'earn',
    () => false,
    (x) => !!x.counterparty,
    () => 'Rachel',
    (x) => x.counterparty || 'them',
    (x) => (x.direction !== 'earn') ? 'Rachel' : (x.counterparty || 'them'),
    (x) => { x.balance = (x.history || []).reduce((s, h) =>
               h.type === 'charge' ? s + h.amount : h.type === 'payment' ? s - h.amount : s, 0); },
    (x) => x.history || [],
    () => [],
  ];
  const build = (extra, ret) => new Function(...DEPS, FIG + extra + '; return ' + ret + ';')(...stubs);
  const inviteLine = build(extractFn('inviteBalanceLine'), 'inviteBalanceLine');
  /* buildShareSummaryText ends with the shared footer, so the sandbox needs it
     and the URLs it names - TWO of them since 18 Sep 2026, both stores, no web
     address. */
  const summary    = build(
    extractConstLine('const APPSTORE_URL=') +
    extractConstLine('const PLAY_URL=') + extractFn('appShareFooter') +
    extractFn('buildShareSummaryText'), 'buildShareSummaryText');
  const solo       = build('', 'soloFiguresBlock');

  // Rachel's own project, her own figures.
  const designer = () => ({ id: 'd1', name: 'Interior designer', type: 'project',
                            direction: 'pay', counterparty: 'Karim', budget: 6500,
                            participants: [], history: [{ type: 'charge', amount: 5900 }] });

  const line = inviteLine(designer());
  check('it does not tell him he is owed anything', /owed/.test(line), false);
  check('it does not name 5900 as a debt', /Balance: you/.test(line), false);
  check('it says who paid, and how much', line.indexOf('Rachel paid: $5900') >= 0, true);
  check('it carries the figure that matters', line.indexOf('Remaining to pay: $600') >= 0, true);
  check('it still names the budget', line.indexOf('Budget: $6500') >= 0, true);

  // THE GUARANTEE, not just the fix: the two messages carry the SAME block,
  // character for character, because they call the same function.
  check('the invite and the plain summary cannot disagree',
    summary(designer()).indexOf(solo(designer())) >= 0, true);
  check('and the plain summary still reads as it did',
    summary(designer()).indexOf('Remaining to pay: $600') >= 0, true);

  // AN ACTIVITY KEEPS THE DEBT SENTENCE — it is correct there, and this is the
  // half a whitelist is for.
  const tutor = { id: 't1', name: 'Tutor', type: 'fixed', direction: 'pay',
                  counterparty: 'Karim', participants: [],
                  history: [{ type: 'charge', amount: 1000 }, { type: 'payment', amount: 400 }] };
  const tline = inviteLine(tutor);
  check('an activity still states the balance', tline.indexOf('Current Balance') >= 0, true);
  check('an activity still says who is owed', tline.indexOf("you're owed $600") >= 0, true);

  // An earning solo project is one-sided too, from the other direction.
  const rental = { id: 'r1', name: 'Orea Rental', type: 'project', direction: 'earn',
                   participants: [], history: [{ type: 'charge', amount: 120 }] };
  check('an earning project is not a debt either',
    /Current Balance/.test(inviteLine(rental)), false);
  check('an earning project says what it billed',
    inviteLine(rental).indexOf('Total billed: $120') >= 0, true);

  // A group still hands off to the settle-up block.
  check('a group project still returns nothing here',
    inviteLine({ id: 'g1', type: 'group', participants: ['A', 'B'], history: [] }), '');
  check('a lending circle still returns nothing here',
    inviteLine({ id: 'l1', type: 'lending', participants: [], history: [] }), '');

  // THE WHITELIST ITSELF: only the four activity types have two sides.
  const two = new Function(extractFn('hasTwoSidedBalance') + '; return hasTwoSidedBalance;')();
  ['hourly', 'daily', 'fixed', 'customrate'].forEach((t) => {
    check(t + ' has two sides', two({ type: t, participants: [] }), true);
  });
  ['project', 'group', 'lending', 'something-new'].forEach((t) => {
    check(t + ' does not', two({ type: t, participants: [] }), false);
  });
  check('participants alone rule it out',
    two({ type: 'fixed', participants: ['A'] }), false);

  // ONE COPY OF THE WORDING, which is the structural half of the same promise.
  // COUNT THE STRING LITERAL, NOT THE WORDS. This file's own comments mention
  // the phrase, and the minifier strips comments - so a plain word count is 2
  // on the master and 1 on the shipped build, which is the exact shape of trap
  // that made the suite unrunnable for five days in September.
  check('"Remaining to pay" is written in exactly one place',
    (src.match(new RegExp(Q + 'Remaining to pay: ' + Q, 'g')) || []).length, 1);
  check('inviteBalanceLine defers to the shared block',
    extractFn('inviteBalanceLine').indexOf('soloFiguresBlock') >= 0, true);
  check('and asks the whitelist first',
    extractFn('inviteBalanceLine').indexOf('hasTwoSidedBalance') >= 0, true);
  check('buildShareSummaryText no longer keeps its own copy',
    extractFn('buildShareSummaryText').indexOf('Remaining to pay') >= 0, false);
})();

section('The share footers offer the two stores and nothing else');
/* THE THIRD AND LAST PASS AT ONE SENTENCE, and all three are worth keeping
   because each was a smaller version of the same mistake.
   16 Sep 2026, Rachel: "remove from the whatsapp message - app store, google
   play, or web. just stop at get tally free and put the link." The prose went
   and the /get/ link stayed.
   17 Sep: "the whatsapp message still shows the web link, not the store links."
   Both halves were true at once - /get/ really does redirect by device, AND a
   reader sees a web address with no sign there is an app behind it - so the two
   store URLs were added BEHIND the smart link.
   18 Sep: "the whatsapp messages still have the web link, please remove that
   from everywhere, i only wnat users to the get the app form teh stores... i
   thought we already removed that before." Adding the stores behind the web
   address did not remove the web address. There is now no web address in any
   message at all. */
(function () {
  check('no message lists the three destinations in prose',
    /App Store, Google Play or web/.test(src), false);
  /* ONE footer, not four copies of one string. */
  check('the per-tracker footer is written once',
    (src.match(/_Tracked with Tally/g) || []).length, 1);
  check('and every summary calls it',
    (src.match(/appShareFooter\(\)/g) || []).length >= 5, true);
  check('the tell-a-friend line still invites', /Get it free/.test(src), true);
  /* THE WEB ADDRESS IS GONE FROM THE WHOLE FILE, constant and all. The /get/
     PAGE is still deployed and still routes by device - the Android build is a
     TWA that loads the web host, and links already sent in other chats must
     keep working. It is simply never advertised. */
  check('the smart link appears nowhere in the app',
    (src.match(/Tally\/get\//g) || []).length, 0);
  check('and neither does the constant that held it',
    (src.match(/GET_TALLY_URL\s*=/g) || []).length, 0);
  check('and the stores are named after it',
    /apps\.apple\.com\/app\/id6798780882/.test(src) &&
    /play\.google\.com\/store\/apps\/details\?id=io\.github\.tallytracker\.twa/.test(src), true);
})();

section('The participants hint is one sentence');
/* Rachel, 16 Sep 2026: the second sentence went. The first one is the whole
   instruction; the second was explaining a joke. */
(function () {
  check('the hint is gone (v114, Rachel)', /Only the people <b>sharing the cost<\/b>/.test(src), false);
  check('the lecture goes', /came along/.test(src), false);
})();

section('/get/ sends a phone to its own store');
/* Rachel, 16 Sep 2026: "why is the link not taking the user directly to the
   relevant store?" Because it was turned off on 3 Sep, at her request, after a
   wrong guess dead-ended someone. It is back, but only on a POSITIVE signal:
   Android in the user agent, or iOS with an App Store URL actually set.
   Anything unplaceable is shown the page instead of being sent somewhere. */
(function () {
  const get = (function () {
    const p = path.join(__dirname, '..', 'get', 'index.html');
    try { return fs.readFileSync(p, 'utf8'); }
    catch (e) { throw new Error('Could not read get/index.html at ' + p); }
  })();
  check('Android is routed by a positive match', /android\s*=\s*\/android\/i\.test\(ua\)/.test(get), true);
  check('it redirects rather than linking', /location\.replace\(info\.target\)/.test(get), true);
  check('back does not bounce them here again', /location\.assign/.test(get), false);
  check('Android goes to Play', /info\.target\s*=\s*PLAY/.test(get), true);
  check('iOS goes to the store only once a URL exists', /ios\s*&&\s*APPSTORE/.test(get), true);
  /* 16 Sep 2026: THE APP STORE URL IS IN. Tally has been live on the App Store
     since 28 Aug 2026 (id 6798780882); this constant sat empty for three weeks
     because the handover notes wrongly said the app had never been submitted.
     These assertions are what stops that happening again in either direction. */
  check('the App Store URL is set', /var APPSTORE\s*=\s*'https:/.test(get), true);
  check('it is the right listing', get.indexOf('id6798780882') >= 0, true);
  /* NO STOREFRONT IN THE URL. Apple's share sheet copies a country-specific
     link (hers was /lb/, the Lebanese store). This link is forwarded through
     WhatsApp to people with any Apple ID, and a storefront-specific link is a
     dead end for all of them, so it must stay storefront-neutral.
     SCOPE THIS TO THE ASSIGNMENT, not the file: the comment beside it quotes
     the /lb/ link as the example of what not to use, and a whole-file search
     therefore matches the warning and calls it the bug. */
  const appstoreLine = (get.match(/var APPSTORE\s*=\s*'[^']*'/) || [''])[0];
  check('the App Store link carries no country code',
    /apps\.apple\.com\/(?!app\/)/.test(appstoreLine), false);
  check('and it is the storefront-neutral form',
    /apps\.apple\.com\/app\/id\d+'$/.test(appstoreLine), true);
  check('so iPhone now redirects rather than seeing the panel',
    /ios && APPSTORE/.test(get), true);
  check('the installed app is never thrown out to Play', /display-mode: standalone/.test(get), true);
  check('there is a way to look at the page itself', /stay=1/.test(get), true);
  check('an unplaceable device is shown a page, not guessed at', /vOther/.test(get), true);
  check('the iPhone panel says how to keep it', /Add to Home Screen/.test(get), true);
  check('the host note survived the rewrite', /per-origin|PER-ORIGIN/.test(get), true);
  check('the Play id is unchanged', get.indexOf('io.github.tallytracker.twa') >= 0, true);
})();


/* ======================================================================
   v103 — TWO THINGS RACHEL ASKED FOR ON 16 SEP 2026
   ====================================================================== */

section('The capacity picker looks like the rest of the app');
/* Rachel, 16 Sep 2026: "dont make them in black. keep them light in color like
   the rest of the app." They were .dialog-btn-save, the dark --btn-neutral
   "ink" button meant for the ONE confirming action in a dialog; stacked, they
   read as black slabs. They are a menu, not a confirmation.
   18 SEP 2026: the three-option chooser this was written for is gone - the
   share button just sends the balance now - so the class belongs to
   showInviteRolePick, which IS the invite flow the header button opens. The
   style assertions matter more than before, not less: this is the screen every
   invite goes through. */
(function () {
  const chooser = extractFn('showInviteRolePick');
  check('both capacities use the light chooser style',
    (chooser.match(/class="share-choice-btn"/g) || []).length, 2);
  check('neither is an ink button', /dialog-btn-save/.test(chooser), false);
  check('Cancel is still the outlined button', /dialog-btn-cancel/.test(chooser), true);
  /* THE STYLE ITSELF, or the class name would be an empty promise. Card
     background and a border, exactly like the home screen's action buttons —
     and --card flips with the theme, so this is right in dark mode too. */
  const rule = (src.match(/\.share-choice-btn\{[^}]*\}/) || [''])[0];
  check('the chooser style exists', rule.length > 0, true);
  check('it takes the card background', /background:var\(--card\)/.test(rule), true);
  check('it is bordered, not filled', /border:1\.5px solid var\(--border\)/.test(rule), true);
  check('it does not reach for the ink colour', /btn-neutral/.test(rule), false);
  /* AND .dialog-btn-save IS UNTOUCHED. Every other dialog in the app still
     depends on it; the fix was a new class, not a repaint of that one. */
  check('the ink button is still the ink button for everything else',
    /\.dialog-btn-save\{[^}]*background:var\(--btn-neutral\)/.test(src), true);
})();

section('Sections are edited where they are');
/* Rachel, 16 Sep 2026, on making sections "more intuitive": remove the
   "+ Section" button from the home screen, remove the per-section totals,
   replace the "⋯" menu with a remove and an add icon, and rename a section by
   tapping its name. */
(function () {
  const render = extractFn('renderProjects');
  const actions = extractFn('homeActionsHtml');

  /* ---- what went ---- */
  check('the home screen no longer offers a Section button',
    /act-badge slate/.test(actions), false);
  check('and does not call the New Section dialog from there',
    /openNewGroup/.test(actions), false);
  check('the per-section total is gone', /group-total/.test(src), false);
  check('so is the signed roll-up that fed it', /totalSigned/.test(src), false);
  check('but per-card figures still use userSignedValue',
    /function userSignedValue/.test(src), true);
  /* MATCH THE MARKUP, NOT THE CHARACTER. The comment above this control in
     index.html names the "⋯" it replaced, and the minifier strips comments - so
     a bare search for the glyph fails on the readable master and passes on the
     shipped build. The old button rendered as >⋯</button>. This caught itself. */
  check('the "⋯" menu is gone', />⋯</.test(render), false);
  check('the Edit Section dialog is gone with it',
    /function editGroup/.test(src), false);
  check('and its Save handler', /function saveEditGroup/.test(src), false);
  check('and its Delete handler', /function deleteGroup/.test(src), false);

  /* ---- what arrived, as revised on 17 Sep 2026 ----
     The ＋ and − pair is gone. Rachel: "i am not sure if the + and - on the
     right of the section labels are clear... then maybe instead of the + we can
     put arrows up and down to reorder sections?" They were not clear, and for
     a findable reason: ＋ and − side by side read as one action in two
     directions, when one INSERTED A SECTION and the other DELETED ONE. ↑ ↓ is
     that pair used honestly, and adding moved to one button below the list. */
  const hdr = extractFn('sectionHeaderHtml');
  check('a remove control on each section', /removeSection\(/.test(hdr), true);
  check('and it is a bin, not a minus', /M3 6h18/.test(hdr), true);
  check('the section can be moved up', /moveSectionUp\(/.test(hdr), true);
  check('and down', /moveSectionDown\(/.test(hdr), true);
  /* MATCH THE MARKUP, NOT THE PARAMETER. `o.first` is a local the minifier
     renames; the word it writes into the HTML is not. */
  check('the arrow that would do nothing is disabled, not hidden',
    (hdr.match(/disabled/g) || []).length >= 2, true);
  check('the name itself renames', /startRenameSection\(/.test(hdr), true);
  check('adding a section below a section is gone',
    /function addSectionAfter/.test(src), false);
  /* ONE WAY IN, AND IT DOES NOT DEPEND ON ALREADY HAVING A SECTION. The old ＋
     on the ungrouped header existed only because the other ＋ lived on a
     section header; one button under the list answers both cases. */
  check('and a single way in, below the list',
    /addSectionAtEnd\(\)/.test(render), true);
  check('which does not hang off the ungrouped header any more',
    /ungrouped-head/.test(render), false);

  /* ---- "Other" is drawn by the SAME function as a real section ----
     Rachel, 17 Sep 2026: "it looks different in terms of formatting, make it
     look exactly like the other sections". It was 11px with 2px tracking, no
     chevron and no count, against 13px/1.5px with both. */
  check('one builder draws every section header',
    (render.match(/sectionHeaderHtml\(/g) || []).length, 2);
  /* ---- THE LABEL IS ONE WORD (Rachel, 18 Sep 2026: 'the section label
     "Other Activities" make it just "Other"'). The old label named the wrong
     thing twice over: the block holds projects and lending circles too, and it
     sat against section names that are one or two words.
     ASSERTED OVER THE WHOLE FILE, which is only safe because the phrase was
     taken out of the COMMENTS as well - the minifier strips comments, so a
     comment still quoting it would fail here and pass on the shipped build. */
  check('the ungrouped block is labelled just "Other"',
    new RegExp(Q + 'Other' + Q).test(render), true);
  check('and the old two-word label is nowhere in the app',
    /Other Activities/.test(src), false);
  check('the removal toast uses the same word as the heading',
    /to Other/.test(extractFn('removeSection')), true);
  check('someone with no sections at all still sees "Your trackers"',
    /Your trackers/.test(render), true);
  check('the ungrouped block collapses like the rest',
    /__ungrouped__/.test(render), true);
  check('and carries its count', (render.match(/count:/g) || []).length >= 2, true);
  /* terser rewrites `false` as `!1`, so accept either. */
  check('but is not renameable, moveable or removable',
    /editable:(false|!1)/.test(render), true);

  /* ---- the chevron is a real tap target (17 Sep 2026) ---- */
  check('the chevron is its own button', /class="group-chevron/.test(hdr) && /<button class="group-chevron/.test(hdr), true);
  /* TALL AND NARROW, revised the same day: 38px square pushed the label away
     from the control that collapses it. Rachel: "give the arrow more height so
     its visible, and bring the label close to it". */
  /* v113 (Rachel, 23 Sep): a filled 30px accent circle with an SVG arrow, so it reads as "opens". */
  check('and it is big enough to see and hit',
    /\.group-chevron\{width:30px;height:30px/.test(src), true);
  check('drawn as a filled circle in the accent colour', /\.group-chevron\{[^}]*background:var\(--accent-light\)[^}]*color:var\(--accent\)/.test(src), true);
  check('with the arrow drawn, not typed', /CHEV_SVG/.test(hdr), true);
  check('the rotation is on an inner span so the hit area does not rotate',
    /\.group-chevron i\{/.test(src) && /\.group-chevron\.open i\{transform:rotate\(90deg\)\}/.test(src), true);

  /* ---- the collapse toggle must not swallow the controls ----
     The whole header row is onclick=toggleGroup, so every control inside it
     has to stop the event or renaming a section also folds it shut. */
  ['startRenameSection', 'removeSection', 'moveSectionUp', 'moveSectionDown'].forEach((fn) => {
    const at = hdr.indexOf(fn);
    check(fn + ' stops the click reaching the collapse toggle',
      at > -1 && hdr.lastIndexOf('event.stopPropagation()', at) > hdr.lastIndexOf('onclick', at) - 40, true);
  });

  /* ---- the first section is still reachable for someone with no sections ---- */
  check('the New Section dialog survives for the empty-state nudge',
    /function openNewGroup/.test(src) && /Create Section/.test(src), true);

  /* ---- "OTHER" IS A ROW IN THE ORDER, NOT A FOOTER (Rachel, 18 Sep 2026) ---
     "when someone adds a new section, dont let it jump before Other, becaus
     ethe user will be confused with the jump, the new section should come
     after Other, the user can then move it up with the arrow."
     The ungrouped block used to be drawn after EVERY section unconditionally,
     so a section appended to `groups` appeared above it - a heading the user
     had just created jumped over the block they were looking at. renderProjects
     now draws groups.slice(0,cut), then Other, then groups.slice(cut). */
  check('the sections above Other are drawn first',
    /groups\.slice\(0,\s*[\w$]+\)/.test(render), true);
  check('and the ones below it after',
    /groups\.slice\([\w$]+\)/.test(render), true);
  check('the boundary is asked for, not assumed',
    /otherCutIndex\(\)/.test(render), true);
  /* THE ARROWS FOLLOW THE ROWS, NOT THE ARRAY. `noUp`/`noDown` replaced
     `first`/`last` because "first in groups" stopped being the same question as
     "top of the screen": the last section ABOVE Other can still go down (it
     crosses Other) and the first section BELOW it can still go up even when it
     is groups[0]. */
  check('the header is told what it may do, not where it sits',
    /noUp:/.test(render) && /noDown:/.test(render), true);
  check('and it no longer reasons about array position itself',
    /o\.first|o\.last/.test(hdr), false);
  check('the Other block itself gets no arrows and no bin',
    /editable:(false|!1)/.test(render), true);
})();

section('Adding, removing, renaming and undoing a section');
/* BEHAVIOURAL. Every local in these functions is renamed by the minifier, so
   the assertions run the real code against a fake DOM and real arrays. The
   functions are declared inside one generated scope so that `groups = ...`
   reassignment inside removeSection is visible to the assertions - which is
   the whole reason this is not five separate extractFn calls. */
(function () {
  const build = (state) => {
    let n = 0;
    const toast = { innerHTML: '', style: {}, classList: { add() {}, remove() {} } };
    const input = { value: '', dataset: {}, focus() {}, select() {} };
    const D = {
      document: {
        getElementById: (id) => (id === 'toast' ? toast : id === 'secRenameInput' ? (D._input || null) : null),
        querySelector: () => null,
      },
      db: { saveCollapsedGroups() {} },
      save() {}, showToast: (m) => D._toasts.push(m),
      renderHome() {}, renderProjects() {},
      genId: () => 'new' + (++n),
      esc: (s) => String(s),
      startRenameSection: (gid) => { D._renameStartedOn = gid; },
      _toasts: [], _input: null, _renameStartedOn: null, _toastEl: toast, _mkInput: () => input,
    };
    const api = new Function('st', 'D',
      'var groups=st.groups, projects=st.projects, collapsedGroups=st.collapsedGroups;' +
      'var _sectionUndo=null;' +
      'var document=D.document, db=D.db, save=D.save, showToast=D.showToast,' +
      '    renderHome=D.renderHome, renderProjects=D.renderProjects, genId=D.genId,' +
      '    esc=D.esc, startRenameSection=D.startRenameSection;' +
      'function getGroup(id){return groups.find(function(g){return g.id===id})}' +
      'function getProject(id){return projects.find(function(p){return p.id===id})}' +
      /* THE BOUNDARY HELPERS ARE PART OF THE UNIT UNDER TEST (18 Sep 2026).
         otherCutIndex and homeHasUngrouped are what decide which side of the
         "Other" block a section renders on, and homeHasUngrouped reads
         `projects` - which the sandbox already provides, because removeSection
         has always needed it. They are deliberately written with no free
         variables for exactly this reason. */
      extractFn('otherCutIndex') + ';' +
      extractFn('homeHasUngrouped') + ';' +
      extractFn('_setSectionBelow') + ';' +
      extractFn('newSectionName') + ';' +
      extractFn('showSectionUndoToast') + ';' +
      extractFn('removeSection') + ';' +
      extractFn('undoRemoveSection') + ';' +
      extractFn('moveSection') + ';' +
      extractFn('moveSectionUp') + ';' +
      extractFn('moveSectionDown') + ';' +
      extractFn('addSectionAtEnd') + ';' +
      extractFn('commitRenameSection') + ';' +
      'return {' +
      ' removeSection:removeSection, undoRemoveSection:undoRemoveSection,' +
      ' moveSectionUp:moveSectionUp, moveSectionDown:moveSectionDown,' +
      ' addSectionAtEnd:addSectionAtEnd,' +
      ' commitRenameSection:commitRenameSection,' +
      ' cut:otherCutIndex,' +
      /* WHAT THE HOME SCREEN ACTUALLY DRAWS, in order, with "Other" as a row
         of its own - which is the whole point of the release. renderProjects
         walks groups.slice(0,cut), then the Other block if anything is in it,
         then groups.slice(cut); this is that, and nothing else, so a test can
         read the screen rather than the flags. */
      ' rows:function(){var c=otherCutIndex();var r=groups.slice(0,c).map(function(g){return g.name});' +
      '   if(homeHasUngrouped())r.push("Other");' +
      '   return r.concat(groups.slice(c).map(function(g){return g.name}))},' +
      ' names:function(){return groups.map(function(g){return g.name})},' +
      ' count:function(){return groups.length},' +
      ' orphans:function(){return projects.filter(function(p){return !p.groupId}).map(function(p){return p.id}).sort()},' +
      ' members:function(gid){return projects.filter(function(p){return p.groupId===gid}).map(function(p){return p.id}).sort()},' +
      ' collapsedOf:function(gid){return !!collapsedGroups[gid]}}'
    )(state, D);
    api.D = D;
    return api;
  };
  const fresh = () => ({
    groups: [{ id: 'gA', name: 'Work' }, { id: 'gB', name: 'Leisure' }],
    projects: [
      { id: 'p1', groupId: 'gA' }, { id: 'p2', groupId: 'gA' },
      { id: 'p3', groupId: 'gB' }, { id: 'p4', groupId: null },
    ],
    collapsedGroups: { gA: true },
  });

  /* ---- ADD appends, and position is chosen afterwards (17 Sep 2026) ---- */
  const c = build(fresh());
  c.addSectionAtEnd();
  check('a new section lands at the end', c.names(), ['Work', 'Leisure', 'New section']);
  check('it starts empty', c.members('new1'), []);
  check('and opens for renaming straight away', c.D._renameStartedOn, 'new1');

  /* ---- MOVE is a swap, and it moves nothing but the section ---- */
  const m = build(fresh());
  m.moveSectionDown('gA');
  check('down swaps with the one below', m.names(), ['Leisure', 'Work']);
  check('the activities in it did not move', m.members('gA'), ['p1', 'p2']);
  check('nor did anyone else\'s', m.members('gB'), ['p3']);
  check('nor did the ungrouped one', m.orphans(), ['p4']);
  m.moveSectionUp('gA');
  check('and up puts it back', m.names(), ['Work', 'Leisure']);
  /* The arrows that would fall off the end are disabled in the header; these
     are the backstop behind them. */
  m.moveSectionUp('gA');
  check('up from the top does nothing', m.names(), ['Work', 'Leisure']);
  m.moveSectionDown('gB');
  check('down from the bottom does nothing', m.names(), ['Work', 'Leisure']);
  m.moveSectionUp('nope');
  check('and an unknown id does nothing at all', m.names(), ['Work', 'Leisure']);
  /* Collapsed state belongs to the section, not to its slot. */
  const m2 = build(fresh());
  m2.moveSectionDown('gA');
  check('a collapsed section stays collapsed after moving', m2.collapsedOf('gA'), true);
  check('and the other stays open', m2.collapsedOf('gB'), false);

  /* ---- REMOVE takes the section, never its contents ---- */
  const d = build(fresh());
  d.removeSection('gA');
  check('the section is gone', d.names(), ['Leisure']);
  check('its items are ungrouped, not deleted', d.orphans(), ['p1', 'p2', 'p4']);
  check('nothing else moved', d.members('gB'), ['p3']);
  check('undo is offered', /undoRemoveSection/.test(d.D._toastEl.innerHTML), true);
  check('and the toast says what moved, by the label on screen',
    /2 items moved to Other/.test(d.D._toastEl.innerHTML), true);
  d.undoRemoveSection();
  check('undo puts it back in the same position', d.names(), ['Work', 'Leisure']);
  check('with the same members', d.members('gA'), ['p1', 'p2']);
  check('and remembers it was collapsed', d.collapsedOf('gA'), true);
  check('leaving the genuinely loose item loose', d.orphans(), ['p4']);

  /* Removing the LAST section, and an empty one. */
  const e = build({ groups: [{ id: 'gZ', name: 'Only' }], projects: [{ id: 'p9', groupId: null }], collapsedGroups: {} });
  e.removeSection('gZ');
  check('removing the only section is fine', e.count(), 0);
  check('an empty section says so rather than counting nothing',
    /it was empty/.test(e.D._toastEl.innerHTML), true);
  e.undoRemoveSection();
  check('and it comes back', e.names(), ['Only']);
  /* Undo twice must not duplicate it. */
  e.undoRemoveSection();
  check('undo is not repeatable', e.names(), ['Only']);
  /* Removing an id that is not there does nothing at all. */
  const f = build(fresh());
  f.removeSection('ghost');
  check('removing an unknown section is a no-op', f.names(), ['Work', 'Leisure']);

  /* ---- RENAME ---- */
  const g = build(fresh());
  g.D._input = { value: '  Work & Clients  ', dataset: {} };
  g.commitRenameSection('gA');
  check('a new name is trimmed and kept', g.names(), ['Work & Clients', 'Leisure']);
  check('and it says so once', g.D._toasts.filter((t) => /renamed/.test(t)).length, 1);
  /* THE DOUBLE-COMMIT THIS GUARDS AGAINST: Enter commits and re-renders, which
     detaches the input, and the browser may then fire blur on the detached
     node. The guard lives on the element, not in a module-level flag, because
     this very suite extracts these functions one at a time - a top-level var
     would be an undefined free variable in here. */
  g.commitRenameSection('gA');
  check('a second commit on the same input changes nothing',
    g.D._toasts.filter((t) => /renamed/.test(t)).length, 1);
  /* An empty name is a no-op, not a scolding. The old dialog answered a blank
     field with "Please enter a name" for tapping a heading and changing your
     mind. */
  const h = build(fresh());
  h.D._input = { value: '   ', dataset: {} };
  h.commitRenameSection('gA');
  check('a blank name leaves the section alone', h.names(), ['Work', 'Leisure']);
  check('and does not scold', h.D._toasts.filter((t) => /enter a name/i.test(t)).length, 0);
  /* Renaming to the same thing is not an event either. */
  const i = build(fresh());
  i.D._input = { value: 'Work', dataset: {} };
  i.commitRenameSection('gA');
  check('renaming to the same name says nothing',
    i.D._toasts.filter((t) => /renamed/.test(t)).length, 0);
  /* And no input at all must not throw. */
  const j = build(fresh());
  j.D._input = null;
  let threw = null;
  try { j.commitRenameSection('gA'); } catch (err) { threw = err.message; }
  check('committing with no field on screen does not throw', threw, 'null');
})();

/* ======================================================================
   v108 - A NEW SECTION LANDS UNDER "OTHER", NOT OVER IT
   ======================================================================
   Rachel, 18 Sep 2026: "when someone adds a new section, dont let it jump
   before Other, becaus ethe user will be confused with the jump, the new
   section should come after Other, the user can then move it up with the
   arrow."

   THE OLD SHAPE, AND WHY IT COULD NOT BE FIXED BY REORDERING THE ARRAY: the
   ungrouped block was drawn after every section unconditionally, so "the end of
   the list" and "the end of `groups`" were two different places and no array
   position could put a section below Other. Other is a row in the same ordered
   list now - `g.below` marks the sections under it, `groups` is kept
   partitioned so the boundary is one index, and the array order still decides
   the order within each side.

   ALL BEHAVIOURAL, AND READ OFF THE SCREEN. `rows()` is what renderProjects
   draws, in order, with "Other" in it as a row of its own. Asserting on the
   flag instead would pass while the screen was wrong - which is precisely the
   bug being fixed. Every local in these functions is renamed by the minifier,
   so a textual test could not reach them at all. */
section('A new section lands under Other, and an arrow brings it up');
(function () {
  const build = (state) => {
    let n = 0;
    const toast = { innerHTML: '', style: {}, classList: { add() {}, remove() {} } };
    const D = {
      document: { getElementById: (id) => (id === 'toast' ? toast : null), querySelector: () => null },
      db: { saveCollapsedGroups() {} },
      save() {}, showToast() {}, renderHome() {}, renderProjects() {},
      genId: () => 'new' + (++n), esc: (s) => String(s),
      startRenameSection() {}, _toastEl: toast,
    };
    const api = new Function('st', 'D',
      'var groups=st.groups, projects=st.projects, collapsedGroups=st.collapsedGroups||{};' +
      'var _sectionUndo=null;' +
      'var document=D.document, db=D.db, save=D.save, showToast=D.showToast,' +
      '    renderHome=D.renderHome, renderProjects=D.renderProjects, genId=D.genId,' +
      '    esc=D.esc, startRenameSection=D.startRenameSection;' +
      'function getGroup(id){return groups.find(function(g){return g.id===id})}' +
      'function getProject(id){return projects.find(function(p){return p.id===id})}' +
      extractFn('otherCutIndex') + ';' +
      extractFn('homeHasUngrouped') + ';' +
      extractFn('_setSectionBelow') + ';' +
      extractFn('newSectionName') + ';' +
      extractFn('showSectionUndoToast') + ';' +
      extractFn('removeSection') + ';' +
      extractFn('undoRemoveSection') + ';' +
      extractFn('moveSection') + ';' +
      extractFn('moveSectionUp') + ';' +
      extractFn('moveSectionDown') + ';' +
      extractFn('addSectionAtEnd') + ';' +
      'return {addSectionAtEnd:addSectionAtEnd, moveSectionUp:moveSectionUp,' +
      ' moveSectionDown:moveSectionDown, removeSection:removeSection,' +
      ' undoRemoveSection:undoRemoveSection, cut:otherCutIndex,' +
      // WHAT THE HOME SCREEN DRAWS, in order: the sections above Other, the
      // Other block when anything is in it, then the sections below.
      ' rows:function(){var c=otherCutIndex();' +
      '   var r=groups.slice(0,c).map(function(g){return g.name});' +
      '   if(homeHasUngrouped())r.push("Other");' +
      '   return r.concat(groups.slice(c).map(function(g){return g.name}))},' +
      // The invariant everything else rests on: no unflagged section may sit
      // after a flagged one, or the boundary is not a single index.
      ' partitioned:function(){var seen=false;for(var i=0;i<groups.length;i++){' +
      '   if(groups[i].below)seen=true; else if(seen)return false} return true},' +
      // Which arrows the header would draw, for the section at this index.
      ' arrows:function(i){var c=otherCutIndex(),o=homeHasUngrouped();' +
      '   return {up:(i>0||(o&&i===c)),down:(i<groups.length-1||(o&&i===c-1))}}}'
    )(state, D);
    return api;
  };
  // Two sections, one loose activity - so the Other block is on screen.
  const loose = () => ({ groups: [{ id: 'gA', name: 'Work' }, { id: 'gB', name: 'Leisure' }],
                         projects: [{ id: 'p1', groupId: 'gA' }, { id: 'p4', groupId: null }] });
  // Everything filed, so there is no Other block to cross.
  const tidy  = () => ({ groups: [{ id: 'gA', name: 'Work' }, { id: 'gB', name: 'Leisure' }],
                         projects: [{ id: 'p1', groupId: 'gA' }, { id: 'p3', groupId: 'gB' }] });

  /* ---- THE BUG, AND ITS FIX ---- */
  const a = build(loose());
  check('before: Other is the last row', a.rows(), ['Work', 'Leisure', 'Other']);
  a.addSectionAtEnd();
  check('a new section lands UNDER Other, not over it',
    a.rows(), ['Work', 'Leisure', 'Other', 'New section']);
  check('and the array is still partitioned', a.partitioned(), true);
  /* ---- AND THE ARROW BRINGS IT UP, ONE ROW AT A TIME ---- */
  a.moveSectionUp('new1');
  check('up moves it past Other and nothing else',
    a.rows(), ['Work', 'Leisure', 'New section', 'Other']);
  a.moveSectionUp('new1');
  check('up again moves it past one section',
    a.rows(), ['Work', 'New section', 'Leisure', 'Other']);
  check('still partitioned', a.partitioned(), true);
  /* ---- AND DOWN GOES BACK THE SAME WAY, ONE ROW PER PRESS ---- */
  a.moveSectionDown('new1');
  check('down swaps with the section below',
    a.rows(), ['Work', 'Leisure', 'New section', 'Other']);
  a.moveSectionDown('new1');
  check('down again crosses Other',
    a.rows(), ['Work', 'Leisure', 'Other', 'New section']);
  a.moveSectionDown('new1');
  check('and down from the bottom row does nothing',
    a.rows(), ['Work', 'Leisure', 'Other', 'New section']);
  check('partitioned throughout', a.partitioned(), true);

  /* ---- CROSSING MOVES ONE SECTION, NOT TWO. A swap at the boundary would
     have carried the section BELOW Other up over it at the same time, which
     is two rows moving for one press. ---- */
  const b = build(loose());
  b.addSectionAtEnd();                  // Work, Leisure, Other, New section
  b.moveSectionDown('gB');              // Leisure crosses Other downward
  check('the section that crossed keeps its place among the sections',
    b.rows(), ['Work', 'Other', 'Leisure', 'New section']);
  check('and still partitioned', b.partitioned(), true);

  /* ---- A SECTION BELOW OTHER CAN GO UP EVEN WHEN IT IS groups[0] ----
     This is why `first`/`last` had to become `noUp`/`noDown`: with every
     section below Other, groups[0] is the row directly under the Other block
     and its up arrow is the only way back. ---- */
  const c = build(loose());
  c.moveSectionDown('gA'); c.moveSectionDown('gA');   // Work to the bottom, below Other
  c.moveSectionDown('gB');                            // Leisure below Other too
  check('every section can end up below Other', c.rows(), ['Other', 'Leisure', 'Work']);
  check('groups[0] is then the first row under Other, and may go up',
    c.arrows(0).up, true);
  c.moveSectionUp('gB');
  check('and up brings it back above', c.rows(), ['Leisure', 'Other', 'Work']);

  /* ---- WITH NOTHING LOOSE THERE IS NO OTHER BLOCK, so there is no boundary
     to cross and the arrows are plain swaps. A flag flip here would have been
     a press that changed nothing on screen. ---- */
  const d = build(tidy());
  check('no Other row when everything is filed', d.rows(), ['Work', 'Leisure']);
  d.addSectionAtEnd();
  check('a new section is simply last', d.rows(), ['Work', 'Leisure', 'New section']);
  check('and no flag was needed', d.cut(), 3);
  d.moveSectionUp('new1');
  check('up is an ordinary swap', d.rows(), ['Work', 'New section', 'Leisure']);
  check('and the arrays stays partitioned', d.partitioned(), true);
  check('the top row cannot go up', d.arrows(0).up, false);
  check('and the bottom row cannot go down', d.arrows(2).down, false);

  /* ---- AN ACCOUNT THAT HAS NEVER ADDED A SECTION SINCE THIS SHIPPED has no
     flags at all, so every section is above Other exactly as before. That is
     the whole migration. ---- */
  const e = build(loose());
  check('no flags means the boundary is the end of the list', e.cut(), 2);
  check('and Other is drawn last, as it always was',
    e.rows(), ['Work', 'Leisure', 'Other']);

  /* ---- WHICH SIDE IT WAS ON IS PART OF WHERE IT WAS. Undo that put a section
     back at its old index but above Other would have moved the thing it claims
     to have restored. ---- */
  const f = build(loose());
  f.addSectionAtEnd();
  check('set up: the new section is below Other',
    f.rows(), ['Work', 'Leisure', 'Other', 'New section']);
  f.removeSection('new1');
  check('removed', f.rows(), ['Work', 'Leisure', 'Other']);
  f.undoRemoveSection();
  check('undo puts it back BELOW Other, where it was',
    f.rows(), ['Work', 'Leisure', 'Other', 'New section']);
  check('and partitioned after the undo', f.partitioned(), true);

  /* ---- THE ARROW THAT WOULD DO NOTHING IS STILL DISABLED, and the last
     section ABOVE Other keeps its down arrow because it has Other to cross. */
  const g2 = build(loose());
  check('the top section cannot go up', g2.arrows(0).up, false);
  check('but the last section above Other CAN go down', g2.arrows(1).down, true);
  g2.moveSectionDown('gB');
  check('once below, the last row cannot go down', g2.arrows(1).down, false);
  check('and it can come back up', g2.arrows(1).up, true);
})();

// Node runs this file top-to-bottom, so collect the async unshare results too.
const _unshareChecks = [];

/* ---- 17 Sep 2026: "Stop sharing" DELETED THE ACTIVITY ---------------------
   Reported by Rachel: Stop sharing on "Living Home Decor" and it was gone —
   off the home screen, not in the archive, gone from the account. The confirm
   dialog had just said "All the history stays with you".

   unshareLedger deleted ledgers/{id} while attachLedgerListener was still
   listening to it. Firestore applies a local delete immediately, so the
   listener fired with a snapshot whose .exists is false, and the first line of
   that handler is onLedgerGone(ledgerId,'deleted') — which splices the project
   out of `projects` and persists the shortened list to the device AND to
   users/{uid}. Unrecoverable, because users/{uid} holds only a STUB of a
   shared activity: the history lives in the ledger document and nowhere else.

   THESE TESTS RUN THE REAL FUNCTIONS. The fake delete() calls onLedgerGone
   exactly the way the real snapshot handler does — synchronously, before the
   delete promise resolves — which is the whole shape of the bug. A re-typed
   copy of either function here would keep passing while the app broke. */
section('Stop sharing keeps the activity (17 Sep 2026)');
(function () {
  const UNSHARE_SRC = [
    'var _lgBase={},_lgUnsub={},_lgLoaded={},_lgMeta={},_unsharing={},_syncHold=0,_events=[],_writeOK=true,_holdSeen=[];',
    'var projects=[],currentProjectId=null,_toasts=[],_deleted=[],_attached=[];',
    'var currentUser={uid:"u_rachel",isAnonymous:false};',
    'function showToast(t){_toasts.push(String(t))}',
    'function refreshCurrentView(){}',
    'function goHome(){}',
    'function getProject(id){return projects.filter(function(x){return x.id===id})[0]}',
    'function detachLedgerListener(id){if(_lgUnsub[id]){try{_lgUnsub[id]()}catch(e){}delete _lgUnsub[id]}}',
    'function attachLedgerListener(id){_attached.push(id);_lgUnsub[id]=function(){}}',
    'var _persists=[],_bin=[],_nid=0;',
    'function genId(){return "b"+(++_nid)}',
    'var BIN_DAYS=30,BIN_MAX=30;',
    'var db={persistSynced(){_persists.push(projects.map(function(x){return x.name}))},',
    '        _cacheSyncedLocally(){},',
    /* The users/{uid} write, which unshareLedger now WAITS for before it
       deletes anything. It records what it carried, so the tests can prove the
       history was in the cloud copy before the ledger went. */
    '        _pushSyncedToFirestore(){_holdSeen.push(_syncHold);var p=projects.filter(function(x){return x.id==="p1"})[0];',
    '          _events.push("users-write:"+((p&&!p.shared&&p.history)||[]).length);return Promise.resolve(_writeOK)},',
    '        readBin(){return _bin.slice()},writeBin(l){_bin=l.slice();return true}};',
    extractFn('isShared'),
    extractFn('ledgerRole'),
    extractFn('isLedgerOwner'),
    extractConstLine('const LEDGER_LOCAL_KEYS='),
    extractFn('hydrateStub'),
    extractFn('pendingInvites'),
    /* onLedgerGone puts a guest's copy in the removal bin now, so the real
       binProject has to be in here - a stub would not prove the thing that
       matters, which is that what lands in the bin is HYDRATED. */
    extractFn('pruneBin'),
    extractFn('binProject'),
    extractAsyncFn('unshareLedger'),
    extractFn('isDormantLedger'),
    /* invitesOutNobodyJoined was here until 18 Sep 2026. hasJoinedMembers is
       the predicate that replaced it, and it draws a different line: not "is a
       code outstanding" but "is anybody actually in", which is the only thing
       the owner is now shown. It needs sharingUnlocked, which is stubbed above
       the extractions. */
    'function sharingUnlocked(){return true}',
    extractFn('hasJoinedMembers'),
    extractFn('onLedgerGone'),
    'return {get projects(){return projects},set projects(v){projects=v},',
    ' _lgBase:_lgBase,_lgLoaded:_lgLoaded,_lgUnsub:_lgUnsub,_lgMeta:_lgMeta,',
    ' get toasts(){return _toasts},get deleted(){return _deleted},',
    ' get attached(){return _attached},get persists(){return _persists},',
    ' get bin(){return _bin},binProject:binProject,get events(){return _events},',
    ' set writeOK(v){_writeOK=v},get holdSeen(){return _holdSeen},get syncHold(){return _syncHold},',
    ' set currentProjectId(v){currentProjectId=v},',
    ' set firestore(v){firestore=v},',
    ' unshareLedger:unshareLedger,onLedgerGone:onLedgerGone,',
    ' isDormantLedger:isDormantLedger,hasJoinedMembers:hasJoinedMembers,',
    ' isShared:isShared};'
  ].join('\n');

  /* A fake Firestore whose ledger delete behaves the way the real one does:
     it notifies the live listener BEFORE the promise settles. */
  function makeSandbox(opts) {
    const o = opts || {};
    const sb = new Function('var firestore;' + UNSHARE_SRC)();
    sb.firestore = {
      collection: function (name) {
        return {
          where: function () { return { get: function () { return Promise.resolve({ forEach: function () {} }); } }; },
          doc: function (id) {
            return {
              delete: function () {
                if (o.deleteFails) return Promise.reject(new Error('unavailable'));
                sb.deleted.push(name + '/' + id);
                sb.events.push('delete:' + name);
                /* THIS IS THE BUG, REPRODUCED: the local delete is applied at
                   once and the snapshot handler's !exists branch runs. */
                if (name === 'ledgers' && sb._lgUnsub[id]) sb.onLedgerGone(id, 'deleted');
                return Promise.resolve();
              }
            };
          }
        };
      }
    };
    return sb;
  }

  function sharedProject() {
    /* A STUB, which is all users/{uid} ever holds for a shared activity. */
    return { id: 'p1', name: 'Living Home Decor', type: 'project', ledgerId: 'lg_1',
             shared: true, role: 'owner', ownerUid: 'u_rachel', ownerName: 'Rachel',
             memberCount: 1, balance: 0 };
  }
  function ledgerData() {
    return { name: 'Living Home Decor', type: 'project', currency: 'USD',
             participants: ['Rachel', 'Sabine'],
             history: [{ id: 'e1', type: 'charge', amount: 120 },
                       { id: 'e2', type: 'charge', amount: 45 },
                       { id: 'e3', type: 'payment', amount: 60 }] };
  }

  /* ---- the report, start to finish ---- */
  const A = makeSandbox();
  const pA = sharedProject();
  A.projects = [pA];
  A._lgBase.lg_1 = ledgerData();
  A._lgLoaded.lg_1 = true;
  A._lgUnsub.lg_1 = function () {};   // a live listener, as in the app

  const done = A.unshareLedger(pA).then(function () {
    check('the activity is still on the home screen', A.projects.length, 1);
    check('and it is the same activity', (A.projects[0] || {}).name, 'Living Home Decor');
    check('with every entry intact', ((A.projects[0] || {}).history || []).length, 3);
    check('and its participants', ((A.projects[0] || {}).participants || []).join(','), 'Rachel,Sabine');
    check('it is no longer shared', !!(A.projects[0] || {}).shared, false);
    check('and holds no ledger id', (A.projects[0] || {}).ledgerId === undefined, true);
    check('the ledger document was deleted', A.deleted.indexOf('ledgers/lg_1') > -1, true);
    check('the listener came off BEFORE the delete', A._lgUnsub.lg_1 === undefined, true);
    /* The list that was written up to users/{uid} must contain it. Writing a
       list without it is what made 17 Sep unrecoverable. */
    check('every saved copy of the list still names it',
      A.persists.length > 0 && A.persists.every(function (names) { return names.indexOf('Living Home Decor') > -1; }), true);
    /* unshareLedger itself is silent; its CALLER is what speaks. Since 18 Sep
       2026 that caller is doRemoveMember, cancelling the last invitee -
       checked below against its source rather than faked here. */
  });

  /* ---- 23 Sep 2026: THE DATA MOVES BEFORE ANYTHING IS DELETED ----
     Cancelling the last invite emptied an activity: a snapshot swapped the
     list mid-unshare and the fold-back landed as a second, hidden copy. The
     order is now: fold back, write users/{uid} WITH the history, wait for it,
     and only then delete the ledger. */
  const doneOrder = done.then(function () {
    const w = A.events.indexOf('users-write:3');
    const d = A.events.indexOf('delete:ledgers');
    check('the full history is written to the account BEFORE the ledger is deleted',
      w > -1 && d > -1 && w < d, true);
    check('no account snapshot is applied while the fold-back runs', A.holdSeen[0] > 0, true);
    check('and the hold is released afterwards', A.syncHold, 0);
    check('one tracker under that id, never two',
      A.projects.filter(function (x) { return x.id === 'p1'; }).length, 1);
    check('a safety copy went into Recently Removed first',
      A.bin.some(function (r) { return r.why === 'unshared' && r.entries === 3; }), true);
  });

  /* ---- offline: the account write never confirms ---- */
  const B = makeSandbox();
  B.writeOK = false;
  const pB = sharedProject();
  B.projects = [pB];
  B._lgBase.lg_1 = ledgerData();
  B._lgLoaded.lg_1 = true;
  B._lgUnsub.lg_1 = function () {};
  const doneB = B.unshareLedger(pB).then(function () {
    check('offline: the ledger is NOT deleted when the account copy did not land', B.deleted.length, 0);
    check('offline: the activity is still there with every entry', (B.projects[0].history || []).length, 3);
    check('offline: and it is still on the home screen', B.projects.length, 1);
  });

  /* ---- the ledger delete fails after the account copy landed ---- */
  const B2 = makeSandbox({ deleteFails: true });
  const pB2 = sharedProject();
  B2.projects = [pB2];
  B2._lgBase.lg_1 = ledgerData();
  B2._lgLoaded.lg_1 = true;
  B2._lgUnsub.lg_1 = function () {};
  const doneB2 = B2.unshareLedger(pB2).then(function () {
    check('a failed ledger delete still leaves the activity whole', (B2.projects[0].history || []).length, 3);
    check('and local, because its history is already safe in the account', !!B2.projects[0].shared, false);
  });

  /* ---- GUARD 1: never delete the only copy before this device has it ---- */
  const C = makeSandbox();
  const pC = sharedProject();
  C.projects = [pC];
  /* no _lgBase, no _lgLoaded — the ledger snapshot has not landed yet */
  const doneC = C.unshareLedger(pC).then(function () {
    check('unsharing an unloaded ledger should have thrown', 'resolved', 'threw');
  }, function (e) {
    check('it refuses while the ledger is still loading', e.message, 'ledger-not-loaded');
    check('and deletes nothing at all', C.deleted.length, 0);
    check('and the activity is untouched', C.projects.length, 1);
  });

  /* ---- GUARD 4: an owner is never evicted from their own activity ---- */
  const D = makeSandbox();
  const pD = sharedProject();
  D.projects = [pD];
  D._lgBase.lg_1 = ledgerData();
  D._lgLoaded.lg_1 = true;
  D.onLedgerGone('lg_1', 'deleted');
  check('an owner keeps the activity when the ledger vanishes', D.projects.length, 1);
  check('and gets its history folded back', (D.projects[0].history || []).length, 3);
  check('and it comes back as an ordinary local activity', !!D.projects[0].shared, false);

  /* ---- but a GUEST is still dropped, which is what onLedgerGone is for ---- */
  const E = makeSandbox();
  E.projects = [{ id: 'p2', name: 'Sabine\'s Trip', ledgerId: 'lg_9', shared: true,
                  role: 'viewer', ownerName: 'Sabine' }];
  E._lgBase.lg_9 = { name: 'Sabine\'s Trip', history: [{ id: 'x1' }, { id: 'x2' }] };
  E._lgLoaded.lg_9 = true;
  E.onLedgerGone('lg_9', 'removed');
  check('a guest who loses access still has it removed', E.projects.length, 0);
  check('and is told why', E.toasts.some(function (t) { return /no longer have access/.test(t); }), true);
  /* THE WAY BACK (17 Sep 2026). Rachel, after Living Home Decor: "how can the
     user recover it if smthg like that happens? there should be a way for the
     user to retrieve it." Being thrown out of a group is a legitimate removal
     and still removes it - but it is no longer the end of the copy. */
  check('and a copy is kept so it can be restored', E.bin.length, 1);
  check('under its own name', (E.bin[0] || {}).name, 'Sabine\'s Trip');
  check('with the reason recorded', (E.bin[0] || {}).why, 'removed');
  /* THE PART THAT WOULD SILENTLY NOT WORK: what sits in `projects` for a
     shared group is a STUB with no money in it. Binning that would give the
     user back an empty tracker, which is worse than nothing because it looks
     right. binProject hydrates out of _lgBase first. */
  check('and its entries, not an empty shell', (E.bin[0] || {}).entries, 2);
  check('the restored copy is a LOCAL one, not a dead ledger stub',
    !!((E.bin[0] || {}).project || {}).ledgerId, false);

  /* ---- GUARD 3: our own unshare is not an eviction ---- */
  const F = makeSandbox();
  const pF = sharedProject();
  F.projects = [pF];
  F._lgBase.lg_1 = ledgerData();
  F._lgLoaded.lg_1 = true;
  F._lgUnsub.lg_1 = function () {};
  const doneF = F.unshareLedger(pF).then(function () {
    /* A late snapshot from any other path must now be inert. */
    F.onLedgerGone('lg_1', 'deleted');
    check('a late snapshot after an unshare cannot remove it', F.projects.length, 1);
    check('and cannot empty it', (F.projects[0].history || []).length, 3);
  });

  /* ---- the other half of the report: "shared" with nobody ---- */
  const G = makeSandbox();
  check('an owner alone with no invites is not really shared',
    G.isDormantLedger({ shared: true, ledgerId: 'lg_1', role: 'owner', memberCount: 1 }), true);
  check('an expired invite does not keep it alive',
    G.isDormantLedger({ shared: true, ledgerId: 'lg_1', role: 'owner', memberCount: 1,
                        pendingInvites: [{ code: 'AB12', expiresAt: 1 }] }), true);
  check('a live invite does',
    G.isDormantLedger({ shared: true, ledgerId: 'lg_1', role: 'owner', memberCount: 1,
                        pendingInvites: [{ code: 'AB12', expiresAt: Date.now() + 86400000 }] }), false);
  check('and so does somebody having joined',
    G.isDormantLedger({ shared: true, ledgerId: 'lg_1', role: 'owner', memberCount: 2 }), false);
  check('a guest\'s ledger is never dormant — it is not theirs to fold back',
    G.isDormantLedger({ shared: true, ledgerId: 'lg_1', role: 'viewer', memberCount: 1 }), false);
  check('an unshared activity is not dormant either', G.isDormantLedger({ id: 'x' }), false);

  /* INVITED IS NOT JOINED (Rachel, 17 Sep 2026), AND AS OF 18 SEP IT IS ALSO
     NOT DISPLAYED. A sent code is still a THIRD state and isDormantLedger
     still counts it - that question is "did this account ever mean to share
     at all". What went is the display of it, so the predicate the OWNER'S
     SCREEN asks is now hasJoinedMembers, and it must answer "is somebody in",
     never "was a code sent". These are behavioural: every local in there is
     renamed by the minifier. */
  const live = t => ({ shared: true, ledgerId: 'lg_1', role: 'owner', memberCount: 1,
                       pendingInvites: [{ code: 'AB12', participant: t || null, expiresAt: Date.now() + 86400000 }] });
  check('a sent invite is not dormant', G.isDormantLedger(live('Sabine')), false);
  check('but a sent invite is NOT somebody having joined',
    G.hasJoinedMembers(live('Sabine')), false);
  check('a second member is', G.hasJoinedMembers(
    { shared: true, ledgerId: 'lg_1', role: 'owner', memberCount: 2 }), true);
  check('an owner alone with no code at all is not',
    G.hasJoinedMembers({ shared: true, ledgerId: 'lg_1', role: 'owner', memberCount: 1 }), false);
  /* AND THE ONE THAT KEEPS THE "Left Group" ROW REACHABLE: somebody who joined
     and walked out leaves memberCount back at 1, so without this the button
     would go back to reading "Invite" and take the only door to their row with
     it. */
  check('but somebody who joined and left still counts',
    G.hasJoinedMembers({ shared: true, ledgerId: 'lg_1', role: 'owner', memberCount: 1,
                         joinedMembers: { u_sabine: { name: 'Sabine', role: 'viewer', left: true } } }), true);
  check('a guest is never offered the owner\'s button',
    G.hasJoinedMembers({ shared: true, ledgerId: 'lg_1', role: 'viewer', memberCount: 2 }), false);
  check('and an unshared activity has nobody in it to manage',
    G.hasJoinedMembers({ id: 'x' }), false);

  _unshareChecks.push(done, doneOrder, doneB, doneB2, doneC, doneF);

  /* ---- and the structure that makes all of the above true ---- */
  const un = extractAsyncFn('unshareLedger');
  const iDetach = un.indexOf('detachLedgerListener');
  const iDelete = un.search(/collection\(["']ledgers["']\)\.doc\([\w$]+\)\.delete\(\)/);
  check('the listener is detached before the ledger is deleted, not after',
    iDetach > -1 && iDelete > -1 && iDetach < iDelete, true);
  check('it will not start without the ledger loaded',
    /_lgLoaded\[[\w$]+\]/.test(un), true);
  const og = extractFn('onLedgerGone');
  check('onLedgerGone bails out on our own unshare', /_unsharing\[/.test(og), true);
  check('onLedgerGone will not splice an owner out', /isLedgerOwner\(/.test(og), true);
  /* If this ever stops being the call the !exists branch makes, the behavioural
     tests above are no longer testing the path the app actually takes. */
  check('a vanished ledger still routes through onLedgerGone',
    /!\s*[\w$]+\.exists\s*\)\s*\{\s*onLedgerGone\(/.test(extractFn('attachLedgerListener')), true);
  /* WHO SPEAKS FOR unshareLedger NOW. "Stop sharing" and its dialog went on
     18 Sep 2026 - it did to everybody what Cancel invite does to one person,
     and two buttons for one outcome is how somebody reaches for the blunt one.
     The FUNCTION is untouched, with all four of the 17 Sep guards; what changed
     is who calls it. Cancelling the last invitee does, which is what makes
     Rachel's "it can be done by user: cancel invite" true rather than a hope.
     THIS BLOCK IS THE RECEIPT FOR THAT: if the last caller is ever removed as
     well, unshareLedger becomes unreachable and an activity that was shared
     once can never be folded back - and no test above would notice. */
  check('the Stop sharing dialog is gone', /function confirmUnshare/.test(src), false);
  check('and its handler with it', /function doUnshare/.test(src), false);
  const dr = extractAsyncFn('doRemoveMember');
  check('unshareLedger is still reached, from cancelling the last invitee',
    /unshareLedger\(/.test(dr), true);
  check('the toast says the history came with it', /history/i.test(dr), true);
  check('a refused fold-back still reports the cancellation',
    /Invite cancelled/.test(dr), true);
  check('and the cancellation is written up before the fold-back is tried',
    dr.indexOf('removeLedgerMember') < dr.indexOf('unshareLedger'), true);
  check('cancelling somebody who is NOT the last changes nothing else',
    /_isLastOtherMember\(/.test(dr), true);
  const strip = extractFn('sharedStripHtml');
  check('an owner is shown no strip at all',
    new RegExp('isLedgerOwner\\(p\\)\\)\\s*return\\s*' + Q + Q).test(strip), true);
  check('a "Shared with 0 people" strip is not drawn',
    /Not shared with anyone yet/.test(strip), false);
  check('nor a strip about an invite nobody has accepted',
    /not joined yet/.test(strip), false);
  const chip = extractFn('roleChipHtml');
  check('and no badge is shown for a ledger nobody is in',
    /isDormantLedger\(/.test(chip), true);
})();


/* ---- 17 Sep 2026: THE WAY BACK, AND THE WAY OUT OF A CATEGORY ------------- */
section('Removing something is no longer the end of it');
(function () {
  const BIN_SRC = [
    'var projects=[],groups=[],_bin=[],_toasts=[],_nid=0,_saves=0;',
    'var BIN_DAYS=30,BIN_MAX=30;',
    'var _lgBase={};',
    'function genId(){return "n"+(++_nid)}',
    'function showToast(t){_toasts.push(String(t))}',
    'function save(){_saves++}',
    'function renderHome(){}',
    'function renderRecentlyRemoved(){}',
    'function getProject(id){return projects.filter(function(x){return x.id===id})[0]}',
    'function getGroup(id){return groups.filter(function(g){return g.id===id})[0]}',
    'var db={readBin(){return _bin.slice()},writeBin(l){_bin=l.slice(0,BIN_MAX);return true}};',
    extractConstLine('const LEDGER_LOCAL_KEYS='),
    extractFn('isShared'),
    extractFn('hydrateStub'),
    extractFn('pruneBin'),
    extractFn('binProject'),
    extractFn('daysLeftInBin'),
    extractFn('binReasonText'),
    extractFn('restoreFromBin'),
    'return {get projects(){return projects},set projects(v){projects=v},',
    ' set groups(v){groups=v},_lgBase:_lgBase,',
    ' get bin(){return _bin},set bin(v){_bin=v},get toasts(){return _toasts},',
    ' binProject:binProject,restoreFromBin:restoreFromBin,pruneBin:pruneBin,',
    ' daysLeftInBin:daysLeftInBin,binReasonText:binReasonText};'
  ].join('\n');
  const mk = () => new Function(BIN_SRC)();

  /* ---- a plain delete is recoverable ---- */
  const A = mk();
  const local = { id: 'p1', name: 'Kitchen Renovation', type: 'project', groupId: 'gA',
                  history: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }] };
  A.projects = [local];
  A.groups = [{ id: 'gA', name: 'Home' }];
  A.binProject(local, 'deleted');
  A.projects = [];
  check('what was deleted is in the bin', A.bin.length, 1);
  check('with its entry count on the row', A.bin[0].entries, 3);
  A.restoreFromBin(A.bin[0].binId);
  check('and comes back', A.projects.length, 1);
  check('with its entries', (A.projects[0].history || []).length, 3);
  check('into the section it came from', A.projects[0].groupId, 'gA');
  check('and leaves the bin', A.bin.length, 0);

  /* ---- A SHARED TRACKER IS A STUB. Binning it without hydrating would hand
     back an empty tracker that LOOKS right, which is worse than nothing. ---- */
  const B = mk();
  const stub = { id: 'p2', name: 'Rome Trip', type: 'project', ledgerId: 'lg_2',
                 shared: true, role: 'viewer', ownerName: 'Sam', memberCount: 3, balance: 0 };
  B.projects = [stub];
  B._lgBase.lg_2 = { name: 'Rome Trip', participants: ['Sam', 'Rachel'],
                     history: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }, { id: 'e4' }] };
  B.binProject(stub, 'removed');
  check('a shared tracker is hydrated on the way in', B.bin[0].entries, 4);
  check('and keeps its participants', (B.bin[0].project.participants || []).join(','), 'Sam,Rachel');
  check('what comes back is local, not a dead stub', !!B.bin[0].project.shared, false);
  check('with no ledger id', B.bin[0].project.ledgerId === undefined, true);
  check('and no stale member count', B.bin[0].project.memberCount === undefined, true);

  /* ---- RESTORING MUST NEVER LAND ON TOP OF SOMETHING LIVE ---- */
  const C = mk();
  const p3 = { id: 'p3', name: 'Pilates', history: [{ id: 'e1' }] };
  C.projects = [p3];
  C.binProject(p3, 'deleted');
  /* still there - restored on another device, or the delete never synced */
  C.restoreFromBin(C.bin[0].binId);
  check('a colliding id does not overwrite the live one', C.projects.length, 2);
  check('the restored copy took a fresh id', C.projects[0].id !== 'p3', true);
  check('and the live one is untouched', C.projects[1].id, 'p3');

  /* ---- a section that no longer exists must not hide the card ---- */
  const D = mk();
  const p4 = { id: 'p4', name: 'Cello', groupId: 'gGone', history: [] };
  D.projects = [p4];
  D.binProject(p4, 'deleted');
  D.projects = [];
  D.restoreFromBin(D.bin[0].binId);
  check('a restored card whose section is gone goes to Other Activities',
    D.projects[0].groupId, null);

  /* ---- the two limits ---- */
  const E = mk();
  const old = Date.now() - 31 * 86400000;
  check('anything past 30 days is dropped',
    E.pruneBin([{ removedAt: old }, { removedAt: Date.now() }]).length, 1);
  const many = [];
  for (let i = 0; i < 40; i++) many.push({ removedAt: Date.now() - i });
  check('and the bin never holds more than 30', E.pruneBin(many).length, 30);
  check('a row knows how long it has left', E.daysLeftInBin(Date.now()), 30);
  check('and an expired one reports nothing left', E.daysLeftInBin(old), 0);
  check('the reason is spelled out for a guest', E.binReasonText('removed'), 'Your access was revoked');
  check('and for leaving', E.binReasonText('left'), 'You left this group');

  /* ---- every path that removes for good goes through the bin ---- */
  ['doDeleteCurrentProject', 'doDeleteProject', 'leaveLedgerDoc', 'onLedgerGone'].forEach(function (fn) {
    check(fn + ' keeps a copy', /binProject\(/.test(extractAsyncFn(fn)), true);
  });
  /* ARCHIVING IS NOT A REMOVAL. It stays in `projects` and already has its own
     Restore - binning it too would show one tracker in two lists. */
  check('archiving does not', /binProject\(/.test(extractFn('doArchive')), false);
  /* THE BIN IS DEVICE-LOCAL, AND THAT IS THE DESIGN, NOT AN OMISSION. Every
     binned tracker carries its whole history; users/{uid} is one Firestore
     document with a hard 1MB ceiling that this app rewrites on EVERY save. Put
     the bin in there and saves get heavier and eventually fail - a data-loss
     bug introduced by a data-loss fix. So it belongs to the LOCAL layer, which
     the architecture note above LOCAL_KEYS says must never touch the synced
     one. */
  check('the bin is a local key',
    new RegExp('bin:' + Q + 'tally_removed_bin' + Q).test(extractConstLine('const LOCAL_KEYS=')), true);
  check('and not a synced one', /bin/.test(extractConstLine('const SYNCED_KEYS=')), false);
  check('but still scoped per account', /scopedKey\(LOCAL_KEYS\.bin\)/.test(src), true);
  check('Settings has somewhere to show it', /id="recentlyRemovedList"/.test(src), true);
})();

section('A category can be taken off again');
(function () {
  /* Rachel, 17 Sep 2026: "i tried editing a transaction to deselect category,
     but there is no way to deselect a category". The mechanism existed - the
     active chip toggles off - and nothing said so. */
  /* RUN THE PICKER, do not read it. Every one of these once spelled a
     parameter name or a quote character, and every one of them passed on the
     master and failed on the shipped build - BUILD NOTES step 7, again. */
  const PICK_SRC = [
    'function esc(s){return String(s==null?"":s)}',
    extractFn('getUsedCategories'),
    extractFn('buildCategoryPicker'),
    'return buildCategoryPicker;'
  ].join('\n');
  const pick = new Function(PICK_SRC)();
  const proj = { history: [{ type: 'charge', costItem: 'Rent' }, { type: 'charge', costItem: 'Bills' }] };
  const blank = pick(proj, 'x', '', 'charge');
  const chosen = pick(proj, 'x', 'Rent', 'charge');
  const bulk = pick(proj, 'bulkCat', '', '', true);
  check('the picker offers "No category" outright', /No category/.test(blank), true);
  check('lit when nothing is chosen', /cat-chip-none active/.test(blank), true);
  check('and not lit once a category is chosen', /cat-chip-none active/.test(chosen), false);
  check('the chosen one is lit instead', /class="cat-chip active" data-cat="Rent"/.test(chosen), true);
  check('and it is not offered in the bulk dialog, where it would do nothing',
    /No category/.test(bulk), false);
  check('though the real categories still are', /data-cat="Bills"/.test(bulk), true);
  /* Tapping the lit chip has always cleared the value; now the row shows it. */
  const sel = extractFn('selectCatChip');
  check('clearing a chip lights "No category" instead of lighting nothing',
    /cat-chip-none/.test(sel), true);
  check('and "No category" itself never toggles off',
    /function selectNoCat/.test(src) && !/wasActive/.test(extractFn('selectNoCat')), true);
  /* The edit path already wrote the empty string back - that half was fine. */
  check('the edit form still writes an empty category back',
    new RegExp('costItem=[\\w$]+\\.value\\|\\|' + Q + Q).test(extractFn('doEditProjectEntry')), true);

  /* ---- and taking them ALL off, which had no control at all ---- */
  const CAT_SRC = [
    'var currentProjectId="p1",_toasts=[],_rendered=0,_closed=0,_saved=0;',
    'var projects=[{id:"p1",name:"Orea Rental",history:[',
    '  {id:"e1",type:"charge",amount:10,costItem:"Rent",note:"March"},',
    '  {id:"e2",type:"charge",amount:20,costItem:"Bills",note:"Water"},',
    '  {id:"e3",type:"payment",amount:5,costItem:"Rent",note:""},',
    '  {id:"e4",type:"charge",amount:7,note:"Uncategorized one"},',
    '  {id:"e5",type:"settlement",amount:3,note:"settled"}]}];',
    'function getProject(id){return projects.filter(function(x){return x.id===id})[0]}',
    'function requireEditRights(){return true}',
    'function syncBalance(){}',
    'function showToast(t){_toasts.push(String(t))}',
    'function closeOverlay(){_closed++}',
    'function renderProjectDetail(){_rendered++}',
    'var db={saveProject(){_saved++}};',
    extractFn('categorizedCount'),
    extractFn('doRemoveAllCategories'),
    'return {get projects(){return projects},get toasts(){return _toasts},',
    ' get saved(){return _saved},categorizedCount:categorizedCount,',
    ' doRemoveAllCategories:doRemoveAllCategories};'
  ].join('\n');
  const C = new Function(CAT_SRC)();
  check('it counts what actually carries a category', C.categorizedCount(C.projects[0]), 3);
  C.doRemoveAllCategories();
  const h = C.projects[0].history;
  check('every category is gone', h.filter(function (e) { return e.costItem; }).length, 0);
  check('and every entry is still there', h.length, 5);
  check('with its amount untouched', h[0].amount, 10);
  check('a note that was already text is left alone', h[0].note, 'March');
  /* A row whose note was blank took the category name as its title when it was
     created; clearing the label must not blank the row. */
  check('and a blank note is backstopped rather than emptied', h[2].note, 'Rent');
  check('it saves once', C.saved, 1);
  check('and says how many changed', /3 transactions are no longer categorized/.test(C.toasts.join('|')), true);
  C.doRemoveAllCategories();
  check('running it again changes nothing', C.categorizedCount(C.projects[0]), 0);

  /* The control has to be where she was standing when she wanted it: the
     "Everything is categorized" dialog was a dead end with one Done button. */
  const dlg = extractFn('showCategorizeExpenses');
  check('the dead-end dialog now offers it', (dlg.match(/removeAllCategoriesBtnHtml\(/g) || []).length, 2);
  const btn = extractFn('removeAllCategoriesBtnHtml');
  check('but not to a viewer', /canWriteEntries\(/.test(btn), true);
  const BTN_SRC = [
    'var _may=true;',
    'function canWriteEntries(){return _may}',
    extractFn('categorizedCount'),
    extractFn('removeAllCategoriesBtnHtml'),
    'return {html:removeAllCategoriesBtnHtml,deny:function(){_may=false}};'
  ].join('\n');
  const B = new Function(BTN_SRC)();
  const withCats = { history: [{ type: 'charge', costItem: 'Rent' }] };
  const without = { history: [{ type: 'charge' }] };
  check('it appears when there is something to remove', B.html(withCats).length > 0, true);
  check('and not when there is nothing to remove', B.html(without), '');
  B.deny();
  check('and never to a viewer', B.html(withCats), '');
  check('and the confirm says nothing is deleted',
    /Nothing is deleted/.test(extractFn('confirmRemoveAllCategories')), true);
})();

section('A screenshot of a tracker says Tally on it');
(function () {
  /* Rachel, 17 Sep 2026: "i tried to take a screenshot of the screen to share
     with someone (didnt want to use the whatsapp button), the screenshot
     doesnt show the tally logo and name." The mark lived only on the home
     screen, which is not the screen anyone photographs. */
  check('the brand strip exists', /class="brand-strip"/.test(src), true);
  ['projectDetailView', 'detailView', 'lendingDetailView'].forEach(function (v) {
    const at = src.indexOf('id="' + v + '"');
    const next = src.indexOf('class="page-header"', at);
    const brand = src.indexOf('class="brand-strip"', at);
    check(v + ' carries it above the title', brand > -1 && brand < next, true);
  });
  check('it names the app, not just the mark', /brand-strip-text">Tally</.test(src), true);
  /* AND THERE IS ONLY ONE OF IT (Rachel, 18 Sep 2026). v107 briefly added a
     centred footer under the history too. A footer below a long history is not
     in a screenshot of the TOP, which was the entire reason for the mark - so
     it was either pin it to the screen, spending permanent space on every
     detail view for an occasional screenshot, or drop it. Dropped. */
  check('and there is no footer duplicating it', /brand-footer/.test(src), false);
  check('nor a strapline explaining where to find the app to someone using it',
    /on the App Store and Google Play/.test(src), false);
  /* Above the fold on purpose: a strip at the bottom of a long history is not
     in the picture. */
  check('and it is the same mark as the home screen',
    (src.match(/rect width="48" height="48" rx="11" fill="#e67e22"/g) || []).length >= 3, true);
})();


/* ---- 17 Sep 2026: PARTIAL SETTLEMENT IN A LENDING CIRCLE ------------------
   Rachel: "there's a settle & reset button, which settles all, but what about
   partial settlement similar to what we have in group projects?" - and then
   the sharper half: "when u click + new transaction, it says Rachel paid for
   Diana, but when Diana pays back Rachel, it shouldnt read it as Diana paid
   for Rachel, she didnt, she just paid Rachel back."
   The arithmetic was always available (record the reverse transaction); what
   was missing was the ability to say what actually happened. */
section('A lending circle can be paid down a bit at a time');
(function () {
  const LEND_SRC = [
    'function rd2(n){return Math.round((n+Number.EPSILON)*100)/100}',
    extractFn('getEntriesSinceLastSettlement'),
    extractFn('calcLendingSettlement'),
    extractFn('calcTransfers'),
    'return {calc:calcLendingSettlement,transfers:calcTransfers};'
  ].join('\n');
  const L = new Function(LEND_SRC)();
  const circle = (hist) => ({ type: 'lending', participants: ['Rachel', 'Sam', 'Diana'], history: hist });

  /* Rachel pays for Sam twice; Sam pays half of it back. */
  const lent = [
    { id: 't1', type: 'transfer', from: 'Rachel', to: 'Sam', amount: 100 },
    { id: 't2', type: 'transfer', from: 'Rachel', to: 'Diana', amount: 40 },
  ];
  const a = L.calc(circle(lent.slice()));
  check('a loan puts the lender in credit', a.balances.Rachel, 140);
  check('and the borrower in debt', a.balances.Sam, -100);
  check('outstanding is what is owed, counted once', a.outstanding, 140);
  check('total lent is the gross', a.totalLent, 140);
  check('and nothing is repaid yet', a.totalRepaid, 0);

  /* THE REPAYMENT MOVES MONEY THE SAME WAY A LOAN DOES - identical signs. */
  const withRepay = L.calc(circle([{ id: 'r1', type: 'repayment', from: 'Sam', to: 'Rachel', amount: 60 }].concat(lent)));
  check('a repayment shrinks the debt', withRepay.balances.Sam, -40);
  check('and the credit with it', withRepay.balances.Rachel, 80);
  check('outstanding falls', withRepay.outstanding, 80);
  check('but total lent does NOT grow', withRepay.totalLent, 140);
  check('the repayment is counted separately', withRepay.totalRepaid, 60);
  /* Which is the whole point: logged as a reverse transaction it would read as
     Sam lending Rachel 60, and "total lent" would have said 200. */

  /* Paying the lot off leaves nothing outstanding, and the history intact. */
  const done = L.calc(circle([
    { id: 'r2', type: 'repayment', from: 'Diana', to: 'Rachel', amount: 40 },
    { id: 'r1', type: 'repayment', from: 'Sam', to: 'Rachel', amount: 100 },
  ].concat(lent)));
  check('repaid in full, nothing is outstanding', done.outstanding, 0);
  check('everyone is square', [done.balances.Rachel, done.balances.Sam, done.balances.Diana].join(','), '0,0,0');
  check('and the record of what was lent survives', done.totalLent, 140);
  check('as does the record of what came back', done.totalRepaid, 140);
  check('so Settle Up has nothing left to ask for', L.transfers(done.balances).length, 0);

  /* Overpaying turns the debt around - which is legal, and guarded. */
  const over = L.calc(circle([{ id: 'r3', type: 'repayment', from: 'Sam', to: 'Rachel', amount: 150 }].concat(lent)));
  check('overpaying flips who owes whom', over.balances.Sam, 50);
  check('and Rachel, overpaid, ends up in debit', over.balances.Rachel, -10);
  /* Outstanding counts the CREDITS once. Sam is owed 50; Diana's 40 of debt is
     the other side of money Rachel no longer has a net claim on. */
  check('and the outstanding figure follows', over.outstanding, 50);

  /* A settlement still draws the line: entries before it are a closed round. */
  const afterSettle = L.calc(circle([
    { id: 't3', type: 'transfer', from: 'Sam', to: 'Diana', amount: 25 },
    { id: 's1', type: 'settlement', amount: 0, note: 'Settlement' },
  ].concat(lent)));
  check('a settlement scopes the round', afterSettle.outstanding, 25);
  check('and the old loans are behind the line', afterSettle.totalLent, 25);

  /* ---- ONE NUMBER EVERYWHERE. p.balance drives the home card; it used to be
     the gross total lent, which never fell, so a fully repaid circle still
     shouted the original figure. ---- */
  const BAL_SRC = [
    'function rd2(n){return Math.round((n+Number.EPSILON)*100)/100}',
    'function amtMain(p,h){return h.amount}',
    extractFn('getEntriesSinceLastSettlement'),
    extractFn('calcLendingSettlement'),
    extractFn('calcBalance'),
    'return calcBalance;'
  ].join('\n');
  const bal = new Function(BAL_SRC)();
  check('the home card shows what is still owed', bal(circle(lent.slice())), 140);
  check('and it falls as debts are paid',
    bal(circle([{ id: 'r1', type: 'repayment', from: 'Sam', to: 'Rachel', amount: 60 }].concat(lent))), 80);
  check('and reaches zero when the circle is square',
    bal(circle([
      { id: 'r2', type: 'repayment', from: 'Diana', to: 'Rachel', amount: 40 },
      { id: 'r1', type: 'repayment', from: 'Sam', to: 'Rachel', amount: 100 },
    ].concat(lent))), 0);
  /* A group project's balance must NOT have changed with it. */
  check('a group project still totals its expenses',
    bal({ type: 'group', participants: ['A', 'B'],
          history: [{ type: 'charge', amount: 30 }, { type: 'charge', amount: 12 }] }), 42);

  /* ---- what the rows SAY, which is the half she actually reported ---- */
  const render = extractFn('renderLendingDetail');
  check('a loan reads as words, not an arrow', /paid for/.test(render), true);
  check('a repayment says what it is', /repaid/.test(render), true);
  /* THE ARROW MEANT TWO THINGS ONE SCREEN APART: in the log "Rachel -> Diana"
     meant Rachel PAID; in Settle Up the same arrow means Rachel OWES. */
  const rowBlock = (render.match(/const line=[\s\S]{0,400}/) || [''])[0];
  check('and the log row carries no arrow at all', /→/.test(rowBlock), false);
  check('Settle Up says "to pay", no arrow (24 Sep 2026)',
    />→</.test(render) === false && />to pay</.test(render), true);
  /* STRINGS AND SHAPES ONLY. `h` is a local the minifier renames and terser
     rewrites every single quote as a double one. */
  check('the history shows repayments too',
    new RegExp('[\\w$]+\\.type===' + Q + 'repayment' + Q).test(render), true);

  /* ---- the dashboard leads with the useful number ---- */
  check('the headline is what is still owed', /Still Owed/.test(render), true);
  check('and what was lent is kept as context underneath', /lent/.test(render), true);
  check('"Total Transactions" is gone as a headline',
    /balance-label">Total Transactions/.test(render), false);
  /* The label is built from a ternary whose variable the minifier renames, so
     check the two words it can produce and the element they land in. */
  check('and the label really is the outstanding one',
    /balance-label/.test(render) && /Outstanding/.test(render), true);

  /* ---- the control, and the guard behind it ---- */
  check('there is a Record Repayment button', /showLendingRepaymentInput\(\)/.test(src), true);
  const form = extractFn('showLendingRepaymentInput');
  check('it pre-fills from what is actually owed', /calcTransfers\(/.test(form), true);
  check('and shows the outstanding debts', /Outstanding right now/.test(form), true);
  check('a viewer cannot open it', /canWriteEntries\(/.test(form), true);
  const conf = extractFn('confirmLendingRepayment');
  check('it refuses a repayment to yourself', /Pick two different people/.test(conf), true);
  check('it warns before flipping the debt', /More than owed/.test(conf), true);
  check('and writes a repayment, not a transfer',
    new RegExp('type:' + Q + 'repayment' + Q).test(conf), true);
  check('a viewer cannot record one either', /requireEditRights\(/.test(conf), true);
  /* The edit sheet named a repayment "Who paid / Paid for" - the exact
     sentence she objected to. */
  const sheet = extractFn('showLendingEntryActions');
  check('the edit sheet knows which kind it is showing',
    /Who repaid/.test(sheet) && /Who paid/.test(sheet), true);
  check('and titles it a Repayment rather than a Transaction',
    /Repayment/.test(sheet) && /Transaction/.test(sheet), true);
  /* THE TYPE IS NOT EDITABLE FROM THAT SHEET, on purpose: turning a loan into
     a repayment with a dropdown is how a history stops meaning anything. */
  check('but it cannot turn one kind into the other',
    new RegExp('type=' + Q + 'repayment' + Q).test(extractFn('doEditLendingEntry')), false);
  /* Settling a round of nothing but repayments is still settling a round. */
  check('a round of repayments can still be closed',
    new RegExp('[\\w$]+\\.type===' + Q + 'transfer' + Q + '\\|\\|[\\w$]+\\.type===' + Q + 'repayment' + Q)
      .test(extractFn('showLendingSettleConfirm')), true);
})();

/* ---- 23 Sep 2026: NOTHING DISAPPEARS -------------------------------------
   Cancelling the last invite left two trackers under one id: an empty one on
   screen and the full one behind it. These run the REAL safety nets. */
section('Nothing disappears (23 Sep 2026)');
(function () {
  const sb = new Function([
    'var _bin=[],_nid=0,BIN_DAYS=30,BIN_MAX=30,_lgBase={};',
    'function genId(){return "b"+(++_nid)}',
    'var db={readBin(){return _bin.slice()},writeBin(l){_bin=l.slice();return true}};',
    'function isShared(p){return !!(p&&p.shared&&p.ledgerId)}',
    'function hydrateStub(p){return p}',
    extractFn('_mts'),
    extractFn('mergeHistories'),
    extractFn('pruneBin'),
    extractFn('binProject'),
    extractFn('healDuplicateProjects'),
    'var _safetyTaken={};',
    extractFn('watchForLoss'),
    'return {heal:healDuplicateProjects,watch:watchForLoss,get bin(){return _bin}};'
  ].join('\n'))();
  const h = function (n) { const a = []; for (let i = 0; i < n; i++) a.push({ id: 'e' + i, type: 'charge', amount: 10, date: '2026-09-0' + (1 + i % 9) }); return a; };

  /* the exact state the bug left behind */
  const healed = sb.heal([
    { id: 'p1', name: 'Living Home Decor', history: [] },
    { id: 'p2', name: 'Other', history: h(1) },
    { id: 'p1', name: 'Living Home Decor', history: h(5) }
  ]);
  check('two copies under one id become one', healed.filter(function (x) { return x.id === 'p1'; }).length, 1);
  check('and it is the one with the entries', (healed.filter(function (x) { return x.id === 'p1'; })[0].history || []).length, 5);
  check('in the first copy\'s place on the list', healed[0].id, 'p1');
  check('and nothing else is touched', healed.length, 2);
  /* a stub and a local copy: the local copy wins, and entries from both are kept */
  const mixed = sb.heal([
    { id: 'p1', shared: true, ledgerId: 'lg_1', history: [{ id: 'x9', date: '2026-09-09' }] },
    { id: 'p1', history: h(3) }
  ]);
  check('a local copy wins over a ledger stub', !!mixed[0].shared, false);
  check('and entries from every copy are kept', mixed[0].history.length, 4);
  const clean = [{ id: 'a' }, { id: 'b' }];
  check('a list with no duplicates comes back untouched', sb.heal(clean) === clean, true);

  /* the loss watch */
  sb.watch([{ id: 'p1', name: 'Rent', history: h(4) }], [{ id: 'p1', name: 'Rent', history: [] }]);
  check('a tracker being emptied is copied to Recently Removed first', sb.bin.length, 1);
  check('with its entries', sb.bin[0].entries, 4);
  check('marked as a safety copy', sb.bin[0].why, 'safety');
  sb.watch([{ id: 'p1', name: 'Rent', history: h(4) }], [{ id: 'p1', name: 'Rent', history: [] }]);
  check('the same loss is not copied twice', sb.bin.length, 1);
  sb.watch([{ id: 'p3', name: 'Gone', history: h(2) }], []);
  check('a tracker vanishing is copied too', sb.bin.length, 2);
  sb.watch([{ id: 'p4', name: 'Edit', history: h(3) }], [{ id: 'p4', history: h(2) }]);
  check('one entry deleted is an ordinary edit, not a loss', sb.bin.length, 2);
  sb.watch([{ id: 'p5', name: 'Shared', history: h(3) }], [{ id: 'p5', shared: true, ledgerId: 'lg', history: [] }]);
  check('a ledger stub arriving without history is not a loss', sb.bin.length, 2);

  /* and where they are wired in */
  const snapFn = extractFn('startFirestoreSync');
  check('account snapshots are held while an unshare folds back', /_syncHold>0\)return/.test(snapFn), true);
  const acs = /applyCloudSnapshot\([\w$]+\)\{[\s\S]*?\n?\s*\},/.exec(src);
  const acsSrc = acs ? acs[0] : '';
  check('applyCloudSnapshot heals duplicates', /healDuplicateProjects\(/.test(acsSrc), true);
  check('applyCloudSnapshot watches for loss', /watchForLoss\(/.test(acsSrc), true);
  check('applyCloudSnapshot updates the same objects in place', /Object\.assign\(/.test(acsSrc), true);
  check('a folded-back ledger can never come back as a stub', /_unsharing\[[\w$]+\.ledgerId\]/.test(acsSrc), true);
  check('the fold-back is re-asserted after the network waits',
    (extractAsyncFn('unshareLedger').match(/Object\.assign\(/g) || []).length >= 1, true);
  check('every push heals duplicates first', /healDuplicateProjects\([\w$]+\)[;,][\s\S]{0,700}projectsForCloud\(\)/.test(src), true);
})();

/* ============================ RESULTS ============================ */
Promise.all(_deletionChecks.concat(_signOutChecks).concat(_reauthChecks).concat(_pushChecks).concat(_unshareChecks)).then(function () {
  console.log('\n' + (fail ? `❌ ${fail} FAILED, ${pass} passed` : `✅ ALL ${pass} TESTS PASSED`));
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.error('\n❌ Deletion tests threw: ' + (e && e.stack || e));
  process.exit(1);
});
