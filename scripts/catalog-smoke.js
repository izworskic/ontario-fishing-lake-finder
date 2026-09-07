const WATERBODY='https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open08/MapServer/17';
const ARA='https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open07/MapServer/2';

async function query(base,params){
  const url=`${base}/query?${new URLSearchParams({f:'json',...params})}`;
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'OntarioFishingLakeFinderCatalogSmoke/1.0'},signal:AbortSignal.timeout(20000)});
  if(!r.ok) throw new Error(`${base} HTTP ${r.status}`);
  const d=await r.json();
  if(d.error) throw new Error(d.error.message||'ArcGIS error');
  return d;
}

(async()=>{
  const lakeWhere="WATERBODY_IDENT IS NOT NULL AND ENTITY_TYPE='Lake'";
  const count=await query(WATERBODY,{where:lakeWhere,returnCountOnly:'true',returnGeometry:'false'});
  if(!Number.isFinite(Number(count.count))||Number(count.count)<1000) throw new Error(`Unexpected Ontario lake count: ${count.count}`);

  const sample=await query(WATERBODY,{where:lakeWhere,outFields:'WATERBODY_IDENT,OFFICIAL_NAME,ENTITY_TYPE,LATITUDE_DECIMAL_DEGREES,LONGITUDE_DECIMAL_DEGREES',returnGeometry:'false',resultRecordCount:'5',orderByFields:'OBJECTID ASC'});
  if(!sample.features?.length) throw new Error('Ontario lake catalog returned no sample records');
  for(const f of sample.features){
    const a=f.attributes||{};
    if(a.ENTITY_TYPE!=='Lake'||!a.WATERBODY_IDENT) throw new Error('Master catalog sample is not a Lake record with stable ID');
  }

  const brook=await query(ARA,{where:"FISH_SPECIES_SUMMARY LIKE '%Brook Trout%' AND WATERBODY_LID IS NOT NULL",returnCountOnly:'true',returnGeometry:'false'});
  if(!Number.isFinite(Number(brook.count))||Number(brook.count)<1) throw new Error('ARA Brook Trout evidence query returned no records');

  console.log(JSON.stringify({status:'ok',masterLakeCount:Number(count.count),sampleCount:sample.features.length,brookTroutAraFeatures:Number(brook.count)}));
})().catch(err=>{console.error(err);process.exit(1)});
