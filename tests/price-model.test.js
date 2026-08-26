const assert=require('assert');
const E=require('../price_model.js');
function dateAt(i){const d=new Date(Date.UTC(2026,0,1+i));return d.toISOString().slice(0,10)}
function row(i,{cpc=10,price=1000,orders=10,clicks=100,carts=20,spend=null,currentPrice=price,directPrice=true}={}){const s=spend==null?cpc*clicks:spend;return{date:dateAt(i),sku:'S',name:'S',clicks,carts,spend:s,cpc,currentPrice,promotedUnits:directPrice?orders:0,promotedRevenue:directPrice?orders*price:0,totalRevenue:orders*price,orderUnitsEstimate:orders,orderReliable:true}}
function series(n,bC,bP,bS,opt={}){const a=[];let lo=Math.log(opt.startOrders||20),pc=opt.startCpc||10,pp=opt.startPrice||1000,ps=opt.startSpend||1000;for(let i=0;i<n;i++){const dc=i?opt.cpcMove?.(i)??((i%2?1:-1)*(.08+.02*(i%3))):0,dp=i?opt.priceMove?.(i)??((i%4<2?1:-1)*.04):0,ds=i?opt.spendMove?.(i)??(i%3===0?.05:-.03):0;cpc=pc*Math.exp(dc);price=pp*Math.exp(dp);spend=ps*Math.exp(ds);if(i)lo+=bC*dc+bP*dp+bS*ds;const orders=Math.max(2,Math.round(Math.exp(lo))),clicks=Math.max(20,Math.round(spend/cpc));a.push(row(i,{cpc,price,orders,clicks,carts:Math.max(3,Math.round(orders*1.8)),spend}));pc=cpc;pp=price;ps=spend}return a}
{
 const p=E.reliableObservedPrice(row(0,{currentPrice:777,directPrice:false}));
 assert.equal(p.price,null,'currentPrice must not be trusted as historical price');
}
{
 const a=E.buildHistoricalPriceSeries([row(0,{price:1000}),row(1,{directPrice:false}),row(2,{price:1005})],{maxSandwichGapDays:3});
 assert.equal(a[1].priceSource,'sandwich-inferred');
 const b=E.buildHistoricalPriceSeries([row(0,{price:1000}),row(1,{directPrice:false}),row(2,{price:1200})],{maxSandwichGapDays:3});
 assert.equal(b[1].historicalPrice,null,'must not infer price across a real price change');
}
{
 const a=E.analyzePriceAdjustedRows(series(50,.8,0,.15,{priceMove:()=>0}),{});
 assert.equal(a.priceStatus.code,'PRICE_STABLE');
}
{
 const a=E.analyzePriceAdjustedRows(series(70,0,-1.4,.15,{cpcMove:i=>(i%2?1:-1)*.10,priceMove:i=>(i%2?1:-1)*.08}),{});
 assert(Math.abs(a.cpcPriceCorrelation)>.75);
 assert.equal(a.priceStatus.code,'PRICE_CONFOUNDED');
}
{
 const a=E.analyzePriceAdjustedRows(series(90,.65,-1.1,.10,{cpcMove:i=>((i%5)-2)*.045,priceMove:i=>(((i*2)%7)-3)*.025,spendMove:i=>(((i*3)%5)-2)*.02}),{minCpcChange:.04,minPriceChange:.025});
 assert(a.jointFit.coefficients.dLogCpc>.2);
 assert(a.jointFit.coefficients.dLogPrice<-.3);
 assert(['PRICE_ADJUSTED','PRICE_EFFECT_MEASURED'].includes(a.priceStatus.code));
}
{
 const a=E.analyzePriceAdjustedRows(series(70,0,-1.2,.05,{cpcMove:()=>0,priceMove:i=>(i%2?1:-1)*.07}),{});
 assert(a.priceChangePairs>=10);
 assert(a.priceElasticityOrder<-.3);
}
{
 const rows=series(70,0,-1.4,.10,{cpcMove:i=>(i%2?1:-1)*.10,priceMove:i=>(i%2?1:-1)*.08});
 const x=E.applyPriceLayer({rows,currentCpc:10,recommendation:{code:'RAISE',stepPct:.10,targetCpc:11},identifiability:{code:'MEASURED'},experiment:{needed:false,conditions:[]},eCart:.5,eOrder:.8},{});
 assert.equal(x.recommendation.code,'INSUFFICIENT');
 assert.equal(x.identifiability.code,'PRICE_CONFOUNDED');
 assert(x.experiment.needed&&x.experiment.conditions.some(v=>/цену товара/i.test(v)));
}
{
 const rows=series(50,.8,0,.10,{priceMove:()=>0});
 const x=E.applyPriceLayer({rows,currentCpc:10,recommendation:{code:'RAISE',stepPct:.10,targetCpc:11},identifiability:{code:'MEASURED'},experiment:{needed:false,conditions:[]},eCart:.5,eOrder:.8},{});
 assert.equal(x.price.priceStatus.code,'PRICE_STABLE');
 assert.equal(x.recommendation.code,'RAISE');
}
{
 const rows=series(90,.65,-1.1,.10,{cpcMove:i=>((i%5)-2)*.045,priceMove:i=>(((i*2)%7)-3)*.025,spendMove:i=>(((i*3)%5)-2)*.02});
 const x=E.applyPriceLayer({rows,currentCpc:10,recommendation:{code:'HOLD',stepPct:0,targetCpc:10},identifiability:{code:'WIDE_UNCERTAINTY'},experiment:{needed:false,conditions:[]},eCart:.4,eOrder:.4},{minCpcChange:.04,minPriceChange:.025});
 assert.equal(x.recommendation.code,'HOLD','price layer must not create a new CPC action');
}
console.log('price model tests passed');