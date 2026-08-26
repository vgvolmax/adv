const assert=require('assert');
const path=require('path');
const basePath=path.join(__dirname,'..','price_model.js');
const E=require(basePath);

function dateAt(i){const d=new Date(Date.UTC(2026,0,1+i));return d.toISOString().slice(0,10)}
function makeRow(i,{cpc=10,price=1000,orders=10,clicks=100,carts=20,spend=null,currentPrice=price,directPrice=true}={}){
  const s=spend==null?cpc*clicks:spend;
  return {date:dateAt(i),sku:'S',name:'S',clicks,carts,spend:s,cpc,currentPrice,
    promotedUnits:directPrice?orders:0,promotedRevenue:directPrice?orders*price:0,
    modelUnits:0,modelRevenue:0,totalRevenue:orders*price,orderUnitsEstimate:orders,orderReliable:true};
}
function expSeries(n,betaCpc,betaPrice,betaSpend,opts={}){
  const rows=[];
  let logOrders=Math.log(opts.startOrders||20),prevCpc=opts.startCpc||10,prevPrice=opts.startPrice||1000,prevSpend=opts.startSpend||1000;
  for(let i=0;i<n;i++){
    const cMove=i===0?0:(opts.cpcMove?opts.cpcMove(i):((i%2?1:-1)*(0.08+0.02*(i%3))));
    const pMove=i===0?0:(opts.priceMove?opts.priceMove(i):((i%4<2?1:-1)*0.04));
    const sMove=i===0?0:(opts.spendMove?opts.spendMove(i):((i%3===0?.05:-.03)));
    const cpc=prevCpc*Math.exp(cMove),price=prevPrice*Math.exp(pMove),spend=prevSpend*Math.exp(sMove);
    if(i>0)logOrders+=betaCpc*cMove+betaPrice*pMove+betaSpend*sMove;
    const orders=Math.max(2,Math.round(Math.exp(logOrders)));
    const clicks=Math.max(20,Math.round(spend/cpc));
    const carts=Math.max(3,Math.round(orders*1.8));
    rows.push(makeRow(i,{cpc,price,orders,clicks,carts,spend}));
    prevCpc=cpc;prevPrice=price;prevSpend=spend;
  }
  return rows;
}

{
  const p=E.reliableObservedPrice(makeRow(0,{currentPrice:777,directPrice:false,orders:10,price:1000}));
  assert.equal(p.price,null,'currentPrice-only must not be trusted as historical price');
  assert.equal(p.reliable,false);
}
{
  const rows=[makeRow(0,{price:1000}),makeRow(1,{price:1000,directPrice:false}),makeRow(2,{price:1005})];
  const s=E.buildHistoricalPriceSeries(rows,{maxSandwichGapDays:3});
  assert(s[1].historicalPrice>995&&s[1].historicalPrice<1010,'sandwiched stable gap should be inferred');
  assert.equal(s[1].priceSource,'sandwich-inferred');
  const rows2=[makeRow(0,{price:1000}),makeRow(1,{price:1000,directPrice:false}),makeRow(2,{price:1200})];
  const s2=E.buildHistoricalPriceSeries(rows2,{maxSandwichGapDays:3});
  assert.equal(s2[1].historicalPrice,null,'must not infer across a price change');
}
{
  const rows=expSeries(50,.8,0,.15,{priceMove:()=>0});
  const a=E.analyzePriceAdjustedRows(rows,{minCpcChange:.05,minPriceChange:.03});
  assert.equal(a.priceStatus.code,'PRICE_STABLE');
  assert(a.priceCoverage>.8);
}
{
  const rows=expSeries(70,0,-1.4,.15,{cpcMove:i=>(i%2?1:-1)*.10,priceMove:i=>(i%2?1:-1)*.08});
  const a=E.analyzePriceAdjustedRows(rows,{minCpcChange:.05,minPriceChange:.03});
  assert(Math.abs(a.cpcPriceCorrelation)>.75,'synthetic CPC and price should be strongly collinear');
  assert.equal(a.priceStatus.code,'PRICE_CONFOUNDED');
}
{
  const rows=expSeries(90,.65,-1.1,.10,{cpcMove:i=>((i%5)-2)*.045,priceMove:i=>(((i*2)%7)-3)*.025,spendMove:i=>(((i*3)%5)-2)*.02});
  const a=E.analyzePriceAdjustedRows(rows,{minCpcChange:.04,minPriceChange:.025});
  assert(a.jointFit.n>=12);
  assert(a.jointFit.coefficients.dLogCpc>.2,'joint CPC beta should remain positive');
  assert(a.jointFit.coefficients.dLogPrice<-.3,'joint price beta should be negative');
  assert(['PRICE_ADJUSTED','PRICE_EFFECT_MEASURED'].includes(a.priceStatus.code));
}
{
  const rows=expSeries(70,0,-1.2,.05,{cpcMove:()=>0,priceMove:i=>(i%2?1:-1)*.07});
  const a=E.analyzePriceAdjustedRows(rows,{minCpcChange:.05,minPriceChange:.03});
  assert(a.priceChangePairs>=10,'price-only natural experiment should produce price points');
  assert(a.priceElasticityOrder<-.3,'price elasticity should be measurable even with stable CPC');
}
{
  const rows=expSeries(70,0,-1.4,.10,{cpcMove:i=>(i%2?1:-1)*.10,priceMove:i=>(i%2?1:-1)*.08});
  const fake={rows,currentCpc:10,recommendation:{code:'RAISE',label:'Повысить',stepPct:.10,targetCpc:11},identifiability:{code:'MEASURED'},confidence:{score:90},experiment:{needed:false,conditions:[]},marginalCpo:100,eCart:.5,eOrder:.8};
  const x=E.applyPriceLayer(fake,{minCpcChange:.05,minPriceChange:.03});
  assert.equal(x.recommendation.code,'INSUFFICIENT','confounded price must block a CPC action');
  assert.equal(x.identifiability.code,'PRICE_CONFOUNDED');
  assert(x.experiment.needed);
  assert(x.experiment.conditions.some(v=>/цену товара/i.test(v)));
}
{
  const rows=expSeries(50,.8,0,.10,{priceMove:()=>0});
  const fake={rows,currentCpc:10,recommendation:{code:'RAISE',label:'Повысить',stepPct:.10,targetCpc:11},identifiability:{code:'MEASURED'},confidence:{score:90},experiment:{needed:false,conditions:[]},marginalCpo:100,eCart:.5,eOrder:.8};
  const x=E.applyPriceLayer(fake,{minCpcChange:.05,minPriceChange:.03});
  assert.equal(x.price.priceStatus.code,'PRICE_STABLE');
  assert.equal(x.recommendation.code,'RAISE','stable price must not erase an otherwise valid CPC recommendation');
}
{
  const rows=expSeries(90,.65,-1.1,.10,{cpcMove:i=>((i%5)-2)*.045,priceMove:i=>(((i*2)%7)-3)*.025,spendMove:i=>(((i*3)%5)-2)*.02});
  const fake={rows,currentCpc:10,recommendation:{code:'HOLD',label:'Не менять',stepPct:0,targetCpc:10},identifiability:{code:'WIDE_UNCERTAINTY'},confidence:{score:80},experiment:{needed:false,conditions:[]},marginalCpo:100,eCart:.4,eOrder:.4};
  const x=E.applyPriceLayer(fake,{minCpcChange:.04,minPriceChange:.025});
  assert.equal(x.recommendation.code,'HOLD','price layer must not create a new CPC action from HOLD');
}

console.log('price model tests passed');
