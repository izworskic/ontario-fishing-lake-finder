const { searchFisheries } = require('../lib/catalog');
const { remoteEvidence, scoreRemote } = require('../lib/remote');

(async()=>{
  const base=await searchFisheries({species:'Brook Trout',thermal:'cold'},3);
  if(!base.lakes?.length) throw new Error('No source-backed Brook Trout coldwater candidate returned');
  const lake=base.lakes[0];
  if(!Number.isFinite(lake.latitude)||!Number.isFinite(lake.longitude)) throw new Error('Remote Trout candidate has no usable coordinates');
  const evidence=await remoteEvidence(lake);
  if(!evidence.available) throw new Error(`Road/access remoteness evidence unavailable: ${(evidence.sourceFailures||[]).join(',')}`);
  const scored=scoreRemote(lake,evidence);
  if(scored.troutFit!==lake.matchScore) throw new Error('Remote scoring mutated Trout Fit semantics');
  if(!Number.isFinite(scored.remoteContext)||scored.remoteContext<0||scored.remoteContext>100) throw new Error('Remote Context score invalid');
  if(!Number.isFinite(scored.confidence)||scored.confidence<0||scored.confidence>100) throw new Error('Remote Context confidence invalid');
  console.log(JSON.stringify({status:'ok',lake:lake.name,id:lake.id,troutFit:scored.troutFit,remoteContext:scored.remoteContext,confidence:scored.confidence,nearestRoadKm:evidence.nearestRoadKm,nearestAccessKm:evidence.nearestAccessKm,sourceFailures:evidence.sourceFailures}));
})().catch(err=>{console.error(err);process.exit(1)});
