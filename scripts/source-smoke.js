const checks = [
  {
    name: 'Ontario Aquatic Resource Area',
    url: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open07/MapServer/2/query?where=FISH_SPECIES_SUMMARY%20IS%20NOT%20NULL&outFields=WATERBODY_LID,OFFICIAL_WATERBODY_NAME,FISH_SPECIES_SUMMARY&returnGeometry=false&resultRecordCount=1&f=json',
    validate: d => Array.isArray(d.features) && d.features.length > 0 && !d.error
  },
  {
    name: 'Ontario Waterbody Location Identifier',
    url: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open08/MapServer/17/query?where=1%3D1&outFields=WATERBODY_IDENT,LATITUDE_DECIMAL_DEGREES,LONGITUDE_DECIMAL_DEGREES&returnGeometry=false&resultRecordCount=1&f=json',
    validate: d => Array.isArray(d.features) && d.features.length > 0 && !d.error
  },
  {
    name: 'Ontario Fishing Access Point',
    url: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open07/MapServer/15/query?where=1%3D1&outFields=OBJECTID,FISHING_ACCESS_POINT_TYPE&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json',
    validate: d => Array.isArray(d.features) && d.features.length > 0 && !d.error
  },
  {
    name: 'Ontario Fish Stocking',
    url: 'https://services1.arcgis.com/TJH5KDher0W13Kgo/ArcGIS/rest/services/FishStockingDataForRecreationalPurposes/FeatureServer/0/query?where=1%3D1&outFields=Waterbody_Location_Identifier,Stocking_Year,Species&returnGeometry=false&resultRecordCount=1&f=json',
    validate: d => Array.isArray(d.features) && d.features.length > 0 && !d.error
  },
  {
    name: 'Ontario Crown MNR unpatented land',
    url: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open08/MapServer/34/query?where=1%3D1&outFields=OBJECTID&returnGeometry=false&resultRecordCount=1&f=json',
    validate: d => Array.isArray(d.features) && d.features.length > 0 && !d.error
  },
  {
    name: 'Ontario CLUPA policy',
    url: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open06/MapServer/5/query?where=1%3D1&outFields=OBJECTID,POLICY_IDENT,NAME_ENG&returnGeometry=false&resultRecordCount=1&f=json',
    validate: d => Array.isArray(d.features) && d.features.length > 0 && !d.error
  },
  {
    name: 'Ontario Road Network',
    url: 'https://services1.arcgis.com/TJH5KDher0W13Kgo/arcgis/rest/services/Ontario_Road_Network_Composite_Service_GeoHub_View_EN/FeatureServer/5/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json',
    validate: d => Array.isArray(d.features) && d.features.length > 0 && !d.error
  },
  {
    name: 'MNR Road Barriers',
    url: 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open09/MapServer/22/query?where=1%3D1&outFields=OBJECTID,BARRIER_IDENT&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json',
    validate: d => Array.isArray(d.features) && d.features.length > 0 && !d.error
  },
  {
    name: 'Ontario Active Fires',
    url: 'https://ws.lioservices.lrc.gov.on.ca/arcgis1061a/rest/services/MNRF/Ontario_Fires_Map/MapServer/32/query?where=1%3D1&outFields=FIREID,FIRE_NAME,CURRENT_SIZE,FIRE_CONDITION&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json',
    validate: d => Array.isArray(d.features) && !d.error
  },
  {
    name: 'Environment Canada SWOB',
    url: 'https://api.weather.gc.ca/collections/swob-realtime/items?limit=1&f=json',
    validate: d => Array.isArray(d.features) && d.features.length > 0
  },
  {
    name: 'Ontario 511 Events',
    url: 'https://511on.ca/api/v2/get/event?format=json&lang=en',
    validate: d => Array.isArray(d)
  }
];

async function main() {
  const failures = [];
  for (const check of checks) {
    try {
      const response = await fetch(check.url, {
        headers: { accept: 'application/json', 'user-agent': 'ChrisIzworskiOntarioFishingLakeFinderSourceSmoke/1.0' },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!check.validate(data)) throw new Error(`unexpected response shape${data?.error?.message ? `: ${data.error.message}` : ''}`);
      console.log(`PASS ${check.name}`);
    } catch (error) {
      failures.push(`${check.name}: ${error.message}`);
      console.error(`FAIL ${check.name}: ${error.message}`);
    }
  }
  if (failures.length) {
    console.error(`\n${failures.length} source check(s) failed:`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`\nAll ${checks.length} live source checks passed.`);
}

main();