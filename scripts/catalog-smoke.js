'use strict';
// Verify the real official catalogs when reachable from CI. Government ArcGIS
// sometimes blocks/times out on GitHub runner egress while serving the same
// records successfully to the site's deployed Vercel runtime. In that case,
// explicitly validate the current public API's source-backed inventory, filters,
// and a bounded map, never silently substitute a static fixture.
const OHN='https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open01/MapServer/25';
const WATERBODY='https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open08/MapServer/17';
const ARA='https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open07/MapServer/2';
const PUBLIC_API='https://chrisizworski.com/api/lakes';

async function getJson(url, timeoutMs=18000) {
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'OntarioFishingLakeFinderCatalogSmoke/2.1'},signal:AbortSignal.timeout(timeoutMs)});
  if(!r.ok)throw new Error(`HTTP ${r.status}: ${new URL(url).hostname}`);
  const d=await r.json();
  if(d?.error)throw new Error(String(d.error.message||d.error));
  return d;
}
async function query(base,params){
  const url=`${base}/query?${new URLSearchParams({f:'json',...params})}`;
  return getJson(url);
}
function check(cond,message){if(!cond)throw new Error(message);}
async function directOfficial(){
  const ohnWhere="WATERBODY_TYPE IN ('Lake','Kettle lake')";
  const ohnCount=await query(OHN,{where:ohnWhere,returnCountOnly:'true',returnGeometry:'false'});
  check(Number(ohnCount.count)>100000,'OHN official lake inventory unexpectedly small');
  const ohnSample=await query(OHN,{where:ohnWhere,outFields:'OGF_ID,WATERBODY_TYPE,OFFICIAL_NAME_LABEL,SYSTEM_CALCULATED_AREA',returnGeometry:'false',resultRecordCount:'5',orderByFields:'OBJECTID ASC'});
  check(Array.isArray(ohnSample.features)&&ohnSample.features.length>0,'No OHN official lake records');
  check(ohnSample.features.every(f=>['Lake','Kettle lake'].includes(f.attributes?.WATERBODY_TYPE)&&Number.isFinite(Number(f.attributes?.OGF_ID))),'Invalid OHN official sample identity');
  const wliCount=await query(WATERBODY,{where:"WATERBODY_IDENT IS NOT NULL AND ENTITY_TYPE='Lake'",returnCountOnly:'true',returnGeometry:'false'});
  check(Number(wliCount.count)>1000,'Waterbody Location Identifier unexpectedly small');
  const brook=await query(ARA,{where:"FISH_SPECIES_SUMMARY LIKE '%Brook Trout%' AND WATERBODY_LID IS NOT NULL",returnCountOnly:'true',returnGeometry:'false'});
  check(Number(brook.count)>0,'ARA Brook Trout evidence unavailable');
  check(Number(ohnCount.count)>Number(wliCount.count)*3,'OHN no longer materially broader than fisheries-location layer');
  return {sourcePath:'direct-official',ohnLakeFeatures:ohnCount.count,waterbodyLocationLakeRecords:wliCount.count,brookTroutAraFeatures:brook.count};
}
async function deployedRuntime(){
  const all=await getJson(`${PUBLIC_API}?limit=25`,18000);
  check(all.catalogMode==='ohn_all_lakes'&&Number(all.candidateCount)>100000,'Public OHN inventory missing');
  check(Array.isArray(all.lakes)&&all.lakes.some(l=>String(l.id).startsWith('ohn:')),'Public OHN list missing source-identifiable lakes');
  const named=await getJson(`${PUBLIC_API}?q=Temagami&limit=25`,18000);
  check(named.catalogMode==='ohn_all_lakes'&&Number(named.candidateCount)>0,'Public named OHN search unavailable');
  check(named.lakes?.some(l=>/Temagami/i.test(l.name)),'Public named lake record not returned');
  const brook=await getJson(`${PUBLIC_API}?species=Brook%20Trout&thermal=cold&limit=25`,18000);
  check(Number(brook.candidateCount)>0&&Array.isArray(brook.lakes)&&brook.lakes.length>0,'Public fisheries evidence unavailable');
  const map=await getJson(`${PUBLIC_API}?mode=map&bbox=-85.4%2C47.8%2C-85.3%2C47.9`,18000);
  check(map.catalogMode==='ohn_all_lakes'&&map.coverageComplete===true&&Array.isArray(map.markers),'Public bounded OHN map not source-complete');
  return {sourcePath:'deployed-public-api-fallback',ohnLakeFeatures:all.candidateCount,namedLake:named.lakes[0]?.name,fishMatches:brook.candidateCount,mapFeatures:map.matchedInView};
}
(async()=>{
  try{
    console.log(JSON.stringify({status:'ok',...(await directOfficial())}));
  }catch(err){
    // Only transport/timeouts justify using the visitor-serving runtime.
    const message=String(err?.message||err);
    const transport=/timeout|aborted|fetch failed|network|econn|eai_again|etimedout|HTTP (403|429|502|503|504)/i.test(message);
    if(!transport)throw err;
    console.warn(`Direct official ArcGIS check unavailable from this runner (${message}). Checking actual public source-backed API instead; direct reachability remains UNVERIFIED.`);
    console.log(JSON.stringify({status:'ok',directOfficialStatus:'unverified-from-runner',...(await deployedRuntime())}));
  }
})().catch(err=>{console.error(err);process.exitCode=1;});
