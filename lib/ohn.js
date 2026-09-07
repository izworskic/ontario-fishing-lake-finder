const { haversineKm } = require('./core');

const OHN_URL = 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open01/MapServer/25';
const OHN_FIELDS = 'OBJECTID,OGF_ID,WATERBODY_TYPE,OFFICIAL_NAME_LABEL,GEL_NAME_IDENT,PERMANENCY,LOCATION_ACCURACY,SYSTEM_CALCULATED_AREA,EFFECTIVE_DATETIME';

function text(v){ return v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim(); }
function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function escSql(v){ return String(v||'').replace(/'/g,"''"); }
function clamp(v,min,max){ return Math.min(max,Math.max(min,v)); }
function arcgisUrl(params={}){ return `${OHN_URL}/query?${new URLSearchParams({f:'json',...params})}`; }

async function getJson(url,timeout=20000){
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'ChrisIzworskiOntarioFishingLakeFinder/4.0'},signal:AbortSignal.timeout(timeout)});
  if(!r.ok) throw new Error(`OHN HTTP ${r.status}`);
  const d=await r.json();
  if(d?.error) throw new Error(d.error.message||'OHN query error');
  return d;
}

function ohnWhere(filters={}){
  const parts=["WATERBODY_TYPE IN ('Lake','Kettle lake')"];
  if(filters.q){
    const s=escSql(filters.q);
    parts.push(`OFFICIAL_NAME_LABEL LIKE '%${s}%'`);
  }
  return parts.join(' AND ');
}

function spatialForBbox(bbox){
  return {geometry:`${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects'};
}

function spatialForOrigin(filters={}){
  if(!Number.isFinite(filters.originLat)||!Number.isFinite(filters.originLon)||!Number.isFinite(filters.maxDistanceKm)) return {};
  return {geometry:`${filters.originLon},${filters.originLat}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',distance:String(filters.maxDistanceKm),units:'esriSRUnit_Kilometer'};
}

async function countOhn(params={}){
  const d=await getJson(arcgisUrl({...params,returnCountOnly:'true',returnGeometry:'false'}));
  const count=Number(d.count);
  if(!Number.isFinite(count)) throw new Error('OHN did not return a usable count');
  return count;
}

async function pageOhn(params={},maxRecords=12000){
  const pageSize=5000,features=[];
  let offset=0,pages=0,complete=true;
  while(offset<maxRecords){
    const count=Math.min(pageSize,maxRecords-offset);
    const d=await getJson(arcgisUrl({...params,resultOffset:String(offset),resultRecordCount:String(count)}));
    const page=Array.isArray(d.features)?d.features:[];
    pages++; features.push(...page);
    if(!page.length) break;
    offset+=page.length;
    if(page.length<count || !d.exceededTransferLimit) break;
    if(offset>=maxRecords){ complete=false; break; }
  }
  return {features,pages,complete};
}

function representativePoint(geometry){
  const rings=geometry?.rings;
  if(!Array.isArray(rings)||!rings.length) return {latitude:null,longitude:null};
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  for(const ring of rings){
    for(const p of ring||[]){
      const x=Number(p?.[0]),y=Number(p?.[1]);
      if(!Number.isFinite(x)||!Number.isFinite(y)) continue;
      west=Math.min(west,x);east=Math.max(east,x);south=Math.min(south,y);north=Math.max(north,y);
    }
  }
  if(!Number.isFinite(west)) return {latitude:null,longitude:null};
  return {latitude:(south+north)/2,longitude:(west+east)/2};
}

function normalizeOhn(feature){
  const a=feature?.attributes||{};
  const ogf=num(a.OGF_ID);
  if(ogf===null) return null;
  const point=representativePoint(feature.geometry);
  return {
    id:`ohn:${String(ogf)}`,
    ohnId:ogf,
    name:text(a.OFFICIAL_NAME_LABEL)||'Unnamed lake',
    officialName:text(a.OFFICIAL_NAME_LABEL),
    waterbodyType:text(a.WATERBODY_TYPE),
    permanency:text(a.PERMANENCY),
    locationAccuracy:text(a.LOCATION_ACCURACY),
    systemCalculatedArea:num(a.SYSTEM_CALCULATED_AREA),
    latitude:point.latitude,
    longitude:point.longitude,
    species:[],speciesSummary:null,stocking:[],fmz:null,thermalRegime:null,maximumDepthM:null,surfaceAreaHa:null,
    matchScore:null,
    matchReasons:['Ontario Hydro Network lake polygon'],
    fishEvidenceAvailable:null,
    catalogMode:'ohn_all_lakes'
  };
}

async function searchOhn(filters={},limit=100){
  const spatial=spatialForOrigin(filters);
  const base={where:ohnWhere(filters),...spatial};
  const candidateCount=await countOhn(base);
  const listWhere=filters.q?ohnWhere(filters):`${ohnWhere(filters)} AND OFFICIAL_NAME_LABEL IS NOT NULL`;
  const page=await pageOhn({where:listWhere,...spatial,outFields:OHN_FIELDS,returnGeometry:'true',outSR:'4326',orderByFields:filters.q?'OFFICIAL_NAME_LABEL ASC':'SYSTEM_CALCULATED_AREA DESC'},Math.min(5000,Math.max(500,limit*5)));
  let lakes=page.features.map(normalizeOhn).filter(Boolean);
  lakes=lakes.map(l=>{
    const d=Number.isFinite(filters.originLat)&&Number.isFinite(filters.originLon)&&Number.isFinite(l.latitude)&&Number.isFinite(l.longitude)?haversineKm(filters.originLat,filters.originLon,l.latitude,l.longitude):null;
    return {...l,originDistanceKm:d===null?null:Math.round(d)};
  });
  if(Number.isFinite(filters.maxDistanceKm)&&Number.isFinite(filters.originLat)&&Number.isFinite(filters.originLon)) lakes=lakes.filter(x=>x.originDistanceKm!==null&&x.originDistanceKm<=filters.maxDistanceKm);
  return {lakes:lakes.slice(0,limit),candidateCount,listCount:Math.min(limit,lakes.length),coverageComplete:true,sourceFeatureCount:page.features.length,sourcePages:page.pages,catalogMode:'ohn_all_lakes'};
}

async function mapOhn(filters,bbox,maxMarkers=12000){
  const base={where:ohnWhere(filters),...spatialForBbox(bbox)};
  const matchedInView=await countOhn(base);
  if(matchedInView>maxMarkers){
    return {markers:[],matchedInView,displayedInView:0,coverageComplete:false,truncatedReason:'zoom_required',sourceFeatureCount:{ohn:0},sourcePages:{ohn:0},catalogMode:'ohn_all_lakes'};
  }
  const page=await pageOhn({...base,outFields:OHN_FIELDS,returnGeometry:'true',outSR:'4326',orderByFields:'OBJECTID ASC'},Math.max(maxMarkers,matchedInView+1));
  let markers=page.features.map(normalizeOhn).filter(x=>x&&Number.isFinite(x.latitude)&&Number.isFinite(x.longitude));
  markers=markers.map(l=>{
    const d=Number.isFinite(filters.originLat)&&Number.isFinite(filters.originLon)?haversineKm(filters.originLat,filters.originLon,l.latitude,l.longitude):null;
    return {...l,originDistanceKm:d===null?null:Math.round(d)};
  });
  if(Number.isFinite(filters.maxDistanceKm)&&Number.isFinite(filters.originLat)&&Number.isFinite(filters.originLon)) markers=markers.filter(x=>x.originDistanceKm!==null&&x.originDistanceKm<=filters.maxDistanceKm);
  return {markers,matchedInView,displayedInView:markers.length,coverageComplete:page.complete&&markers.length===matchedInView,truncatedReason:page.complete?null:'source_safety_ceiling',sourceFeatureCount:{ohn:page.features.length},sourcePages:{ohn:page.pages},catalogMode:'ohn_all_lakes'};
}

async function ohnLakeDetail(id){
  const raw=String(id||'').replace(/^ohn:/,'');
  const ogf=Number(raw);
  if(!Number.isFinite(ogf)) return null;
  const d=await getJson(arcgisUrl({where:`OGF_ID=${ogf}`,outFields:OHN_FIELDS,returnGeometry:'true',outSR:'4326',resultRecordCount:'2'}));
  const lake=normalizeOhn((d.features||[])[0]);
  if(!lake) return null;
  return {...lake,fishEvidenceAvailable:false,matchReasons:['Ontario Hydro Network lake polygon','No fisheries record has been joined to this OHN lake yet'],regulationNote:'This lake is present in the Ontario Hydro Network. Fisheries evidence is separate; verify Fish ON-Line and current Ontario regulations before fishing.'};
}

module.exports={OHN_URL,OHN_FIELDS,ohnWhere,countOhn,pageOhn,normalizeOhn,searchOhn,mapOhn,ohnLakeDetail};
