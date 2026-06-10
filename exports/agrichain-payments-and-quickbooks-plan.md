# AgriChain — Mobile Money & QuickBooks Integration Plan

*Prepared for management, finance, and operator/partner discussions.*
*AgriChain — Mtandeo Commodities Ltd, Uganda.*

---

## Executive summary

AgriChain can pay farmers and suppliers, and collect from buyers, directly through the **MTN MoMo** and **Airtel Money** APIs — this is normal *merchant* use and requires **no special payment-systems licence**. "Becoming our own payment gateway/aggregator" for *other* businesses is a different, regulated activity that requires a **Bank of Uganda licence** and is a company/regulatory project, not a software feature.

Separately, **QuickBooks** can be connected so AgriChain's financial events (payments, procurement spend, sales) flow into the books automatically, removing manual re-entry.

The recommended sequence: wire up mobile-money **disbursements** (sandbox first), confirm settlement of mobile-money payments, then connect QuickBooks so the books only ever reflect real, settled cash.

---

# Part A — QuickBooks Integration Plan

## 1. Goal
Get AgriChain's financial events into QuickBooks automatically so the books reflect real procurement spend, payments, and sales — without manual data entry.

## 2. Direction & grain (the two decisions that shape everything)

- **Direction:** One-way push, AgriChain → QuickBooks. AgriChain remains the operational source of truth; QuickBooks is the book of record. (Two-way sync is far more complex and not needed.)
- **Grain — recommended:** **Daily summarised journal entries per buying station**, not every individual delivery. A field operation can generate thousands of micro-payments a day; pushing each one bloats QuickBooks and makes reconciliation difficult. We push one summarised entry per station per day, with drill-down references back to AgriChain.
  - *Alternative (only if the accountant insists):* transaction-level — each supplier/farmer payment as a Bill/Expense and each sale as an Invoice. This can be added later if required.

## 3. What maps to what

| AgriChain event | QuickBooks object | Notes |
|---|---|---|
| Farmer / supplier payment (money out) | Expense / Bill Payment (or summarised Journal Entry) | Farmers & suppliers = QuickBooks **Vendors** |
| Cash-float top-up & deductions | Transfer / Journal Entry | Internal movement; tracks agent cash accountability |
| Sale to a buyer (money in) | Sales Receipt / Invoice | Buyers = QuickBooks **Customers** |
| Commodity (coffee, maize, etc.) | Product/Service **Item** | One item per commodity in the catalogue |
| Procurement cost by commodity | Mapped to expense / COGS accounts | Drives margin reporting |

## 4. Chart-of-accounts mapping (needs the accountant's sign-off)
Before any code, finance decides which QuickBooks accounts these events hit — e.g. "Crop Purchases (COGS)", "Mobile Money Clearing", "Cash Float — Field Agents", "Sales Revenue". **This is a business decision, not a technical one.** A simple mapping table will be provided for finance to complete.

## 5. Phasing

| Phase | Scope | Code? |
|---|---|---|
| **Phase 0 — Decisions** | Confirm grain + chart-of-accounts mapping with the accountant | No |
| **Phase 1 — Connect & masters** | Connect QuickBooks; sync vendors (farmers/suppliers), customers (buyers), items (commodities) | Yes |
| **Phase 2 — Money out** | Push payments / procurement as daily summarised entries | Yes |
| **Phase 3 — Money in** | Push sales | Yes |
| **Phase 4 — Reconciliation aids** | Sync log + status indicators in the back office; retry failures | Yes |

## 6. Effort & key dependency
Moderate build, mostly back-office and API-server work. **Key dependency:** if mobile-money payments are still unsettled (recorded as pending), they must not post to QuickBooks as cleared. **Sequence Phase 2 (money-out) after the mobile-money settlement is resolved** (see Part B).

## 7. Connection method
QuickBooks connects via secure OAuth (log in with the QuickBooks account; no API keys to copy around). It exposes QuickBooks' accounting REST API for the objects above.

---

# Part B — Direct MTN & Airtel integration, and "being our own gateway"

## 1. The APIs exist and are open to us
Both operators provide modern REST APIs with self-service sandboxes:

- **MTN MoMo Open API** (launched in Uganda first, 2018): **Collections** (receive money) and **Disbursements** (pay out to wallets). Self-service sandbox at `momodeveloper.mtn.com`; production requires KYC, a registered Ugandan company, and an MTN account manager. Go-live ~10 days after testing.
- **Airtel Money API** (`developers.airtel.africa`): the same Collections + Disbursements model, OAuth2, sandbox → KYC → go-live.

This maps directly onto AgriChain's existing payment design: **Disbursements** = paying farmers/suppliers; **Collections** = receiving payments from buyers.

## 2. The critical distinction on "being our own gateway"
There are two very different things with very different legal consequences:

- **(A) Using the APIs to pay our own counterparties** (farmers, suppliers) and collect from our own buyers — this is normal **merchant** use. **No payment-systems licence required.** We integrate directly and settle to our own bank. *This is what AgriChain actually needs.*
- **(B) Becoming an aggregator/gateway** — facilitating payments **on behalf of other businesses** — under Uganda's **National Payment Systems Act 2020**, an aggregator/integrator/payment gateway is a regulated **Payment System Operator (PSO)**. Requirements include:
  - A Bank of Uganda PSO licence
  - **NITA-U** systems certification (obtained first)
  - **FIA** (Financial Intelligence Authority) registration
  - **Minimum paid-up capital ~UGX 100M–500M** depending on class
  - AML/CFT policy, business plan, audited financials, and ongoing annual reporting to BoU / NITA-U / FIA

So "be our own gateway that eventually pushes to the bank" is feasible but is a **company/regulatory project**, not a software feature — only worth pursuing if AgriChain intends to offer payments as a service to **third parties**. For running AgriChain itself, option (A) is all that is needed and is far faster.

## 3. How money actually reaches the bank
Money does not move from MoMo straight into a bank account via API. The flow is:

1. Funds sit in the **MoMo business wallet** as e-money.
2. We trigger **self-liquidation / settlement** (on-demand, or a scheduled daily/weekly standing order).
3. The operator converts the e-money to cash via its **escrow / partner bank**.
4. Cash lands in the **corporate bank account**.

The operator's escrow bank is the bridge between e-money and the banking system; "pushing to the bank" is the settlement step, configurable as a standing order. **Merchant fees apply** (MTN charges roughly 1% for individual merchants and 2% for business merchants on received payments).

## 4. Recommendation
- **Do (A) now:** wire MTN + Airtel **Disbursements** into the existing payment path so farmer/supplier payouts go out automatically — sandbox first. Add **Collections** if/when buyers should pay via MoMo. Settlement to the bank = a standing order configured with the operator (no code).
- **Treat (B) as a separate strategic decision** — only if monetising payments for other agribusinesses. A licensing roadmap can be drafted separately if that is on the table.

---

## Appendix — Sandbox configuration values

| Variable | Sandbox value / how to obtain |
|---|---|
| `MTN_MOMO_HOST` | `https://sandbox.momodeveloper.mtn.com` (fixed sandbox URL) |
| `MTN_MOMO_SUBSCRIPTION_KEY` | From your MTN developer profile after subscribing to a product (Collections/Disbursements) at `momodeveloper.mtn.com` |
| `MTN_MOMO_USER_ID` | Self-generated in sandbox: `POST /v1_0/apiuser` (returns a UUID you supply) |
| `MTN_MOMO_API_KEY` | Self-generated in sandbox: `POST /v1_0/apiuser/{userId}/apikey` (shown once — save immediately) |
| `AIRTEL_MONEY_HOST` | `https://openapiuat.airtel.africa` (fixed staging/sandbox URL) |
| `AIRTEL_MONEY_CLIENT_ID` | From "Key Management" after creating an application at `developers.airtel.africa` |
| `AIRTEL_MONEY_CLIENT_SECRET` | From "Key Management" alongside the client ID |

**Production note:** in MTN production the host becomes `https://proxy.momoapi.mtn.com` and the target-environment header changes from `sandbox` to `mtnuganda`; the User ID and API Key come from the MTN Partner Portal (not self-generated). Airtel production host becomes `https://openapi.airtel.africa`.
