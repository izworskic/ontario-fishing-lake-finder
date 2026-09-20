const {execFileSync}=require("node:child_process");

const out=execFileSync(process.platform==="win32"?"npm.cmd":"npm",["pack","--dry-run","--json"],{encoding:"utf8"});
const parsed=JSON.parse(out);
const files=new Set((parsed[0]?.files||[]).map(x=>x.path));
const required=[
  "public/index.html",
  "public/remote-trout-lake-finder/index.html",
  "data/trout-index.json"
];
const missing=required.filter(x=>!files.has(x));
if(missing.length){
  console.error("Package surface is missing required production files:",missing.join(", "));
  process.exit(1);
}
console.log("PASS: package includes required Ontario finder production surfaces.");
