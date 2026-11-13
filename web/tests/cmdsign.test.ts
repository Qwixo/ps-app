// The phone's pairing code matches the Second Computer test vector (side-session-notes second-computer/sas-vector.json).
import { phoneCode } from "../src/core/phonecode.ts";
const v = { primaryPub: "BMTzy6/WYKbWwJNLI4sW/8ZFOpBYM72B5QWYgJTo25qF/+eEU+WkzuqST+A/O97RgEIj9GA13KJfCqDaGGC/phg=",
  secondaryPub: "BEWdrrmMJK84hjiqmUmITx11v+oc5J/F2dxwxnIc3BdUasm10f+2qYh79/eXfkvl5aY1EU/G90lq1s8Aw0rceDU=", code: "349 797" };
const fake = { primaryPub: "BPrimaryKeyForTheTestVectorOnly", secondaryPub: "BSecondaryKeyForTheTestVectorOnly", code: "360 280" };
let fails = 0;
for (const t of [v, fake]) {
  const got = await phoneCode(t.primaryPub, t.secondaryPub);
  if (got !== t.code) { fails++; console.log(`FAIL ${got} != ${t.code}`); }
}
console.log(fails ? `cmdsign: ${fails} FAILED` : "cmdsign: 2 pairing code vectors match");
process.exit(fails ? 1 : 0);
