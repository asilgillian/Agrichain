import { db } from "./index";
import {
  regionsTable,
  usersTable,
  groupsTable,
  farmersTable,
  plotsTable,
  certificationStreamsTable,
  certificationEnrolmentsTable,
  surveyTemplatesTable,
  surveySubmissionsTable,
  visitsTable,
  batchesTable,
  deliveriesTable,
  lotsTable,
  paymentsTable,
  gapAssessmentsTable,
  trainingSessionsTable,
  exportContractsTable,
  shipmentsTable,
  assetsTable,
  activityFundsTable,
  auditLogsTable,
} from "./schema";

async function seed() {
  console.log("Seeding database...");

  // Regions
  const [region1, region2] = await db.insert(regionsTable).values([
    { name: "Nyeri County", level: 1, countryCode: "KE" },
    { name: "Kirinyaga County", level: 1, countryCode: "KE" },
  ]).returning().onConflictDoNothing();

  if (!region1) { console.log("Regions already seeded"); return; }

  // Users
  const [agent1, agent2, manager1] = await db.insert(usersTable).values([
    { firstName: "James", lastName: "Mwangi", email: "james.mwangi@agri.ke", role: "agronomist", regionId: region1.id, status: "active" },
    { firstName: "Grace", lastName: "Wanjiru", email: "grace.wanjiru@agri.ke", role: "agronomist", regionId: region2.id, status: "active" },
    { firstName: "Peter", lastName: "Kimani", email: "peter.kimani@agri.ke", role: "manager", regionId: region1.id, status: "active" },
  ]).returning();

  // Groups
  const [group1, group2] = await db.insert(groupsTable).values([
    { name: "Nyeri Farmers Cooperative", regionId: region1.id, village: "Karatina" },
    { name: "Mt Kenya Growers Association", regionId: region2.id, village: "Kutus" },
  ]).returning();

  // Farmers
  const [f1, f2, f3] = await db.insert(farmersTable).values([
    {
      referenceNumber: "F001KE",
      firstName: "Mary", lastName: "Njeri",
      nationalId: "23456789", dateOfBirth: "1980-05-15",
      phoneNumber: "+254712345678", sex: "female",
      groupId: group1.id, regionId: region1.id, village: "Karatina",
      status: "active",
    },
    {
      referenceNumber: "F002KE",
      firstName: "John", lastName: "Kamau",
      nationalId: "34567890", dateOfBirth: "1975-11-20",
      phoneNumber: "+254723456789", sex: "male",
      groupId: group1.id, regionId: region1.id, village: "Mukurweini",
      status: "active",
    },
    {
      referenceNumber: "F003KE",
      firstName: "Esther", lastName: "Wambui",
      nationalId: "45678901", dateOfBirth: "1985-03-10",
      phoneNumber: "+254734567890", sex: "female",
      groupId: group2.id, regionId: region2.id, village: "Kerugoya",
      status: "active",
    },
  ]).returning();

  // Plots
  await db.insert(plotsTable).values([
    { farmerId: f1.id, cropType: "coffee", areaHectares: "0.8500", status: "active", harvestDate: "2025-07-01" },
    { farmerId: f2.id, cropType: "coffee", areaHectares: "1.2000", status: "active", harvestDate: "2025-07-15" },
    { farmerId: f3.id, cropType: "coffee", areaHectares: "0.6500", status: "active", harvestDate: "2025-08-01" },
  ]);

  // Certification streams
  const [eudr, ra] = await db.insert(certificationStreamsTable).values([
    { name: "EUDR", description: "EU Deforestation Regulation compliance stream", requiresGpsPolygon: true, active: true },
    { name: "Rainforest Alliance", description: "Rainforest Alliance certification stream", requiresGpsPolygon: false, active: true },
  ]).returning();

  // Enrolments
  await db.insert(certificationEnrolmentsTable).values([
    { farmerId: f1.id, streamId: eudr.id, enrolmentDate: "2024-01-15", expiryDate: "2026-01-15", status: "active" },
    { farmerId: f1.id, streamId: ra.id, enrolmentDate: "2024-02-01", expiryDate: "2025-02-01", status: "active" },
    { farmerId: f2.id, streamId: eudr.id, enrolmentDate: "2024-03-01", expiryDate: "2026-03-01", status: "active" },
    { farmerId: f3.id, streamId: ra.id, enrolmentDate: "2024-01-01", expiryDate: "2026-01-01", status: "active" },
  ]);

  // Survey templates
  const [tpl1] = await db.insert(surveyTemplatesTable).values([
    { name: "Farmer Registration Form", type: "registration", fields: [{ id: "q1", label: "Plot size (ha)?", type: "number" }, { id: "q2", label: "Primary crop?", type: "text" }], published: true },
    { name: "GAP Assessment", type: "gap_assessment", fields: [{ id: "q1", label: "Do you use certified inputs?", type: "boolean" }, { id: "q2", label: "Water source type?", type: "select", options: ["river", "borehole", "rain"] }], published: true },
  ]).returning();

  // Survey submissions
  await db.insert(surveySubmissionsTable).values([
    { templateId: tpl1.id, farmerId: f1.id, agentId: agent1.id, responses: { q1: 0.85, q2: "coffee" }, status: "approved", reviewedAt: new Date() },
    { templateId: tpl1.id, farmerId: f2.id, agentId: agent1.id, responses: { q1: 1.2, q2: "coffee" }, status: "pending" },
  ]);

  // Visits
  await db.insert(visitsTable).values([
    { farmerId: f1.id, agentId: agent1.id, scheduledDate: "2025-04-20", priority: "high", status: "scheduled" },
    { farmerId: f2.id, agentId: agent2.id, scheduledDate: "2025-04-21", priority: "medium", status: "scheduled" },
    { farmerId: f3.id, agentId: agent2.id, scheduledDate: "2025-04-18", priority: "low", status: "completed", completedAt: new Date() },
  ]);

  // Batches
  const [batch1, batch2] = await db.insert(batchesTable).values([
    { batchTag: "B2504A", agentId: agent1.id, cropType: "coffee", totalWeightKg: "450.0", farmerCount: 3, qualifyingStreams: ["EUDR", "Rainforest Alliance"], status: "locked", harvestDate: "2025-04-10", farmerContributions: [{ farmerId: f1.id, weightKg: 180 }, { farmerId: f2.id, weightKg: 270 }] },
    { batchTag: "B2504B", agentId: agent2.id, cropType: "coffee", totalWeightKg: "220.5", farmerCount: 2, qualifyingStreams: ["EUDR"], status: "open", harvestDate: "2025-04-12", farmerContributions: [{ farmerId: f3.id, weightKg: 220.5 }] },
  ]).returning();

  // Deliveries
  const [del1, del2] = await db.insert(deliveriesTable).values([
    {
      lotTag: "L2504A-001",
      batchId: batch1.id,
      grossWeightKg: "462.0", tareWeightKg: "12.0", netWeightKg: "450.0",
      moistureContent: "11.5", defectCount: "1.0", cupScore: "82.5", grade: "AA",
      pricePerKg: "420.00", totalValue: "189000.00",
      qualifyingStreams: ["EUDR", "Rainforest Alliance"],
      weightApproved: true, qcApproved: true, status: "approved",
    },
    {
      lotTag: "L2504B-001",
      batchId: batch2.id,
      grossWeightKg: "235.0", tareWeightKg: "14.5", netWeightKg: "220.5",
      qualifyingStreams: ["EUDR"],
      weightApproved: true, qcApproved: false, status: "pending_qc",
    },
  ]).returning();

  // Lots
  await db.insert(lotsTable).values([
    { lotTag: "LOT-2504A", deliveryId: del1.id, weightKg: "450.0", certificationStreams: ["EUDR", "Rainforest Alliance"], siloId: "SILO-01", status: "received" },
  ]);

  // Payments
  await db.insert(paymentsTable).values([
    { farmerId: f1.id, deliveryId: del1.id, amountDue: "75600.00", currency: "KES", paymentMethod: "mpesa", status: "pending" },
    { farmerId: f2.id, deliveryId: del1.id, amountDue: "113400.00", currency: "KES", paymentMethod: "mpesa", status: "paid", amountPaid: "113400.00", paidAt: new Date() },
  ]);

  // GAP assessments
  await db.insert(gapAssessmentsTable).values([
    { farmerId: f1.id, agentId: agent1.id, overallScore: "78", maxScore: "100", criteria: [{ name: "Inputs", score: 20, maxScore: 25 }, { name: "Water", score: 18, maxScore: 20 }, { name: "Waste", score: 15, maxScore: 20 }, { name: "Documentation", score: 25, maxScore: 35 }], status: "approved" },
  ]);

  // Training sessions
  await db.insert(trainingSessionsTable).values([
    { title: "GAP Certification Training", type: "gap", scheduledDate: "2025-04-25", location: "Nyeri Training Center", facilitatorId: manager1.id, attendeeCount: 25, status: "scheduled" },
    { title: "EUDR Compliance Workshop", type: "eudr", scheduledDate: "2025-05-05", location: "Kirinyaga Extension Office", facilitatorId: manager1.id, attendeeCount: 40, status: "scheduled" },
  ]);

  // Export contracts
  const [contract1] = await db.insert(exportContractsTable).values([
    { contractNumber: "EXP-2504-001", buyer: "Nordic Coffee Co.", destination: "Hamburg, Germany", cropType: "coffee", quantityKg: "5000.000", pricePerKg: "450.0000", certificationRequired: "EUDR", deliveryDate: "2025-06-30", status: "active" },
  ]).returning();

  // Shipments
  await db.insert(shipmentsTable).values([
    { contractId: contract1.id, containerNumber: "MSCU1234567", portOfLoading: "Mombasa", portOfDestination: "Hamburg", shipmentDate: "2025-06-15", totalWeightKg: "5000.0", status: "preparing" },
  ]);

  // Assets
  await db.insert(assetsTable).values([
    { assetCode: "AST001", type: "motorcycle", serialNumber: "KBZ-123X", make: "Honda", model: "CG125", purchaseDate: "2023-01-10", purchaseValue: "185000.00", currentBookValue: "140000.00", status: "assigned", assignedToUserId: agent1.id },
    { assetCode: "AST002", type: "tablet", serialNumber: "TAB-2023-007", make: "Samsung", model: "Galaxy Tab A8", purchaseDate: "2023-06-15", purchaseValue: "45000.00", currentBookValue: "35000.00", status: "assigned", assignedToUserId: agent2.id },
    { assetCode: "AST003", type: "weighing_scale", serialNumber: "WS-1002", make: "Mettler Toledo", model: "BC150", purchaseDate: "2022-09-01", purchaseValue: "120000.00", currentBookValue: "95000.00", status: "available" },
  ]);

  // Activity funds
  await db.insert(activityFundsTable).values([
    { agentId: agent1.id, activityType: "farm_visit", plannedDate: "2025-04-20", destination: "Karatina Village", estimatedAmount: "2500.00", currency: "KES", status: "approved", approvedAmount: "2500.00", lineItems: [{ description: "Fuel", amount: 1500 }, { description: "Lunch allowance", amount: 1000 }] },
    { agentId: agent2.id, activityType: "training", plannedDate: "2025-04-25", destination: "Nyeri Training Center", estimatedAmount: "5000.00", currency: "KES", status: "pending", lineItems: [{ description: "Travel", amount: 2000 }, { description: "Materials", amount: 3000 }] },
  ]);

  // Audit logs
  await db.insert(auditLogsTable).values([
    { entityType: "farmer", entityId: f1.id, action: "created", actorId: manager1.id, actorName: "Peter Kimani", actorRole: "manager", after: { referenceNumber: "F001KE" } },
    { entityType: "delivery", entityId: del1.id, action: "approved", actorId: manager1.id, actorName: "Peter Kimani", actorRole: "manager", before: { status: "pending_approval" }, after: { status: "approved" } },
    { entityType: "payment", entityId: f2.id, action: "paid", actorId: manager1.id, actorName: "Peter Kimani", actorRole: "manager", after: { amountPaid: "113400.00", paymentMethod: "mpesa" } },
  ]);

  console.log("Seed complete.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
