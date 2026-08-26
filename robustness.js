(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./elasticity.js'));
  else root.OzonElasticity=factory(root.OzonElasticity);
})(typeof globalThis!=='undefined'?globalThis:this,function(E){
'use strict';
if(!E) throw new Error('OzonElasticity core is required before robustness.js');
const baseAnalyze=E.analyzeCampaignRolling;
const finite=x=>Number.isFinite(Number(x));
const num=(x,f=0)=>finite(x)?Number(x):f;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function weightedMean(v,w){let sw=0,sy=0;for(let i=0;i<v.length;i++){const x=Number(v[i]),q=Number(w[i]);if(Number.isFinite(x)&&q>0){sw+=q;sy+=q*x}}return sw?sy/sw:null}
function circularShiftPartialTest(pairs,out='dLogOrder'){
  const v=(pairs||[]).filter(p=>Number.isFinite(p.dLogCpc)&&Number.isFinite(p.dLogSpend)&&Number.isFinite(p[out])&&num(p.weight)>0);
  const full=E.fitDifferencedElasticity(v,out);
  if(v.length<8||!Number.isFinite(full.betaCpc)) return {...full,pValue:1,level:'Недостаточно данных',method:'circular-shift'};
  const y=v.map(p=>p[out]),x=v.map(p=>p.dLogSpend),w=v.map(p=>num(p.weight,1));
  const mx=weightedMean(x,w),my=weightedMean(y,w);let top=0,bot=0;
  for(let i=0;i<v.length;i++){top+=w[i]*(x[i]-mx)*(y[i]-my);bot+=w[i]*(x[i]-mx)**2}
  if(Math.abs(bot)<1e-12) return {...full,pValue:1,level:'Недостаточно данных',method:'circular-shift'};
  const bs=top/bot,ic=my-bs*mx,pred=x.map(z=>ic+bs*z),res=y.map((z,i)=>z-pred[i]),obs=Math.abs(full.betaCpc);
  let extreme=0,valid=0;
  for(let shift=1;shift<v.length;shift++){
    const copy=v.map((p,i)=>({...p,[out]:pred[i]+res[(i+shift)%v.length]}));
    const f=E.fitDifferencedElasticity(copy,out);
    if(!Number.isFinite(f.betaCpc)) continue;
    valid++; if(Math.abs(f.betaCpc)>=obs-1e-12) extreme++;
  }
  const p=valid?(extreme+1)/(valid+1):1;
  return {...full,pValue:p,level:p<=.05?'Высокая':p<=.15?'Средняя':'Низкая',method:'circular-shift'};
}
function addDays(iso,n){const d=new Date(iso+'T00:00:00Z');if(!Number.isFinite(d.getTime()))return null;d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function laggedPairs(pairs,days,lag=1){const m=new Map((days||[]).map(d=>[d.date,d])),out=[];for(const p of pairs||[]){const a=m.get(addDays(p.fromDate,lag)),b=m.get(addDays(p.toDate,lag));if(!a||!b||!Number.isFinite(a.orderUnitsEstimate)||!Number.isFinite(b.orderUnitsEstimate))continue;const oa=a.orderUnitsEstimate,ob=b.orderUnitsEstimate,reliable=a.orderReliable!==false&&b.orderReliable!==false?1:.55;out.push({...p,dLogOrder:Math.log(ob+1)-Math.log(oa+1),eOrder:E.arcElasticity(oa,ob,E.actualCpc(p.from),E.actualCpc(p.to)),weight:num(p.weight)*reliable,lagDays:lag})}return out}
function temporalStability(pairs){const a=(pairs||[]).slice().sort((x,y)=>String(x.fromDate).localeCompare(String(y.fromDate)));if(a.length<16)return{conflict:false,earlyBeta:null,lateBeta:null,earlyP:1,lateP:1};const mid=Math.floor(a.length/2),early=a.slice(0,mid),late=a.slice(mid),ef=E.fitDifferencedElasticity(early),lf=E.fitDifferencedElasticity(late),et=circularShiftPartialTest(early),lt=circularShiftPartialTest(late);const conflict=Number.isFinite(ef.betaCpc)&&Number.isFinite(lf.betaCpc)&&Math.abs(ef.betaCpc)>=.3&&Math.abs(lf.betaCpc)>=.3&&Math.sign(ef.betaCpc)!==Math.sign(lf.betaCpc)&&et.pValue<=.20&&lt.pValue<=.20;return{conflict,earlyBeta:ef.betaCpc,lateBeta:lf.betaCpc,earlyP:et.pValue,lateP:lt.pValue,earlyN:early.length,lateN:late.length}}
function fullRange(rows,todayIso){const d=E.campaignDaily(rows);if(!d.length)return null;const last=d.at(-1).date,excluded=!!todayIso&&last===todayIso,complete=excluded?d.slice(0,-1):d;if(!complete.length)return null;return{startDate:complete[0].date,endDate:complete.at(-1).date,lastDayExcluded:excluded,completeDays:complete.length}}
function classify(m,s={}){const c=num(s.currentCpc||m.currentCpc),make=(code,label,stepPct,reason,evidence='Низкая')=>({code,label,stepPct,reason,evidence,targetCpc:c>0?c*(1+stepPct):null}),conf=num(m.confidence?.score??m.confidence),pairs=num(m.informativePairs),coverage=num(m.orderCoverage),eo=Number(m.eOrder),adj=Number(m.adjustedEOrder),ec=Number(m.eCart),ac=Number(m.adjustedECart),po=finite(m.orderPValue)?Number(m.orderPValue):1,pc=finite(m.cartPValue)?Number(m.cartPValue):1,lag=Number(m.lagAdjustedEOrder),lp=finite(m.lagOrderPValue)?Number(m.lagOrderPValue):1,max=finite(s.maxIncrementalCpo)&&Number(s.maxIncrementalCpo)>0?Number(s.maxIncrementalCpo):null,mar=Number(m.marginalCpo);
  if(conf<60||pairs<6||coverage<.6||!Number.isFinite(eo)||!Number.isFinite(adj))return make('INSUFFICIENT','Недостаточно данных',0,'Недостаточно информативных изменений CPC, заказов или качества восстановления.');
  if(Math.abs(eo)>=.35&&Math.abs(adj)>=.35&&Math.sign(eo)!==Math.sign(adj))return make('INSUFFICIENT','Недостаточно данных',0,'Сырая и spend-adjusted E заказов противоречат друг другу.');
  if(m.temporalConflict)return make('INSUFFICIENT','Недостаточно данных',0,'Знак E меняется между первой и второй половинами загруженного интервала.');
  if(Number.isFinite(lag)&&po<=.15&&lp<=.15&&Math.abs(adj)>=.25&&Math.abs(lag)>=.25&&Math.sign(adj)!==Math.sign(lag))return make('INSUFFICIENT','Недостаточно данных',0,`Same-day E=${adj.toFixed(2)}, а +1 день E=${lag.toFixed(2)}: противоположные знаки.`);
  if(max&&Number.isFinite(mar)&&mar>max&&adj>0)return make('HOLD','Не повышать',0,'Marginal CPO выше заданного лимита.');
  const up=(Number.isFinite(ac)&&ac>=.1&&pc<=.2)||(Number.isFinite(ec)&&ec>=.2&&pc<=.1),down=(Number.isFinite(ac)&&ac<=.1&&pc<=.2)||eo<=-.2;
  if(adj>=.35&&up){if(po<=.05)return make('RAISE','Повысить целевой CPC',conf>=80&&adj>=.8?.10:.05,`Spend-adjusted E заказов подтверждена (p=${po.toFixed(3)}).`,'Высокая');if(po<=.15&&conf>=65)return make('RAISE','Тест: повысить CPC',.05,`Средняя доказательность (p=${po.toFixed(3)}).`,'Средняя')}
  if(adj<=-.30&&down){if(po<=.05)return make('LOWER','Снизить целевой CPC',conf>=80&&adj<=-.8?-.15:-.10,`Более высокий CPC ухудшает/не улучшает заказы (p=${po.toFixed(3)}).`,'Высокая');if(po<=.15&&conf>=65)return make('LOWER','Тест: снизить CPC',-.05,`Средняя доказательность (p=${po.toFixed(3)}).`,'Средняя')}
  if(Number.isFinite(ac)&&ac>=.3&&pc<=.1&&adj<=.1&&po<=.2)return make('TRAFFIC_TRAP','Трафиковая ловушка',-.05,'CPC масштабирует корзины, но не заказы.','Средняя');
  return make('HOLD','Не менять',0,`Эффект CPC на заказы не доказан (p=${po.toFixed(3)}).`);
}
function identify(x){const h=x.history||{},reg=E.scoreCurrentRegimeKnowledge((x.days||[]).slice(-14)),ci=x.ciAdjustedOrder||{},width=Number.isFinite(ci.low)&&Number.isFinite(ci.high)?ci.high-ci.low:99,both=Math.min(num(h.belowCount),num(h.aboveCount));const parts={informativePairs:clamp(num(h.informativePairs)/8,0,1)*20,effectivePairs:clamp(num(h.effectivePairs)/5,0,1)*10,cpcSpan:clamp(num(h.cpcSpan)/.3,0,1)*15,cpcBands:clamp((num(h.distinctBands)-1)/3,0,1)*10,bothSides:clamp(both/3,0,1)*10,outcomeVolume:clamp(num(h.totalOrders)/30,0,1)*10,spendIndependence:clamp(num(h.spendIndependence,.5),0,1)*15,precision:clamp(1/(1+width/.8),0,1)*10},score=Math.round(Object.values(parts).reduce((a,b)=>a+b,0)),mk=(code,label,reason,needsExperiment)=>({code,label,reason,needsExperiment,score,labelScore:score>=80?'Высокая':score>=60?'Средняя':'Низкая',parts,regime:reg});
  if(!(num(x.currentCpc)>0)||num(reg.clicks)<20)return mk('INACTIVE_CURRENT','Нет активного CPC','В последних 14 полных днях недостаточно активного CPC.',false);
  if(num(h.orderCoverage)<.6)return mk('DATA_QUALITY','Проблема качества заказов','Недостаточно надёжно восстановленных общих заказов.',false);
  if(num(h.informativePairs)<6||num(h.cpcSpan)<.15||num(h.distinctBands)<3)return mk('CPC_NOT_EXCITED','CPC почти не исследован',`Только ${num(h.informativePairs)} информативных переходов и ${num(h.distinctBands)} CPC-зон.`,true);
  if(x.temporal?.conflict)return mk('TEMPORAL_SHIFT','Режим менялся во времени',`Первая половина E=${num(x.temporal.earlyBeta).toFixed(2)}, вторая E=${num(x.temporal.lateBeta).toFixed(2)}.`,true);
  const p=num(x.orderPValue,1),lp=num(x.lagOrderPValue,1),a=Number(x.adjustedEOrder),la=Number(x.lagAdjustedEOrder);
  if(Number.isFinite(a)&&Number.isFinite(la)&&p<=.15&&lp<=.15&&Math.abs(a)>=.25&&Math.abs(la)>=.25&&Math.sign(a)!==Math.sign(la))return mk('LAG_SENSITIVE','Эффект чувствителен к лагу',`Same-day E=${a.toFixed(2)} (p=${p.toFixed(3)}), +1 день E=${la.toFixed(2)} (p=${lp.toFixed(3)}).`,true);
  if(x.recommendation?.code!=='INSUFFICIENT'&&p<=.15&&Number.isFinite(a))return mk('MEASURED','Эластичность измерена',`Spend-adjusted эффект достаточен для текущего решения (p=${p.toFixed(3)}).`,false);
  if(num(h.ordersPerDay)<1||num(h.totalOrders)<15)return mk('LOW_OUTCOME_POWER','Мало заказов для E','CPC двигался, но конечных заказов слишком мало.',true);
  if((Number.isFinite(h.spendCorrelation)&&Math.abs(h.spendCorrelation)>=.8)||num(h.pairWeightRatio)<.3)return mk('CONFOUNDED','CPC смешан с расходом','CPC и расход менялись слишком совместно; нужен чистый тест при стабильном бюджете.',true);
  if(Number.isFinite(ci.low)&&Number.isFinite(ci.high)&&ci.low>=-.2&&ci.high<=.2)return mk('NEAR_ZERO','E измерена ≈ 0','Интервал E находится в практически нулевой зоне.',false);
  return mk('WIDE_UNCERTAINTY','E не определена точно','Интервал эффекта остаётся широким; нужна новая чистая точка CPC.',true);
}
function plan(x,id,s={}){const h=x.history||{},c=num(x.currentCpc),eligible=['CPC_NOT_EXCITED','LOW_OUTCOME_POWER','CONFOUNDED','WIDE_UNCERTAINTY','LAG_SENSITIVE','TEMPORAL_SHIFT'].includes(id.code);if(!eligible||!(c>0))return{needed:false,targetCpc:null,stepPct:0,direction:null,days:null,daysLabel:'—',reason:id.reason,conditions:[]};let dir=id.code==='WIDE_UNCERTAINTY'&&num(h.aboveCount)+1<num(h.belowCount)?1:-1,mag=['CPC_NOT_EXCITED','LOW_OUTCOME_POWER'].includes(id.code)?.15:.12;mag=Math.max(mag,Math.min(.20,Math.max(.10,2*num(s.minCpcChange,.05))));if(dir>0)mag=Math.min(mag,.10);const step=dir*mag,recent=(x.days||[]).slice(-14),a=E.aggregateRegime(recent),need=(t,r)=>r>0?Math.ceil(t/r):99;let days=Math.max(4,need(150,a.clicksPerDay||0),need(20,a.cartsPerDay||0),need(10,a.ordersPerDay||0));if(id.code==='CONFOUNDED')days=Math.max(days,5);if(['LOW_OUTCOME_POWER','LAG_SENSITIVE','TEMPORAL_SHIFT'].includes(id.code))days=Math.max(days,7);return{needed:true,targetCpc:c*(1+step),stepPct:step,direction:dir<0?'LOWER':'RAISE',days,daysLabel:days>21?'>21':String(days),feasibleWithin21:days<=21,reason:id.code==='LAG_SENSITIVE'?'Нужен многодневный CPC-блок из-за лага заказов.':id.code==='TEMPORAL_SHIFT'?'Историческая E меняла знак; нужна новая точка CPC в текущем режиме.':dir<0?'По умолчанию тестируем более низкий CPC как менее рискованную точку.':'Нужна точка выше текущего CPC.',conditions:['Не менять бюджет/лимит кампании во время теста','По возможности не менять цену и контент карточки','Оценивать только полные дни','Не интерпретировать первый день блока отдельно'],volumeTargets:{clicks:150,carts:20,orders:10},note:'Длительность рассчитана по темпу событий последних 14 полных дней, а не как гарантия statistical power.'};}
E.suggestRollingRange=fullRange;
E.wildBootstrapPartialTest=circularShiftPartialTest;
E.analyzeCampaignRolling=function(rows,s={}){const base=baseAnalyze(rows,s);return base.map(x=>{const ot=circularShiftPartialTest(x.pairs,'dLogOrder'),ct=circularShiftPartialTest(x.pairs,'dLogCart'),lp=laggedPairs(x.pairs,x.days,1),lf=E.fitDifferencedElasticity(lp,'dLogOrder'),lt=circularShiftPartialTest(lp,'dLogOrder'),temporal=temporalStability(x.pairs),rec=classify({...x,orderPValue:ot.pValue,cartPValue:ct.pValue,lagAdjustedEOrder:lf.betaCpc,lagOrderPValue:lt.pValue,temporalConflict:temporal.conflict},{...s,currentCpc:x.currentCpc}),updated={...x,orderTest:ot,cartTest:ct,orderPValue:ot.pValue,cartPValue:ct.pValue,lagPairs:lp,lagAdjustedEOrder:lf.betaCpc,lagOrderPValue:lt.pValue,lagOrderTest:lt,temporal,recommendation:rec,targetCpc:rec.targetCpc};updated.regimeKnowledge=E.scoreCurrentRegimeKnowledge((x.days||[]).slice(-14));updated.identifiability=identify(updated);updated.experiment=plan(updated,updated.identifiability,s);return updated})};
E.circularShiftPartialTest=circularShiftPartialTest;
E.buildLaggedOrderPairs=laggedPairs;
E.assessTemporalStability=temporalStability;
if(typeof document!=='undefined'){
  const style=document.createElement('style');style.textContent='.measure-badge.LAG_SENSITIVE,.measure-badge.TEMPORAL_SHIFT{background:var(--warn-bg);color:var(--warn)}';document.head.appendChild(style);
  const b=document.getElementById('last21');if(b)b.textContent='Весь загруженный интервал';
  const f=document.getElementById('measurementFilter');if(f){for(const [v,t] of [['LAG_SENSITIVE','Чувствительно к лагу'],['TEMPORAL_SHIFT','Смена режима']])if(!f.querySelector(`option[value="${v}"]`)){const o=document.createElement('option');o.value=v;o.textContent=t;f.appendChild(o)}}
  const blocks=document.querySelectorAll('.method-grid > div');if(blocks[1])blocks[1].innerHTML='<h3>Поправка на расход</h3><p>First-difference модель отделяет CPC от фактического расхода. p-value считается residual circular-shift randomization test; на synthetic stress-test ложные p≤0,05 ≈5%.</p>';
  if(blocks[2])blocks[2].innerHTML='<h3>Весь интервал + текущий режим</h3><p>По умолчанию E считается по всему загруженному полному интервалу РК от первой даты. Текущий режим отдельно оценивается по последним 14 полным дням.</p>';
  if(blocks[3])blocks[3].innerHTML='<h3>Robustness</h3><p>Проверяются лаг заказов +1 день и смена знака E между половинами истории. Конфликт блокирует прямое изменение CPC и переводит SKU в контролируемый многодневный тест.</p>';
}
return E;
});