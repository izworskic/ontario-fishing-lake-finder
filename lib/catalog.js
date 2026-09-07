const {
  SOURCES,
  araWhere,
  normalizeAra,
  dedupe,
  looksLikeLake,
  fitScore,
  haversineKm
} = require('./core');

const ARA_FIELDS = 'OBJECTID,ARA_IDENT,WATERBODY_LID,WATERBODY_TYPE,CORPORATE_WATERBODY_NAME,OFFICIAL_WATERBODY_NAME,WATERBODY_ALIAS_NAME1,WATERBODY_ALIAS_NAME2,FISHERIES_MANAGEMENT_ZONE_ID,THERMAL_REGIME,THERMAL_REGIME_REASON,FISH_SPECIES_SUMMARY,SURFACE_AREA,MAXIMUM_DEPTH,MEAN_DEPTH,SECCHI_DEPTH,CONDUCTIVITY,COLDWATER_REHAB_POTENTIAL_IND,SPATIAL_VERIFICATION_FLG,EFFECTIVE_DATETIME';
const MAP_ARA_FIELDS = 'OBJECTID,WATERBODY_LID,WATERBODY_TYPE,CORPORATE_WATERBODY_NAME,OFFICIAL_WATERBODY_NAME,WATERBODY_ALIAS_NAME1,WATERBODY_ALIAS_NAME2,FISHERIES_MANAGEMENT_ZONE_ID,THERMAL_REGIME,FISH_SPECIES_SUMMARY,SURFACE_AREA,MAXIMUM_DEPTH,MEAN_DEPTH,SECCHI_DEPTH';
const WATERBODY_FIELDS = 'OBJECTID,WATERBODY_IDENT,OFFICIAL_NAME,OFFICIAL_ALTERNATE_NAME,UNOFFICIAL_NAME,ENTITY_TYPE,LATITUDE_DECIMAL_DEGREES,LONGITUDE_DECIMAL_DEGREES,GEOGRAPHIC_TOWNSHIP_NAME,UPPER_TIER_MUNICIPALITY,LOWER_TIER_MUNICIPALITY,SINGLE_TIER_MUNICIPALITY,TERRITORIAL_DISTRICT,LOCATION_NARRATIVE,REFRESH_DATETIME,SHAPE.AREA';
const STOCK_FIELDS = 'MNRF_District,Stocking_Year,Species,Official_Waterbody_Name,Unoffcial_Waterbody_Name,Waterbody_Location_Identifier,Geographic_Township,Developmental_Stage,Number_of_Fish_Stocked,Latitude,Longitude,ObjectId';

function text(v){ return v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim(); }
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
function escSql(v){ return String(v || '').replace(/'/g,"''"); }
function clamp(v,min,max){ return Math.min(max,Math.max(min,v)); }

function arcgisUrl(base, params={}){
  return `${base}/query?${new URLSearchParams({f:'json', ...params})}`;
}

async function getJson(url, timeout=15000){
  const r = await fetch(url, {
    headers:{accept:'application/json','user-agent':'ChrisIzworskiOntarioFishingLakeFinder/3.0'},
    signal:AbortSignal.timeout(timeout)
  });
  if(!r.ok) throw new Error(`Upstream HTTP ${r.status}`);
  const d = await r.json();
  if(d?.error) throw new Error(d.error.message || 'Upstream GIS error');
  return d;
}

function hasFisheriesFilters(filters={}){
  return Boolean(filters.species || filters.fmz || filters.thermal || Number.isFinite(filters.minDepth));
}

function buildWhere(filters={}){
  const parts=[araWhere(filters)];
  if(Number.isFinite(filters.minDepth)) parts.push(`MAXIMUM_DEPTH >= ${Number(filters.minDepth)}`);
  return parts.filter(Boolean).join(' AND ');
}

function waterbodyWhere(filters={}){
  const parts=["WATERBODY_IDENT IS NOT NULL","ENTITY_TYPE = 'Lake'"];
  if(filters.q){
    const s=escSql(filters.q);
    parts.push(`(OFFICIAL_NAME LIKE '%${s}%' OR OFFICIAL_ALTERNATE_NAME LIKE '%${s}%' OR UNOFFICIAL_NAME LIKE '%${s}%')`);
  }
  return parts.join(' AND ');
}

function spatialParamsForOrigin(filters={}){
  if(!Number.isFinite(filters.originLat) || !Number.isFinite(filters.originLon) || !Number.isFinite(filters.maxDistanceKm)) return {};
  return {
    geometry:`${filters.originLon},${filters.originLat}`,
    geometryType:'esriGeometryPoint',
    inSR:'4326',
    spatialRel:'esriSpatialRelIntersects',
    distance:String(filters.maxDistanceKm),
    units:'esriSRUnit_Kilometer'
  };
}

async function pagedArcgis(base, params={}, options={}){
  const pageSize=clamp(Number(options.pageSize)||2000,1,2000);
  const maxRecords=Math.max(pageSize,Number(options.maxRecords)||60000);
  const fetchJson=options.fetchJson||getJson;
  const features=[];
  let offset=0;
  let complete=true;
  let pages=0;
  while(offset<maxRecords){
    const count=Math.min(pageSize,maxRecords-offset);
    const d=await fetchJson(arcgisUrl(base,{
      ...params,
      resultOffset:String(offset),
      resultRecordCount:String(count)
    }));
    const page=Array.isArray(d.features)?d.features:[];
    pages++;
    features.push(...page);
    if(page.length===0) break;
    offset+=page.length;
    if(!d.exceededTransferLimit && page.length<count) break;
    if(page.length<count) break;
    if(offset>=maxRecords){
      complete=!d.exceededTransferLimit;
      break;
    }
  }
  if(features.length>=maxRecords) complete=false;
  return {features,complete,pages};
}

async function countArcgis(base,params={},options={}){
  const fetchJson=options.fetchJson||getJson;
  const d=await fetchJson(arcgisUrl(base,{...params,returnCountOnly:'true',returnGeometry:'false'}));
  const count=Number(d.count);
  if(!Number.isFinite(count)) throw new Error('Source did not return a usable count');
  return count;
}

function normalizeLocation(feature){
  const a=feature?.attributes||{};
  const id=text(a.WATERBODY_IDENT);
  if(!id) return null;
  const officialName=text(a.OFFICIAL_NAME), alternateName=text(a.OFFICIAL_ALTERNATE_NAME), unofficialName=text(a.UNOFFICIAL_NAME);
  return {
    id,
    name:officialName||alternateName||unofficialName||'Unnamed lake',
    officialName,
    alternateName,
    unofficialName,
    entityType:text(a.ENTITY_TYPE),
    latitude:num(a.LATITUDE_DECIMAL_DEGREES),
    longitude:num(a.LONGITUDE_DECIMAL_DEGREES),
    township:text(a.GEOGRAPHIC_TOWNSHIP_NAME),
    municipality:text(a.SINGLE_TIER_MUNICIPALITY)||text(a.LOWER_TIER_MUNICIPALITY)||text(a.UPPER_TIER_MUNICIPALITY)||text(a.TERRITORIAL_DISTRICT),
    district:text(a.TERRITORIAL_DISTRICT),
    locationNarrative:text(a.LOCATION_NARRATIVE),
    catalogArea:num(a['SHAPE.AREA']),
    refreshedAt:a.REFRESH_DATETIME??null
  };
}

async function parallelChunks(items,size,worker,concurrency=5){
  const chunks=[];
  for(let i=0;i<items.length;i+=size) chunks.push(items.slice(i,i+size));
  const results=new Array(chunks.length);
  let cursor=0;
  async function run(){
    while(true){
      const i=cursor++;
      if(i>=chunks.length) return;
      results[i]=await worker(chunks[i]);
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency,chunks.length)},()=>run()));
  return results;
}

async function lookupLocations(ids){
  const out=new Map();
  if(!ids.length) return out;
  const batches=await parallelChunks(ids,120,async chunk=>{
    const where=`WATERBODY_IDENT IN (${chunk.map(x=>`'${escSql(x)}'`).join(',')})`;
    const d=await getJson(arcgisUrl(SOURCES.waterbody,{where,outFields:WATERBODY_FIELDS,returnGeometry:'false',resultRecordCount:'2000'}));
    return d.features||[];
  },5);
  for(const f of batches.flat()){
    const row=normalizeLocation(f);
    if(row) out.set(row.id,row);
  }
  return out;
}

async function lookupStocking(ids){
  const out=new Map();
  if(!ids.length) return out;
  const batches=await parallelChunks(ids,100,async chunk=>{
    const where=`Waterbody_Location_Identifier IN (${chunk.map(x=>`'${escSql(x)}'`).join(',')})`;
    try{
      const d=await getJson(arcgisUrl(SOURCES.stocking,{where,outFields:STOCK_FIELDS,returnGeometry:'false',orderByFields:'Stocking_Year DESC',resultRecordCount:'2000'}));
      return d.features||[];
    }catch{return [];}
  },4);
  for(const f of batches.flat()){
    const a=f.attributes||{},id=text(a.Waterbody_Location_Identifier);
    if(!id) continue;
    if(!out.has(id)) out.set(id,[]);
    out.get(id).push({
      year:num(a.Stocking_Year),
      species:text(a.Species),
      numberStocked:num(a.Number_of_Fish_Stocked),
      developmentalStage:text(a.Developmental_Stage),
      district:text(a.MNRF_District),
      township:text(a.Geographic_Township)
    });
  }
  return out;
}

function baseRank(lake,targetSpecies){
  const s=fitScore({...lake,latitude:null,longitude:null,stocking:[]},targetSpecies);
  return s.score;
}

async function searchFisheries(filters={},limit=100){
  const page=await pagedArcgis(SOURCES.ara,{
    where:buildWhere(filters),
    outFields:ARA_FIELDS,
    returnGeometry:'false',
    orderByFields:'OBJECTID ASC',
    ...spatialParamsForOrigin(filters)
  },{maxRecords:60000});
  let candidates=dedupe(page.features.map(normalizeAra)).filter(x=>looksLikeLake(x.waterbodyType));
  candidates.sort((a,b)=>baseRank(b,filters.species)-baseRank(a,filters.species)||((b.surfaceAreaHa||0)-(a.surfaceAreaHa||0)));
  const poolSize=Math.min(candidates.length,Math.max(500,limit*5));
  const pool=candidates.slice(0,poolSize);
  const ids=pool.map(x=>x.id);
  const [locs,stocks]=await Promise.all([lookupLocations(ids),lookupStocking(ids)]);
  let rows=pool.map(l=>{
    const loc=locs.get(l.id)||{};
    const item={...l,...loc,stocking:(stocks.get(l.id)||[]).slice(0,8),fishEvidenceAvailable:true,catalogMode:'fisheries'};
    const scored=fitScore(item,filters.species);
    const originDistanceKm=Number.isFinite(filters.originLat)&&Number.isFinite(filters.originLon)&&Number.isFinite(item.latitude)&&Number.isFinite(item.longitude)
      ? haversineKm(filters.originLat,filters.originLon,item.latitude,item.longitude)
      : null;
    return {...item,matchScore:scored.score,matchReasons:scored.reasons,originDistanceKm:originDistanceKm===null?null:Math.round(originDistanceKm)};
  }).filter(x=>x.latitude!==null&&x.longitude!==null);
  if(Number.isFinite(filters.maxDistanceKm)&&Number.isFinite(filters.originLat)&&Number.isFinite(filters.originLon)){
    rows=rows.filter(x=>x.originDistanceKm!==null&&x.originDistanceKm<=filters.maxDistanceKm);
  }
  rows.sort((a,b)=>b.matchScore-a.matchScore||((a.originDistanceKm??99999)-(b.originDistanceKm??99999))||((b.surfaceAreaHa||0)-(a.surfaceAreaHa||0)));
  return {
    lakes:rows.slice(0,limit),
    candidateCount:candidates.length,
    listCount:Math.min(limit,rows.length),
    coverageComplete:page.complete,
    sourceFeatureCount:page.features.length,
    sourcePages:page.pages,
    catalogMode:'fisheries'
  };
}

async function searchMaster(filters={},limit=100){
  const spatial=spatialParamsForOrigin(filters);
  const params={where:waterbodyWhere(filters),...spatial};
  const candidateCount=await countArcgis(SOURCES.waterbody,params);
  const maxRecords=(filters.q||Object.keys(spatial).length)?Math.min(12000,Math.max(2000,candidateCount)):Math.min(2000,Math.max(limit*5,500));
  const page=await pagedArcgis(SOURCES.waterbody,{
    ...params,
    outFields:WATERBODY_FIELDS,
    returnGeometry:'false',
    orderByFields:filters.q?'OFFICIAL_NAME ASC':'OBJECTID ASC'
  },{maxRecords});
  let rows=page.features.map(normalizeLocation).filter(x=>x&&Number.isFinite(x.latitude)&&Number.isFinite(x.longitude));
  rows=rows.map(item=>{
    const originDistanceKm=Number.isFinite(filters.originLat)&&Number.isFinite(filters.originLon)
      ? haversineKm(filters.originLat,filters.originLon,item.latitude,item.longitude)
      : null;
    return {
      ...item,
      species:[],
      speciesSummary:null,
      stocking:[],
      fmz:null,
      thermalRegime:null,
      maximumDepthM:null,
      surfaceAreaHa:null,
      matchScore:null,
      matchReasons:['Ontario Waterbody Location Identifier lake record'],
      fishEvidenceAvailable:null,
      catalogMode:'all_lakes',
      originDistanceKm:originDistanceKm===null?null:Math.round(originDistanceKm)
    };
  });
  if(Number.isFinite(filters.maxDistanceKm)&&Number.isFinite(filters.originLat)&&Number.isFinite(filters.originLon)){
    rows=rows.filter(x=>x.originDistanceKm!==null&&x.originDistanceKm<=filters.maxDistanceKm);
    rows.sort((a,b)=>a.originDistanceKm-b.originDistanceKm||a.name.localeCompare(b.name));
  }else{
    rows.sort((a,b)=>a.name.localeCompare(b.name));
  }
  return {
    lakes:rows.slice(0,limit),
    candidateCount,
    listCount:Math.min(limit,rows.length),
    coverageComplete:true,
    sourceFeatureCount:page.features.length,
    sourcePages:page.pages,
    catalogMode:'all_lakes'
  };
}

async function searchComplete(filters={},limit=100){
  return hasFisheriesFilters(filters) ? searchFisheries(filters,limit) : searchMaster(filters,limit);
}

function parseBbox(value){
  const parts=String(value||'').split(',').map(Number);
  if(parts.length!==4||parts.some(v=>!Number.isFinite(v))) return null;
  const [west,south,east,north]=parts;
  if(west>=east||south>=north||west<-180||east>180||south<-90||north>90) return null;
  return {west,south,east,north};
}

function spatialForBbox(bbox){
  return {
    geometry:`${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType:'esriGeometryEnvelope',
    inSR:'4326',
    spatialRel:'esriSpatialRelIntersects'
  };
}

async function mapMaster(filters,bbox,maxMarkers){
  const spatial=spatialForBbox(bbox);
  const page=await pagedArcgis(SOURCES.waterbody,{
    where:waterbodyWhere(filters),
    outFields:WATERBODY_FIELDS,
    returnGeometry:'false',
    orderByFields:'OBJECTID ASC',
    ...spatial
  },{maxRecords:40000});
  let markers=page.features.map(normalizeLocation).filter(x=>x&&Number.isFinite(x.latitude)&&Number.isFinite(x.longitude));
  markers=markers.filter(loc=>loc.longitude>=bbox.west&&loc.longitude<=bbox.east&&loc.latitude>=bbox.south&&loc.latitude<=bbox.north).map(loc=>{
    const originDistanceKm=Number.isFinite(filters.originLat)&&Number.isFinite(filters.originLon)
      ? haversineKm(filters.originLat,filters.originLon,loc.latitude,loc.longitude)
      : null;
    return {...loc,matchScore:null,fishEvidenceAvailable:null,catalogMode:'all_lakes',originDistanceKm:originDistanceKm===null?null:Math.round(originDistanceKm)};
  });
  if(Number.isFinite(filters.maxDistanceKm)&&Number.isFinite(filters.originLat)&&Number.isFinite(filters.originLon)){
    markers=markers.filter(x=>x.originDistanceKm!==null&&x.originDistanceKm<=filters.maxDistanceKm);
  }
  const matchedInView=markers.length;
  const capped=matchedInView>maxMarkers;
  if(capped) markers=markers.slice(0,maxMarkers);
  return {
    markers,
    matchedInView,
    displayedInView:markers.length,
    coverageComplete:page.complete&&!capped,
    truncatedReason:capped?'marker_safety_ceiling':(!page.complete?'source_safety_ceiling':null),
    sourceFeatureCount:{waterbody:page.features.length,ara:0},
    sourcePages:{waterbody:page.pages,ara:0},
    catalogMode:'all_lakes'
  };
}

async function mapFisheries(filters,bbox,maxMarkers){
  const spatial=spatialForBbox(bbox);
  const [araPage,waterPage]=await Promise.all([
    pagedArcgis(SOURCES.ara,{
      where:buildWhere(filters),
      outFields:MAP_ARA_FIELDS,
      returnGeometry:'false',
      orderByFields:'OBJECTID ASC',
      ...spatial
    },{maxRecords:40000}),
    pagedArcgis(SOURCES.waterbody,{
      where:"WATERBODY_IDENT IS NOT NULL AND ENTITY_TYPE = 'Lake'",
      outFields:WATERBODY_FIELDS,
      returnGeometry:'false',
      orderByFields:'OBJECTID ASC',
      ...spatial
    },{maxRecords:40000})
  ]);
  const ara=dedupe(araPage.features.map(normalizeAra)).filter(x=>looksLikeLake(x.waterbodyType));
  const locs=new Map();
  for(const f of waterPage.features){
    const row=normalizeLocation(f);
    if(row&&Number.isFinite(row.latitude)&&Number.isFinite(row.longitude)) locs.set(row.id,row);
  }
  let markers=[];
  for(const lake of ara){
    const loc=locs.get(lake.id);
    if(!loc) continue;
    if(loc.longitude<bbox.west||loc.longitude>bbox.east||loc.latitude<bbox.south||loc.latitude>bbox.north) continue;
    const originDistanceKm=Number.isFinite(filters.originLat)&&Number.isFinite(filters.originLon)
      ? haversineKm(filters.originLat,filters.originLon,loc.latitude,loc.longitude)
      : null;
    if(Number.isFinite(filters.maxDistanceKm)&&originDistanceKm!==null&&originDistanceKm>filters.maxDistanceKm) continue;
    const scored=fitScore({...lake,...loc,stocking:[]},filters.species);
    markers.push({
      id:lake.id,
      name:lake.name,
      latitude:loc.latitude,
      longitude:loc.longitude,
      municipality:loc.municipality,
      district:loc.district,
      township:loc.township,
      fmz:lake.fmz,
      thermalRegime:lake.thermalRegime,
      maximumDepthM:lake.maximumDepthM,
      surfaceAreaHa:lake.surfaceAreaHa,
      matchScore:scored.score,
      fishEvidenceAvailable:true,
      catalogMode:'fisheries',
      originDistanceKm:originDistanceKm===null?null:Math.round(originDistanceKm)
    });
  }
  markers.sort((a,b)=>b.matchScore-a.matchScore||((b.surfaceAreaHa||0)-(a.surfaceAreaHa||0)));
  const matchedInView=markers.length;
  const capped=matchedInView>maxMarkers;
  if(capped) markers=markers.slice(0,maxMarkers);
  const sourceComplete=araPage.complete&&waterPage.complete;
  return {
    markers,
    matchedInView,
    displayedInView:markers.length,
    coverageComplete:sourceComplete&&!capped,
    truncatedReason:capped?'marker_safety_ceiling':(!sourceComplete?'source_safety_ceiling':null),
    sourceFeatureCount:{ara:araPage.features.length,waterbody:waterPage.features.length},
    sourcePages:{ara:araPage.pages,waterbody:waterPage.pages},
    catalogMode:'fisheries'
  };
}

async function mapViewport(filters={},bboxValue,maxMarkers=12000){
  const bbox=parseBbox(bboxValue);
  if(!bbox) throw new Error('Invalid map bbox');
  return hasFisheriesFilters(filters) ? mapFisheries(filters,bbox,maxMarkers) : mapMaster(filters,bbox,maxMarkers);
}

async function catalogLakeDetail(id){
  const safe=escSql(String(id||'').trim().slice(0,32));
  if(!safe) throw new Error('Missing waterbody id');
  const d=await getJson(arcgisUrl(SOURCES.waterbody,{
    where:`WATERBODY_IDENT='${safe}' AND ENTITY_TYPE='Lake'`,
    outFields:WATERBODY_FIELDS,
    returnGeometry:'false',
    resultRecordCount:'5'
  }));
  const loc=normalizeLocation((d.features||[])[0]);
  if(!loc) return null;
  const stocks=await lookupStocking([loc.id]);
  const stocking=stocks.get(loc.id)||[];
  return {
    ...loc,
    species:[],
    speciesSummary:null,
    stocking,
    fmz:null,
    thermalRegime:null,
    maximumDepthM:null,
    meanDepthM:null,
    secchiDepthM:null,
    surfaceAreaHa:null,
    matchScore:null,
    matchReasons:['Ontario Waterbody Location Identifier lake record','No Ontario ARA fisheries record was returned for this lake'],
    fishEvidenceAvailable:false,
    catalogMode:'all_lakes',
    regulationNote:'Lake is present in Ontario’s waterbody registry. Fish species and FMZ evidence are not available from the joined ARA record; verify Fish ON-Line and current regulations before fishing.'
  };
}

module.exports={
  buildWhere,
  waterbodyWhere,
  hasFisheriesFilters,
  parseBbox,
  pagedArcgis,
  countArcgis,
  searchComplete,
  searchMaster,
  searchFisheries,
  mapViewport,
  catalogLakeDetail,
  normalizeLocation
};