# Bulk Upload Cheat Sheet (UUID-style)

The Admin → Bulk Upload screen requires raw UUIDs for parent references.
Upload in this order, copying UUIDs from the relevant admin screen between steps.

## Load order

| # | Upload                      | UUIDs needed in this CSV          | Grab UUIDs from                    |
|---|-----------------------------|-----------------------------------|------------------------------------|
| 1 | regions (level 1)           | —                                 | Admin → Regions                    |
| 2 | regions (level 2)           | parentId (level 1 UUID)           | Admin → Regions                    |
| 3 | regions (level 3)           | parentId (level 2 UUID)           | Admin → Regions                    |
| 4 | regions (level 4 villages)  | parentId (level 3 UUID)           | Admin → Regions                    |
| 5 | org_regions                 | —                                 | —                                  |
| 6 | commodities                 | —                                 | Admin → Commodities                |
| 7 | commodity_types             | commodityId, parentCommodityTypeId| Admin → Commodities                |
| 8 | commodity_prices            | commodityTypeId, regionId         | Admin → Commodity Types + Regions  |
| 9 | groups                      | regionId (level 4 / village UUID) | Admin → Regions                    |
| 10| users                       | regionId, managerId               | Admin → Regions + Users            |
| 11| buying_stations             | managerUserId                     | Admin → Users                      |
| 12| silos                       | —                                 | —                                  |
| 13| storage_bins                | —                                 | —                                  |
| 14| farmers                     | groupId, regionId                 | Admin → Groups + Regions           |

## Exact CSV header lines (use as row 1)

```
regions:           name,level,countryCode,parentId
org_regions:       name,description,countryCode,isActive
commodities:       name,code,scientificName,defaultUnit,description,status
commodity_types:   commodityId,name,code,stage,parentCommodityTypeId,isPurchasable,isSellable,defaultUnit,defaultMoistureMin,defaultMoistureMax,status
commodity_prices:  commodityTypeId,regionId,pricePerKg,currency,effectiveDate,source,notes
groups:            name,regionId,village
buying_stations:   name,location,gpsLat,gpsLng,managerUserId,isActive
silos:             name,facilityId,stream,commodityType,capacityKg,status
storage_bins:      name,facilityId,stream,commodityType,capacityKg,isActive
users:             firstName,lastName,email,phoneNumber,clerkUserId,role,regionId,managerId,status
farmers:           firstName,lastName,nationalId,phoneNumber,sex,groupId,regionId,village,dateOfBirth
```

## Value rules

- **Blank cells** — leave empty for optional fields. Do not write `null` or `""`.
- **Booleans** — `true` / `false` (also `1`/`0`, `yes`/`no`).
- **Dates** — `YYYY-MM-DD`.
- **Currency** — blank defaults to `UGX`.
- **Status**:
  - commodities / commodity_types / users → `active` (default) or `inactive`.
  - silos → `ACTIVE` (default), `IDLE`, `CLEANING`, `MAINTENANCE`.
- **Stage** (commodity_types) → `raw` (default), `intermediate`, `finished`.
- **Source** (commodity_prices) → `manual` (default), `market`, `contract`.
- **role** (users) — exact role name from Admin → Roles (e.g. `SystemAdministrator`, `FieldAgent`).
- **clerkUserId** — leave blank. Populates automatically on first Google/email sign-in.
- **Region UUIDs** — each region row has its own UUID. A village's `parentId` is the **parish** UUID, not the district UUID.

## Example: Abim district

Step 1 — upload regions level 1:

```csv
name,level,countryCode,parentId
Central,1,UG,
Eastern,1,UG,
Northern,1,UG,
Western,1,UG,
```

Step 2 — open Admin → Regions, copy "Northern"'s UUID, then upload level 2:

```csv
name,level,countryCode,parentId
Abim,2,UG,<paste-Northern-uuid>
Gulu,2,UG,<paste-Northern-uuid>
Lira,2,UG,<paste-Northern-uuid>
```

Repeat for level 3 (sub-counties under each district) and level 4 (villages under each sub-county).
