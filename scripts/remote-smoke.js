const {loadIndex,searchRemoteTrout,remoteMap}=require('../lib/remote');

(async()=>{
  const index=loadIndex();
  if(index.schemaVersion!==2) throw new Error(`Unexpected trout index schema ${index.schemaVersion}`);
  if(!Array.isArray(index.lakes)||index.lakes.length<500) throw new Error(`Trout index unexpectedly small: ${index.lakes?.length}`);
  if(!index.lakes.some(x=>x.evidence?.includes('ara_survey'))) throw new Error('ARA survey-point evidence missing from trout index');
  if(!index.lakes.some(x=>x.evidence?.includes('stocking'))) throw new Error('Stocking evidence missing from trout index');

  const first=searchRemoteTrout({species:'Brook Trout',remote:'easy',sort:'remote'},{limit:25,offset:0});
  const second=searchRemoteTrout({species:'Brook Trout',remote:'easy',sort:'remote'},{limit:25,offset:25});
  if(first.candidateCount<100) throw new Error(`Brook Trout universe unexpectedly small: ${first.candidateCount}`);
  if(first.candidateCount!==second.candidateCount) throw new Error('Pagination changed candidateCount');
  if(!first.lakes.length) throw new Error('No Brook Trout rows returned');
  const lake=first.lakes[0];
  if(!Number.isFinite(lake.troutFit)||!Number.isFinite(lake.remoteContext)||!Number.isFinite(lake.confidence)) throw new Error('V2 score contract invalid');
  if(!lake.evidence?.length) throw new Error('Top result has no source provenance');

  const map=remoteMap({species:'Brook Trout',remote:'easy'},'-96,41,-74,57',12000);
  if(!map.coverageComplete) throw new Error(`Province-wide Brook Trout map exceeded marker ceiling: ${map.matchedInView}`);
  if(map.matchedInView!==first.candidateCount) throw new Error(`Map/list universe mismatch: map ${map.matchedInView}, list ${first.candidateCount}`);

  console.log(JSON.stringify({status:'ok',indexLakes:index.lakes.length,brookTrout:first.candidateCount,indexBuiltAt:index.builtAt,sample:{name:lake.name,id:lake.id,troutFit:lake.troutFit,remoteContext:lake.remoteContext,confidence:lake.confidence,evidence:lake.evidence,roadKm:lake.remote?.roadKm,accessKm:lake.remote?.accessKm},summary:index.summary}));
})().catch(err=>{console.error(err);process.exit(1)});
