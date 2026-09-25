import { writeFileSync } from "fs";

const chunks = [
  "start-Dj2bs0Kq",
  "capabilities-Cqy7s-PF",
  "customization-okh9xJ8M",
  "models-DZr7pp6i",
  "programmatic-D_fLU-fi",
  "reference-BWFEeAhZ",
];

const all = {};
for (const c of chunks) {
  let mod;
  try {
    mod = await import("./chunk_" + c + ".js");
  } catch (err) {
    console.error("IMPORT FAIL", c, String(err));
    continue;
  }
  for (const [k, v] of Object.entries(mod)) {
    if (typeof v !== "function") continue;
    let res;
    try {
      res = v({});
    } catch (err) {
      continue; // not a doc-page component
    }
    if (res && res.kind === "doc") {
      const slug = (res.meta && res.meta.slug) || k;
      all[slug] = {
        group: (res.meta && res.meta.group) || "",
        title: (res.meta && res.meta.title) || k,
        lede: (res.meta && res.meta.lede) || "",
        tree: res.tree,
      };
    }
  }
}
writeFileSync(new URL("./omp_extracted.json", import.meta.url), JSON.stringify(all));
console.log("pages extracted:", Object.keys(all).length);
for (const s of Object.keys(all)) console.log(" ", s);
