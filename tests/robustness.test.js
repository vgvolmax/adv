const assert=require('assert');
const E=require('../robustness.js');
function row(date,cpc=10,clicks=100,orders=8){return{date,sku:'S',name:'S',clicks,carts:15,spend:cpc*clicks,cpc,totalRevenue:orders*1000,orderUnitsEstimate:orders,orderReliable:true,promotedUnits:orders,promotedRevenue:orders*1000}}
{
 const rows=[];for(let i=0;i<62;i++){const d=new Date(Date.UTC(2026,5,26+i)).toISOString().slice(0,10);rows.push(row(d));}
 const r=E.suggestRollingRange(rows,'2026-08-26',21);assert.strictEqual(r.startDate,'2026-06-26');assert.strictEqual(r.endDate,'2026-08-25');
}
{
 const rec=(()=>{const rows=[];for(let i=0;i<25;i++){const d=new Date(Date.UTC(2026,7,1+i)).toISOString().slice(0,10);rows.push(row(d,8+(i%5),100,8+(i%3)));}return E.analyzeCampaignRolling(rows,{startDate:'2026-08-01',endDate:'2026-08-25',minCpcChange:.05,todayIso:'2026-08-26'})[0]})();
 assert(rec.regimeKnowledge.days<=14);assert('lagOrderPValue' in rec);assert('temporal' in rec);
}
console.log('robustness tests passed');
