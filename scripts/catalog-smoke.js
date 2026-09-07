const OHN='https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open01/MapServer/25';
const WATERBODY='https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open08/MapServer/17';
const ARA='https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open07/MapServer/2';

async function query(base,params){
  const url=`${base}/query?${new URLSearchParams({f:'json',...params})}`;
  const r=await fetch(url,{headers:{accept:'application/json','user-agent':'OntarioFishingLakeFinderCatalogSmoke/2.0'},signal:AbortSignal.timeout(20000)});
  if(!r.ok) throw new Error(`${base} HTTP ${r.status}`);
  const d=await r.json();
  if(d.error) throw new Error(d.error.message||'ArcGIS error');
  return d;
}

(async()=>{
  const ohnWhere="WATERBODY_TYPE IN ('Lake','Kettle lake')";
  const ohnCount=await query(OHN,{where:ohnWhere,returnCountOnly:'true',returnGeometry:'false'});
  if(!Number.isFinite(Number(ohnCount.count))||Number(ohnCount.count)<100000) throw new Error(`OHN lake inventory is unexpectedly small: ${ohnCount.count}`);

  const ohnSample=await query(OHN,{where:ohnWhere,outFields:'OGF_ID,WATERBODY_TYPE,OFFICIAL_NAME_LABEL,SYSTEM_CALCULATED_AREA',returnGeometry:'false',resultRecordCount:'5',orderByFields:'OBJECTID ASC'});
  if(!ohnSample.features?.length) throw new Error('OHN lake inventory returned no sample records');
  for(const f of ohnSample.features){
    const a=f.attributes||{};
    if(!['Lake','Kettle lake'].includes(a.WATERBODY_TYPE)||!Number.isFinite(Number(a.OGF_ID))) throw new Error('OHN sample is not a lake record with stable OGF_ID');
  }

  const wliWhere="WATERBODY_IDENT IS NOT NULL AND ENTITY_TYPE='Lake'";
  const wliCount=await query(WATERBODY,{where:wliWhere,returnCountOnly:'true',returnGeometry:'false'});
  if(!Number.isFinite(Number(wliCount.count))||Number(wliCount.count)<1000) throw new Error(`Unexpected fisheries-location lake count: ${wliCount.count}`);

  const brook=await query(ARA,{where:"FISH_SPECIES_SUMMARY LIKE '%Brook Trout%' AND WATERBODY_LID IS NOT NULL",returnCountOnly:'true',returnGeometry:'false'});
  if(!Number.isFinite(Number(brook.count))||Number(brook.count)<1) throw new Error('ARA Brook Trout evidence query returned no records');

  if(Number(ohnCount.count)<=Number(wliCount.count)*3) throw new Error(`OHN master inventory (${ohnCount.count}) is not materially broader than fisheries-location layer (${wliCount.count})`);

  console.log(JSON.stringify({status:'ok',ohnLakeFeatures:Number(ohnCount.count),waterbodyLocationLakeRecords:Number(wliCount.count),sampleCount:ohnSample.features.length,brookTroutAraFeatures:Number(brook.count)}));
})().catch(err=>{console.error(err);process.exit(1)});
