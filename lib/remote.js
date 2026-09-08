const { SOURCES, haversineKm } = require('./core');
const { searchFisheries } = require('./catalog');

const TROUT_SPECIES = ['Brook Trout','Lake Trout','Rainbow Trout','Brown Trout','Splake'];
const ACCESS_FIELDS = 'OBJECTID,FISHING_ACCESS_POINT_TYPE,PARKING_PRESENCE_FLG,SITE_OWNERSHIP_TYPE,ACCESSIBILITY_FLG,USER_FEE_FLG,SITE_NAME';

function clamp(v,min,max){ return Math.min(max,Math.max(min,v)); }
function text(v){ return v === null || v === undefined || String(v).trim()==='' ? null : String(v).trim(); }
function arcgisUrl(base,params={}){ return `${base}/query?${new URLSearchParams({f:'json',...params})}`; }

async function getJson(url,timeout=9000){
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'ChrisIzworskiRemoteTroutFinder/1.0'},signal:AbortSignal.timeout(timeout)});
  if(!r.ok) throw new Error(`Upstream HTTP ${r.status}`);
  const d=await r.json();
  if(d?.error) throw new Error(d.error.message||'Upstream GIS error');
  return d;
}

function geometryPoints(g){
  const pts=[];
  if(Number.isFinite(g?.x)&&Number.isFinite(g?.y)) pts.push([g.y,g.x]);
  for(const path of g?.paths||[]) for(const p of path||[]) if(Array.isArray(p)&&p.length>=2) pts.push([p[1],p[0]]);
  for(const ring of g?.rings||[]) for(const p of ring||[]) if(Array.isArray(p)&&p.length>=2) pts.push([p[1],p[0]]);
  for(const p of g?.points||[]) if(Array.isArray(p)&&p.length>=2) pts.push([p[1],p[0]]);
  return pts;
}

function minGeometryDistanceKm(lat,lon,features=[]){
  let best=null;
  for(const f of features){
    for(const p of geometryPoints(f?.geometry)){
      const d=haversineKm(lat,lon,p[0],p[1]);
      if(d!==null&&(best===null||d<best)) best=d;
    }
  }
  return best;
}

async function nearbyFeatures(base,lat,lon,distanceKm,outFields='OBJECTID',count=200){
  const d=await getJson(arcgisUrl(base,{
    where:'1=1',geometry:`${lon},${lat}`,geometryType:'esriGeometryPoint',inSR:'4326',
    spatialRel:'esriSpatialRelIntersects',distance:String(distanceKm),units:'esriSRUnit_Kilometer',
    outFields,returnGeometry:'true',outSR:'4326',maxAllowableOffset:'0.001',resultRecordCount:String(count)
  }));
  return d.features||[];
}

async function nearbyCount(base,lat,lon,distanceKm){
  const d=await getJson(arcgisUrl(base,{
    where:'1=1',geometry:`${lon},${lat}`,geometryType:'esriGeometryPoint',inSR:'4326',
    spatialRel:'esriSpatialRelIntersects',distance:String(distanceKm),units:'esriSRUnit_Kilometer',
    returnCountOnly:'true',returnGeometry:'false'
  }));
  return Number.isFinite(Number(d.count))?Number(d.count):null;
}

async function remoteEvidence(lake){
  const lat=Number(lake.latitude),lon=Number(lake.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)) return {available:false,reasons:['Lake coordinates unavailable for remoteness context']};
  const settled=await Promise.allSettled([
    nearbyFeatures(SOURCES.roads,lat,lon,20,'OBJECTID',180),
    nearbyFeatures(SOURCES.access,lat,lon,20,ACCESS_FIELDS,100),
    nearbyCount(SOURCES.crown,lat,lon,2),
    nearbyCount(SOURCES.roadBarriers,lat,lon,15)
  ]);
  const roads=settled[0].status==='fulfilled'?settled[0].value:null;
  const access=settled[1].status==='fulfilled'?settled[1].value:null;
  const crownCount=settled[2].status==='fulfilled'?settled[2].value:null;
  const barrierCount=settled[3].status==='fulfilled'?settled[3].value:null;
  const nearestRoadKm=roads===null?null:minGeometryDistanceKm(lat,lon,roads);
  const nearestAccessKm=access===null?null:minGeometryDistanceKm(lat,lon,access);
  const accessExamples=Array.isArray(access)?access.slice(0,3).map(f=>({
    name:text(f.attributes?.SITE_NAME)||'Mapped fishing access',
    type:text(f.attributes?.FISHING_ACCESS_POINT_TYPE),
    ownership:text(f.attributes?.SITE_OWNERSHIP_TYPE),
    parking:text(f.attributes?.PARKING_PRESENCE_FLG),
    fee:text(f.attributes?.USER_FEE_FLG),
    distanceKm:minGeometryDistanceKm(lat,lon,[f])
  })):[];
  return {
    available:roads!==null||access!==null,
    nearestRoadKm,
    nearestAccessKm,
    roadSearchRadiusKm:20,
    accessSearchRadiusKm:20,
    mappedRoadFeatures:roads?.length??null,
    mappedAccessFeatures:access?.length??null,
    crownRecordsWithin2Km:crownCount,
    roadBarriersWithin15Km:barrierCount,
    accessExamples,
    sourceFailures:settled.map((x,i)=>x.status==='rejected'?['roads','access','crown','roadBarriers'][i]:null).filter(Boolean)
  };
}

function roadPoints(km){
  if(km===null) return 4;
  if(km>=12) return 24;
  if(km>=8) return 21;
  if(km>=5) return 17;
  if(km>=3) return 13;
  if(km>=1) return 8;
  return 2;
}
function accessPoints(km,count){
  if(km===null && count===0) return 7;
  if(km===null) return 4;
  if(km>=12) return 13;
  if(km>=8) return 11;
  if(km>=5) return 9;
  if(km>=3) return 7;
  if(km>=1) return 4;
  return 1;
}

function scoreRemote(lake,evidence){
  const reasons=[];
  const troutFit=Number.isFinite(lake.matchScore)?lake.matchScore:0;
  let remoteness=0,confidence=100;
  if(evidence.nearestRoadKm!==null){
    remoteness+=roadPoints(evidence.nearestRoadKm);
    reasons.push(`Nearest mapped ORN road feature about ${evidence.nearestRoadKm.toFixed(1)} km away`);
  }else if(evidence.mappedRoadFeatures===0){
    remoteness+=18;
    reasons.push('No mapped ORN road feature returned within 20 km; this is not proof of roadless access');
    confidence-=12;
  }else{
    remoteness+=4; confidence-=25; reasons.push('Road-distance evidence unavailable');
  }
  if(evidence.nearestAccessKm!==null){
    remoteness+=accessPoints(evidence.nearestAccessKm,evidence.mappedAccessFeatures);
    reasons.push(`Nearest mapped fishing-access point about ${evidence.nearestAccessKm.toFixed(1)} km away`);
  }else if(evidence.mappedAccessFeatures===0){
    remoteness+=7;
    reasons.push('No mapped fishing-access point returned within 20 km; unmapped access may exist');
    confidence-=10;
  }else{
    remoteness+=4; confidence-=20; reasons.push('Fishing-access evidence unavailable');
  }
  if(Number(evidence.crownRecordsWithin2Km)>0){
    remoteness+=4;
    reasons.push('Crown unpatented-land records occur within 2 km (planning context only)');
  }
  if(Number(evidence.roadBarriersWithin15Km)>0){
    reasons.push(`${evidence.roadBarriersWithin15Km} mapped MNR road barrier record(s) within 15 km`);
  }
  const recent=(lake.stocking||[]).filter(s=>Number(s.year)>=new Date().getUTCFullYear()-5);
  if(recent.length) reasons.push(`Recent stocking record: ${recent[0].species||'trout'} ${recent[0].year}`);
  else reasons.push('No recent stocking record returned; this does not prove a wild fishery');
  const remoteContext=clamp(Math.round((remoteness/41)*100),0,100);
  const overall=clamp(Math.round(troutFit*.58+remoteContext*.42),0,100);
  return {troutFit,remoteContext,remoteScore:overall,confidence:clamp(confidence,0,100),reasons:reasons.slice(0,7)};
}

async function mapConcurrent(items,limit,worker){
  const out=new Array(items.length);let cursor=0;
  async function run(){while(true){const i=cursor++;if(i>=items.length)return;out[i]=await worker(items[i],i);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>run()));
  return out;
}

function normalizeTroutSpecies(value){
  const found=TROUT_SPECIES.find(s=>s.toLowerCase()===String(value||'').trim().toLowerCase());
  return found||'Brook Trout';
}

async function searchRemoteTrout(filters={},limit=12){
  const species=normalizeTroutSpecies(filters.species);
  const fishFilters={...filters,species,thermal:filters.thermal||'cold'};
  const candidateLimit=Math.min(36,Math.max(18,limit*2));
  const base=await searchFisheries(fishFilters,candidateLimit);
  let candidates=base.lakes;
  if(filters.stocking==='recent'){
    const y=new Date().getUTCFullYear();
    candidates=candidates.filter(l=>(l.stocking||[]).some(s=>Number(s.year)>=y-5&&String(s.species||'').toLowerCase().includes(species.toLowerCase())));
  }else if(filters.stocking==='none_recent'){
    const y=new Date().getUTCFullYear();
    candidates=candidates.filter(l=>!(l.stocking||[]).some(s=>Number(s.year)>=y-5&&String(s.species||'').toLowerCase().includes(species.toLowerCase())));
  }
  const enriched=await mapConcurrent(candidates.slice(0,candidateLimit),4,async lake=>{
    const evidence=await remoteEvidence(lake);
    const score=scoreRemote(lake,evidence);
    return {...lake,remoteEvidence:evidence,...score};
  });
  enriched.sort((a,b)=>b.remoteScore-a.remoteScore||b.troutFit-a.troutFit||((a.originDistanceKm??99999)-(b.originDistanceKm??99999)));
  return {
    lakes:enriched.slice(0,limit),
    species,
    candidateCount:base.candidateCount,
    fisheriesCoverageComplete:base.coverageComplete,
    remotenessEvaluatedCount:enriched.length,
    listCount:Math.min(limit,enriched.length),
    semantics:'Remote Context ranks mapped-road distance, mapped fishing-access distance and related planning context among a bounded set of strong fisheries candidates. It is not proof of legal access, road condition, solitude, fish abundance or catch probability.'
  };
}

module.exports={TROUT_SPECIES,normalizeTroutSpecies,minGeometryDistanceKm,remoteEvidence,scoreRemote,searchRemoteTrout};
