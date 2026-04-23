# MTANDEO COMMODITIES LTD — Build Budget & Milestone Plan

**Project:** Uganda-Localized Digital Agriculture Platform
**Scope:** 11 modules · agri-web (admin) + agri-mobile (Expo) · UGX, +256, MTN/Airtel Money · Farmer-to-export auditability
**Prepared:** April 2026
**Author:** Engineering Lead

---

## 1. Where the project stands today

| Layer | % Complete | Notes |
|---|---|---|
| Database schema (farmers, groups, regions, plots, contracts, deliveries, workflows, audit, payments, loans, sales, exports, certifications, warehouse, assets) | 90% | Drizzle schemas in `lib/db/src/schema/` |
| Auth (Clerk) + RBAC (14 roles, granular permissions) | 95% | `lib/db` roles seeded, middleware live |
| Procurement engine (configurable workflow master, dual-approver gates, CORRECTION rewind, INFO_CHECKPOINT skip, reorder safety) | 100% | Just shipped |
| Admin UI shell (web) | 60% | Procurement + workflows + farmers/regions live; loans, exports, sales lists pending |
| Mobile UI shell (Expo) | 35% | Auth + farmer registration screens; field data capture pending |
| API server (REST + OpenAPI codegen) | 70% | Procurement, workflows, admin, regions live; payments/loans/exports endpoints pending |
| Reporting & dashboards | 10% | Stubs only |
| Integrations (MTN/Airtel Money, certification bodies, banks) | 0% | Not started |

**Overall: ~50% of v1 scope complete.**

---

## 2. What's left to build (v1)

### Module status
| # | Module | Status | Effort remaining |
|---|---|---|---|
| 1 | Farmer Registration & KYC | 70% done | 1 wk polish |
| 2 | Plot Mapping (GPS) | 40% | 2 wks (mobile GPS, polygon draw) |
| 3 | Agronomy Surveys & Visits | 50% | 2 wks |
| 4 | Procurement (deliveries, weight, QC, pricing) | 95% | 0.5 wk polish |
| 5 | Activity Funds | 60% | 1 wk |
| 6 | Payments (mobile money + bank) | 20% | 3 wks (incl. MTN/Airtel sandbox + reconciliation) |
| 7 | Loans & Inputs Credit | 30% | 2 wks |
| 8 | Warehouse & Lots | 50% | 1.5 wks |
| 9 | Sales & Contracts | 30% | 2 wks |
| 10 | Exports & Logistics | 10% | 3 wks (incl. shipping docs, BoL, certificates) |
| 11 | Compliance & Certifications (Rainforest Alliance, Fairtrade, Organic) | 20% | 2 wks |
| — | Reporting / dashboards / KPIs | 10% | 2 wks |
| — | Notifications (SMS + email + in-app) | 0% | 1 wk |
| — | Mobile offline-first sync | 0% | 3 wks |

**Total remaining effort: ~26 person-weeks.**

---

## 3. Milestone plan

### Milestone A — Compliance + Farmer Registration (sellable MVP)
**Duration:** 4 weeks · **Cost: USD 2,500 – 4,500**
- Polish farmer registration (web + mobile), photo capture, NIN validation
- Plot mapping with GPS polygon
- Compliance module: certification tracking, expiry alerts, document storage
- Basic reporting (farmer counts, certification status, region rollups)
- Deploy + train 20 users

**This is the chunk you can sell to the 10k-farmer client immediately.**

### Milestone B — Procurement complete + Payments
**Duration:** 5 weeks · **Cost: USD 3,500 – 6,000**
- Activity funds approval flow polish
- MTN MoMo + Airtel Money integration (sandbox → production)
- Bank disbursement file (CSV/XML for KCB/Stanbic)
- Payment reconciliation dashboard
- SMS receipts to farmers (+256)

### Milestone C — Warehouse + Sales + Exports
**Duration:** 6 weeks · **Cost: USD 4,500 – 8,000**
- Lot tracking, warehouse intake/dispatch
- Buyer contracts, sales orders
- Export documentation (Bill of Lading, phytosanitary, origin certs)
- Logistics tracking

### Milestone D — Loans + Reporting + Polish
**Duration:** 4 weeks · **Cost: USD 2,500 – 4,500**
- Input credit, repayment schedules, deductions at procurement
- Executive dashboards, regulator reports (UCDA, MAAIF)
- Audit log viewer, data export tools
- Performance hardening, security review, penetration test

### Milestone E — Mobile offline-first + scale-out
**Duration:** 3 weeks · **Cost: USD 2,000 – 3,500**
- Offline data capture for field agents (low-connectivity areas)
- Background sync with conflict resolution
- Bulk farmer import wizard

---

## 4. Total build cost (remaining work)

| Path | Out-of-pocket | Time |
|---|---|---|
| **Solo (you, on Replit, USD 25/h opportunity cost)** | USD 4,000 – 8,000 hard cost · USD 18,000 – 26,000 opportunity | 5 – 7 months |
| **You + 1 contractor (mid-level, East Africa)** | USD 15,000 – 26,000 | 4 – 5 months |
| **Small team (1 senior + 1 mid + 1 mobile, EA rates)** | USD 35,000 – 55,000 | 3 – 4 months |
| **Outsourced agency (East Africa)** | USD 60,000 – 90,000 | 4 – 5 months |
| **Outsourced agency (Europe / North America)** | USD 200,000 – 400,000 | 4 – 6 months |

**Recommended:** Solo or You + 1 contractor route. Total spend stays under USD 25k, you finish in ~5 months, and the first paying customer (USD 18–25k/yr per the earlier quote) covers the entire build.

---

## 5. Recurring monthly costs once live

| Item | Monthly USD |
|---|---|
| Replit Deployments (or VPS) | 25 – 80 |
| Database (Neon / managed Postgres) | 25 – 100 |
| Clerk auth (up to 10k MAU) | 25 – 99 |
| Object storage (S3-compatible, ~50 GB) | 5 – 15 |
| SMS gateway (Africa's Talking, ~5k SMS/mo) | 30 – 80 |
| Domain + email + monitoring | 20 – 40 |
| **Total** | **130 – 415 / mo** |

Pass this through to the client as a hosting line item, or absorb it into the SaaS price.

---

## 6. Cash-flow scenario

Assuming you take the solo path and land the first deployment by month 3:

| Month | Spend (USD) | Revenue (USD) | Net |
|---|---|---|---|
| 1 | -800 | 0 | -800 |
| 2 | -800 | 0 | -1,600 |
| 3 | -800 | +8,000 (onboarding fee) | +5,600 |
| 4 | -800 | +1,000 (monthly SaaS billing) | +5,800 |
| 5 | -800 | +1,000 | +6,000 |
| 6 | -800 | +1,000 | +6,200 |
| 12 | -800/mo | +1,000/mo + new client #2 | +20k+ |

**Break-even: month 3. ARR target by month 12: USD 35–50k.**

---

## 7. Recommended next 30 days

1. Finish Milestone A (compliance + farmer registration polish).
2. Package a one-page sales sheet + 5-minute demo video.
3. Pitch the 10k-farmer client at USD 8k onboarding + USD 1k/month.
4. Use the signed contract to fund Milestones B–D.

---

*Numbers are realistic estimates for the East African market as of April 2026 and assume you continue to host on Replit infrastructure. Currency assumed USD; convert to UGX at prevailing BoU rate for client invoicing.*
