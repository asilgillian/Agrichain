/**
 * Generate a QuickBooks-ready journal import from the client's cash ledger.
 *
 * Reads the cleaned, pre-classified cash ledger (scripts/src/data/cash-ledger.json)
 * and emits:
 *   - exports/quickbooks-cash-ledger-import.csv     (double-entry journal, UGX)
 *   - exports/quickbooks-cash-ledger-reconciliation.md
 *
 * The script is deterministic and idempotent: re-running overwrites both outputs
 * with identical content. It asserts that categorised totals tie back to each
 * batch's P&L (TOTAL EXPENDITURE and REVENUE) taken from the workbook, allowing
 * only documented variances.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

type Category =
  | "COGS"
  | "OPERATING"
  | "FUNDING_IN"
  | "TRANSFER_OUT"
  | "REVENUE"
  | "BALANCE_BF";

interface Line {
  batch: string;
  date: string;
  particulars: string;
  direction: "in" | "out";
  amount: number;
  category: Category;
  subAccount?: string;
  vendor?: string;
  grade?: string;
  settledToBank?: boolean;
}

interface Ledger {
  currency: string;
  source: string;
  batches: string[];
  targets: Record<string, { expenditure: number; revenue: number }>;
  lines: Line[];
}

// Chart of accounts (per the agreed integration plan)
const ACC = {
  fieldCash: "Field Cash & Mobile Money Float",
  bank: "Stanbic Bank — UGX",
  cogs: "Cost of Goods Sold — Coffee Purchases",
  revenue: "Sales Revenue — Coffee",
  operating: (sub: string) => `Operating Expenses:${sub}`,
};

const BUYER = "Historical Ledger Buyer (TBC)";

// Documented, accepted variance between cash-ledger categorised expenditure and
// the workbook's TOTAL EXPENDITURE figure, per batch (UGX).
const ACCEPTED_EXP_VARIANCE: Record<string, { amount: number; reason: string }> = {
  "Batch 3": {
    amount: 43700,
    reason:
      "Bank charge of 43,700 posted after the batch float was refunded/closed; excluded from the workbook's batch P&L but retained here as a real cash outflow.",
  },
};

interface JournalRow {
  journalNo: string;
  date: string;
  currency: string;
  memo: string;
  account: string;
  debit: number | "";
  credit: number | "";
  name: string;
  className: string;
}

function fmt(n: number): string {
  // UGX: keep up to 2 decimals but drop trailing zeros
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildJournal(ledger: Ledger): JournalRow[] {
  const rows: JournalRow[] = [];
  let seq = 0;
  const push = (
    line: Line,
    drAcc: string,
    crAcc: string,
    name: string,
  ) => {
    seq += 1;
    const journalNo = `JE-${String(seq).padStart(4, "0")}`;
    const base = {
      journalNo,
      date: line.date,
      currency: ledger.currency,
      memo: line.particulars,
      name,
      className: line.batch,
    };
    rows.push({ ...base, account: drAcc, debit: line.amount, credit: "" });
    rows.push({ ...base, account: crAcc, debit: "", credit: line.amount });
  };

  for (const line of ledger.lines) {
    if (line.amount <= 0) continue;
    switch (line.category) {
      case "BALANCE_BF":
        // Carry-over of the same float account between batches: not a new cash
        // movement, so no journal entry is created.
        break;
      case "COGS":
        push(line, ACC.cogs, ACC.fieldCash, line.vendor ?? "");
        break;
      case "OPERATING":
        push(line, ACC.operating(line.subAccount ?? "Sundry"), ACC.fieldCash, "");
        break;
      case "FUNDING_IN":
        push(line, ACC.fieldCash, ACC.bank, "");
        break;
      case "TRANSFER_OUT":
        push(line, ACC.bank, ACC.fieldCash, "");
        break;
      case "REVENUE": {
        const cashSide = line.settledToBank ? ACC.bank : ACC.fieldCash;
        push(line, cashSide, ACC.revenue, BUYER);
        break;
      }
    }
  }
  return rows;
}

function sumBy(lines: Line[], pred: (l: Line) => boolean): number {
  return lines.filter(pred).reduce((a, l) => a + l.amount, 0);
}

function reconcile(ledger: Ledger): string {
  const out: string[] = [];
  out.push("# QuickBooks Cash-Ledger Import — Reconciliation Summary");
  out.push("");
  out.push(`Source: ${ledger.source}`);
  out.push(`Home currency: ${ledger.currency} (no USD-denominated line items were found in the cash ledger).`);
  out.push("");
  out.push(
    "Each cash-ledger line is posted as a balanced double-entry journal. " +
      "Coffee payments post to **Cost of Goods Sold**; field costs " +
      "(transport, fuel, milling/processing, loading/handling, subsistence, " +
      "commissions, bank charges, sundry) post to **Operating Expenses**; " +
      "funds advanced to the field post as a **bank transfer** (Stanbic → Field " +
      "Cash/Mobile-Money float), not as an expense; and sales post to **Sales " +
      "Revenue**.",
  );
  out.push("");
  out.push("## Per-batch reconciliation (UGX)");
  out.push("");
  out.push(
    "| Batch | COGS | Operating | COGS + Operating | Workbook expenditure | Δ | Revenue (posted) | Workbook revenue | Δ |",
  );
  out.push("|---|--:|--:|--:|--:|--:|--:|--:|--:|");

  let totCogs = 0,
    totOpex = 0,
    totRev = 0;
  const num = (n: number) => n.toLocaleString("en-US");

  for (const b of ledger.batches) {
    const ls = ledger.lines.filter((l) => l.batch === b);
    const cogs = sumBy(ls, (l) => l.category === "COGS");
    const opex = sumBy(ls, (l) => l.category === "OPERATING");
    const rev = sumBy(ls, (l) => l.category === "REVENUE");
    totCogs += cogs;
    totOpex += opex;
    totRev += rev;
    const t = ledger.targets[b]!;
    const expDelta = cogs + opex - t.expenditure;
    const revDelta = rev - t.revenue;
    out.push(
      `| ${b} | ${num(cogs)} | ${num(opex)} | ${num(cogs + opex)} | ${num(
        t.expenditure,
      )} | ${num(expDelta)} | ${num(rev)} | ${num(t.revenue)} | ${num(revDelta)} |`,
    );
  }
  const totExp = Object.values(ledger.targets).reduce((a, t) => a + t.expenditure, 0);
  const totRevT = Object.values(ledger.targets).reduce((a, t) => a + t.revenue, 0);
  out.push(
    `| **All** | **${num(totCogs)}** | **${num(totOpex)}** | **${num(
      totCogs + totOpex,
    )}** | **${num(totExp)}** | **${num(totCogs + totOpex - totExp)}** | **${num(
      totRev,
    )}** | **${num(totRevT)}** | **${num(totRev - totRevT)}** |`,
  );
  out.push("");

  // Other (non-P&L) cash movements
  const funding = sumBy(ledger.lines, (l) => l.category === "FUNDING_IN");
  const transferOut = sumBy(ledger.lines, (l) => l.category === "TRANSFER_OUT");
  const balBf = sumBy(ledger.lines, (l) => l.category === "BALANCE_BF");
  out.push("## Other cash movements (balance-sheet, not P&L)");
  out.push("");
  out.push(`- Field funding transfers in (Stanbic → field float): ${num(funding)}`);
  out.push(`- Transfers / refunds back to bank: ${num(transferOut)}`);
  out.push(
    `- Opening float carried between batches (balance b/f, not re-posted): ${num(balBf)}`,
  );
  out.push("- Capex (equipment/vehicles): 0 — no capital purchases appear in the field cash ledger.");
  out.push(
    "- Fixed costs (water, electricity, rent, legal, accounting): 0 — entered directly in QuickBooks per the plan, not generated by field activity.",
  );
  out.push("");
  out.push("## Notes & variances");
  out.push("");
  for (const [b, v] of Object.entries(ACCEPTED_EXP_VARIANCE)) {
    out.push(`- **${b}** Δ ${num(v.amount)}: ${v.reason}`);
  }
  out.push(
    "- Batches 1 & 2 sale proceeds are recorded in the cash ledger and post against the field float; batches 3–5 graded sales are taken from the workbook's per-grade REVENUE tables and post as settled to the Stanbic (UGX) bank account.",
  );
  out.push(
    "- Coffee advances and part/additional payments to the same supplier are all classed as COGS (they settle one coffee purchase).",
  );
  out.push(
    "- Minor field tools (sampling spear, padlock, stationery) are expensed to Operating Expenses:Sundry on materiality grounds rather than capitalised.",
  );
  return out.join("\n") + "\n";
}

/** Spreadsheet-friendly CSV version of the per-batch reconciliation. */
function reconcileCsv(ledger: Ledger): string {
  const rows: (string | number)[][] = [];
  rows.push([
    "Batch",
    "COGS",
    "Operating",
    "COGS+Operating",
    "WorkbookExpenditure",
    "ExpenditureDelta",
    "RevenuePosted",
    "WorkbookRevenue",
    "RevenueDelta",
  ]);
  let totCogs = 0,
    totOpex = 0,
    totRev = 0;
  for (const b of ledger.batches) {
    const ls = ledger.lines.filter((l) => l.batch === b);
    const cogs = sumBy(ls, (l) => l.category === "COGS");
    const opex = sumBy(ls, (l) => l.category === "OPERATING");
    const rev = sumBy(ls, (l) => l.category === "REVENUE");
    totCogs += cogs;
    totOpex += opex;
    totRev += rev;
    const t = ledger.targets[b]!;
    rows.push([
      b,
      fmt(cogs),
      fmt(opex),
      fmt(cogs + opex),
      fmt(t.expenditure),
      fmt(cogs + opex - t.expenditure),
      fmt(rev),
      fmt(t.revenue),
      fmt(rev - t.revenue),
    ]);
  }
  const totExp = Object.values(ledger.targets).reduce((a, t) => a + t.expenditure, 0);
  const totRevT = Object.values(ledger.targets).reduce((a, t) => a + t.revenue, 0);
  rows.push([
    "All",
    fmt(totCogs),
    fmt(totOpex),
    fmt(totCogs + totOpex),
    fmt(totExp),
    fmt(totCogs + totOpex - totExp),
    fmt(totRev),
    fmt(totRevT),
    fmt(totRev - totRevT),
  ]);

  // Blank row, then non-P&L cash movements as labelled rows.
  rows.push([]);
  rows.push(["Other cash movements (balance-sheet, not P&L)", "Amount"]);
  rows.push([
    "Field funding transfers in (Stanbic -> field float)",
    fmt(sumBy(ledger.lines, (l) => l.category === "FUNDING_IN")),
  ]);
  rows.push([
    "Transfers / refunds back to bank",
    fmt(sumBy(ledger.lines, (l) => l.category === "TRANSFER_OUT")),
  ]);
  rows.push([
    "Opening float carried between batches (balance b/f, not re-posted)",
    fmt(sumBy(ledger.lines, (l) => l.category === "BALANCE_BF")),
  ]);
  rows.push(["Capex (equipment/vehicles)", 0]);
  rows.push(["Fixed costs (water, electricity, rent, legal, accounting)", 0]);

  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

// Coffee suppliers seen in the ledger; used to catch coffee purchases that are
// not tagged COGS (e.g. lines that name a supplier but omit the word "coffee").
const COFFEE_VENDOR_TOKENS = [
  "julius",
  "rubirizi",
  "natema",
  "gurama",
  "segawa",
  "ssenyondo",
  "robert",
  "katwalo",
  "vicent",
  "vincent",
  "kafeero",
  "katumba",
  "ddamulira",
  "deus",
  "brendon",
  "ronald",
];
const TRANSPORTY = [
  "transport",
  "processing",
  "movement",
  "loading",
  "weighing",
  "grading",
  "drying",
  "colour",
  "milling",
  "reprocess",
  "truck hire",
  "car hire",
  "offload",
  "weighbridge",
  "rebagging",
  "handpicking",
  "handling",
];

/** Throw if a cash-out line looks like a coffee purchase but is not tagged COGS. */
function assertNoMisclassifiedPurchases(lines: Line[]): void {
  const bad: string[] = [];
  for (const l of lines) {
    if (l.direction !== "out" || l.category === "COGS") continue;
    const pl = l.particulars.toLowerCase();
    if (TRANSPORTY.some((k) => pl.includes(k))) continue; // freight/processing, not a purchase
    const looksLikePurchase =
      /purchase of [\d,]+\s*kg/.test(pl) ||
      (pl.includes("coffee") &&
        (pl.includes("payment") || pl.includes("purchase") || pl.includes("advance"))) ||
      (COFFEE_VENDOR_TOKENS.some((v) => pl.includes(v)) &&
        (pl.includes("payment") || pl.includes("purchase") || pl.includes("advance")));
    if (looksLikePurchase) {
      bad.push(`${l.batch} "${l.particulars}" -> ${l.category}`);
    }
  }
  if (bad.length) {
    throw new Error(
      "Lines look like coffee purchases but are not tagged COGS:\n" + bad.join("\n"),
    );
  }
}

function main(): void {
  const dataPath = resolve(__dirname, "data/cash-ledger.json");
  const ledger = JSON.parse(readFileSync(dataPath, "utf8")) as Ledger;

  assertNoMisclassifiedPurchases(ledger.lines);

  // Build journal + verify it is internally balanced.
  const rows = buildJournal(ledger);
  const totalDebit = rows.reduce((a, r) => a + (r.debit === "" ? 0 : r.debit), 0);
  const totalCredit = rows.reduce((a, r) => a + (r.credit === "" ? 0 : r.credit), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Journal is not balanced: debits ${totalDebit} vs credits ${totalCredit}`,
    );
  }

  // Reconciliation asserts (allow documented variances).
  const problems: string[] = [];
  for (const b of ledger.batches) {
    const ls = ledger.lines.filter((l) => l.batch === b);
    const cogs = sumBy(ls, (l) => l.category === "COGS");
    const opex = sumBy(ls, (l) => l.category === "OPERATING");
    const rev = sumBy(ls, (l) => l.category === "REVENUE");
    const t = ledger.targets[b]!;
    const allowed = ACCEPTED_EXP_VARIANCE[b]?.amount ?? 0;
    if (Math.abs(cogs + opex - t.expenditure) > allowed + 0.01) {
      problems.push(
        `${b}: expenditure ${cogs + opex} vs target ${t.expenditure} (Δ ${
          cogs + opex - t.expenditure
        }, allowed ${allowed})`,
      );
    }
    if (Math.abs(rev - t.revenue) > 0.01) {
      problems.push(`${b}: revenue ${rev} vs target ${t.revenue}`);
    }
  }
  if (problems.length) {
    throw new Error("Reconciliation failed:\n" + problems.join("\n"));
  }

  // Write CSV
  const header = [
    "JournalNo",
    "JournalDate",
    "Currency",
    "Memo",
    "AccountName",
    "Debits",
    "Credits",
    "Name",
    "Class",
  ];
  const csvLines = [header.join(",")];
  for (const r of rows) {
    csvLines.push(
      [
        r.journalNo,
        r.date,
        r.currency,
        r.memo,
        r.account,
        r.debit === "" ? "" : fmt(r.debit),
        r.credit === "" ? "" : fmt(r.credit),
        r.name,
        r.className,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const csvPath = resolve(ROOT, "exports/quickbooks-cash-ledger-import.csv");
  const mdPath = resolve(ROOT, "exports/quickbooks-cash-ledger-reconciliation.md");
  const reconCsvPath = resolve(
    ROOT,
    "exports/quickbooks-cash-ledger-reconciliation.csv",
  );
  mkdirSync(dirname(csvPath), { recursive: true });
  writeFileSync(csvPath, csvLines.join("\n") + "\n");
  writeFileSync(mdPath, reconcile(ledger));
  writeFileSync(reconCsvPath, reconcileCsv(ledger));

  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${rows.length} journal rows (${rows.length / 2} entries) to ${csvPath}\n` +
      `Wrote reconciliation to ${mdPath}\n` +
      `Wrote reconciliation CSV to ${reconCsvPath}\n` +
      `Balanced: debits == credits == ${totalDebit.toLocaleString("en-US")} UGX`,
  );
}

main();
