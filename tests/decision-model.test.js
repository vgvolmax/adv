const assert=require('assert');
const E=require('../decision_model.js');

function iso(i){const d=new Date(Date.UTC(2026,0,1+i));return d.toISOString().slice(0,10)}
function row(i,{cpc=10,spend=1000,orders=10,price=1000,carts=20,direct=true,totalRevenue=null}={}){
  const clicks=Math.max(1,Math.round(spend/cpc));
  return {date:iso(i),sku:'S',name:'S',clicks,carts,spend,cpc,currentPrice:price,
    promotedUnits:direct?Math.max(0,Math.min(orders,2)):0,
    promotedRevenue:direct?Math.max(0,Math.min(orders,2))*price:0,
    modelUnits:0,modelRevenue:0,totalRevenue:totalRevenue==null?orders*price:totalRevenue,
    orderUnitsEstimate:orders,orderReliable:true};
}

// BH must be monotone and control multiple testing.
{
  const q=E.benjaminiHochberg([.001,.02,.04,.3]);
  assert(q[0]<=q[1]&&q[1]<=q[2]);
  assert(q[2]>.04,'q must be stricter than raw p when testing multiple SKU');
}

// Safe reconstruction must not borrow a global historical median across a price regime change.
{
  const rows=[
    row(0,{price:1000,orders:2,direct:true}),
    row(1,{price:1000,orders:2,direct:false,totalRevenue:2000}),
    row(2,{price:1500,orders:2,direct:true,totalRevenue:3000}),
  ];
  const s=E.buildSafeOrderSeries(rows);
  assert.equal(s[1].safeOrderUnits,null,'ambiguous day between different price regimes must be excluded from inference');
  assert.equal(s[1].safeOrderReliable,false);
}

// Pooled expansion economics must keep failed expansions instead of conditioning on success.
{
  const days=[
    row(0,{cpc:10,spend:1000,orders:10}),
    row(1,{cpc:12,spend:1400,orders:12}), // +400 / +2
    row(2,{cpc:15,spend:1800,orders:10}), // +400 / -2
  ];
  const econ=E.computeExpansionEconomics(E.buildSafeOrderSeries(days),.05);
  assert.equal(econ.expansions,2);
  assert.equal(econ.deltaSpend,800);
  assert.equal(econ.deltaOrders,0);
  assert.equal(econ.incrementalCpo,Infinity,'failed expansion must make pooled incremental CPO non-profitable');
  assert.equal(econ.successRate,.5);
}

// PPML log-link coefficient is a true conditional elasticity of expected count wrt CPC.
{
  const rows=[]; let cpc=10,spend=1200;
  for(let i=0;i<80;i++){
    cpc=10*Math.exp(.22*Math.sin(i*1.71));
    spend=1200*Math.exp(.10*Math.cos(i*1.13));
    const mu=20*Math.pow(cpc/10,.7)*Math.pow(spend/1200,.15);
    const orders=Math.max(0,Math.round(mu));
    rows.push(row(i,{cpc,spend,orders,price:1000,direct:true,carts:Math.max(3,Math.round(orders*1.8))}));
  }
  const a=E.fitLocalPpmlElasticity(E.buildSafeOrderSeries(rows),{currentCpc:cpc});
  assert(a.n>=30);
  assert(a.betaCpc>.35&&a.betaCpc<1.05,`expected beta around .7, got ${a.betaCpc}`);
}

// Observational evidence may only propose a small controlled test, never a strong automatic move.
{
  const fake={sku:'S',currentCpc:10,eCart:.5,adjustedECart:.5,identifiability:{code:'MEASURED'},experiment:{needed:false,conditions:[]},
    price:{priceStatus:{code:'PRICE_STABLE'}},confidence:{score:90}};
  const d={...fake,decisionModel:{betaCpc:.8,pValue:.001,qValue:.01,n:50,effectiveN:25,safeOrderCoverage:.9,localCpcSpan:.3,priceStable:true},expansionEconomics:{incrementalCpo:100,successRate:.8,expansions:5}};
  const r=E.classifyTrustedRecommendation(d,{});
  assert.equal(r.code,'RAISE');
  assert.equal(r.stepPct,.05);
  assert(/наблюд/i.test(r.reason));
}

// Positive own-price association is treated as endogeneity suspicion, not causal price elasticity.
{
  const status=E.classifyPriceAssociation({betaPrice:.9,pricePValue:.03,priceCoverage:.8,directPriceDays:20,priceSpan:.2,cpcPriceCorrelation:.1,cpcVif:1.2,priceVif:1.2,totalPricedOrders:80,medianPairOrders:4,jointN:30});
  assert.equal(status.code,'PRICE_ENDOGENEITY_SUSPECTED');
}

// A common-demand proxy should absorb a shared demand shock that otherwise makes CPC look causal.
{
  const rows=[],proxy={};
  for(let i=0;i<70;i++){
    const demand=Math.exp(.35*Math.sin(i*.73));
    const cpc=10*demand; // CPC moves with demand, but has zero causal effect on orders
    const spend=1200*Math.exp(.05*Math.cos(i*.41));
    const orders=Math.max(1,Math.round(18*demand));
    rows.push(row(i,{cpc,spend,orders,price:1000,direct:true,carts:Math.round(orders*1.8)}));
    proxy[iso(i)]=Math.log(1+100*demand);
  }
  const safe=E.buildSafeOrderSeries(rows);
  const raw=E.fitLocalPpmlElasticity(safe,{currentCpc:10});
  const adj=E.fitLocalPpmlElasticity(safe,{currentCpc:10,demandProxyByDate:proxy});
  assert(raw.betaCpc>.3,'without a demand control the confounding should be visible');
  assert.equal(adj.useDemandProxy,false,'internal peer-demand proxy is diagnostic only, not a causal control');
  assert.equal(adj.demandProxyAvailable,true);
  assert.equal(adj.demandConfounded,true,'when CPC tracks the peer-demand proxy almost perfectly the model must declare non-identification');
}

// A sign flip across 0/1/2-day local fits must block a direct recommendation.
{
  const x={currentCpc:10,decisionLagConflict:true,decisionModel:{betaCpc:.8,pValue:.01,qValue:.02,n:40,effectiveN:25,safeOrderCoverage:.9,localCpcSpan:.25},
    price:{priceStatus:{code:'PRICE_STABLE'}},identifiability:{code:'MEASURED'},adjustedECart:.4,expansionEconomics:{expansions:4,successRate:.75,incrementalCpo:100}};
  const r=E.classifyTrustedRecommendation(x,{});
  assert.equal(r.code,'INSUFFICIENT');
  assert(/лаг/i.test(r.label+r.reason));
}


// When price varies and is sufficiently observed, PPML must include it directly; if not, a CPC action is blocked.
{
  const rows=[],priceByDate={};
  for(let i=0;i<90;i++){
    const cpc=10*Math.exp(.20*Math.sin(i*1.31));
    const price=1000*Math.exp(.12*Math.sin(i*.47+.8));
    const spend=1300*Math.exp(.08*Math.cos(i*.83));
    const mu=22*Math.pow(cpc/10,.6)*Math.pow(price/1000,-1.1)*Math.pow(spend/1300,.12);
    const orders=Math.max(1,Math.round(mu));
    rows.push(row(i,{cpc,spend,orders,price,direct:true,carts:Math.max(3,Math.round(orders*1.8))}));
    priceByDate[iso(i)]=price;
  }
  const a=E.fitLocalPpmlElasticity(E.buildSafeOrderSeries(rows),{currentCpc:10,priceByDate,priceStable:false});
  assert.equal(a.priceControlUsed,true);
  assert(a.betaCpc>.25&&a.betaCpc<1.0,`price-adjusted CPC beta should remain near +0.6, got ${a.betaCpc}`);
  const blocked=E.classifyTrustedRecommendation({currentCpc:10,decisionModel:{betaCpc:.7,pValue:.01,qValue:.02,n:40,effectiveN:20,safeOrderCoverage:.9,localCpcSpan:.25,priceStable:false,priceControlUsed:false},price:{priceStatus:{code:'PRICE_CONTROL_AVAILABLE',reason:'price varies'}},identifiability:{code:'MEASURED'},adjustedECart:.3,expansionEconomics:{expansions:4,successRate:.75,incrementalCpo:100}},{});
  assert.equal(blocked.code,'INSUFFICIENT');
  assert(/цен/i.test(blocked.reason+blocked.label));
}

console.log('decision model tests passed');
