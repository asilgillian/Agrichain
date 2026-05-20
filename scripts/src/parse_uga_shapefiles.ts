// @ts-nocheck
(globalThis as any).self = globalThis;
import shp from "shpjs";
import { readFileSync, writeFileSync } from "node:fs";

function toAb(b: Buffer) { return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }

const adm2 = await shp(toAb(readFileSync("attached_assets/uga_shapefiles/uga_adm2_districts.zip")));
const adm4 = await shp(toAb(readFileSync("attached_assets/uga_shapefiles/uga_adm4_subcounties.zip")));

function summarize(fc: any) {
  return {
    count: fc.features.length,
    sampleProps: fc.features[0].properties,
    propKeys: Object.keys(fc.features[0].properties),
    geomTypes: Array.from(new Set(fc.features.map((f: any) => f.geometry.type))),
  };
}
console.log("ADM2", JSON.stringify(summarize(adm2), null, 2));
console.log("ADM4", JSON.stringify(summarize(adm4), null, 2));
writeFileSync("/tmp/uga_adm2.json", JSON.stringify(adm2));
writeFileSync("/tmp/uga_adm4.json", JSON.stringify(adm4));
console.log("WROTE /tmp/uga_adm2.json + /tmp/uga_adm4.json");
