const SOURCES = {
  ara: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open07/MapServer/2',
  waterbody: 'https://ws.lioservices.lrc.gov.on.ca/arcgis1071a/rest/services/LIO_OPEN_DATA/LIO_Open08/MapServer/17',
  access: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open07/MapServer/15',
  stocking: 'https://services1.arcgis.com/TJH5KDher0W13Kgo/ArcGIS/rest/services/FishStockingDataForRecreationalPurposes/FeatureServer/0',
  crown: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open08/MapServer/34',
  clupa: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open06/MapServer/5',
  roads: 'https://services1.arcgis.com/TJH5KDher0W13Kgo/arcgis/rest/services/Ontario_Road_Network_Composite_Service_GeoHub_View_EN/FeatureServer/5',
  roadBarriers: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open09/MapServer/22',
  activeFires: 'https://ws.lioservices.lrc.gov.on.ca/arcgis1061a/rest/services/MNRF/Ontario_Fires_Map/MapServer/32',
  swob: 'https://api.weather.gc.ca/collections/swob-realtime/items',
  regulations: 'https://www.ontario.ca/document/ontario-fishing-regulations-summary',
  fishOnline: 'https://www.ontario.ca/page/how-use-fish-line',
  forestFireInfo: 'https://www.ontario.ca/page/forest-fires',
  ontario511: 'https://511on.ca/'
};

const SPECIES = {
  'brook trout': { cold: true, depth: 7 },
  'lake trout': { cold: true, depth: 18 },
  'rainbow trout': { cold: true, depth: 10 },
  'brown trout': { cold: true, depth: 8 },
  splake: { cold: true, depth: 12 },
  walleye: { depth: 6 },
  'northern pike': { depth: 4 },
  'smallmouth bass': { depth: 4 },
  'largemouth bass': { depth: 2 },
  muskellunge: { depth: 5 },
  'yellow perch': { depth: 3 },
  'black crappie': { depth: 2 },
  whitefish: { cold: true, depth: 15 }
};

const ARA_FIELDS = 'OBJECTID,ARA_IDENT,WATERBODY_LID,WATERBODY_TYPE,CORPORATE_WATERBODY_NAME,OFFICIAL_WATERBODY_NAME,WATERBODY_ALIAS_NAME1,WATERBODY_ALIAS_NAME2,FISHERIES_MANAGEMENT_ZONE_ID,THERMAL_REGIME,THERMAL_REGIME_REASON,FISH_SPECIES_SUMMARY,SURFACE_AREA,MAXIMUM_DEPTH,MEAN_DEPTH,SECCHI_DEPTH,CONDUCTIVITY,COLDWATER_REHAB_POTENTIAL_IND,SPATIAL_VERIFICATION_FLG,EFFECTIVE_DATETIME';
const WATERBODY_FIELDS = 'WATERBODY_IDENT,OFFICIAL_NAME,OFFICIAL_ALTERNATE_NAME,UNOFFICIAL_NAME,LATITUDE_DECIMAL_DEGREES,LONGITUDE_DECIMAL_DEGREES,GEOGRAPHIC_TOWNSHIP_NAME,UPPER_TIER_MUNICIPALITY,LOWER_TIER_MUNICIPALITY,SINGLE_TIER_MUNICIPALITY,TERRITORIAL_DISTRICT,LOCATION_NARRATIVE,REFRESH_DATETIME';
const STOCK_FIELDS = 'MNRF_District,Stocking_Year,Species,Official_Waterbody_Name,Unoffcial_Waterbody_Name,Waterbody_Location_Identifier,Geographic_Township,Developmental_Stage,Number_of_Fish_Stocked,Latitude,Longitude,ObjectId';
const ACCESS_FIELDS = 'OBJECTID,FISHING_ACCESS_POINT_TYPE,SITE_LAST_VERIFICATION_DATE,VERIFICATION_DATE_SOURCE,PARKING_PRESENCE_FLG,SITE_OWNERSHIP_TYPE,MATERIAL_TYPE,ACCESSIBILITY_FLG,USER_FEE_FLG,VISIBILITY_IND,SITE_NAME,SITE_PHOTO_URL,ADDITIONAL_INFORMATION_URL,GENERAL_COMMENTS';

function text(v){ return v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim(); }
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
function clamp(v,min,max){ return Math.min(max, Math.max(min,v)); }
function clean(v,max=80){ return String(v || '').replace(/[<>]/g,'').trim().slice(0,max); }
function escSql(v){ return String(v || '').replace(/'/g,"''"); }
function parseSpecies(v){ return [...new Set(String(v || '').replace(/\r?\n/g,';').split(/\s*[;,|]\s*/).map(x=>x.trim()).filter(Boolean))].slice(0,40); }
function looksLikeLake(v){ const s=String(v||'').toLowerCase(); return !s || /lake|pond|reservoir|impoundment/.test(s); }

function arcgisUrl(base, params={}){
  return `${base}/query?${new URLSearchParams({f:'json', ...params})}`;
}

async function getJson(url, timeout=12000){
  const r = await fetch(url,{headers:{accept:'application/json','user-agent':'ChrisIzworskiOntarioFishingLakeFinder/1.0'},signal:AbortSignal.timeout(timeout)});
  if(!r.ok) throw new Error(`Upstream HTTP ${r.status}`);
  const data=await r.json();
  if(data?.error) throw new Error(data.error.message || 'Upstream GIS error');
  return data;
}

function haversineKm(a,b,c,d){
  if([a,b,c,d].some(v=>!Number.isFinite(Number(v)))) return null;
  const R=6371,toRad=x=>x*Math.PI/180,dLat=toRad(c-a),dLon=toRad(d-b);
  const q=Math.sin(dLat/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(q));
}

function araWhere({species,q,fmz,thermal}){
  const parts=['FISH_SPECIES_SUMMARY IS NOT NULL','WATERBODY_LID IS NOT NULL'];
  if(species) parts.push(`FISH_SPECIES_SUMMARY LIKE '%${escSql(species)}%'`);
  if(q){ const s=escSql(q); parts.push(`(OFFICIAL_WATERBODY_NAME LIKE '%${s}%' OR CORPORATE_WATERBODY_NAME LIKE '%${s}%' OR WATERBODY_ALIAS_NAME1 LIKE '%${s}%' OR WATERBODY_ALIAS_NAME2 LIKE '%${s}%')`); }
  if(/^\d{1,2}$/.test(String(fmz||''))) parts.push(`FISHERIES_MANAGEMENT_ZONE_ID=${Number(fmz)}`);
  const thermalLabels={cold:'Cold',cool:'Cool',warm:'Warm'};
  if(thermalLabels[thermal]) parts.push(`THERMAL_REGIME LIKE '${thermalLabels[thermal]}%'`);
  return parts.join(' AND ');
}

function normalizeAra(feature){
  const a=feature?.attributes||{}, id=text(a.WATERBODY_LID); if(!id) return null;
  return {id, araId:text(a.ARA_IDENT), objectId:a.OBJECTID??null, name:text(a.OFFICIAL_WATERBODY_NAME)||text(a.CORPORATE_WATERBODY_NAME)||text(a.WATERBODY_ALIAS_NAME1)||'Unnamed lake', officialName:text(a.OFFICIAL_WATERBODY_NAME), aliases:[text(a.WATERBODY_ALIAS_NAME1),text(a.WATERBODY_ALIAS_NAME2)].filter(Boolean), waterbodyType:text(a.WATERBODY_TYPE), speciesSummary:text(a.FISH_SPECIES_SUMMARY), species:parseSpecies(a.FISH_SPECIES_SUMMARY), fmz:num(a.FISHERIES_MANAGEMENT_ZONE_ID), thermalRegime:text(a.THERMAL_REGIME), thermalReason:text(a.THERMAL_REGIME_REASON), surfaceAreaHa:num(a.SURFACE_AREA), maximumDepthM:num(a.MAXIMUM_DEPTH), meanDepthM:num(a.MEAN_DEPTH), secchiDepthM:num(a.SECCHI_DEPTH), conductivity:num(a.CONDUCTIVITY), coldwaterRehabPotential:text(a.COLDWATER_REHAB_POTENTIAL_IND), spatialVerification:text(a.SPATIAL_VERIFICATION_FLG), effectiveAt:a.EFFECTIVE_DATETIME??null};
}

function dedupe(rows){
  const m=new Map();
  for(const row of rows.filter(Boolean)){
    const old=m.get(row.id);
    if(!old){m.set(row.id,row);continue;}
    const primary=(row.surfaceAreaHa||0)>(old.surfaceAreaHa||0)?row:old, secondary=primary===row?old:row;
    primary.species=[...new Set([...(primary.species||[]),...(secondary.species||[])])];
    if(!primary.speciesSummary) primary.speciesSummary=secondary.speciesSummary;
    m.set(row.id,primary);
  }
  return [...m.values()];
}

async function lookupLocations(ids){
  const out=new Map();
  for(let i=0;i<ids.length;i+=35){
    const chunk=ids.slice(i,i+35), where=`WATERBODY_IDENT IN (${chunk.map(x=>`'${escSql(x)}'`).join(',')})`;
    const d=await getJson(arcgisUrl(SOURCES.waterbody,{where,outFields:WATERBODY_FIELDS,returnGeometry:'false',resultRecordCount:'2000'}));
    for(const f of d.features||[]){
      const a=f.attributes||{},id=text(a.WATERBODY_IDENT);if(!id)continue;
      out.set(id,{latitude:num(a.LATITUDE_DECIMAL_DEGREES),longitude:num(a.LONGITUDE_DECIMAL_DEGREES),officialName:text(a.OFFICIAL_NAME),alternateName:text(a.OFFICIAL_ALTERNATE_NAME),unofficialName:text(a.UNOFFICIAL_NAME),township:text(a.GEOGRAPHIC_TOWNSHIP_NAME),municipality:text(a.SINGLE_TIER_MUNICIPALITY)||text(a.LOWER_TIER_MUNICIPALITY)||text(a.UPPER_TIER_MUNICIPALITY)||text(a.TERRITORIAL_DISTRICT),district:text(a.TERRITORIAL_DISTRICT),locationNarrative:text(a.LOCATION_NARRATIVE),refreshedAt:a.REFRESH_DATETIME??null});
    }
  }
  return out;
}

async function lookupStocking(ids){
  const out=new Map();
  for(let i=0;i<ids.length;i+=30){
    const chunk=ids.slice(i,i+30), where=`Waterbody_Location_Identifier IN (${chunk.map(x=>`'${escSql(x)}'`).join(',')})`;
    try{
      const d=await getJson(arcgisUrl(SOURCES.stocking,{where,outFields:STOCK_FIELDS,returnGeometry:'false',orderByFields:'Stocking_Year DESC',resultRecordCount:'2000'}));
      for(const f of d.features||[]){const a=f.attributes||{},id=text(a.Waterbody_Location_Identifier);if(!id)continue;if(!out.has(id))out.set(id,[]);out.get(id).push({year:num(a.Stocking_Year),species:text(a.Species),numberStocked:num(a.Number_of_Fish_Stocked),developmentalStage:text(a.Developmental_Stage),district:text(a.MNRF_District),township:text(a.Geographic_Township)});}
    }catch{}
  }
  return out;
}

function fitScore(lake,targetSpecies){
  let score=35; const reasons=['Ontario ARA fish and lake record'], target=String(targetSpecies||'').toLowerCase(), blob=`${lake.speciesSummary||''} ${(lake.species||[]).join(' ')}`.toLowerCase();
  if(target){if(blob.includes(target)){score+=30;reasons.push(`${targetSpecies} recorded`);}else{score-=25;reasons.push(`${targetSpecies} not shown in this ARA record`);}}
  else if(lake.species?.length){score+=Math.min(12,lake.species.length*2);reasons.push(`${lake.species.length} recorded species`);}
  const p=SPECIES[target], thermal=String(lake.thermalRegime||'').toLowerCase();
  if(p?.cold&&thermal.includes('cold')){score+=12;reasons.push('coldwater regime fits target');}
  if(p?.depth&&lake.maximumDepthM!==null&&lake.maximumDepthM>=p.depth){score+=8;reasons.push(`depth data fits target (${Math.round(lake.maximumDepthM)} m max)`);}
  if(lake.surfaceAreaHa!==null){score+=3;reasons.push('surface area documented');}
  if(lake.latitude!==null&&lake.longitude!==null) score+=5;
  const y=new Date().getUTCFullYear(), recent=(lake.stocking||[]).find(s=>(!target||String(s.species||'').toLowerCase().includes(target))&&s.year&&y-s.year<=5);
  if(recent){score+=12;reasons.push(`${recent.species||targetSpecies} stocked in ${recent.year}`);}
  return {score:clamp(Math.round(score),0,100),reasons:reasons.slice(0,7)};
}

async function searchLakes(filters,limit=60){
  const d=await getJson(arcgisUrl(SOURCES.ara,{where:araWhere(filters),outFields:ARA_FIELDS,returnGeometry:'false',orderByFields:'SURFACE_AREA DESC',resultRecordCount:String(Math.min(1200,Math.max(limit*7,280)))}));
  const raw=dedupe((d.features||[]).map(normalizeAra)).filter(x=>looksLikeLake(x.waterbodyType));
  const short=raw.slice(0,Math.min(220,Math.max(limit*3,limit))), ids=short.map(x=>x.id);
  const [locs,stock]=await Promise.all([lookupLocations(ids),lookupStocking(ids)]);
  let rows=short.map(l=>{const item={...l,...(locs.get(l.id)||{}),stocking:(stock.get(l.id)||[]).slice(0,8)};const s=fitScore(item,filters.species);const originDistanceKm=Number.isFinite(filters.originLat)&&Number.isFinite(filters.originLon)&&Number.isFinite(item.latitude)&&Number.isFinite(item.longitude)?haversineKm(filters.originLat,filters.originLon,item.latitude,item.longitude):null;return {...item,matchScore:s.score,matchReasons:s.reasons,originDistanceKm:originDistanceKm===null?null:Math.round(originDistanceKm)};}).filter(x=>x.latitude!==null&&x.longitude!==null);
  if(Number.isFinite(filters.minDepth)) rows=rows.filter(x=>(x.maximumDepthM??-1)>=filters.minDepth);
  if(Number.isFinite(filters.maxDistanceKm)&&Number.isFinite(filters.originLat)&&Number.isFinite(filters.originLon)) rows=rows.filter(x=>x.originDistanceKm!==null&&x.originDistanceKm<=filters.maxDistanceKm);
  rows.sort((a,b)=>b.matchScore-a.matchScore||((a.originDistanceKm??99999)-(b.originDistanceKm??99999))||((b.surfaceAreaHa||0)-(a.surfaceAreaHa||0)));
  return rows.slice(0,limit);
}

async function queryNearby(base,lat,lon,distanceKm,outFields='*',count=100){
  return getJson(arcgisUrl(base,{where:'1=1',geometry:`${lon},${lat}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',distance:String(distanceKm),units:'esriSRUnit_Kilometer',outFields,returnGeometry:'true',outSR:'4326',resultRecordCount:String(count)}));
}

function pointFromGeometry(g){ if(Number.isFinite(g?.x)&&Number.isFinite(g?.y))return[g.y,g.x]; if(Array.isArray(g?.points)&&g.points[0])return[g.points[0][1],g.points[0][0]]; return null; }
function minDistanceToGeometry(lat,lon,g){ const pts=[]; if(Number.isFinite(g?.x)&&Number.isFinite(g?.y))pts.push([g.y,g.x]); for(const path of g?.paths||[])for(const p of path||[])pts.push([p[1],p[0]]); for(const ring of g?.rings||[])for(const p of ring||[])pts.push([p[1],p[0]]); let best=null; for(const p of pts){const d=haversineKm(lat,lon,p[0],p[1]);if(d!==null&&(best===null||d<best))best=d;} return best; }

async function accessContext(lat,lon){
  try{const d=await queryNearby(SOURCES.access,lat,lon,12,ACCESS_FIELDS,100);return (d.features||[]).map(f=>{const a=f.attributes||{},p=pointFromGeometry(f.geometry),distanceKm=p?haversineKm(lat,lon,p[0],p[1]):null;return{id:a.OBJECTID??null,name:text(a.SITE_NAME)||text(a.FISHING_ACCESS_POINT_TYPE)||'Fishing access point',type:text(a.FISHING_ACCESS_POINT_TYPE),distanceKm:distanceKm===null?null:Math.round(distanceKm*10)/10,latitude:p?.[0]??null,longitude:p?.[1]??null,parking:text(a.PARKING_PRESENCE_FLG),ownership:text(a.SITE_OWNERSHIP_TYPE),accessible:text(a.ACCESSIBILITY_FLG),fee:text(a.USER_FEE_FLG),lastVerifiedAt:a.SITE_LAST_VERIFICATION_DATE??null,infoUrl:text(a.ADDITIONAL_INFORMATION_URL)}}).sort((a,b)=>(a.distanceKm??999)-(b.distanceKm??999));}catch{return[];}
}

async function crownContext(lat,lon){
  const out={unpatentedNearby:false,unpatentedRecordCount:0,policyAreas:[],note:'Planning/mapping context only; not a legal boundary or camping/access determination.'};
  try{const d=await queryNearby(SOURCES.crown,lat,lon,2,'OBJECTID,SURVEY_LOCATION_IDENT,AREA_IN_HA,LOCATION_DESCR',50);out.unpatentedRecordCount=(d.features||[]).length;out.unpatentedNearby=out.unpatentedRecordCount>0;}catch{}
  try{const d=await queryNearby(SOURCES.clupa,lat,lon,0.2,'OBJECTID,POLICY_IDENT,DESIGNATION_ENG,NAME_ENG,CATEGORY_ENG',20);out.policyAreas=(d.features||[]).map(f=>({policyId:text(f.attributes?.POLICY_IDENT),name:text(f.attributes?.NAME_ENG),designation:text(f.attributes?.DESIGNATION_ENG),category:text(f.attributes?.CATEGORY_ENG)}));}catch{}
  return out;
}

function pickAttr(a,keys){for(const k of keys){if(text(a?.[k]))return text(a[k]);}return null;}
async function roadContext(lat,lon){
  const out={nearestRoad:null,barriers:[],ontario511:SOURCES.ontario511};
  try{const d=await queryNearby(SOURCES.roads,lat,lon,12,'*',100);const roads=(d.features||[]).map(f=>({name:pickAttr(f.attributes,['FULL_STREET_NAME','FULL_NAME','ROAD_NAME','OFFICIAL_STREET_NAME','STREET_NAME'])||'Mapped road',roadClass:pickAttr(f.attributes,['ROAD_CLASS','ROAD_CLASSIFICATION','CLASSIFICATION']),surface:pickAttr(f.attributes,['PAVEMENT_STATUS','ROAD_SURFACE','SURFACE_TYPE']),jurisdiction:pickAttr(f.attributes,['JURISDICTION','JURISDICTION_NAME']),distanceKm:minDistanceToGeometry(lat,lon,f.geometry)})).filter(x=>x.distanceKm!==null).sort((a,b)=>a.distanceKm-b.distanceKm);if(roads[0])out.nearestRoad={...roads[0],distanceKm:Math.round(roads[0].distanceKm*10)/10};}catch{}
  try{const d=await queryNearby(SOURCES.roadBarriers,lat,lon,25,'OBJECTID,BARRIER_IDENT,RESPONSIBILITY_CLASS,RESPONSIBILITY_DETAIL,GATE_IND,BERM_IND,DITCH_IND,FENCE_IND,BOULDER_IND,OBSTACLE_TYPE,UNSAFE_IND,UNSAFE_CONCERN,GENERAL_COMMENTS',100);out.barriers=(d.features||[]).map(f=>{const p=pointFromGeometry(f.geometry),distanceKm=p?haversineKm(lat,lon,p[0],p[1]):null,a=f.attributes||{};return{id:a.OBJECTID??null,identifier:text(a.BARRIER_IDENT),distanceKm:distanceKm===null?null:Math.round(distanceKm*10)/10,responsibility:text(a.RESPONSIBILITY_CLASS)||text(a.RESPONSIBILITY_DETAIL),gate:text(a.GATE_IND),obstacle:text(a.OBSTACLE_TYPE),unsafe:text(a.UNSAFE_IND),unsafeConcern:text(a.UNSAFE_CONCERN),comments:text(a.GENERAL_COMMENTS),latitude:p?.[0]??null,longitude:p?.[1]??null};}).sort((a,b)=>(a.distanceKm??999)-(b.distanceKm??999));}catch{}
  return out;
}

async function fireContext(lat,lon){
  const out={activeFires:[],nearestFireKm:null,forestFireInfo:SOURCES.forestFireInfo,note:'Active-fire locations/status can change; use Ontario emergency/fire information for decisions.'};
  try{const d=await queryNearby(SOURCES.activeFires,lat,lon,150,'FIREID,FIRE_NUMBER,FIRE_NAME,FIRE_TYPE,CURRENT_SIZE,CONFIRMED_DATE,FIRE_CONDITION,DISTRICT_NAME,CONDITION_DESCRIPTION,ESTIMATED_FIRE_CAUSE,RESPONSE_OBJECTIVE',200);out.activeFires=(d.features||[]).map(f=>{const p=pointFromGeometry(f.geometry),distanceKm=p?haversineKm(lat,lon,p[0],p[1]):null,a=f.attributes||{};return{id:a.FIREID??null,name:text(a.FIRE_NAME)||`Fire ${a.FIRE_NUMBER??''}`.trim(),distanceKm:distanceKm===null?null:Math.round(distanceKm),sizeHa:num(a.CURRENT_SIZE),condition:text(a.FIRE_CONDITION)||text(a.CONDITION_DESCRIPTION),district:text(a.DISTRICT_NAME),confirmedAt:a.CONFIRMED_DATE??null,cause:text(a.ESTIMATED_FIRE_CAUSE),latitude:p?.[0]??null,longitude:p?.[1]??null};}).sort((a,b)=>(a.distanceKm??9999)-(b.distanceKm??9999));out.nearestFireKm=out.activeFires[0]?.distanceKm??null;}catch{}
  return out;
}

function firstNumericByRegex(obj,regex){for(const [k,v] of Object.entries(obj||{})){if(regex.test(k)){const n=Number(v);if(Number.isFinite(n))return n;}}return null;}
async function weatherContext(lat,lon){
  const out={station:null,observedAt:null,temperatureC:null,windKmh:null,windGustKmh:null,distanceKm:null,note:'Nearest recent Environment Canada SWOB station observation; conditions at the lake can differ.'};
  try{
    const span=1.0,bbox=[lon-span,lat-span,lon+span,lat+span].join(','),url=`${SOURCES.swob}?${new URLSearchParams({bbox,limit:'100',sortby:'-date_tm-value',f:'json'})}`;
    const d=await getJson(url);const rows=(d.features||[]).map(f=>{const c=f.geometry?.coordinates||[],p=f.properties||{},distanceKm=Array.isArray(c)&&c.length>=2?haversineKm(lat,lon,c[1],c[0]):null;return{p,c,distanceKm};}).filter(x=>x.distanceKm!==null).sort((a,b)=>a.distanceKm-b.distanceKm);const best=rows[0];if(best){const p=best.p;out.station=text(p['stn_nam-value'])||text(p['station_name'])||text(p['msc_id-value'])||text(p['clim_id-value'])||'Environment Canada station';out.observedAt=text(p['date_tm-value'])||text(p.obs_date_tm)||text(p.datetime)||null;out.temperatureC=firstNumericByRegex(p,/^(air_temp|.*temp.*)-?value$|air.?temp/i);out.windKmh=firstNumericByRegex(p,/avg.*wnd.*spd|wind.*speed|wnd.*spd/i);out.windGustKmh=firstNumericByRegex(p,/gust.*spd|wind.*gust/i);out.distanceKm=Math.round(best.distanceKm);}}
  catch{}
  return out;
}

function tripScore(matchScore,{access,roads,fires,weather}){
  let live=50;const reasons=[];
  const nearAccess=access?.[0]?.distanceKm;
  if(Number.isFinite(nearAccess)){if(nearAccess<=2){live+=15;reasons.push(`mapped fishing access ${nearAccess} km away`);}else if(nearAccess<=8){live+=8;reasons.push(`mapped fishing access ${nearAccess} km away`);}else reasons.push('no mapped fishing access within 8 km');}else reasons.push('no nearby source-published fishing access returned');
  const road=roads?.nearestRoad?.distanceKm;if(Number.isFinite(road)){if(road<=2){live+=10;reasons.push(`mapped road ${road} km away`);}else if(road<=8){live+=5;reasons.push(`mapped road ${road} km away`);}}
  const barrier=roads?.barriers?.[0]?.distanceKm;if(Number.isFinite(barrier)&&barrier<=5){live-=8;reasons.push(`MNR road barrier mapped ${barrier} km away`);}
  const fire=fires?.nearestFireKm;if(Number.isFinite(fire)){if(fire<=20){live-=35;reasons.push(`active fire about ${fire} km away`);}else if(fire<=50){live-=18;reasons.push(`active fire about ${fire} km away`);}else if(fire<=100){live-=6;reasons.push(`active fire about ${fire} km away`);}}
  const wind=weather?.windKmh;if(Number.isFinite(wind)){if(wind>=35){live-=15;reasons.push(`nearest station wind ${Math.round(wind)} km/h`);}else if(wind>=25){live-=8;reasons.push(`nearest station wind ${Math.round(wind)} km/h`);}else reasons.push(`nearest station wind ${Math.round(wind)} km/h`);}
  live=clamp(live,0,100);return{score:Math.round(matchScore*.65+live*.35),evidenceScore:matchScore,tripContextScore:live,reasons:reasons.slice(0,6),semantics:'Trip score combines lake-fit evidence with access/road/fire/current-observation context. It is not a catch forecast, safety clearance, legal access determination, or route time.'};
}

async function lakeDetail(id,targetSpecies){
  const safe=escSql(clean(id,32));if(!safe)throw new Error('Missing waterbody id');
  const d=await getJson(arcgisUrl(SOURCES.ara,{where:`WATERBODY_LID='${safe}'`,outFields:ARA_FIELDS,returnGeometry:'false',resultRecordCount:'100'}));
  const rows=dedupe((d.features||[]).map(normalizeAra));if(!rows.length)return null;const base=rows[0];
  const [locs,stocks]=await Promise.all([lookupLocations([base.id]),lookupStocking([base.id])]);const lake={...base,...(locs.get(base.id)||{}),stocking:stocks.get(base.id)||[]};const fit=fitScore(lake,targetSpecies);lake.matchScore=fit.score;lake.matchReasons=fit.reasons;
  if(!Number.isFinite(lake.latitude)||!Number.isFinite(lake.longitude))return lake;
  const [access,crown,roads,fires,weather]=await Promise.all([accessContext(lake.latitude,lake.longitude),crownContext(lake.latitude,lake.longitude),roadContext(lake.latitude,lake.longitude),fireContext(lake.latitude,lake.longitude),weatherContext(lake.latitude,lake.longitude)]);
  const trip=tripScore(lake.matchScore,{access,roads,fires,weather});
  return {...lake,access,crown,roads,fires,weather,tripScore:trip.score,tripScoreBreakdown:trip,regulationNote:lake.fmz?`Mapped in Fisheries Management Zone ${lake.fmz}. Check current zone rules and waterbody-specific exceptions before fishing.`:'Check current Ontario regulations and waterbody-specific exceptions before fishing.'};
}

function sourceManifest(){return{aquaticResourceAreas:{url:SOURCES.ara,role:'fish species, FMZ and lake characteristics'},waterbodyIdentifier:{url:SOURCES.waterbody,role:'joinable waterbody ID and location'},fishStocking:{url:SOURCES.stocking,role:'recreational stocking records'},fishingAccess:{url:SOURCES.access,role:'source-published fishing access points'},crownUnpatented:{url:SOURCES.crown,role:'MNR unpatented-land planning/mapping context'},crownPolicy:{url:SOURCES.clupa,role:'Crown Land Use Policy Atlas context; not legal boundary evidence'},roads:{url:SOURCES.roads,role:'Ontario Road Network mapping context'},roadBarriers:{url:SOURCES.roadBarriers,role:'MNR road barriers / restricted access context'},activeFires:{url:SOURCES.activeFires,role:'Ontario active forest fire locations/status'},weather:{url:SOURCES.swob,role:'Environment Canada real-time station observations'},regulations:{url:SOURCES.regulations,role:'current legal fishing rules verification'},fishOnline:{url:SOURCES.fishOnline,role:'official Ontario fishing reference'}};}

module.exports={SOURCES,clean,num,parseSpecies,looksLikeLake,haversineKm,araWhere,normalizeAra,dedupe,fitScore,tripScore,searchLakes,lakeDetail,sourceManifest};
