const assert = require('assert');
const E = require('../elasticity.js');

function day(n, {cpc=10, clicks=100, carts=15, orders=8, spend=null}={}) {
  const d = String(n).padStart(2,'0');
  return {
    date:`2026-08-${d}`, sku:'SKU-1', name:'Test SKU', clicks, carts,
    spend: spend == null ? cpc*clicks : spend,
    cpc, totalRevenue: orders*1000,
    orderUnitsEstimate:orders, orderReliable:true,
    promotedUnits:orders, promotedRevenue:orders*1000,
  };
}

function stableHistory() {
  return Array.from({length:21},(_,i)=>day(i+1,{cpc:10+(i%2?0.1:-0.1),clicks:120,carts:20,orders:10}));
}

{
  const rows=stableHistory();
  const current=E.analyzeSkuRolling(rows,{startDate:'2026-08-01',endDate:'2026-08-21',minCpcChange:.05,bootstrapIterations:100});
  const history=E.summarizeHistoricalExcitation(rows,{currentCpc:current.currentCpc,minCpcChange:.05});
  const id=E.assessElasticityIdentifiability(current,history);
  const plan=E.planCpcExperiment(current,history,id,{minCpcChange:.05});
  assert(current.days.length===21);
  assert(id.code==='CPC_NOT_EXCITED');
  assert(plan.needed===true && plan.stepPct<0 && plan.days>=4);
}

{
  const rows=Array.from({length:21},(_,i)=>day(i+1,{cpc:7+(i%7)*1.2,clicks:80,carts:8,orders:i%5===0?1:0}));
  const current=E.analyzeSkuRolling(rows,{startDate:'2026-08-01',endDate:'2026-08-21',minCpcChange:.05,bootstrapIterations:100});
  const history=E.summarizeHistoricalExcitation(rows,{currentCpc:current.currentCpc,minCpcChange:.05});
  const id=E.assessElasticityIdentifiability(current,history);
  assert(id.code==='LOW_OUTCOME_POWER' || id.code==='CONFOUNDED');
}

{
  const rows=Array.from({length:21},(_,i)=>{
    const cpc=7+(i%7)*1.1, clicks=100, spend=cpc*clicks;
    return day(i+1,{cpc,clicks,carts:15,orders:8,spend});
  });
  const current=E.analyzeSkuRolling(rows,{startDate:'2026-08-01',endDate:'2026-08-21',minCpcChange:.05,bootstrapIterations:100});
  const history=E.summarizeHistoricalExcitation(rows,{currentCpc:current.currentCpc,minCpcChange:.05});
  const id=E.assessElasticityIdentifiability({...current,recommendation:{code:'INSUFFICIENT'},orderPValue:1},history);
  assert(['CONFOUNDED','WIDE_UNCERTAINTY'].includes(id.code));
}

{
  const mock={days:stableHistory(),currentCpc:10,recommendation:{code:'LOWER'},orderPValue:.03,adjustedEOrder:-.8,ciAdjustedOrder:{low:-1.1,high:-.4}};
  const history={informativePairs:10,effectivePairs:6,cpcSpan:.5,distinctBands:5,belowCount:5,aboveCount:5,spendCorrelation:.2,spendIndependence:.8,pairWeightRatio:.6,orderCoverage:1,totalOrders:100,ordersPerDay:5};
  const id=E.assessElasticityIdentifiability(mock,history);
  assert.strictEqual(id.code,'MEASURED');
  assert.strictEqual(E.planCpcExperiment(mock,history,id).needed,false);
}

{
  const current={days:[day(1,{clicks:0,spend:0,cpc:0,orders:0})],currentCpc:null,recommendation:{code:'INSUFFICIENT'},orderPValue:1,ciAdjustedOrder:{low:null,high:null}};
  const id=E.assessElasticityIdentifiability(current,{orderCoverage:1});
  assert.strictEqual(id.code,'INACTIVE_CURRENT');
}

console.log('elasticity identifiability tests passed');
