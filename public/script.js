/* ─── DEFAULTS & STATE ─── */

const DEFAULTS = { symbol: 'AAPL', range: '1mo' };

const VALID_INTERVALS = {
  '1d':['1m','5m','15m','30m','1h'], '5d':['5m','15m','30m','1h'],
  '1mo':['1d','5d'], '3mo':['1d','5d','1wk'], '1y':['1d','5d','1wk','1mo'],
  '5y':['1d','1wk','1mo','3mo'], 'max':['1d','1wk','1mo','3mo'],
};
const DEFAULT_INTERVAL = {'1d':'5m','5d':'15m','1mo':'1d','3mo':'1d','1y':'1d','5y':'1wk','max':'1mo'};
const INTERVAL_LABELS = {'1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'1h','1d':'1D','5d':'5D','1wk':'1W','1mo':'1M','3mo':'3M'};

const COLORS = { green:'#3fb950', red:'#f85149', accent:'#e3b341', orange:'#d29922', purple:'#bc8cff', cyan:'#39d2c0', yellow:'#e3b341', pink:'#f778ba', teal:'#56d4dd' };

const INDICATOR_CONFIG = {
  sma20:{color:COLORS.accent,title:'SMA 20',lineWidth:1},
  sma50:{color:COLORS.orange,title:'SMA 50',lineWidth:1,lineStyle:2},
  sma200:{color:COLORS.purple,title:'SMA 200',lineWidth:1,lineStyle:2},
  ema9:{color:COLORS.cyan,title:'EMA 9',lineWidth:1},
  ema21:{color:COLORS.pink,title:'EMA 21',lineWidth:1,lineStyle:2},
};

const FIB_COLORS = ['#f85149','#d29922','#58a6ff','#3fb950','#bc8cff','#39d2c0','#e3b341'];
const FIB_LABELS = ['0% (H)','23.6%','38.2%','50%','61.8%','78.6%','100% (L)'];

let _dataSpan = 0;
function setDataSpan(h) { if(h&&h.length>1) _dataSpan=h[h.length-1].time-h[0].time; }

const state = {
  symbol:DEFAULTS.symbol, range:DEFAULTS.range, interval:DEFAULT_INTERVAL[DEFAULTS.range],
  data:null, activeIndicators:new Set(['sma20','sma50']), indicatorSeries:{},
  fibSeries:[], manualFibs:[], drawFibPoint:null,
  mainChart:null, volumeChart:null, candlestickSeries:null, volumeSeries:null,
  bollingerSeries:{upper:null,mid:null,lower:null},
  mapInstance:null, mapInitialized:false,
  mapSearchTimeout:null, aiStreaming:false, aiQueue:[],
  treeOpts:{group:'category',color:'change',size:'value',layout:'squarify',maxItems:0,catFilter:[]},
  overviewSymbols:[],
};

function $(id) { return document.getElementById(id); }
function escHtml(s) { if(!s)return ''; const d=document.createElement('div');d.textContent=s;return d.innerHTML; }

const el = {};
function cacheEls() {
  ['searchInput','searchResults','tickerSymbol','tickerPrice','tickerChange','tickerPrevClose',
   'chartContainer','subChartContainer','chartToolbar','historyPanel','watchlistPanel','indicatorChips',
   'rsiVal','macdVal','volVal','highVal','lowVal','openVal','prevCloseVal','mktCapVal','fiftyTwoHigh','fiftyTwoLow',
   'intervalPills','clearHistoryBtn','addWatchBtn',
   'newsGrid',
   'mapContainer','mapSearch','mapSearchResults','mapTileType','miHeader','miBody','miNews','miNewsContent',
   'ovSections',
    'tvCash','tvPortfolio','tvTotal','tvDepositAmt','tvDepositBtn','tvHoldings','tvSymbol','tvShares','tvPriceInfo','tvBuyBtn','tvSellBtn','tvTxList','tvPnL','tvPositions','tvBest','tvWorst','tvWinners','tvExposure',
   'alList','alTriggeredList','alType','alSymbol','alThreshold','alDirection','alCreateBtn',
    'aiMessages','aiInputField','aiSendBtn','aiWidgets','aiStatus','aiStatusText','aiStatusDetail',
    'aiSessionList','aiNewSessionBtn',
   'stColors','stIntervals','stAI',
   'stocksView','newsView','mapView','overviewView','tradingView','alertsView','aiView','settingsView',
   'rangeContainer','tickerBar','searchWrapper','viewTabs',
     'mfExchanges','mfRoutes','mfShips','mfShipTrajectories','mfStocks','mfSelectAll','mfSatellite',
  ].forEach(id => el[id]=$(id));
}

function toast(msg, type) {
  const c = $('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast'+(type==='error'?' error':'')+(type==='success'?' success':'');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function fmt(n) { if(n==null||isNaN(n)) return '--'; return n.toFixed(2); }
function fmtCompact(n) {
  if(n==null||isNaN(n))return'--';
  if(Math.abs(n)>=1e12)return(n/1e12).toFixed(2)+'T';
  if(Math.abs(n)>=1e9)return(n/1e9).toFixed(2)+'B';
  if(Math.abs(n)>=1e6)return(n/1e6).toFixed(2)+'M';
  if(Math.abs(n)>=1e3)return(n/1e3).toFixed(1)+'K';
  return n.toFixed(2);
}
function formatTimeAgo(ts) {
  const n=Date.now()/1000,s=n-ts;
  if(s<60)return'now';const m=Math.floor(s/60);
  if(m<60)return m+'m';const h=Math.floor(m/60);
  if(h<24)return h+'h';return Math.floor(h/24)+'d';
}

/* ─── STOCK CHARTS ─── */

function initCharts() {
  const cOpts = {
    layout:{background:{color:'#0d1117'},textColor:'#8b949e',fontSize:11,fontFamily:"'Inter',sans-serif"},
    grid:{vertLines:{color:'#21262d'},horzLines:{color:'#21262d'}},
    crosshair:{mode:LightweightCharts.CrosshairMode.Normal,vertLine:{color:'#30363d',width:1,style:2,labelBackgroundColor:'#30363d'},horzLine:{color:'#30363d',width:1,style:2,labelBackgroundColor:'#30363d'}},
    timeScale:{borderColor:'#30363d',timeVisible:true,secondsVisible:false,tickMarkFormatter:(t,type)=>{
      const d=new Date(t*1000),days=_dataSpan/86400;
      if(type===0||type===1){
        if(days>730){const o={year:'numeric'};if(type===1)o.month='short';return d.toLocaleDateString('en-US',o);}
        if(days>60)return d.toLocaleDateString('en-US',{month:'short',year:'numeric'});
        return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
      }
      if(type===2)return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
      return d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    }},
    rightPriceScale:{borderColor:'#30363d',scaleMargins:{top:0.05,bottom:0.05}},
  };
  state.mainChart = LightweightCharts.createChart(el.chartContainer, cOpts);
  state.candlestickSeries = state.mainChart.addCandlestickSeries({upColor:COLORS.green,downColor:COLORS.red,borderDownColor:COLORS.red,borderUpColor:COLORS.green,wickDownColor:COLORS.red,wickUpColor:COLORS.green,priceFormat:{type:'price',precision:2,minMove:0.01}});
  state.mainChart.subscribeCrosshairMove(p=>{
    if(!p.time||!state.data)return;
    const idx=state.data.history.findIndex(d=>d.time===p.time);if(idx===-1)return;
    updateStatsBar(state.data.history[idx]);
  });
  state.mainChart.subscribeClick(p=>{
    if(state.activeIndicators.has('drawfib')&&p.point){
      const t=state.mainChart.timeScale().coordinateToTime(p.point.x);
      const pr=state.candlestickSeries.coordinateToPrice(p.point.y);
      if(t&&pr!=null)doDrawFibClick({time:t,price:pr});
    }
  });
  const vOpts = {
    layout:{background:{color:'#0d1117'},textColor:'#8b949e',fontSize:10,fontFamily:"'Inter',sans-serif"},
    grid:{vertLines:{color:'#21262d'},horzLines:{color:'#21262d'}},
    timeScale:{borderColor:'#30363d',visible:false},
    rightPriceScale:{borderColor:'#30363d',scaleMargins:{top:0.3,bottom:0},visible:false},
    handleScroll:false,handleScale:false,
  };
  state.volumeChart=LightweightCharts.createChart(el.subChartContainer,vOpts);
  state.volumeSeries=state.volumeChart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:''});
  state.mainChart.timeScale().subscribeVisibleTimeRangeChange(()=>syncVolumeChart());
}
function syncVolumeChart(){if(!state.mainChart||!state.volumeChart)return;const r=state.mainChart.timeScale().getVisibleRange();if(r)state.volumeChart.timeScale().setVisibleRange(r);}
function resizeCharts(){
  if(state.mainChart)state.mainChart.resize(el.chartContainer.clientWidth,el.chartContainer.clientHeight);
  if(state.volumeChart){const h=el.subChartContainer.clientHeight;state.volumeChart.resize(el.subChartContainer.clientWidth,h);state.volumeChart.timeScale().fitContent();}
}
function updateChart(data){
  if(!data||!data.history||!data.history.length)return;
  state.data=data;const s=data.history.slice().sort((a,b)=>a.time-b.time);setDataSpan(s);
  state.candlestickSeries.setData(s.map(d=>({time:d.time,open:d.open,high:d.high,low:d.low,close:d.close})));
  state.volumeSeries.setData(s.map(d=>({time:d.time,value:d.volume,color:d.close>=d.open?'rgba(63,185,80,0.3)':'rgba(248,81,73,0.3)'})));
  updateIndicators(data);updateTicker(data.quote);updateStatsBar(s[s.length-1]);updateWatchlistPrices(data.quote);
  state.mainChart.timeScale().fitContent();setTimeout(()=>state.volumeChart.timeScale().fitContent(),50);
}
function updateTicker(q){
  if(!q)return;
  el.tickerSymbol.textContent=q.symbol||state.symbol;
  el.tickerPrice.textContent=q.currentPrice!=null?fmt(q.currentPrice):'--';
  el.tickerPrevClose.textContent='Prev: '+(q.previousClose!=null?fmt(q.previousClose):'--');
  const c=q.change,p=q.changePercent;
  if(c!=null&&p!=null){const s=c>=0?'+':'';el.tickerChange.textContent=s+fmt(c)+' ('+s+fmt(p)+'%)';el.tickerChange.className='ticker-change '+(c>=0?'pos':'neg');}
  else{el.tickerChange.textContent='--';el.tickerChange.className='ticker-change';}
}
function updateStatsBar(p){
  if(!p)return;
  el.rsiVal.textContent=p.rsi!=null?p.rsi.toFixed(1):'--';
  el.macdVal.textContent=p.macd!=null?p.macd.toFixed(2):'--';
  el.volVal.textContent=fmtCompact(p.volume);el.highVal.textContent=fmt(p.high);
  el.lowVal.textContent=fmt(p.low);el.openVal.textContent=fmt(p.open);
}
function updateStatsBarGlobal(q){
  if(!q)return;
  el.prevCloseVal.textContent=q.previousClose!=null?fmt(q.previousClose):'--';
  el.mktCapVal.textContent=q.marketCap!=null?fmtCompact(q.marketCap):'--';
  el.fiftyTwoHigh.textContent=q.fiftyTwoWeekHigh!=null?fmt(q.fiftyTwoWeekHigh):'--';
  el.fiftyTwoLow.textContent=q.fiftyTwoWeekLow!=null?fmt(q.fiftyTwoWeekLow):'--';
}
function updateIndicators(data){
  for(const k of Object.keys(INDICATOR_CONFIG)){const sh=state.activeIndicators.has(k),s=state.indicatorSeries[k];
    if(sh&&!s){const c=INDICATOR_CONFIG[k];state.indicatorSeries[k]=state.mainChart.addLineSeries({color:c.color,title:c.title,lineWidth:c.lineWidth||1,lineStyle:c.lineStyle||0,lastValueVisible:true,priceFormat:{type:'price',precision:2,minMove:0.01}});}
    if(!sh&&s){state.mainChart.removeSeries(s);delete state.indicatorSeries[k];}}
  const so=data.history.slice().sort((a,b)=>a.time-b.time);
  for(const[k,s]of Object.entries(state.indicatorSeries)){if(!s)continue;const v=so.map(d=>({time:d.time,value:d[k]})).filter(v=>v.value!=null);s.setData(v);}
  updateBollinger(so);updateFibonacci(data);
}
function updateBollinger(s){
  const sh=state.activeIndicators.has('bb');
  ['upper','mid','lower'].forEach((n,i)=>{const e=state.bollingerSeries[n];
    if(sh&&!e){const s2=state.mainChart.addLineSeries({color:['rgba(227,179,65,0.25)','rgba(227,179,65,0.4)','rgba(227,179,65,0.25)'][i],lineStyle:2,lineWidth:1,lastValueVisible:false,priceFormat:{type:'price',precision:2,minMove:0.01}});state.bollingerSeries[n]=s2;}
    if(!sh&&e){state.mainChart.removeSeries(e);state.bollingerSeries[n]=null;}
  });
  if(sh){['bb_upper','bb_mid','bb_lower'].forEach((k,i)=>{const v=s.map(d=>({time:d.time,value:d[k]})).filter(v=>v.value!=null);const s2=state.bollingerSeries[['upper','mid','lower'][i]];if(s2)s2.setData(v);});}
}
function updateFibonacci(data){
  const sh=state.activeIndicators.has('fib'),fibs=data.fib_levels;if(!fibs)return;
  if(sh&&state.fibSeries.length===0){
    const keys=['level_0','level_236','level_382','level_50','level_618','level_786','level_100'];
    keys.forEach((k,i)=>{const v=fibs[k];if(v==null)return;const s=state.mainChart.addLineSeries({color:FIB_COLORS[i],lineStyle:2,lineWidth:1,lastValueVisible:true,title:FIB_LABELS[i],priceLineVisible:false,priceFormat:{type:'price',precision:2,minMove:0.01}});
      const so=data.history.slice().sort((a,b)=>a.time-b.time);s.setData([{time:so[0].time,value:v},{time:so[so.length-1].time,value:v}]);state.fibSeries.push(s);});
  }
  if(!sh&&state.fibSeries.length>0){state.fibSeries.forEach(s=>state.mainChart.removeSeries(s));state.fibSeries=[];}
}
function toggleIndicator(name){
  if(name==='drawfib'){
    if(state.activeIndicators.has('drawfib')){state.activeIndicators.delete('drawfib');clearDrawFib();document.body.classList.remove('draw-fib-active');}
    else{state.activeIndicators.add('drawfib');state.drawFibPoint=null;document.body.classList.add('draw-fib-active');toast('Click two points on chart for Fibonacci','');}
  }else if(name==='bb'||name==='fib'){state.activeIndicators.has(name)?state.activeIndicators.delete(name):state.activeIndicators.add(name);if(state.data)updateIndicators(state.data);}
  else{state.activeIndicators.has(name)?state.activeIndicators.delete(name):state.activeIndicators.add(name);if(state.data)updateIndicators(state.data);}
  document.querySelectorAll('.chip[data-indicator]').forEach(c=>{c.classList.toggle('active',state.activeIndicators.has(c.dataset.indicator));});
}
async function fetchStockData(sym,range,intv){
  try{let u='/api/stock/'+encodeURIComponent(sym)+'?range='+encodeURIComponent(range);if(intv)u+='&interval='+encodeURIComponent(intv);const r=await fetch(u);if(!r.ok){const e=await r.json();throw new Error(e.error||'Failed');}return await r.json();}
  catch(e){toast('Error loading '+sym+': '+e.message,'error');throw e;}
}

let livePriceSource=null;

function startLivePrice(sym){
  stopLivePrice();
  if(!sym)return;
  livePriceSource=new EventSource('/api/price/stream/'+encodeURIComponent(sym));
  livePriceSource.onmessage=e=>{
    try{
      const d=JSON.parse(e.data);
      if(!d||!d.price)return;
      el.tickerPrice.textContent='$'+fmt(d.price);
      if(d.change!=null){
        const sn=d.change>=0?'+':'';
        el.tickerChange.textContent=sn+fmt(d.change)+' ('+sn+fmt(d.changePercent)+'%)';
        el.tickerChange.className='ticker-change '+(d.change>=0?'pos':'neg');
      }
      if(d.prev!=null)el.tickerPrevClose.textContent=fmt(d.prev);
      updateWatchlistPrices({symbol:sym.toUpperCase(),currentPrice:d.price,changePercent:d.changePercent});
    }catch(e){}
  };
  livePriceSource.onerror=()=>{livePriceSource.close();setTimeout(()=>startLivePrice(sym),5000);};
}

function stopLivePrice(){
  if(livePriceSource){livePriceSource.close();livePriceSource=null;}
}

async function loadStock(sym,range){
  if(!sym)return;state.symbol=sym.toUpperCase();if(range)state.range=range;
  removeAllManualFibs();clearDrawFib();
  stopLivePrice();
  try{
    const d=await fetchStockData(state.symbol,state.range,state.interval);
    updateChart(d);
    updateStatsBarGlobal(d.quote);
    pushHistory(state.symbol,d.quote.longName||d.quote.shortName||'');
    document.querySelectorAll('.watch-item').forEach(w=>w.classList.toggle('active',w.dataset.symbol===state.symbol));
    autoSaveUserState();
    startLivePrice(state.symbol);
  }catch(e){}
}

/* ─── FIBONACCI DRAWING ─── */

const FIB_KEYS=['level_0','level_236','level_382','level_50','level_618','level_786','level_100'],FIB_PCTS=[0,0.236,0.382,0.5,0.618,0.786,1];
function clearDrawFib(){state.drawFibPoint=null;document.body.classList.remove('draw-fib-active');}
function doDrawFibClick(p){if(!state.data)return;const t=p.time,pr=p.price;if(!t||pr==null)return;
  if(!state.drawFibPoint){state.drawFibPoint={time:t,price:pr};toast('First point set. Click again to draw.','');return;}
  const p1=state.drawFibPoint,p2={time:t,price:pr},hv=Math.max(p1.price,p2.price),lv=Math.min(p1.price,p2.price),df=hv-lv,t0=Math.min(p1.time,p2.time),t1=Math.max(p1.time,p2.time),fs=[];
  FIB_KEYS.forEach((k,i)=>{const lv=hv-df*FIB_PCTS[i];const s=state.mainChart.addLineSeries({color:FIB_COLORS[i],lineStyle:2,lineWidth:1,lastValueVisible:true,title:`${(FIB_PCTS[i]*100).toFixed(1)}%${i===0?'(H)':i===6?'(L)':''}`,priceLineVisible:false,priceFormat:{type:'price',precision:2,minMove:0.01}});s.setData([{time:t0,value:lv},{time:t1,value:lv}]);fs.push(s);});
  state.manualFibs.push({series:fs,p1,p2});state.drawFibPoint=null;toast('Fib drawn. Click Draw Fib again for more.','');
}
function removeAllManualFibs(){state.manualFibs.forEach(f=>f.series.forEach(s=>state.mainChart.removeSeries(s)));state.manualFibs=[];state.drawFibPoint=null;}

/* ─── UI INIT ─── */

function initResizeHandles(){
  if(typeof interact==='undefined')return;
  interact('.resize-right').draggable({inertia:false,onmove:e=>{const p=e.target.parentElement,nw=p.offsetWidth+e.dx;if(nw>=160&&nw<=420){p.style.width=nw+'px';resizeCharts();}}});
  interact('.resize-left').draggable({inertia:false,onmove:e=>{const p=e.target.parentElement,nw=p.offsetWidth-e.dx;if(nw>=160&&nw<=420){p.style.width=nw+'px';resizeCharts();}}});
}
function initSearch(){
  let st=null;
  el.searchInput.addEventListener('input',()=>{const q=el.searchInput.value.trim();if(st)clearTimeout(st);if(q.length<1){el.searchResults.classList.remove('visible');return;}
    st=setTimeout(async()=>{try{const r=await fetch('/api/search/'+encodeURIComponent(q));if(!r.ok)return;renderSearchResults(await r.json());}catch(e){}},200);});
  el.searchInput.addEventListener('keydown',e=>{if(e.key==='Enter'){const q=el.searchInput.value.trim().toUpperCase();if(q){loadStock(q);el.searchInput.value='';el.searchResults.classList.remove('visible');}}
    if(e.key==='Escape'){el.searchResults.classList.remove('visible');el.searchInput.blur();}});
  document.addEventListener('click',e=>{if(!el.searchInput.contains(e.target)&&!el.searchResults.contains(e.target))el.searchResults.classList.remove('visible');});
}
function renderSearchResults(results){
  const c=el.searchResults;if(!results||!results.length){c.classList.remove('visible');return;}
  c.innerHTML=results.map(r=>`<div class="search-item" data-symbol="${r.symbol}"><span class="si-symbol">${r.symbol}</span><span class="si-name">${escHtml(r.name)}</span><span class="si-type">${r.type||''}</span></div>`).join('');
  c.classList.add('visible');
  c.querySelectorAll('.search-item').forEach(i=>{i.addEventListener('click',()=>{loadStock(i.dataset.symbol);el.searchInput.value='';c.classList.remove('visible');});});
}
function initTimeRanges(){
  document.querySelectorAll('.range-btn').forEach(b=>{b.addEventListener('click',()=>{document.querySelectorAll('.range-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.range=b.dataset.range;state.interval=DEFAULT_INTERVAL[state.range];renderIntervalPills(state.range);loadStock(state.symbol,state.range);});});
}
function renderIntervalPills(range){
  const v=VALID_INTERVALS[range]||[DEFAULT_INTERVAL[range]];
  el.intervalPills.innerHTML=v.map(iv=>`<button class="interval-pill${iv===state.interval?' active':''}" data-interval="${iv}">${INTERVAL_LABELS[iv]||iv}</button>`).join('');
}
function initIntervalPills(){el.intervalPills.addEventListener('click',e=>{const p=e.target.closest('.interval-pill');if(!p||p.classList.contains('active'))return;el.intervalPills.querySelectorAll('.interval-pill').forEach(x=>x.classList.remove('active'));p.classList.add('active');state.interval=p.dataset.interval;loadStock(state.symbol,state.range);});}
function initIndicatorChips(){el.indicatorChips.addEventListener('click',e=>{const c=e.target.closest('.chip');if(!c)return;toggleIndicator(c.dataset.indicator);});}
function removeWatchlistItem(sym){
  const item=document.querySelector('.watch-item[data-symbol="'+sym+'"]');
  if(item){item.remove();saveUserState();toast('Removed '+sym);}
}

function initWatchlist(){
  el.watchlistPanel.addEventListener('click',e=>{const i=e.target.closest('.watch-item');if(!i)return;if(e.target.closest('.watch-del'))return;loadStock(i.dataset.symbol);});
  el.addWatchBtn.addEventListener('click',()=>{const s=prompt('Add symbol:');if(s&&s.trim()){const sym=s.trim().toUpperCase();if(document.querySelector('.watch-item[data-symbol="'+sym+'"]')){toast(sym+' already in watchlist');return;}
      const d=document.createElement('div');d.className='watch-item';d.dataset.symbol=sym;d.innerHTML=`<span class="watch-symbol">${sym}</span><span class="watch-name"></span><span class="watch-price">--</span><span class="watch-dayrange"></span><span class="watch-change">--</span><span class="watch-vol"></span><span class="watch-del" title="Remove">×</span>`;
      d.querySelector('.watch-del').addEventListener('click',e=>{e.stopPropagation();removeWatchlistItem(sym);});
      d.addEventListener('click',()=>loadStock(sym));el.watchlistPanel.appendChild(d);saveUserState();toast('Added '+sym);fetchWatchlistPrices();}});
}
function updateWatchlistPrices(q){
  if(!q||!q.symbol)return;const i=document.querySelector('.watch-item[data-symbol="'+q.symbol+'"]');if(!i)return;
  i.querySelector('.watch-price').textContent=q.currentPrice!=null?fmt(q.currentPrice):'--';
  const c=q.changePercent,e=i.querySelector('.watch-change');if(c!=null){const s=c>=0?'+':'';e.textContent=s+fmt(c)+'%';e.className='watch-change '+(c>=0?'pos':'neg');}else{e.textContent='--';e.className='watch-change';}
  if(q.longName){const n=i.querySelector('.watch-name');if(n)n.textContent=q.longName;}
  if(q.dayHigh!=null&&q.dayLow!=null){const dr=i.querySelector('.watch-dayrange');if(dr)dr.textContent=fmt(q.dayLow)+' - '+fmt(q.dayHigh);}
  if(q.regularMarketVolume!=null){const v=i.querySelector('.watch-vol');if(v)v.textContent=fmtCompact(q.regularMarketVolume);}
}

async function fetchWatchlistPrices(){
  const items=document.querySelectorAll('.watch-item');
  items.forEach(async item=>{
    const sym=item.dataset.symbol;
    if(!sym)return;
    try{
      const r=await fetch('/api/stock/'+encodeURIComponent(sym)+'?range=1d&interval=5m');
      const d=await r.json();
      const q=d.quote||{};
      if(q.currentPrice!=null){
        item.querySelector('.watch-price').textContent=fmt(q.currentPrice);
        const pct=q.changePercent;
        const e=item.querySelector('.watch-change');
        if(pct!=null){
          const s=pct>=0?'+':'';
          e.textContent=s+fmt(pct)+'%';
          e.className='watch-change '+(pct>=0?'pos':'neg');
        }
        const n=item.querySelector('.watch-name');
        if(n&&q.longName)n.textContent=q.longName;
        const dr=item.querySelector('.watch-dayrange');
        if(dr&&q.dayHigh!=null&&q.dayLow!=null)dr.textContent=fmt(q.dayLow)+' - '+fmt(q.dayHigh);
        const v=item.querySelector('.watch-vol');
        if(v&&q.regularMarketVolume!=null)v.textContent=fmtCompact(q.regularMarketVolume);
      }
    }catch(e){}
  });
}
const viewedHistory=[];
function pushHistory(s,n,p){
  const t=Math.floor(Date.now()/1000),i=viewedHistory.findIndex(h=>h.symbol===s);
  if(i!==-1)viewedHistory.splice(i,1);
  viewedHistory.unshift({symbol:s,name:n||s,time:t,price:p||null});
  if(viewedHistory.length>50)viewedHistory.length=50;
  renderHistory();autoSaveUserState();
}
function renderHistory(){
  const c=el.historyPanel;if(!viewedHistory.length){c.innerHTML='<div class="history-empty">No stocks viewed yet</div>';return;}
  c.innerHTML=viewedHistory.map(h=>`<div class="history-item" data-symbol="${h.symbol}"><span class="hi-symbol">${h.symbol}</span><span class="hi-name">${escHtml(h.name)}</span>${h.price!=null?`<span class="hi-price">$${fmt(h.price)}</span>`:''}<span class="hi-time">${formatTimeAgo(h.time)}</span></div>`).join('');
  c.querySelectorAll('.history-item').forEach(i=>{i.addEventListener('click',()=>loadStock(i.dataset.symbol));});
}
async function fetchHistoryPrices(){
  const items=document.querySelectorAll('.history-item');
  items.forEach(async item=>{
    const sym=item.dataset.symbol; if(!sym)return;
    try{
      const r=await fetch('/api/price/'+encodeURIComponent(sym));
      const d=await r.json();
      if(d.price!=null){
        let span=item.querySelector('.hi-price');
        if(!span){span=document.createElement('span');span.className='hi-price';item.insertBefore(span,item.querySelector('.hi-time'));}
        span.textContent='$'+fmt(d.price);
        // Update cache
        const h=viewedHistory.find(x=>x.symbol===sym);
        if(h) h.price=d.price;
      }
    }catch(e){}
  });
}
function initHistoryPanel(){el.clearHistoryBtn.addEventListener('click',()=>{viewedHistory.length=0;renderHistory();saveUserState();toast('History cleared');});}
function initPolling(){setInterval(()=>{if(state.symbol)fetchStockData(state.symbol,state.range,state.interval).then(d=>{if(d&&d.history){state.data=d;const s=d.history.slice().sort((a,b)=>a.time-b.time);setDataSpan(s);state.candlestickSeries.setData(s.map(x=>({time:x.time,open:x.open,high:x.high,low:x.low,close:x.close})));updateTicker(d.quote);updateWatchlistPrices(d.quote);updateStatsBar(s[s.length-1]);updateStatsBarGlobal(d.quote);}}).catch(()=>{});},30000);}
// Separate watchlist price polling for all symbols
setInterval(()=>{const items=document.querySelectorAll('.watch-item');if(items.length)fetchWatchlistPrices();},15000);

/* ─── VIEW TABS ─── */

function initViewTabs(){
  document.querySelectorAll('.view-tab').forEach(t=>{t.addEventListener('click',()=>{document.querySelectorAll('.view-tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');switchView(t.dataset.view);});});
}
function switchView(view){
  const vs={stocks:'stocksView',news:'newsView',map:'mapView',overview:'overviewView',trading:'tradingView',alerts:'alertsView',ai:'aiView',settings:'settingsView'};
  Object.values(vs).forEach(v=>{const e=document.getElementById(v);if(e)e.style.display=v===vs[view]?'flex':'none';});
  const isStock=view==='stocks';
  ['tickerBar','rangeContainer'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display=isStock?'':'none';});
  el.searchWrapper.style.display=isStock?'':'none';
  if(!isStock)stopLivePrice();
  if(view==='news')fetchAndRenderNewsView();
  else if(view==='map')initMapView();
  else if(view==='overview')fetchAndRenderOverview();
  else if(view==='trading')fetchTradingData();
  else if(view==='alerts')fetchAlerts();
  else if(view==='settings')initSettings();
  else if(view==='stocks')setTimeout(resizeCharts,50);
  autoSaveUserState();
}

/* ─── NEWS ─── */

async function fetchAndRenderNewsView(){
  try{
    const r=await fetch('/api/news/latest');
    const news=await r.json();
    if(!Array.isArray(news)||!news.length){el.newsGrid.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">No news</div>';return;}

    let html='';
    // Featured top row
    const top=news.slice(0,2);
    if(top.length){
      html+='<div class="ng-top">';
      top.forEach(n=>{
        const src=n.source||'';
        const ts=n.providerPublishTime?formatTimeAgo(n.providerPublishTime):'';
        const desc=n.description||'';
        const img=n.image&&!n.image.includes('googleusercontent.com')?n.image:null;
        html+=`<div class="ng-feat" onclick="toggleNG(this)">
          ${img?`<div class="ng-fimg" style="aspect-ratio:16/9"><img src="${escHtml(img)}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`:''}
          <div class="ng-fbody">
            <div class="ng-src">${escHtml(src)}</div>
            <div class="ng-ftitle">${escHtml(n.title||'')}</div>
            <div class="ng-fdesc">${escHtml(desc.slice(0,150))}${desc.length>150?'…':''}</div>
            <div class="ng-meta">${ts}</div>
          </div>
          <div class="ng-expand">
            <div class="ng-fdesc">${escHtml(desc)}</div>
            <a class="ng-link" href="${escHtml(n.link||'#')}" target="_blank">Read →</a>
          </div>
        </div>`;
      });
      html+='</div>';
    }
    // Rest in compact 2-col grid
    const rest=news.slice(2);
    if(rest.length){
      html+='<div class="ngrid">';
      rest.forEach(n=>{
        const src=n.source||'';
        const ts=n.providerPublishTime?formatTimeAgo(n.providerPublishTime):'';
        const img=n.image&&!n.image.includes('googleusercontent.com')?n.image:null;
        html+=`<div class="ng-sml" onclick="toggleNG(this)">
          ${img?`<div class="ng-simg" style="aspect-ratio:1/1"><img src="${escHtml(img)}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`:''}
          <div class="ng-sbody">
            <div class="ng-src">${escHtml(src)}</div>
            <div class="ng-stitle">${escHtml(n.title||'')}</div>
            <div class="ng-meta">${ts}</div>
          </div>
          <div class="ng-expand">
            <div class="ng-fdesc">${escHtml(n.description||'')}</div>
            <a class="ng-link" href="${escHtml(n.link||'#')}" target="_blank">Read →</a>
          </div>
        </div>`;
      });
      html+='</div>';
    }
    el.newsGrid.innerHTML=html;
  }catch{
    el.newsGrid.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Failed</div>';
  }
}

function toggleNG(el){
  const exp=el.querySelector('.ng-expand');
  if(!exp)return;
  const open=el.classList.toggle('open');
  exp.style.maxHeight=open?exp.scrollHeight+'px':'0';
  exp.style.opacity=open?'1':'0';
}
function initNewsPolling(){setInterval(()=>{const a=document.querySelector('.view-tab.active');if(a&&a.dataset.view==='news')fetchAndRenderNewsView();},60000);}


/* ─── MAP VIEW ─── */

const EXCHANGE_ROUTES=[
  [[40.7061,-74.0089],[51.5149,-0.0992],'New York - London'],
  [[40.7061,-74.0089],[35.6812,139.7671],'New York - Tokyo'],
  [[51.5149,-0.0992],[22.2842,114.1586],'London - Hong Kong'],
  [[51.5149,-0.0992],[1.3521,103.8198],'London - Singapore'],
  [[40.7061,-74.0089],[-23.5505,-46.6333],'New York - Sao Paulo'],
  [[35.6812,139.7671],[31.2304,121.4737],'Tokyo - Shanghai'],
  [[51.5149,-0.0992],[50.1109,8.6821],'London - Frankfurt'],
  [[40.7061,-74.0089],[43.6481,-79.3820],'New York - Toronto'],
  [[51.5149,-0.0992],[18.9290,72.8336],'London - Mumbai'],
  [[37.5665,126.9780],[35.6812,139.7671],'Seoul - Tokyo'],
];

const SHIPS=[
  {name:'MSC Maya',type:'Container',flag:'Panama',waypoints:[[31.23,121.47],[22.0,115.0],[10.5,110.0],[1.35,103.82]],speed:18,course:185,eta:'2d 4h',cargo:'Electronics & Machinery',owner:'Mediterranean Shipping Co.',cargoDetail:'Semiconductor components & consumer electronics',companies:'MSC, Evergreen, ONE'},
  {name:'Ever Given II',type:'Container',flag:'Panama',waypoints:[[1.35,103.82],[6.0,95.0],[10.0,80.0],[15.2,68.5],[20.0,55.0],[25.0,40.0],[30.0,32.0],[36.0,25.0],[40.0,15.0],[42.0,5.0],[44.0,-2.0],[46.0,-5.0],[51.92,4.48]],speed:16,course:290,eta:'8d 12h',cargo:'Consumer Goods',owner:'Evergreen Marine Corp.',cargoDetail:'Retail goods, furniture, textiles',companies:'Evergreen, Hapag-Lloyd, ONE'},
  {name:'Cosco Pride',type:'Bulk Carrier',flag:'China',waypoints:[[-23.96,-46.33],[-22.0,-40.0],[-20.0,-35.0],[-15.0,-30.0],[-10.0,-25.0],[-5.0,-20.0],[0.0,-15.0],[5.0,-10.0],[-5.0,5.0],[-10.0,10.0],[-15.0,15.0],[-20.0,20.0],[-25.0,25.0],[-30.0,30.0],[-34.0,35.0],[-33.0,40.0],[-30.0,45.0],[-25.0,50.0],[-20.0,55.0],[-15.0,60.0],[-10.0,65.0],[-5.0,70.0],[0.0,75.0],[5.0,80.0],[10.0,85.0],[15.0,90.0],[20.0,95.0],[22.0,100.0],[24.0,105.0],[26.0,110.0],[28.0,115.0],[30.0,118.0],[36.07,120.38]],speed:12,course:85,eta:'15d 6h',cargo:'Iron Ore',owner:'COSCO Shipping Bulk',cargoDetail:'Iron ore from Brazil to China (steel production)',companies:'Vale, COSCO, BHP Billiton'},
  {name:'Maersk Valiant',type:'Container',flag:'Denmark',waypoints:[[51.92,4.48],[50.0,-10.0],[48.5,-30.2],[46.0,-50.0],[44.0,-60.0],[40.71,-74.01]],speed:20,course:275,eta:'3d 8h',cargo:'Manufactured Goods',owner:'Maersk Line',cargoDetail:'Industrial equipment & machinery parts',companies:'Maersk, CMA CGM, ZIM'},
  {name:'BW LPG Helios',type:'LPG Tanker',flag:'Singapore',waypoints:[[29.76,-95.37],[28.0,-90.0],[26.0,-85.0],[24.0,-80.0],[22.0,-75.0],[25.3,-155.8],[28.0,-160.0],[30.0,-165.0],[32.0,-170.0],[34.0,-175.0],[35.61,140.11]],speed:14,course:275,eta:'10d 18h',cargo:'LPG',owner:'BW LPG Ltd.',cargoDetail:'Liquefied petroleum gas (propane/butane)',companies:'BW LPG, Dorian LPG, Petredec'},
  {name:'Frontier Sky',type:'Crude Tanker',flag:'Liberia',waypoints:[[26.66,50.16],[28.0,45.0],[30.5,35.0],[32.0,25.8],[34.0,20.0],[36.0,15.0],[38.0,10.0],[40.0,5.0],[42.0,2.0],[44.0,0.0],[46.0,-2.0],[48.0,-1.0],[51.92,4.48]],speed:11,course:310,eta:'5d 2h',cargo:'Crude Oil',owner:'Frontline Ltd.',cargoDetail:'Arabian light crude oil (spot charter)',companies:'Shell, BP, Trafigura'},
  {name:'CMA CGM Libra',type:'Container',flag:'France',waypoints:[[33.77,-118.24],[35.0,-130.0],[36.0,-145.0],[37.0,-155.0],[38.2,-170.1],[37.0,-175.0],[35.0,180.0],[33.0,160.0],[32.0,140.0],[31.23,121.47]],speed:19,course:275,eta:'7d 14h',cargo:'Electronics',owner:'CMA CGM Group',cargoDetail:'Consumer electronics, semiconductors, lithium batteries',companies:'CMA CGM, COSCO, Evergreen'},
  {name:'NYK Falcon',type:'Container',flag:'Japan',waypoints:[[35.68,139.65],[38.0,150.0],[40.0,160.0],[42.0,-155.0],[40.0,-140.0],[37.0,-130.0],[33.77,-118.24]],speed:17,course:85,eta:'6d 10h',cargo:'Vehicles',owner:'Nippon Yusen Kaisha',cargoDetail:'Toyota & Honda vehicles (Ro-Ro)',companies:'Toyota, Honda, NYK'},
  {name:'Vale Rio',type:'Bulk Carrier',flag:'Brazil',waypoints:[[51.92,4.48],[50.0,2.0],[48.0,-2.0],[46.0,-5.0],[44.0,-10.0],[40.0,-15.0],[35.0,-20.0],[30.0,-22.0],[25.8,-25.5],[20.0,-28.0],[15.0,-30.0],[10.0,-33.0],[5.0,-35.0],[0.0,-37.0],[-5.0,-38.0],[-10.0,-39.0],[-15.0,-40.0],[-20.0,-42.0],[-23.96,-46.33]],speed:13,course:195,eta:'11d 8h',cargo:'Ballast',owner:'Vale S.A.',cargoDetail:'Ballast (empty) returning for iron ore load',companies:'Vale, Anglo American'},
  {name:'Stolt Strength',type:'Chemical Tanker',flag:'Bahamas',waypoints:[[1.35,103.82],[5.0,106.0],[10.0,109.0],[14.0,112.0],[18.5,116.8],[22.0,120.0],[26.0,124.0],[30.0,127.0],[35.18,129.08]],speed:13,course:40,eta:'4d 6h',cargo:'Chemicals',owner:'Stolt-Nielsen Ltd.',cargoDetail:'Industrial chemicals, solvents, acids',companies:'BASF, Dow, DuPont'},
  {name:'MSC Diana',type:'Container',flag:'Panama',waypoints:[[31.23,121.47],[28.0,115.0],[26.0,105.0],[24.0,95.0],[22.0,85.0],[24.0,75.0],[26.0,65.0],[28.0,55.0],[28.0,42.0],[30.0,35.0],[32.0,28.0],[35.0,20.0],[38.0,15.0],[42.0,12.0],[46.0,10.0],[50.0,10.0],[53.55,10.0]],speed:17,course:290,eta:'14d 8h',cargo:'Furniture & Textiles',owner:'Mediterranean Shipping Co.',cargoDetail:'Flat-pack furniture, garments, fabrics',companies:'IKEA, H&M, MSC'},
  {name:'Hyundai Hope',type:'Container',flag:'South Korea',waypoints:[[35.18,129.08],[32.0,125.0],[28.0,120.0],[22.0,115.0],[18.0,110.0],[18.0,105.0],[18.0,95.0],[18.0,85.0],[18.0,75.0],[18.0,65.0],[18.0,55.0],[18.0,52.0],[20.0,45.0],[22.0,38.0],[25.0,30.0],[28.0,22.0],[30.0,15.0],[32.0,10.0],[35.0,5.0],[38.0,4.0],[42.0,3.0],[45.0,3.0],[48.0,4.0],[51.92,4.48]],speed:15,course:295,eta:'12d 6h',cargo:'Electronics & Machinery',owner:'HMM Co. Ltd.',cargoDetail:'Samsung electronics & Hyundai machinery',companies:'Samsung, Hyundai, LG'},
  {name:'Pacific Explorer',type:'Container',flag:'Singapore',waypoints:[[31.23,121.47],[32.0,130.0],[33.0,140.0],[34.0,150.0],[35.0,160.0],[36.0,-175.0],[35.0,-165.0],[34.0,-155.0],[34.0,-145.0],[34.0,-135.0],[34.0,-125.0],[33.77,-118.24]],speed:19,course:85,eta:'7d 10h',cargo:'Consumer Electronics',owner:'Ocean Network Express (ONE)',cargoDetail:'Smartphones, laptops, gaming consoles',companies:'Apple, Samsung, Sony, ONE'},
  {name:'GasLog Gibraltar',type:'LNG Tanker',flag:'Bermuda',waypoints:[[25.29,51.53],[24.0,55.0],[22.0,58.0],[22.0,60.0],[22.0,65.0],[20.0,62.0],[18.0,58.0],[16.0,52.0],[14.0,48.0],[12.0,42.0],[12.0,35.0],[14.0,28.0],[16.0,22.0],[18.0,18.0],[20.0,12.0],[22.0,10.0],[25.0,8.0],[28.0,5.0],[32.0,2.0],[36.0,0.0],[40.0,-2.0],[44.0,-4.0],[48.0,-2.0],[51.4,0.5]],speed:15,course:310,eta:'9d 4h',cargo:'LNG',owner:'GasLog Ltd.',cargoDetail:'Liquefied natural gas (Qatar → Europe)',companies:'QatarEnergy, Shell, TotalEnergies'},
  {name:'Almi Atlas',type:'Bulk Carrier',flag:'Marshall Islands',waypoints:[[-20.31,118.58],[-18.0,116.0],[-15.0,115.0],[-12.0,115.0],[-8.0,115.0],[-4.0,115.0],[0.0,115.0],[4.0,115.0],[8.0,115.0],[12.0,115.0],[16.0,115.0],[20.0,115.0],[24.0,115.0],[28.0,115.0],[32.0,116.0],[36.07,120.38]],speed:11,course:350,eta:'5d 12h',cargo:'Iron Ore',owner:'Almi Tankers S.A.',cargoDetail:'Iron ore from Australia to China',companies:'Rio Tinto, BHP, FMG'},
  {name:'Hafnia Excellence',type:'Product Tanker',flag:'Singapore',waypoints:[[29.76,-95.37],[28.0,-90.0],[26.0,-85.0],[24.0,-80.0],[28.0,-75.0],[30.0,-70.0],[32.0,-65.0],[34.0,-60.0],[36.0,-55.0],[38.0,-50.0],[40.0,-45.0],[40.0,-35.0],[42.0,-25.0],[44.0,-15.0],[46.0,-5.0],[48.0,0.0],[50.0,2.0],[51.92,4.48]],speed:13,course:65,eta:'7d 18h',cargo:'Refined Petroleum',owner:'Hafnia Ltd.',cargoDetail:'Gasoline, diesel & jet fuel (USGC → Europe)',companies:'ExxonMobil, Chevron, Shell'},
  {name:'COSCO Universe',type:'Container',flag:'China',waypoints:[[39.13,117.72],[36.0,120.0],[34.0,123.0],[32.0,125.0],[30.0,122.0],[28.0,118.0],[26.0,115.0],[24.0,112.0],[22.0,110.0],[20.0,108.0],[18.0,105.0],[16.0,100.0],[15.0,95.0],[15.0,90.0],[15.0,85.0],[16.0,80.0],[18.0,75.0],[20.0,70.0],[22.0,65.0],[24.0,60.0],[26.0,55.0],[28.0,50.0],[30.0,45.0],[32.0,40.0],[34.0,35.0],[36.0,30.0],[37.94,23.65]],speed:16,course:280,eta:'10d 2h',cargo:'Mixed Goods',owner:'COSCO Shipping Lines',cargoDetail:'Mixed containerized cargo (China → Europe)',companies:'COSCO, CMA CGM, MSC'},
  {name:'Star Venture',type:'Bulk Carrier',flag:'Liberia',waypoints:[[-23.96,-46.33],[-22.0,-40.0],[-18.0,-35.0],[-14.0,-30.0],[-10.0,-25.0],[-6.0,-20.0],[-2.0,-15.0],[2.0,-10.0],[4.0,-5.0],[2.0,0.0],[-2.0,5.0],[-6.0,10.0],[-10.0,12.0],[-3.0,15.0],[0.0,20.0],[2.0,25.0],[4.0,30.0],[5.0,35.0],[6.0,40.0],[6.0,45.0],[5.0,50.0],[4.0,55.0],[3.0,60.0],[2.0,65.0],[2.0,70.0],[3.0,75.0],[4.0,80.0],[5.0,85.0],[6.0,90.0],[8.0,95.0],[10.0,100.0],[12.0,105.0],[15.0,110.0],[18.0,114.0],[22.0,117.0],[26.0,120.0],[31.23,121.47]],speed:12,course:85,eta:'18d 6h',cargo:'Soybeans',owner:'Cargill Ocean Transportation',cargoDetail:'Brazilian soybeans (export to China)',companies:'Cargill, Bunge, ADM'},
  {name:'MOL Majesty',type:'Car Carrier',flag:'Japan',waypoints:[[35.68,139.65],[38.0,145.0],[40.0,150.0],[40.0,160.0],[40.0,170.0],[40.0,180.0],[40.0,-175.0],[38.0,-170.0],[36.0,-165.0],[35.0,-155.0],[34.0,-145.0],[34.0,-135.0],[34.0,-125.0],[33.77,-118.24]],speed:15,course:75,eta:'8d 20h',cargo:'Vehicles',owner:'Mitsui O.S.K. Lines',cargoDetail:'Japanese automotive export (Toyota/Nissan/Mazda)',companies:'Toyota, Nissan, Mazda, MOL'},
];

let mapExchanges = [];
let mapRouteLines = [];
let mapMarkers = [];
let mapShips = [];
let currentMapInfo = null;

const TILE_LAYERS = {
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19,subdomains:'abcd'}),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'&copy; Esri'}),
  sentinel: L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/{z}/{y}/{x}.jpg',{maxZoom:19,attribution:'&copy; Copernicus & EOX',maxNativeZoom:18}),
  light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{maxZoom:19,subdomains:'abcd'}),
};
let currentTileLayer = 'sentinel';
let satMarker = null, satSwath = null, satGroundTrack = null;
let satAnimationTimer = null;

const SENTINEL_ORBIT = [
  {lat:51.9, lng:10.4}, {lat:48.7, lng:15.2}, {lat:45.2, lng:19.8}, {lat:41.5, lng:24.1},
  {lat:37.6, lng:28.2}, {lat:33.5, lng:32.0}, {lat:29.3, lng:35.5}, {lat:24.9, lng:38.7},
  {lat:20.4, lng:41.6}, {lat:15.8, lng:44.2}, {lat:11.1, lng:46.5}, {lat:6.4, lng:48.5},
  {lat:1.6, lng:50.2}, {lat:-3.2, lng:51.6}, {lat:-8.0, lng:52.7}, {lat:-12.8, lng:53.5},
  {lat:-17.6, lng:54.0}, {lat:-22.4, lng:54.2}, {lat:-27.1, lng:54.1}, {lat:-31.8, lng:53.7},
  {lat:-36.4, lng:53.0}, {lat:-41.0, lng:52.0}, {lat:-45.5, lng:50.7}, {lat:-50.0, lng:49.0},
  {lat:-54.4, lng:47.0}, {lat:-58.7, lng:44.6}, {lat:-62.9, lng:41.8}, {lat:-67.0, lng:38.6},
  {lat:-70.9, lng:35.0}, {lat:-74.7, lng:31.1}, {lat:-78.3, lng:27.0}, {lat:-81.7, lng:22.8},
  {lat:-84.7, lng:18.8}, {lat:-87.2, lng:15.7}, {lat:-88.5, lng:14.7},
  {lat:-87.2, lng:-164.3}, {lat:-84.7, lng:-161.2}, {lat:-81.7, lng:-157.2},
  {lat:-78.3, lng:-153.0}, {lat:-74.7, lng:-148.9}, {lat:-70.9, lng:-145.0},
  {lat:-67.0, lng:-141.4}, {lat:-62.9, lng:-138.2}, {lat:-58.7, lng:-135.4},
  {lat:-54.4, lng:-133.0}, {lat:-50.0, lng:-131.0}, {lat:-45.5, lng:-129.3},
  {lat:-41.0, lng:-128.0}, {lat:-36.4, lng:-127.0}, {lat:-31.8, lng:-126.3},
  {lat:-27.1, lng:-125.9}, {lat:-22.4, lng:-125.8}, {lat:-17.6, lng:-126.0},
  {lat:-12.8, lng:-126.5}, {lat:-8.0, lng:-127.3}, {lat:-3.2, lng:-128.4},
  {lat:1.6, lng:-129.8}, {lat:6.4, lng:-131.5}, {lat:11.1, lng:-133.5},
  {lat:15.8, lng:-135.8}, {lat:20.4, lng:-138.4}, {lat:24.9, lng:-141.3},
  {lat:29.3, lng:-144.5}, {lat:33.5, lng:-148.0}, {lat:37.6, lng:-151.8},
  {lat:41.5, lng:-155.9}, {lat:45.2, lng:-160.2}, {lat:48.7, lng:-164.8},
  {lat:51.9, lng:-169.6}, {lat:54.9, lng:-174.6}, {lat:57.6, lng:-179.8},
  {lat:60.0, lng:174.8}, {lat:62.1, lng:169.4}, {lat:63.9, lng:164.0},
  {lat:65.4, lng:158.6}, {lat:66.6, lng:153.2}, {lat:67.5, lng:147.8},
  {lat:68.1, lng:142.4}, {lat:68.4, lng:137.0}, {lat:68.4, lng:131.6},
  {lat:68.1, lng:126.2}, {lat:67.5, lng:120.8}, {lat:66.6, lng:115.4},
  {lat:65.4, lng:110.0}, {lat:63.9, lng:104.6}, {lat:62.1, lng:99.2},
  {lat:60.0, lng:93.8}, {lat:57.6, lng:88.6}, {lat:54.9, lng:83.6},
  {lat:51.9, lng:78.8}, {lat:48.7, lng:74.2}, {lat:45.2, lng:69.6},
  {lat:41.5, lng:65.2}, {lat:37.6, lng:61.0}, {lat:33.5, lng:57.0},
  {lat:29.3, lng:53.3}, {lat:24.9, lng:49.8}, {lat:20.4, lng:46.6},
  {lat:15.8, lng:43.6}, {lat:11.1, lng:40.9}, {lat:6.4, lng:38.5},
  {lat:1.6, lng:36.4}, {lat:-3.2, lng:34.6}, {lat:-8.0, lng:33.1},
  {lat:-12.8, lng:31.9}, {lat:-17.6, lng:31.0}, {lat:-22.4, lng:30.4},
  {lat:-27.1, lng:30.1}, {lat:-31.8, lng:30.1}, {lat:-36.4, lng:30.4},
  {lat:-41.0, lng:31.0}, {lat:-45.5, lng:31.9}, {lat:-50.0, lng:33.1},
  {lat:-54.4, lng:34.6}, {lat:-58.7, lng:36.4}, {lat:-62.9, lng:38.6},
  {lat:-67.0, lng:41.2}, {lat:-70.9, lng:44.4}, {lat:-74.7, lng:48.2},
  {lat:-78.3, lng:52.8}, {lat:-81.7, lng:58.6}, {lat:-84.7, lng:67.0},
  {lat:-87.2, lng:83.0}, {lat:-88.5, lng:100.0}, {lat:-88.5, lng:120.0},
  {lat:-87.2, lng:140.0}, {lat:-84.7, lng:158.0}, {lat:-81.7, lng:173.0},
  {lat:-78.3, lng:-174.2}, {lat:-74.7, lng:-164.6}, {lat:-70.9, lng:-157.2},
  {lat:-67.0, lng:-151.4}, {lat:-62.9, lng:-146.8}, {lat:-58.7, lng:-143.0},
  {lat:-54.4, lng:-139.8}, {lat:-50.0, lng:-137.2}, {lat:-45.5, lng:-135.0},
  {lat:-41.0, lng:-133.2}, {lat:-36.4, lng:-131.8}, {lat:-31.8, lng:-130.8},
  {lat:-27.1, lng:-130.2}, {lat:-22.4, lng:-130.0}, {lat:-17.6, lng:-130.2},
  {lat:-12.8, lng:-130.8}, {lat:-8.0, lng:-131.8}, {lat:-3.2, lng:-133.2},
  {lat:1.6, lng:-135.0}, {lat:6.4, lng:-137.2}, {lat:11.1, lng:-139.8},
  {lat:15.8, lng:-142.8}, {lat:20.4, lng:-146.2}, {lat:24.9, lng:-150.0},
  {lat:29.3, lng:-154.2}, {lat:33.5, lng:-158.8}, {lat:37.6, lng:-163.8},
  {lat:41.5, lng:-169.2}, {lat:45.2, lng:-175.0}, {lat:48.7, lng:178.8},
  {lat:51.9, lng:172.8}, {lat:54.9, lng:166.8}, {lat:57.6, lng:160.8},
  {lat:60.0, lng:154.8}, {lat:62.1, lng:148.8}, {lat:63.9, lng:142.8},
  {lat:65.4, lng:136.8}, {lat:66.6, lng:130.8}, {lat:67.5, lng:124.8},
  {lat:68.1, lng:118.8}, {lat:68.4, lng:112.8}, {lat:68.4, lng:106.8},
  {lat:68.1, lng:100.8}, {lat:67.5, lng:94.8}, {lat:66.6, lng:88.8},
  {lat:65.4, lng:82.8}, {lat:63.9, lng:76.8}, {lat:62.1, lng:70.8},
  {lat:60.0, lng:64.8}, {lat:57.6, lng:58.8}, {lat:54.9, lng:52.8},
  {lat:51.9, lng:46.8}, {lat:48.7, lng:40.8}, {lat:45.2, lng:34.8},
  {lat:41.5, lng:28.8}, {lat:37.6, lng:22.8}, {lat:33.5, lng:16.8},
  {lat:29.3, lng:10.8}, {lat:24.9, lng:4.8}, {lat:20.4, lng:-1.2},
  {lat:15.8, lng:-7.2}, {lat:11.1, lng:-13.2}, {lat:6.4, lng:-19.2},
  {lat:1.6, lng:-25.2}, {lat:-3.2, lng:-31.2}, {lat:-8.0, lng:-37.2},
  {lat:-12.8, lng:-43.2}, {lat:-17.6, lng:-49.2}, {lat:-22.4, lng:-55.2},
  {lat:-27.1, lng:-61.2}, {lat:-31.8, lng:-67.2}, {lat:-36.4, lng:-73.2},
  {lat:-41.0, lng:-79.2}, {lat:-45.5, lng:-85.2}, {lat:-50.0, lng:-91.2},
  {lat:-54.4, lng:-97.2}, {lat:-58.7, lng:-103.2}, {lat:-62.9, lng:-109.2},
  {lat:-67.0, lng:-115.2}, {lat:-70.9, lng:-121.2}, {lat:-74.7, lng:-127.2},
  {lat:-78.3, lng:-133.2}, {lat:-81.7, lng:-139.2}, {lat:-84.7, lng:-145.2},
  {lat:-87.2, lng:-151.2},
];

function getSatelliteInfo(posIdx){
  const p=SENTINEL_ORBIT[posIdx]||SENTINEL_ORBIT[0];
  const alt=693; const speed=7.5; const period='98.6 min';
  const inst='C-band SAR (5.405 GHz)';
  const res='10 m (IW), 25 m (EW), 5 m (SM), 50 m (WV)';
  const swath='250 km (IW), 400 km (EW), 80 km (SM)';
  const revisit='6 days (at equator)';
  const passes='14+5/6 orbits per day';
  return {alt,speed,period,inst,res,swath,revisit,passes,lat:p.lat.toFixed(2),lng:p.lng.toFixed(2)};
}

function switchTileLayer(type){
  if(currentTileLayer===type) return;
  if(TILE_LAYERS[currentTileLayer]) state.mapInstance.removeLayer(TILE_LAYERS[currentTileLayer]);
  TILE_LAYERS[type].addTo(state.mapInstance);
  currentTileLayer=type;
}

function updateSatellite(posIdx){
  const p=SENTINEL_ORBIT[posIdx]||SENTINEL_ORBIT[0];
  if(satMarker&&state.mapInstance.hasLayer(satMarker)) satMarker.setLatLng([p.lat,p.lng]);
}

function showSatelliteInfo(posIdx){
  const info=getSatelliteInfo(posIdx);
  el.miHeader.textContent='Sentinel-1A Satellite';
  el.miBody.innerHTML=`
<div class="mi-stat"><span class="mi-stat-label">Satellite</span><span class="mi-stat-value">Sentinel-1A (ESA)</span></div>
<div class="mi-stat"><span class="mi-stat-label">Position</span><span class="mi-stat-value">${info.lat}°N, ${info.lng}°E</span></div>
<div class="mi-stat"><span class="mi-stat-label">Altitude</span><span class="mi-stat-value">${info.alt} km</span></div>
<div class="mi-stat"><span class="mi-stat-label">Speed</span><span class="mi-stat-value">${info.speed} km/s</span></div>
<div class="mi-stat"><span class="mi-stat-label">Orbit Period</span><span class="mi-stat-value">${info.period}</span></div>
<div class="mi-stat" style="border-top:1px solid var(--border-light);margin-top:6px;padding-top:6px"><span class="mi-stat-label">Instrument</span><span class="mi-stat-value">${info.inst}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Resolution</span><span class="mi-stat-value">${info.res}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Swath Width</span><span class="mi-stat-value">${info.swath}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Revisit Time</span><span class="mi-stat-value">${info.revisit}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Daily Orbits</span><span class="mi-stat-value">${info.passes}</span></div>
<div style="margin-top:12px;padding:8px;background:var(--bg-base);border:1px solid var(--border-light);font-size:11px;color:var(--text-muted)">
<strong style="color:var(--accent)">Live Feed</strong> — Scanning swath: ${posIdx%2===0?'IW mode (Interferometric Wide swath, 250 km)':'EW mode (Extra Wide swath, 400 km)'}<br>
<span style="font-size:10px">Next pass: ${Math.floor(Math.random()*60)+1} min | Data downlink: ${['Svalbard','Matera','Alaska'][Math.floor(Math.random()*3)]}</span></div>`;
  el.miNews.style.display='none';
}

async function initMapView(){
  if(state.mapInitialized)return;state.mapInitialized=true;
  try{
    const r=await fetch('/api/exchanges');mapExchanges=await r.json();
    if(!state.mapInstance){
      state.mapInstance=L.map(el.mapContainer,{center:[20,0],zoom:2,zoomControl:true,attributionControl:false,worldCopyJump:true});
      TILE_LAYERS.satellite.addTo(state.mapInstance);
      // Routes
      EXCHANGE_ROUTES.forEach(([f,t,l])=>{const line=L.polyline([f,t],{color:'#58a6ff',weight:2.5,opacity:0.7,dashArray:'8,8'}).addTo(state.mapInstance).bindTooltip(l,{permanent:false,direction:'center'});
        mapRouteLines.push({label:l,line,from:f,to:t});
        line.on('click',()=>showMapRouteInfo(l,f,t));});
      // Markers
      mapExchanges.forEach(ex=>{
        const isOpen=ex.status==='open';
        const icon=L.divIcon({className:'',html:`<div class="exchange-marker ${isOpen?'open':''}"></div>`,iconSize:[14,14],iconAnchor:[7,7]});
        const marker=L.marker([ex.lat,ex.lng],{icon}).addTo(state.mapInstance);
        const popup=`<div style="font-size:13px;font-weight:600;margin-bottom:4px">${ex.name}</div><div style="font-size:11px"><div>${ex.city}, ${ex.country}</div><div style="margin-top:4px"><span style="display:inline-block;width:6px;height:6px;background:${isOpen?'var(--green)':'var(--red)'};margin-right:4px"></span>${isOpen?'Open':'Closed'} - ${ex.local_time}</div></div>`;
        marker.bindPopup(popup,{className:'exchange-popup',closeButton:true,maxWidth:240});
        marker.on('click',()=>showMapExchangeInfo(ex));
        mapMarkers.push({exchange:ex,marker});
      });
      // Ships
      SHIPS.forEach(sh=>{
        const waypoints=sh.waypoints||[[sh.waypoints?.[0]?.[0]||0,sh.waypoints?.[0]?.[1]||0],[sh.waypoints?.[sh.waypoints.length-1]?.[0]||0,sh.waypoints?.[sh.waypoints.length-1]?.[1]||0]];
        const from=waypoints[0]; const to=waypoints[waypoints.length-1];
        // Trail polyline (ship's actual traveled path)
        const trail=L.polyline([from],{color:'#ffc107',weight:2,opacity:0.5});
        const icon=L.divIcon({className:'',html:`<div class="ship-marker" style="transform:rotate(${sh.course}deg)"></div>`,iconSize:[14,14],iconAnchor:[7,0]});
        const marker=L.marker([from[0],from[1]],{icon});
        marker.bindTooltip(sh.name,{permanent:false,direction:'top',offset:[0,-6]});
        marker.on('click',()=>showMapShipInfo(sh));
        mapShips.push({ship:sh,marker,trail,from,to,waypoints,progress:Math.random(),trailPositions:[from]});
      });
      // Satellite marker & swath
      const satIcon=L.divIcon({className:'',html:`<div class="sat-marker"></div>`,iconSize:[16,16],iconAnchor:[8,8]});
      satMarker=L.marker([51.9,10.4],{icon:satIcon}).addTo(state.mapInstance);
      satMarker.bindTooltip('Sentinel-1A',{permanent:false,direction:'top',offset:[0,-10]});
      satMarker.on('click',()=>showSatelliteInfo(0));

      // Legend
      const legendControl=L.control({position:'bottomright'});legendControl.onAdd=function(){const d=L.DomUtil.create('div','map-legend');d.innerHTML=`<div class="map-legend-title">Legend</div><div class="map-legend-item"><div class="map-legend-dot" style="background:var(--green)"></div>Open Exchange</div><div class="map-legend-item"><div class="map-legend-dot" style="background:var(--accent)"></div>Closed Exchange</div><div class="map-legend-item"><div class="map-legend-line" style="border-top-color:#58a6ff"></div>Trade Route</div><div class="map-legend-item" style="margin-top:6px"><div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:10px solid #ffc107;filter:drop-shadow(0 0 4px rgba(255,193,7,0.6))"></div>Ship</div><div class="map-legend-item" style="margin-top:4px"><div class="sat-legend-dot"></div>Sentinel-1A</div>`;return d;};legendControl.addTo(state.mapInstance);
      syncMapFilters();
      setTimeout(()=>state.mapInstance.invalidateSize(),200);
    }
  }catch(e){console.error('Map init error:',e);}
}

// Satellite animation
let satPosIdx=0;
function animateSatellite(){
  if(!state.mapInstance||!satMarker||!el.mfSatellite.checked)return;
  satPosIdx=(satPosIdx+1)%SENTINEL_ORBIT.length;
  const p=SENTINEL_ORBIT[satPosIdx];
  satMarker.setLatLng([p.lat,p.lng]);
  // Update info panel if viewing satellite
  if(currentMapInfo&&currentMapInfo.type==='satellite') showSatelliteInfo(satPosIdx);
}
setInterval(animateSatellite,3000);

function showMapExchangeInfo(ex){
  currentMapInfo={type:'exchange',data:ex};
  el.miHeader.textContent=ex.name+' ('+ex.code+')';
  fetch('/api/exchange/'+ex.code).then(r=>r.json()).then(d=>{
    const stocks=d.stocks||[];
    const meta=d.exchange||ex;
    el.miBody.innerHTML=`<div class="mi-stat"><span class="mi-stat-label">Location</span><span class="mi-stat-value">${meta.city}, ${meta.country}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Status</span><span class="mi-stat-value ${meta.status==='open'?'pos':'neg'}">${meta.status==='open'?'Open':'Closed'} (${meta.local_time})</span></div>
<div class="mi-stat"><span class="mi-stat-label">Timezone</span><span class="mi-stat-value">${meta.tz}</span></div>
${meta.marketCap?`<div class="mi-stat"><span class="mi-stat-label">Market Cap</span><span class="mi-stat-value">${meta.marketCap}</span></div>`:''}
${meta.listed?`<div class="mi-stat"><span class="mi-stat-label">Listed Companies</span><span class="mi-stat-value">${meta.listed}</span></div>`:''}
${meta.founded?`<div class="mi-stat"><span class="mi-stat-label">Founded</span><span class="mi-stat-value">${meta.founded}</span></div>`:''}
${stocks.length?`<div style="margin-top:12px"><div class="mi-section-title">Representative Stocks</div>${stocks.map(s=>{
  const p=s.price||s.price===0?s.price:null,c=s.change,pct=s.changePercent,cls=(pct||0)>=0?'pos':'neg',sn=(pct||0)>=0?'+':'';
  return`<div class="mi-stock-item" onclick="loadStock('${s.symbol||''}')"><span class="ms-symbol">${s.symbol||'N/A'}</span><span class="ms-price">${p!=null?'$'+fmt(p):'--'}</span><span class="ms-chg ${cls}">${c!=null?sn+fmt(c):'--'}</span></div>`;
}).join('')}</div>`:''}`;
  }).catch(()=>{el.miBody.innerHTML='<div class="mi-empty">Failed to load exchange data</div>';});
  // News
  fetch('/api/news/'+ex.code).then(r=>r.json()).then(news=>{
    if(Array.isArray(news)&&news.length){el.miNews.style.display='block';el.miNewsContent.innerHTML=news.slice(0,4).map(n=>`<div style="padding:4px 0;border-bottom:1px solid var(--border-light)"><div style="font-size:11px"><a href="${escHtml(n.link||'#')}" target="_blank" rel="noopener" style="color:var(--text-primary);text-decoration:none">${escHtml(n.title||'')}</a></div><div style="font-size:10px;color:var(--text-muted)">${n.providerPublishTime?formatTimeAgo(n.providerPublishTime):''}</div></div>`).join('');}
    else el.miNews.style.display='none';
  }).catch(()=>el.miNews.style.display='none');
}

function showMapRouteInfo(label,from,to){
  currentMapInfo={type:'route',data:{label,from,to}};
  const routeVol={vol:'$'+['1.2T','2.8T','850B','620B','210B','1.5T','980B','450B','780B','370B'][Math.floor(Math.random()*10)],time:'~'+['7','13','25','18','12','20','14','10','22','8'][Math.floor(Math.random()*10)]+' days',ships:['120','340','85','160','45','290','110','75','200','55'][Math.floor(Math.random()*10)]+'/year'};
  const parts=label.split(' - ');const oName=parts[0]||'Origin',dName=parts[1]||'Destination';
  const dist=Math.round(distance(from,to));
  el.miHeader.textContent='Trade Route: '+label;
  el.miBody.innerHTML=`<div class="mi-stat"><span class="mi-stat-label">Origin</span><span class="mi-stat-value">${oName}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Coordinates</span><span class="mi-stat-value">${from[0].toFixed(2)}°N, ${from[1].toFixed(2)}°E</span></div>
<div class="mi-stat"><span class="mi-stat-label">Destination</span><span class="mi-stat-value">${dName}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Coordinates</span><span class="mi-stat-value">${to[0].toFixed(2)}°N, ${to[1].toFixed(2)}°E</span></div>
<div class="mi-stat"><span class="mi-stat-label">Distance</span><span class="mi-stat-value">~${dist.toLocaleString()} km</span></div>
<div class="mi-stat" style="border-top:1px solid var(--border-light);margin-top:6px;padding-top:6px"><span class="mi-stat-label">Est. Trade Volume</span><span class="mi-stat-value">${routeVol.vol}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Transit Time</span><span class="mi-stat-value">${routeVol.time}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Annual Shipments</span><span class="mi-stat-value">${routeVol.ships}</span></div>
<div class="mi-stat" style="border-top:1px solid var(--border-light);margin-top:6px;padding-top:6px"><span class="mi-stat-label">Type</span><span class="mi-stat-value">Financial Corridor</span></div>
<div class="mi-stat"><span class="mi-stat-label">Active Since</span><span class="mi-stat-value">19th Century</span></div>
<div style="margin-top:12px;font-size:11px;color:var(--text-muted)">Click the route line on the map to reselect. Click a stock to load it in the Stocks tab.</div>`;
  el.miNews.style.display='none';
}

function distance(p1,p2){
  const R=6371,dL=(p2[1]-p1[1])*Math.PI/180,dP=(p2[0]-p1[0])*Math.PI/180;
  const a=Math.sin(dP/2)**2+Math.cos(p1[0]*Math.PI/180)*Math.cos(p2[0]*Math.PI/180)*Math.sin(dL/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function showMapShipInfo(sh, live){
  if(!sh)return;
  if(!live){
    currentMapInfo={type:'ship',data:sh};
    el.miHeader.textContent='Ship: '+sh.name;
  }
  const ms=mapShips.find(s=>s.ship.name===sh.name);
  let pos;
  try{pos=ms?ms.marker.getLatLng():{lat:(sh.waypoints?.[0]?.[0])||0,lng:(sh.waypoints?.[0]?.[1])||0};}catch(e){pos={lat:0,lng:0};}
  const wps=sh.waypoints||[];
  const from=wps.length>1?wps[0]:[0,0];
  const to=wps.length>1?wps[wps.length-1]:[0,0];
  const dist=Math.round(distance(from,to));
  const trailLen=ms?ms.trailPositions.length:0;
  const liveDot=live?'<span style="display:inline-block;width:6px;height:6px;background:var(--green);margin-right:4px;animation:shipPulse 1s ease-in-out infinite;border-radius:50%"></span>':'';
  const owner=sh.owner||'MSC Shipping Lines';
  const cargoDetail=sh.cargoDetail||'Standard container freight';
  const companies=sh.companies||'Multiple carriers';
  el.miBody.innerHTML=`${liveDot}<div class="mi-stat"><span class="mi-stat-label">Type</span><span class="mi-stat-value">${sh.type}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Flag</span><span class="mi-stat-value">${sh.flag}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Owner</span><span class="mi-stat-value">${owner}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Position</span><span class="mi-stat-value">${pos.lat.toFixed(4)}°${pos.lat>=0?'N':'S'}, ${pos.lng.toFixed(4)}°${pos.lng>=0?'E':'W'}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Speed</span><span class="mi-stat-value">${sh.speed} knots (${(sh.speed*1.852).toFixed(1)} km/h)</span></div>
<div class="mi-stat"><span class="mi-stat-label">Course</span><span class="mi-stat-value">${sh.course}°</span></div>
<div class="mi-stat" style="border-top:1px solid var(--border-light);margin-top:6px;padding-top:6px"><span class="mi-stat-label">Cargo</span><span class="mi-stat-value">${sh.cargo}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Cargo Detail</span><span class="mi-stat-value">${cargoDetail}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Shipping Partners</span><span class="mi-stat-value">${companies}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Origin</span><span class="mi-stat-value">${from[0].toFixed(2)}, ${from[1].toFixed(2)}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Destination</span><span class="mi-stat-value">${to[0].toFixed(2)}, ${to[1].toFixed(2)}</span></div>
<div class="mi-stat"><span class="mi-stat-label">Distance</span><span class="mi-stat-value">~${dist.toLocaleString()} km</span></div>
<div class="mi-stat"><span class="mi-stat-label">ETA</span><span class="mi-stat-value">${sh.eta}</span></div>
<div style="margin-top:12px;padding:6px;background:var(--bg-base);border:1px solid var(--border-light);font-size:10px;color:var(--text-muted)">
<strong style="color:var(--accent)">Live Tracking</strong> — Updated every 4s<br>
<span>Trail: ${trailLen} positions | Next waypoint: ${Math.round((1-(ms?.progress||0))*100)}% of leg</span></div>`;
  el.miNews.style.display='none';
}

function syncMapFilters(){
  if(!state.mapInstance)return;
  const m=state.mapInstance;
  mapMarkers.forEach(({marker})=>{if(el.mfExchanges.checked)m.addLayer(marker);else if(m.hasLayer(marker))m.removeLayer(marker);});
  mapRouteLines.forEach(({line})=>{if(el.mfRoutes.checked)m.addLayer(line);else if(m.hasLayer(line))m.removeLayer(line);});
  mapShips.forEach(({marker,trail})=>{
    if(el.mfShips.checked){if(!m.hasLayer(marker))m.addLayer(marker);}
    else{if(m.hasLayer(marker))m.removeLayer(marker);}
    if(el.mfShipTrajectories.checked){if(!m.hasLayer(trail))m.addLayer(trail);}
    else{if(m.hasLayer(trail))m.removeLayer(trail);}
  });
  // Satellite checkbox toggles Sentinel-2 basemap + Sentinel-1 marker
  if(el.mfSatellite.checked){
    if(currentTileLayer!=='sentinel'){switchTileLayer('sentinel');el.mapTileType.value='sentinel';}
    if(satMarker&&!m.hasLayer(satMarker))m.addLayer(satMarker);
  }else{
    if(currentTileLayer==='sentinel'){switchTileLayer('dark');el.mapTileType.value='dark';}
    if(satMarker&&m.hasLayer(satMarker))m.removeLayer(satMarker);
  }
  const legendEl=document.querySelector('.map-legend');
  if(legendEl) legendEl.style.display=el.mfSatellite.checked||el.mfExchanges.checked||el.mfRoutes.checked||el.mfShips.checked?'':'none';
}

function initMapSearch(){
  el.mapSearch.addEventListener('input',()=>{const q=el.mapSearch.value.trim();if(state.mapSearchTimeout)clearTimeout(state.mapSearchTimeout);
    if(q.length<1){el.mapSearchResults.style.display='none';return;}
    state.mapSearchTimeout=setTimeout(()=>{
      const results=[];const lq=q.toLowerCase();
      const showEx=el.mfExchanges.checked;const showRt=el.mfRoutes.checked;const showSh=el.mfShips.checked;
      if(showEx)mapExchanges.forEach(ex=>{if(ex.name.toLowerCase().includes(lq)||ex.code.toLowerCase().includes(lq)||ex.city.toLowerCase().includes(lq))results.push({type:'exchange',label:ex.code+' - '+ex.name,data:ex,action:()=>showMapExchangeInfo(ex)});});
      if(showRt)mapRouteLines.forEach(r=>{if(r.label.toLowerCase().includes(lq))results.push({type:'route',label:r.label,data:r,action:()=>showMapRouteInfo(r.label,r.from,r.to)});});
      if(showSh)SHIPS.forEach(sh=>{if(sh.name.toLowerCase().includes(lq)||sh.type.toLowerCase().includes(lq)||sh.flag.toLowerCase().includes(lq)||sh.cargo.toLowerCase().includes(lq))results.push({type:'ship',label:sh.name+' ('+sh.type+')',data:sh,action:()=>showMapShipInfo(sh)});});
      if(el.mfSatellite.checked&&('sentinel'.includes(lq)||'satellite'.includes(lq)||'scan'.includes(lq)))
        results.push({type:'satellite',label:'Sentinel-1A Satellite',data:{},action:()=>showSatelliteInfo(satPosIdx)});
      if(el.mfStocks.checked)fetch('/api/search/'+encodeURIComponent(q)).then(r=>r.ok?r.json():[]).then(sr=>{
        sr.slice(0,5).forEach(s=>results.push({type:'stock',label:s.symbol+' - '+s.name,data:s,action:()=>{switchView('stocks');loadStock(s.symbol);}}));
        renderMapSearchResults(results,q);
      }).catch(()=>renderMapSearchResults(results,q));
      else renderMapSearchResults(results,q);
    },200);
  });
  el.mapSearch.addEventListener('keydown',e=>{if(e.key==='Escape'){el.mapSearchResults.style.display='none';el.mapSearch.blur();}});
  // Tile type switching
  el.mapTileType.addEventListener('change',function(){switchTileLayer(this.value);});
  el.mfSelectAll.addEventListener('click',()=>{const checked=!el.mfExchanges.checked;[el.mfExchanges,el.mfRoutes,el.mfShips,el.mfSatellite].forEach(c=>c.checked=checked);syncMapFilters();});
  [el.mfExchanges,el.mfRoutes,el.mfShips,el.mfShipTrajectories,el.mfSatellite].forEach(cb=>cb.addEventListener('change',syncMapFilters));
  document.addEventListener('click',e=>{if(!el.mapSearch.contains(e.target)&&!el.mapSearchResults.contains(e.target))el.mapSearchResults.style.display='none';});
}

function renderMapSearchResults(results,q){
  const c=el.mapSearchResults;if(!results.length){c.style.display='none';return;}
  c.innerHTML=results.map(r=>`<div class="search-item" data-type="${r.type}"><span class="si-symbol">${escHtml(r.label)}</span><span class="si-type">${r.type}</span></div>`).join('');
  c.style.display='block';
  c.querySelectorAll('.search-item').forEach((item,i)=>{
    item.addEventListener('click',()=>{el.mapSearchResults.style.display='none';el.mapSearch.value=results[i].label;results[i].action();});
  });
}

function animateShips(){
  if(!state.mapInstance||!mapShips.length)return;
  mapShips.forEach(s=>{
    const wps=s.waypoints||[s.from,s.to];
    const totalSegments=wps.length-1;
    const step=0.0008;
    let p=s.progress||0; p+=step;
    if(p>=1){p=0;s.trailPositions=[s.from];s.trail.setLatLngs([s.from]);}
    s.progress=p;
    const totalProgress=p*totalSegments;
    const segIdx=Math.min(Math.floor(totalProgress),totalSegments-1);
    const segProgress=totalProgress-segIdx;
    const fromWp=wps[segIdx];const toWp=wps[segIdx+1];
    const lat=fromWp[0]+(toWp[0]-fromWp[0])*segProgress;
    const lng=fromWp[1]+(toWp[1]-fromWp[1])*segProgress;
    s.marker.setLatLng([lat,lng]);
    // Update trail
    s.trailPositions.push([lat,lng]);
    if(s.trailPositions.length>80) s.trailPositions.shift();
    s.trail.setLatLngs(s.trailPositions);
    // Update rotation
    const dx=toWp[1]-fromWp[1]; const dy=toWp[0]-fromWp[0];
    const angle=Math.atan2(dx,dy)*180/Math.PI;
    s.marker._icon.style.transform+=' rotate('+angle+'deg)';
    // Live update info panel if this ship is selected
    if(currentMapInfo&&currentMapInfo.type==='ship'&&currentMapInfo.data&&currentMapInfo.data.name===s.ship.name){
      showMapShipInfo(s.ship,true);
    }
  });
}
setInterval(animateShips,4000);

/* ─── OVERVIEW ─── */

function squarify(items, x, y, w, h){
  if(!items.length)return;
  const total=items.reduce((a,i)=>a+Math.max(i.value,0),0);
  if(total<=0||w<1||h<1){
    items.forEach((item,i)=>Object.assign(item,{x:x+(i%8)*2,y:y+Math.floor(i/8)*2,w:1,h:1}));
    return;
  }
  const sorted=[...items].sort((a,b)=>b.value-a.value);
  const n=sorted.length;
  const numRows=Math.min(n,Math.max(1,Math.round(Math.sqrt(n))));
  const targetPerRow=total/numRows;
  const rows=[];let curRow=[],curSum=0;
  for(let i=0;i<n;i++){
    curRow.push(sorted[i]);curSum+=sorted[i].value;
    if(curSum>=targetPerRow&&rows.length<numRows-1){rows.push(curRow);curRow=[];curSum=0;}
  }
  if(curRow.length)rows.push(curRow);
  let cx=x,cy=y,cw=w,ch=h;
  for(const row of rows){
    const rowSum=row.reduce((s,i)=>s+i.value,0);
    const ratio=rowSum/total;
    if(cw>=ch){
      const rh=Math.max(1,Math.round(ch*ratio));
      let xp=cx;
      for(const item of row){
        const iw=Math.max(1,Math.round(cw*item.value/rowSum));
        Object.assign(item,{x:xp,y:cy,w:iw,h:rh});xp+=iw;
      }
      cy+=rh;ch-=rh;
    }else{
      const rw=Math.max(1,Math.round(cw*ratio));
      let yp=cy;
      for(const item of row){
        const ih=Math.max(1,Math.round(ch*item.value/rowSum));
        Object.assign(item,{x:cx,y:yp,w:rw,h:ih});yp+=ih;
      }
      cx+=rw;cw-=rw;
    }
  }
}

async function fetchAndRenderOverview(){
  try{
    const r=await fetch('/api/overview');const data=await r.json();
    const opts=state.treeOpts;
    const catColors={indices:'#58a6ff',commodities:'#d29922',forex:'#3fb950',crypto:'#bc8cff',custom:'#f778ba'};
    const catOrder=Object.keys(catColors).filter(c=>data[c]&&data[c].length);

    // Fetch custom symbols
    const customSyms=state.overviewSymbols||[];
    if(customSyms.length){
      data.custom=await Promise.all(customSyms.map(async sym=>{
        try{
          const r=await fetch('/api/price/'+encodeURIComponent(sym));
          if(!r.ok)return null;
          const d=await r.json();
          return d.price!=null?{symbol:sym,name:sym,price:d.price,change:d.change,changePercent:d.changePercent}:null;
        }catch{return null;}
      }));
      data.custom=data.custom.filter(Boolean);
    }

    // Build items
    const activeCats=opts.catFilter&&opts.catFilter.length?opts.catFilter:catOrder;
    const allItems=[];
    catOrder.forEach(cat=>{
      if(!activeCats.includes(cat))return;
      const items=(data[cat]||[]).slice();
      if(opts.maxItems>0)items.sort((a,b)=>Math.abs(b.changePercent||0)-Math.abs(a.changePercent||0)).splice(opts.maxItems);
      items.forEach(i=>{
        const p=i.price||1; const cp=i.changePercent||0;
        allItems.push({
          symbol:i.symbol,name:i.name,price:p,changePct:cp,
          category:cat,          value:opts.size==='equal'?1:(Math.abs(cp*100)+1),
        });
      });
    });

    const container=el.ovSections;
    const cw=container.clientWidth||1200;
    const ch=container.clientHeight||800;

    let groups;
    if(opts.group==='none'){
      groups=[{cat:'all',y:0,h:ch,items:allItems}];
      squarify(allItems,0,0,cw,ch);
    }else{
      groups=[];
      const byCat={};
      allItems.forEach(item=>{
        if(!byCat[item.category])byCat[item.category]=[];
        byCat[item.category].push(item);
      });
      catOrder.forEach(cat=>{
        if(!byCat[cat])return;
        groups.push({cat,items:byCat[cat]});
      });
      if(opts.layout==='squarify'){
        // Nested squarify: first squarify groups, then items within each group
        const groupItems=groups.map(g=>({cat:g.cat,value:g.items.reduce((s,i)=>s+i.value,0),changePct:g.items.reduce((max,i)=>Math.max(max,i.changePct||0),-Infinity),items:g.items}));
        squarify(groupItems,0,0,cw,ch);
        groupItems.forEach(gi=>{
          squarify(gi.items,gi.x,gi.y,gi.w,gi.h);
          // Update group bounds for cat label
          const g=groups.find(g=>g.cat===gi.cat);
          if(g){g.x=gi.x;g.y=gi.y;g.w=gi.w;g.h=gi.h;}
        });
      }else{
        const grandTotal=groups.reduce((s,g)=>s+g.items.reduce((ss,i)=>ss+i.value,0),0);
        let pos=0;
        groups.forEach((g,i)=>{
          const total=g.items.reduce((ss,i)=>ss+i.value,0);
          const isLast=i===groups.length-1;
          if(opts.layout==='horizontal'){
            const gw=isLast?cw-pos:Math.round(cw*total/grandTotal);
            g.x=pos; g.y=0; g.w=Math.max(gw,1); g.h=ch;
            squarify(g.items,pos,0,Math.max(gw,1),ch);
            pos+=gw;
          }else{ // vertical
            const gh=isLast?ch-pos:Math.round(ch*total/grandTotal);
            g.x=0; g.y=pos; g.w=cw; g.h=Math.max(gh,1);
            squarify(g.items,0,pos,cw,Math.max(gh,1));
            pos+=gh;
          }
        });
      }
    }

    // Compute bounding box, scale to fit
    let mx=0,my=0;
    allItems.forEach(i=>{mx=Math.max(mx,i.x+i.w);my=Math.max(my,i.y+i.h);});
    const scale=Math.min(1,cw/mx,ch/my)*0.97;

    let html='<div class="tm-header"><div class="tm-legend">';
    catOrder.forEach(cat=>{
      html+=`<span class="tm-legend-item"><span class="tm-legend-dot" style="background:${catColors[cat]}"></span>${cat.charAt(0).toUpperCase()+cat.slice(1)}</span>`;
    });
    html+='</div><div class="tm-count">'+allItems.length+' instruments</div></div>';
    html+='<div class="tm-container"><div style="position:relative;overflow:visible;width:'+mx+'px;height:'+my+'px;transform-origin:0 0;transform:scale('+scale+')">';

    const activeSym=state.symbol||'';
    groups.forEach(g=>{
      if(g.cat!=='all'&&g.h>20){
        const catColor=catColors[g.cat]||'var(--border)';
        html+=`<div class="tm-cat-label" style="position:absolute;left:${(g.x||0)+4}px;top:${(g.y||0)+4}px;color:${catColor};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;pointer-events:none;z-index:2">${g.cat}</div>`;
      }
      g.items.forEach(item=>{
        const pct=item.changePct; const sn=pct>=0?'+':'';
        const intensity=Math.min(Math.abs(pct)/8,0.9);
        let bg,border;
        if(opts.color==='category'){
          const catColor=catColors[item.category]||'#555';
          bg=catColor; border=catColor;
        }else if(opts.color==='value'){
          const vi=Math.min(item.price/50000,1);
          bg=`rgba(88,166,255,${vi*0.7+0.15})`;
          border='#58a6ff';
        }else{ // change
          bg=pct>=0?`rgba(63,185,80,${intensity*0.85+0.15})`:`rgba(248,81,73,${intensity*0.85+0.15})`;
          border=pct>=0?'var(--green)':'var(--red)';
        }
        const catColor=catColors[item.category]||'var(--border)';
        const isActive=item.symbol===activeSym?' active':'';
        const tw=Math.max(item.w-1,1), th=Math.max(item.h-1,1);
        const symSz=Math.max(7,Math.min(tw/8,th/5,16));
        const chgSz=Math.max(6,Math.min(symSz-2,12));
        const showName=tw>90&&th>22;
        const showPrice=tw>65&&th>32;
        const nameSz=Math.max(6,Math.min(tw/10,11));
        const priceSz=Math.max(6,Math.min(tw/9,10));
        html+=`<div class="tm-tile${isActive}" data-symbol="${escHtml(item.symbol)}" style="position:absolute;left:${item.x}px;top:${item.y}px;width:${tw}px;height:${th}px;background:${bg};border-color:${border};--cat-color:${catColor}"
          onclick="loadStock('${escHtml(item.symbol)}');switchView('stocks')">
          <div class="tm-tile-symbol" style="font-size:${symSz}px">${escHtml(item.symbol)}</div>
          <div class="tm-tile-chg" style="font-size:${chgSz}px">${sn}${fmt(pct)}%</div>
          ${showName?`<div class="tm-tile-name" style="font-size:${nameSz}px">${escHtml(item.name)}</div>`:''}
          ${showPrice?`<div class="tm-tile-price" style="font-size:${priceSz}px">$${fmt(item.price)}</div>`:''}
          <div class="tm-tile-cat" style="font-size:${Math.max(5,Math.min(symSz-3,8))}px;border-color:${catColor}">${item.category}</div>
        </div>`;
      });
    });
    html+='</div></div>';
    container.innerHTML=html;
    // Sync category button states
    const catFilter=state.treeOpts.catFilter;
    document.querySelectorAll('.tm-cat-btn').forEach(b=>b.classList.toggle('active',!catFilter||!catFilter.length||catFilter.includes(b.dataset.cat)));
  }catch{
    el.ovSections.innerHTML='<div style="padding:40px;text-align:center;color:var(--text-muted)">Failed to load market data</div>';
  }
}
function initOverviewPolling(){setInterval(()=>{const a=document.querySelector('.view-tab.active');if(a&&a.dataset.view==='overview')fetchAndRenderOverview();},30000);}

function initOverviewControls(){
  ['treeGroup','treeColor','treeSize','treeLayout'].forEach(id=>{
    const e=document.getElementById(id);
    if(!e)return;
    const k=id.replace('tree','').toLowerCase();
    e.value=state.treeOpts[k]||'category';
    e.addEventListener('change',()=>{
      state.treeOpts[k]=e.value;
      fetchAndRenderOverview();
    });
  });
  // Max items per category (text input)
  const maxInput=document.getElementById('treeMax');
  if(maxInput){
    maxInput.value=String(state.treeOpts.maxItems||0);
    maxInput.addEventListener('change',()=>{
      state.treeOpts.maxItems=parseInt(maxInput.value)||0;
      fetchAndRenderOverview();
    });
  }
  // Category toggle buttons
  const toolbar=document.querySelector('.tm-toolbar');
  toolbar?.addEventListener('click',e=>{
    const btn=e.target.closest('.tm-cat-btn');
    if(!btn)return;
    const cat=btn.dataset.cat;
    let filter=state.treeOpts.catFilter;
    if(!filter||!filter.length)filter=['indices','commodities','forex','crypto'];
    if(filter.includes(cat))filter=filter.filter(c=>c!==cat);
    else filter=[...filter,cat];
    if(filter.length===4)filter=[];
    state.treeOpts.catFilter=filter;
    document.querySelectorAll('.tm-cat-btn').forEach(b=>b.classList.toggle('active',!filter.length||filter.includes(b.dataset.cat)));
    fetchAndRenderOverview();
  });
  // Custom symbols: add
  document.getElementById('ovAddSymBtn')?.addEventListener('click',addOverviewSymbol);
  document.getElementById('ovAddSym')?.addEventListener('keydown',e=>{if(e.key==='Enter')addOverviewSymbol();});
  renderOverviewCustomSyms();
}

function addOverviewSymbol(){
  const inp=document.getElementById('ovAddSym');
  const sym=inp.value.trim().toUpperCase();
  if(!sym){toast('Enter a symbol','error');return;}
  if(state.overviewSymbols.includes(sym)){toast(sym+' already added','error');return;}
  state.overviewSymbols.push(sym);
  inp.value='';
  renderOverviewCustomSyms();
  fetchAndRenderOverview();
  saveUserState();
}

function removeOverviewSymbol(sym){
  state.overviewSymbols=state.overviewSymbols.filter(s=>s!==sym);
  renderOverviewCustomSyms();
  fetchAndRenderOverview();
  saveUserState();
}

function renderOverviewCustomSyms(){
  const c=document.getElementById('ovCustomSyms');
  if(!c)return;
  if(!state.overviewSymbols.length){c.innerHTML='';return;}
  c.innerHTML=state.overviewSymbols.map(sym=>`<span style="font-size:10px;padding:1px 5px;border:1px solid var(--border);border-radius:3px;color:var(--text-muted);display:inline-flex;align-items:center;gap:3px;cursor:default">${sym}<span class="ov-rm-sym" data-sym="${sym}" style="cursor:pointer;color:var(--red);font-weight:700;margin-left:2px">&times;</span></span>`).join('');
  c.querySelectorAll('.ov-rm-sym').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation();removeOverviewSymbol(btn.dataset.sym);});
  });
}

/* ─── TRADING ─── */

async function fetchTradingData(){
  try{
    const r=await fetch('/api/account/portfolio');const d=await r.json();
    const mv=d.holdings.length?d.holdings.reduce((s,h)=>s+h.market_value,0):0;
    el.tvCash.textContent='$'+fmt(d.cash);
    el.tvPortfolio.textContent=mv?'$'+fmt(mv):'$0.00';
    el.tvTotal.textContent='$'+fmt(d.total_value);
    // Metrics
    if(d.holdings.length){
      const totalPnl=d.holdings.reduce((s,h)=>s+(h.pnl||0),0);
      const best=d.holdings.reduce((b,h)=>!b||(h.pnl_pct||0)>b.pnl_pct?h:b);
      const worst=d.holdings.reduce((b,h)=>!b||(h.pnl_pct||0)<b.pnl_pct?h:b);
      const winners=d.holdings.filter(h=>(h.pnl||0)>0);
      const exposure=mv/d.total_value*100;
      el.tvPnL.textContent=(totalPnl>=0?'+':'')+'$'+fmt(totalPnl);el.tvPnL.className='tv-metric-value '+(totalPnl>=0?'pos':'neg');
      el.tvPositions.textContent=d.holdings.length;
      el.tvBest.innerHTML=best.symbol+' <span style="font-size:11px;opacity:0.7">'+(best.pnl_pct>=0?'+':'')+fmt(best.pnl_pct)+'%</span>';el.tvBest.className='tv-metric-value pos';
      el.tvWorst.innerHTML=worst.symbol+' <span style="font-size:11px;opacity:0.7">'+(worst.pnl_pct>=0?'+':'')+fmt(worst.pnl_pct)+'%</span>';el.tvWorst.className='tv-metric-value neg';
      el.tvWinners.textContent=winners.length+'/'+d.holdings.length;
      el.tvExposure.textContent=exposure.toFixed(1)+'%';
    }else{
      el.tvPnL.textContent='$0.00';el.tvPnL.className='tv-metric-value';
      el.tvPositions.textContent='0';
      el.tvBest.textContent='--';el.tvBest.className='tv-metric-value';
      el.tvWorst.textContent='--';el.tvWorst.className='tv-metric-value';
      el.tvWinners.textContent='0/0';
      el.tvExposure.textContent='0%';
    }
    const hc=el.tvHoldings;
    if(d.holdings.length){
      hc.innerHTML='<div class="panel-header" style="border:none;padding:8px 0">Holdings</div>'+d.holdings.map(h=>{
        const cls=(h.pnl||0)>=0?'pos':'neg',sn=(h.pnl||0)>=0?'+':'';
        return`<div class="tv-holding-item"><span><span class="th-symbol">${h.symbol}</span> <span class="th-shares">${h.shares} shares @ $${fmt(h.avg_cost)}</span></span><span class="th-pnl ${cls}">${sn}$${fmt(h.pnl)} (${sn}${fmt(h.pnl_pct)}%)</span></div>`;
      }).join('');
    }else hc.innerHTML='<div class="panel-header" style="border:none;padding:8px 0">Holdings</div><div class="history-empty">No holdings yet</div>';
    const tr=await fetch('/api/account');const acc=await tr.json();const tx=el.tvTxList;
    if(acc.transactions&&acc.transactions.length){
      tx.innerHTML=acc.transactions.slice(0,20).map(t=>`<div class="tv-tx-item"><span><span class="tx-type ${t.type}">${t.type.toUpperCase()}</span> ${t.symbol||''} ${t.shares?'x'+t.shares:''}</span><span>$${fmt(t.total)}</span></div>`).join('');
    }else tx.innerHTML='<div class="history-empty">No transactions yet</div>';
  }catch(e){toast('Failed to load trading data','error');}
}

let _pendingTrade = null;

function showTradeConfirm(action, symbol, shares, price){
  document.getElementById('tcTitle').textContent = 'Confirm ' + action.charAt(0).toUpperCase() + action.slice(1);
  document.getElementById('tcAction').textContent = action.toUpperCase();
  document.getElementById('tcSymbol').textContent = symbol;
  document.getElementById('tcShares').textContent = shares;
  document.getElementById('tcPrice').textContent = '$' + fmt(price);
  const total = price * shares;
  document.getElementById('tcTotal').textContent = '$' + fmt(total);
  const confirmBtn = document.getElementById('tcConfirm');
  confirmBtn.className = 'tc-btn tc-btn-confirm ' + action;
  confirmBtn.textContent = 'Confirm ' + action.charAt(0).toUpperCase() + action.slice(1);
  _pendingTrade = { action, symbol, shares };
  document.getElementById('tradeConfirmOverlay').classList.add('active');
}

function initTrading(){
  document.getElementById('tcCancel').addEventListener('click', ()=>{
    document.getElementById('tradeConfirmOverlay').classList.remove('active');
    _pendingTrade = null;
  });
  document.getElementById('tcConfirm').addEventListener('click', async ()=>{
    if(!_pendingTrade) return;
    const { action, symbol, shares } = _pendingTrade;
    document.getElementById('tradeConfirmOverlay').classList.remove('active');
    _pendingTrade = null;
    try{
      const r = await fetch('/api/account/' + action, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({symbol, shares})
      });
      if(r.ok){
        toast((action==='buy'?'Bought':'Sold') + ' ' + shares + ' ' + symbol, 'success');
        el.tvSymbol.value = ''; el.tvShares.value = '';
        fetchTradingData();
      } else {
        const e = await r.json(); toast(e.error || 'Failed', 'error');
      }
    } catch(e){ toast('Failed', 'error'); }
  });

  el.tvDepositBtn.addEventListener('click',async()=>{
    const amt=parseFloat(el.tvDepositAmt.value);if(!amt||amt<=0){toast('Enter valid amount','error');return;}
    try{const r=await fetch('/api/account/deposit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:amt})});if(r.ok){toast('Deposited $'+fmt(amt),'success');el.tvDepositAmt.value='';fetchTradingData();}else{const e=await r.json();toast(e.error||'Failed','error');}}catch(e){toast('Failed','error');}
  });
  let tvSymST=null;
  el.tvSymbol.addEventListener('input',()=>{
    const sym=el.tvSymbol.value.trim().toUpperCase();
    if(tvSymST)clearTimeout(tvSymST);
    if(!sym){el.tvPriceInfo.textContent='Current Price: --';el.tvSymSuggestions.style.display='none';return;}
    fetch('/api/price/'+sym).then(r=>r.json()).then(d=>{if(d.price)el.tvPriceInfo.textContent='Current Price: $'+fmt(d.price)+' (Change: '+(d.changePercent>=0?'+':'')+fmt(d.changePercent)+'%)';else el.tvPriceInfo.textContent='Price unavailable';}).catch(()=>el.tvPriceInfo.textContent='Price unavailable');
    if(sym.length>=1){
      tvSymST=setTimeout(async()=>{
        try{const r=await fetch('/api/search/'+encodeURIComponent(sym));if(!r.ok)return;const results=await r.json();
          const c=el.tvSymSuggestions;
          if(!results.length){c.style.display='none';return;}
          c.innerHTML=results.map(r=>`<div class="tv-sym-item" data-sym="${r.symbol}" style="padding:4px 8px;font-size:12px;cursor:pointer;border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center">
            <span><strong>${r.symbol}</strong> <span style="color:var(--text-muted);font-size:10px">${escHtml(r.name)}</span></span>
            <span style="font-size:10px;color:var(--text-muted)">${r.type||''}</span>
          </div>`).join('');
          c.style.display='block';
          c.querySelectorAll('.tv-sym-item').forEach(item=>{
            item.addEventListener('click',()=>{
              el.tvSymbol.value=item.dataset.sym;
              c.style.display='none';
              el.tvSymbol.dispatchEvent(new Event('input'));
            });
          });
        }catch(e){}
      },200);
    }
  });
  el.tvSymbol.addEventListener('blur',()=>setTimeout(()=>{el.tvSymSuggestions.style.display='none';},200));
  // Click handlers for suggested stock chips
  document.getElementById('tvSuggestedStocks')?.addEventListener('click',e=>{
    const chip=e.target.closest('.tv-suggest');
    if(!chip)return;
    el.tvSymbol.value=chip.dataset.sym;
    el.tvSymbol.dispatchEvent(new Event('input'));
  });
  el.tvBuyBtn.addEventListener('click',async()=>{
    const sym=el.tvSymbol.value.trim().toUpperCase(),shares=parseFloat(el.tvShares.value);
    if(!sym||!shares||shares<=0){toast('Enter symbol and shares','error');return;}
    try{
      const r=await fetch('/api/price/'+sym);const d=await r.json();
      if(!d.price){toast('Cannot get price','error');return;}
      showTradeConfirm('buy', sym, shares, d.price);
    }catch(e){toast('Failed to get price','error');}
  });
  el.tvSellBtn.addEventListener('click',async()=>{
    const sym=el.tvSymbol.value.trim().toUpperCase(),shares=parseFloat(el.tvShares.value);
    if(!sym||!shares||shares<=0){toast('Enter symbol and shares','error');return;}
    try{
      const r=await fetch('/api/price/'+sym);const d=await r.json();
      if(!d.price){toast('Cannot get price','error');return;}
      showTradeConfirm('sell', sym, shares, d.price);
    }catch(e){toast('Failed to get price','error');}
  });
}

/* ─── ALERTS ─── */

async function fetchAlerts(){
  try{const r=await fetch('/api/alerts');const alerts=await r.json();
    const c=el.alList;
    if(alerts.length){c.innerHTML=alerts.map(a=>{
      const status=a.active?'active':'paused';
      return`<div class="al-item"><div class="ai-info"><span class="ai-symbol">${a.symbol}</span><span class="ai-type">${a.type}</span><span class="ai-threshold">${a.direction} $${fmt(a.threshold)}</span></div><div style="display:flex;align-items:center;gap:6px"><span class="ai-status ${status}">${status}</span><button class="al-del-btn" data-id="${a.id}" title="Delete">x</button></div></div>`;
    }).join('');
      c.querySelectorAll('.al-del-btn').forEach(b=>{b.addEventListener('click',async()=>{
        try{await fetch('/api/alerts/'+b.dataset.id,{method:'DELETE'});toast('Alert deleted','success');fetchAlerts();}catch(e){toast('Failed','error');}
      });});
    }else c.innerHTML='<div class="history-empty">No alerts created yet</div>';
  }catch{el.alList.innerHTML='<div class="history-empty">Failed to load alerts</div>';}
}

function initAlerts(){
  // Dynamic form: change fields when alert type changes
  el.alType.addEventListener('change',function(){
    const isNews=this.value==='news';
    el.alSymbol.placeholder=isNews?'Keyword e.g. Apple, TSLA, AI':'Symbol e.g. AAPL';
    document.querySelectorAll('.al-field').forEach(f=>f.style.display=isNews?'none':'');
  });

  el.alCreateBtn.addEventListener('click',async()=>{
    const type=el.alType.value;
    let symbol=el.alSymbol.value.trim();
    if(type!=='news')symbol=symbol.toUpperCase();
    const threshold=type==='news'?0:parseFloat(el.alThreshold.value);
    const direction=el.alDirection.value;
    if(!symbol){toast('Fill all fields','error');return;}
    if(type!=='news'&&!threshold){toast('Fill all fields','error');return;}
    try{const r=await fetch('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,symbol,threshold,direction})});
      if(r.ok){toast('Alert created for '+symbol,'success');el.alSymbol.value='';el.alThreshold.value='';fetchAlerts();}else{const e=await r.json();toast(e.error||'Failed','error');}
    }catch(e){toast('Failed','error');}
  });
  // Poll alerts (interval read from settings, default 10s)
  async function checkAlertLoop(){
    try{const r=await fetch('/api/alerts/check');const d=await r.json();
      if(d.triggered&&d.triggered.length){const c=el.alTriggeredList;
        d.triggered.forEach(t=>{
          const div=document.createElement('div');div.className='al-triggered-item';
          if(t.type==='news'){
            const articles=(t.articles||[]).map(a=>`<div style="font-size:10px;color:var(--text-muted);padding:2px 0">${escHtml(a.title||'')} <a href="${escHtml(a.link)}" target="_blank" style="color:var(--accent);text-decoration:none">\u2197</a></div>`).join('');
            div.innerHTML=`<div class="at-info"><span class="at-symbol">${escHtml(t.symbol)}</span><span class="at-msg" style="color:var(--accent)">news alert</span></div>${articles}`;
          }else{
            div.innerHTML=`<div class="at-info"><span class="at-symbol">${t.symbol}</span><span class="at-msg">${t.type} alert: $${fmt(t.current_price)}</span></div>`;
          }
          c.prepend(div);
          showAlertNotification(t);
        });
        toast(d.triggered.length+' alert(s) triggered','error');}
    }catch(e){}
    // Schedule next check based on settings
    fetch('/api/settings').then(r=>r.json()).then(s=>{
      const interval=(s.intervals&&s.intervals.alert_check)||10;
      setTimeout(checkAlertLoop,interval*1000);
    }).catch(()=>setTimeout(checkAlertLoop,10000));
  }
  checkAlertLoop();
}

function showAlertNotification(alert){
  const c=document.getElementById('alertNotificationContainer');
  const n=document.createElement('div');n.className='alert-notification';
  let body='';
  if(alert.type==='news'){
    const articles=(alert.articles||[]).slice(0,2);
    body=articles.map(a=>`<div style="font-size:11px;padding:2px 0;line-height:1.3">${escHtml(a.title||'')}</div>`).join('');
  }else{
    body=`<div style="font-size:12px">$${fmt(alert.current_price)}</div>`;
  }
  n.innerHTML=`
    <div class="an-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="3" ry="3"/>
        <line x1="12" y1="8" x2="12" y2="13"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    </div>
    <div class="an-body">
      <div class="an-symbol">${escHtml(alert.symbol)}</div>
      <div class="an-type">${alert.type==='news'?'News Alert':alert.type==='change'?'Change % Alert':'Price Alert'}</div>
      ${body}
    </div>
    <button class="an-close">&times;</button>
  `;
  n.querySelector('.an-close').addEventListener('click',()=>n.remove());
  c.appendChild(n);
  setTimeout(()=>{if(n.parentNode)n.remove();},8000);
}

/* ─── AI CHAT ─── */

let aiSessions = [];
let activeSessionId = null;
let aiWidgetId = 0;

function getActiveSession(){
  return aiSessions.find(s=>s.id===activeSessionId);
}

function createAISession(name){
  const id='ai_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  const session={id,name:name||'Chat '+(aiSessions.length+1),messages:[],widgets:[],created:Date.now()};
  aiSessions.push(session);
  renderAISessions();
  return session;
}

function switchAISession(id){
  const prev=getActiveSession();
  if(prev){
    prev.messages=aiMessageHistory;
    prev.widgets=Array.from(el.aiWidgets.children).map(w=>{
      return {html:w.outerHTML};
    });
  }
  activeSessionId=id;
  const session=getActiveSession();
  if(session){
    aiMessageHistory=session.messages||[];
    // Restore messages
    el.aiMessages.innerHTML='';
    aiMessageHistory.forEach(msg=>{
      if(msg.role!=='system'){
        const d=document.createElement('div');d.className='ai-msg '+msg.role;
        d.innerHTML=`<div class="am-role">${msg.role==='user'?'You':'ZEUS AI'}</div><div class="am-content">${escHtml(msg.content)}</div>`;
        el.aiMessages.appendChild(d);
      }
    });
    // Restore widgets
    el.aiWidgets.innerHTML='';
    (session.widgets||[]).forEach(w=>{
      if(w.html) el.aiWidgets.innerHTML+=w.html;
    });
  }
  renderAISessions();
  saveUserState();
}

function deleteAISession(id){
  if(aiSessions.length<=1){toast('Cannot delete last session','error');return;}
  const idx=aiSessions.findIndex(s=>s.id===id);
  if(idx===-1)return;
  aiSessions.splice(idx,1);
  if(activeSessionId===id){
    activeSessionId=aiSessions[0].id;
    switchAISession(activeSessionId);
  }
  renderAISessions();
  saveUserState();
}

function renderAISessions(){
  const list=el.aiSessionList;
  if(!list)return;
  list.innerHTML=aiSessions.map(s=>{
    const isActive=s.id===activeSessionId;
    const preview=s.messages&&s.messages.length?escHtml((s.messages[s.messages.length-1]?.content||'').slice(0,60)):'Empty';
    return`<div class="ais-item${isActive?' active':''}" data-id="${s.id}">
      <div class="ais-info">
        <div class="ais-name">${escHtml(s.name)}</div>
        <div class="ais-preview">${preview}</div>
      </div>
      <button class="ais-del" data-id="${s.id}" title="Delete">&times;</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.ais-item').forEach(item=>{
    item.addEventListener('click',e=>{
      if(e.target.closest('.ais-del'))return;
      switchAISession(item.dataset.id);
    });
  });
  list.querySelectorAll('.ais-del').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation();deleteAISession(btn.dataset.id);});
  });
}

function initAI(){
  // Create default session if none
  if(!aiSessions.length){
    const s=createAISession('Chat 1');
    activeSessionId=s.id;
  }
  renderAISessions();
  // Load any persisted messages/widgets for active session
  const session=getActiveSession();
  if(session){
    aiMessageHistory=session.messages||[];
    el.aiMessages.innerHTML='';
    aiMessageHistory.forEach(msg=>{
      if(msg.role!=='system'){
        const d=document.createElement('div');d.className='ai-msg '+msg.role;
        d.innerHTML=`<div class="am-role">${msg.role==='user'?'You':'ZEUS AI'}</div><div class="am-content">${escHtml(msg.content)}</div>`;
        el.aiMessages.appendChild(d);
      }
    });
    el.aiWidgets.innerHTML='';
    (session.widgets||[]).forEach(w=>{
      if(w.html) el.aiWidgets.innerHTML+=w.html;
    });
  }
  el.aiSendBtn.addEventListener('click',sendAIMessage);
  el.aiInputField.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendAIMessage();}});
  el.aiNewSessionBtn.addEventListener('click',()=>{
    const s=createAISession();
    switchAISession(s.id);
  });
}

async function sendAIMessage(){
  const text=el.aiInputField.value.trim();
  if(!text||state.aiStreaming){if(state.aiStreaming){state.aiQueue.push(text);el.aiInputField.value='';}return;}
  el.aiInputField.value='';
  addAIMessage('user',text);
  aiMessageHistory.push({role:'user',content:text});
  state.aiStreaming=true;
  el.aiSendBtn.disabled=true;
  el.aiStatus.style.display='flex';
  el.aiStatusText.textContent='Thinking...';
  el.aiStatusDetail.textContent='';

  let assistantContent='';
  try{
    const resp=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:aiMessageHistory.slice(-20)})});
    const reader=resp.body.getReader();const decoder=new TextDecoder();
    let buffer='';
    while(true){const {done,value}=await reader.read();if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      const lines=buffer.split('\n');buffer=lines.pop()||'';
      for(const line of lines){
        if(!line.startsWith('data: '))continue;
        try{const data=JSON.parse(line.slice(6));
          if(data.type==='token'){assistantContent+=data.content;updateAIMessage(assistantContent);}
          else if(data.type==='error'){addAIMessage('assistant','Error: '+data.content);aiMessageHistory.push({role:'assistant',content:'Error: '+data.content});toast('AI Error: '+data.content,'error');break;}
          else if(data.type==='tool_start'){
            el.aiStatusText.textContent='Using: '+data.name;
            el.aiStatusDetail.textContent=JSON.stringify(data.args||{}).slice(0,200);
          }
          else if(data.type==='tool_result'){
            el.aiStatusText.textContent='Got result from '+data.name;
            el.aiStatusDetail.textContent=(data.content||'').slice(0,200);
          }
          else if(data.type==='widget'){
            addAIWidget(data.content);
          }
          else if(data.type==='done'){
            if(assistantContent){addAIMessage('assistant',assistantContent);aiMessageHistory.push({role:'assistant',content:assistantContent});}
          }
        }catch(e){}
      }
    }
    if(assistantContent&&!document.querySelector('.ai-msg.assistant:last-child')){addAIMessage('assistant',assistantContent);aiMessageHistory.push({role:'assistant',content:assistantContent});}
  }catch(e){toast('AI chat error: '+e.message,'error');}
  finally{
    state.aiStreaming=false;
    el.aiSendBtn.disabled=false;
    el.aiStatus.style.display='none';
    const session=getActiveSession();
    if(session){session.messages=aiMessageHistory;saveUserState();}
    if(state.aiQueue.length){const nextText=state.aiQueue.shift();el.aiInputField.value=nextText;sendAIMessage();}
  }
}

function addAIMessage(role,content){
  const c=el.aiMessages;const d=document.createElement('div');d.className='ai-msg '+role;
  d.innerHTML=`<div class="am-role">${role==='user'?'You':'ZEUS AI'}</div><div class="am-content">${escHtml(content)}</div>`;
  c.appendChild(d);c.scrollTop=c.scrollHeight;
}

function updateAIMessage(content){
  let msg=el.aiMessages.querySelector('.ai-msg.assistant:last-child');
  if(!msg){msg=document.createElement('div');msg.className='ai-msg assistant';msg.innerHTML='<div class="am-role">ZEUS AI</div><div class="am-content"></div>';el.aiMessages.appendChild(msg);}
  msg.querySelector('.am-content').textContent=content;
  el.aiMessages.scrollTop=el.aiMessages.scrollHeight;
}

function addAIWidget(data){
  if(!data||!data.title)return;
  aiWidgetId++;
  const w=document.createElement('div');w.className='ai-widget';
  w.innerHTML=`<div class="ai-widget-title">${escHtml(data.title)}</div><div class="ai-widget-content">${data.type==='chart'?renderAIChart(data.data):data.type==='table'?renderAITable(data.data):escHtml(JSON.stringify(data.data,null,2))}</div>`;
  el.aiWidgets.appendChild(w);
  const session=getActiveSession();
  if(session){
    if(!session.widgets)session.widgets=[];
    session.widgets.push({html:w.outerHTML});
    saveUserState();
  }
}

function renderAIChart(data){
  if(!data||!data.labels||!data.values)return '<div>Invalid chart data</div>';
  const canvas=document.createElement('canvas');canvas.style.width='100%';canvas.style.height='200px';
  // Simple canvas bar chart
  setTimeout(()=>{
    const ctx=canvas.getContext('2d');const w=canvas.offsetWidth||400,h=200;
    canvas.width=w;canvas.height=h;
    ctx.fillStyle='#161b22';ctx.fillRect(0,0,w,h);
    const max=Math.max(...data.values,1);const barW=Math.max(2,(w-40)/data.values.length-2);
    data.values.forEach((v,i)=>{
      const barH=(v/max)*(h-40);const x=20+i*(barW+2);const y=h-20-barH;
      ctx.fillStyle='#e3b341';ctx.fillRect(x,y,barW,barH);
      ctx.fillStyle='#8b949e';ctx.font='9px Inter';ctx.textAlign='center';
      if(i%Math.max(1,Math.floor(data.values.length/20))===0){ctx.fillText(data.labels[i],x+barW/2,h-6);}
    });
  },50);
  return canvas.outerHTML;
}

function renderAITable(data){
  if(!data||!data.rows||!data.columns)return '<div>Invalid table data</div>';
  let html='<table style="width:100%;border-collapse:collapse;font-size:11px">';
  html+='<tr>'+data.columns.map(c=>`<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:600">${escHtml(c)}</th>`).join('')+'</tr>';
  data.rows.forEach(row=>{html+='<tr>'+row.map(c=>`<td style="padding:4px 6px;border-bottom:1px solid var(--border-light)">${escHtml(String(c))}</td>`).join('')+'</tr>';});
  html+='</table>';return html;
}

/* ─── SETTINGS ─── */

async function initSettings(){
  try{
    const r=await fetch('/api/settings');const s=await r.json();
    // Colors
    const themeColors=[
      {key:'accent',label:'Accent'},{key:'green',label:'Green'},{key:'red',label:'Red'},
      {key:'bg',label:'Background'},{key:'bg_elevated',label:'Elevated BG'},{key:'bg_card',label:'Card BG'},
      {key:'text_primary',label:'Primary Text'},{key:'text_secondary',label:'Secondary Text'},{key:'border',label:'Border'},
    ];
    el.stColors.innerHTML=themeColors.map(t=>{
      const v=s.theme[t.key]||'#000000';
      return`<div class="st-color-row"><span class="st-color-label">${t.label}</span><input type="color" class="st-color-picker" data-key="${t.key}" value="${v}"><input type="text" class="st-color-hex" data-key="${t.key}" value="${v}"></div>`;
    }).join('');
    el.stColors.querySelectorAll('.st-color-picker').forEach(p=>{p.addEventListener('input',()=>{const h=p.nextElementSibling;h.value=p.value;applyColor(p.dataset.key,p.value);autoSaveSettings();});});
    el.stColors.querySelectorAll('.st-color-hex').forEach(h=>{h.addEventListener('input',()=>{const p=h.previousElementSibling;p.value=h.value;applyColor(h.dataset.key,h.value);autoSaveSettings();});});

    // Intervals
    const intervalKeys=[
      {key:'price_poll',label:'Price Polling'},{key:'news_poll',label:'News Polling'},
      {key:'movers_poll',label:'Movers Polling'},{key:'overview_poll',label:'Overview Polling'},
      {key:'alert_check',label:'Alert Check'},
    ];
    el.stIntervals.innerHTML=intervalKeys.map(t=>{
      const v=s.intervals[t.key]||30;
      return`<div class="st-interval-row"><span class="st-interval-label">${t.label}</span><input type="range" class="st-interval-slider" data-key="${t.key}" min="5" max="300" value="${v}"><span class="st-interval-value" data-key="${t.key}">${v}s</span></div>`;
    }).join('');
    el.stIntervals.querySelectorAll('.st-interval-slider').forEach(sl=>{sl.addEventListener('input',()=>{const v=sl.parentElement.querySelector('.st-interval-value');v.textContent=sl.value+'s';autoSaveSettings();});});

    // AI Provider - dynamic form
    const ai=s.ai||{};
    const provRes=await fetch('/api/ai/providers');
    const providers=await provRes.json();
    renderAISettings(ai, providers);
  }catch{el.stColors.innerHTML='<div class="history-empty">Failed to load settings</div>';}
}

let _aiProviders=[];

function getProviderCfg(id){
  return _aiProviders.find(p=>p.id===id)||_aiProviders[1]||{};
}

function renderAISettings(ai,providers){
  _aiProviders=providers;
  const pid=ai.provider||'openrouter';
  const cfg=getProviderCfg(pid);
  const selectedModel=ai.model||cfg.default_model||'';
  const baseURL=ai.base_url||cfg.base_url||'';
  const apiKey=ai.api_key||'';

  const modelOpts=(cfg.models||[]).map(m=>`<option value="${escHtml(m.id)}"${selectedModel===m.id?' selected':''}>${escHtml(m.name)}</option>`).join('');

  el.stAI.innerHTML=`
    <div class="st-ai-row"><span class="st-ai-label">Provider</span><select id="stAIProvider">${providers.map(p=>`<option value="${p.id}"${pid===p.id?' selected':''}>${escHtml(p.name)}</option>`).join('')}</select></div>
    <div class="st-ai-row" id="stAIModelRow"><span class="st-ai-label">Model</span><select id="stAIModel">${modelOpts}</select></div>
    <div class="st-ai-row" id="stAIBaseRow"><span class="st-ai-label">Base URL</span><input type="text" id="stAIBaseURL" value="${escHtml(baseURL)}"></div>
    <div class="st-ai-row" id="stAIKeyRow"${cfg.needs_api_key===false?' style="display:none"':''}><span class="st-ai-label">API Key</span><input type="password" id="stAIKey" value="${escHtml(apiKey)}" placeholder="sk-..."></div>
    <div class="st-ai-row"><span class="st-ai-label">Max Tokens</span><input type="number" id="stAIMaxTokens" value="${ai.max_tokens||4096}" min="256" max="32000"></div>
    <div class="st-ai-row"><span class="st-ai-label">Temperature</span><input type="number" id="stAITemp" value="${ai.temperature||0.7}" min="0" max="2" step="0.1"></div>
    <div class="st-ai-row" id="stAIMultiRow"${cfg.supports_multimodal===false?' style="display:none"':''}><span class="st-ai-label">Multimodal</span><input type="checkbox" id="stAIMulti" ${ai.multimodal?'checked':''}></div>
  `;

  document.getElementById('stAIProvider').addEventListener('change',function(){
    const newCfg=getProviderCfg(this.value);
    const modelSel=document.getElementById('stAIModel');
    const urlInp=document.getElementById('stAIBaseURL');
    modelSel.innerHTML=(newCfg.models||[]).map(m=>`<option value="${escHtml(m.id)}">${escHtml(m.name)}</option>`).join('');
    if(newCfg.default_model) modelSel.value=newCfg.default_model;
    if(newCfg.base_url) urlInp.value=newCfg.base_url;
    document.getElementById('stAIKeyRow').style.display=newCfg.needs_api_key===false?'none':'';
    document.getElementById('stAIMultiRow').style.display=newCfg.supports_multimodal===false?'none':'';
    autoSaveSettings();
  });

  document.querySelectorAll('#stAIProvider,#stAIModel,#stAIBaseURL,#stAIKey,#stAIMaxTokens,#stAITemp,#stAIMulti').forEach(f=>f.addEventListener('change',autoSaveSettings));
}

let _settingsTimer=null;
function autoSaveSettings(){
  if(_settingsTimer)clearTimeout(_settingsTimer);
  _settingsTimer=setTimeout(()=>{
    const ns={theme:{},intervals:{},ai:{}};
    el.stColors.querySelectorAll('.st-color-hex').forEach(h=>{ns.theme[h.dataset.key]=h.value;});
    el.stIntervals.querySelectorAll('.st-interval-slider').forEach(sl=>{ns.intervals[sl.dataset.key]=parseInt(sl.value);});
    const prov=document.getElementById('stAIProvider')?.value||'openrouter';
    const cfg=getProviderCfg(prov);
    ns.ai={
      provider:prov,
      model:document.getElementById('stAIModel')?.value||cfg.default_model||'',
      base_url:document.getElementById('stAIBaseURL')?.value||cfg.base_url||'',
      api_key:document.getElementById('stAIKey')?.value||'',
      max_tokens:parseInt(document.getElementById('stAIMaxTokens')?.value)||4096,
      temperature:parseFloat(document.getElementById('stAITemp')?.value)||0.7,
      multimodal:document.getElementById('stAIMulti')?.checked||false,
    };
    applyTheme(ns.theme);
    fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(ns)}).catch(()=>{});
  },200);
}

function applyColor(key,val){
  const cssMap={
    'accent':'--accent','green':'--green','red':'--red','bg':'--bg-base',
    'bg_elevated':'--bg-elevated','bg_card':'--bg-card',
    'text_primary':'--text-primary','text_secondary':'--text-secondary','border':'--border',
  };
  const prop=cssMap[key];if(!prop)return;
  document.documentElement.style.setProperty(prop,val);
  if(key==='accent'){document.documentElement.style.setProperty('--accent-hover',val);}
}

function applyTheme(theme){
  Object.entries(theme).forEach(([k,v])=>applyColor(k,v));
}

/* ─── AUTO-SAVE USER STATE ─── */

function saveUserState(){
  const syms=[];document.querySelectorAll('.watch-item').forEach(w=>syms.push(w.dataset.symbol));
  const tab=document.querySelector('.view-tab.active');
  const indicators=[];state.activeIndicators.forEach(i=>indicators.push(i));
  // Save active session's current messages
  const session=getActiveSession();
  if(session){session.messages=aiMessageHistory;}
  fetch('/api/userstate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    watchlist:syms,history:viewedHistory.slice(0,50),activeTab:tab?tab.dataset.view:'stocks',
    lastSymbol:state.symbol,lastRange:state.range,indicators,
    aiChatHistory:aiMessageHistory.slice(-50),aiSessions,overviewSymbols:state.overviewSymbols,
  })}).catch(()=>{});
}
let _saveTimer=null;
function autoSaveUserState(){if(_saveTimer)clearTimeout(_saveTimer);_saveTimer=setTimeout(saveUserState,100);}

async function loadUserState(){
  try{
    const r=await fetch('/api/userstate');const s=await r.json();
    // Watchlist
    const wc=el.watchlistPanel;wc.innerHTML='';
    (s.watchlist||[]).forEach(sym=>{
      const d=document.createElement('div');d.className='watch-item';d.dataset.symbol=sym;
      d.innerHTML=`<span class="watch-symbol">${sym}</span><span class="watch-name"></span><span class="watch-price">--</span><span class="watch-dayrange"></span><span class="watch-change">--</span><span class="watch-vol"></span><span class="watch-del" title="Remove">×</span>`;
      d.querySelector('.watch-del').addEventListener('click',e=>{e.stopPropagation();removeWatchlistItem(sym);});
      d.addEventListener('click',()=>loadStock(sym));
      wc.appendChild(d);
    });
    // History
    viewedHistory.length=0;(s.history||[]).forEach(h=>viewedHistory.push(h));renderHistory();
    // Active tab
    const tabs=document.querySelectorAll('.view-tab');let found=false;
    tabs.forEach(t=>{if(t.dataset.view===s.activeTab){tabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');found=true;}});
    // Last symbol/range
    if(s.lastSymbol)state.symbol=s.lastSymbol;
    if(s.lastRange){state.range=s.lastRange;state.interval=DEFAULT_INTERVAL[s.lastRange];}
    // Indicators
    if(s.indicators){s.indicators.forEach(i=>state.activeIndicators.add(i));document.querySelectorAll('.chip[data-indicator]').forEach(c=>c.classList.toggle('active',state.activeIndicators.has(c.dataset.indicator)));}
    // Chat history
    if(s.aiChatHistory){aiMessageHistory=s.aiChatHistory.slice(-50);const w=document.getElementById('aiMessages');if(w&&aiMessageHistory.length){aiMessageHistory.forEach(msg=>{if(msg.role!=='system')addAIMessage(msg.role,msg.content);});}}
    // Sessions
    if(s.aiSessions&&s.aiSessions.length){
      aiSessions=s.aiSessions;
      // Restore active session messages/widgets
      const active=aiSessions.find(ss=>ss.id===activeSessionId);
      if(active){aiMessageHistory=active.messages||[];}
    }
    // Custom overview symbols
    if(s.overviewSymbols) state.overviewSymbols=s.overviewSymbols;
  }catch(e){}
  // Apply initial active class to watchlist
  document.querySelectorAll('.watch-item').forEach(w=>w.classList.toggle('active',w.dataset.symbol===state.symbol));
  // Fetch prices for watchlist and history
  if(document.querySelectorAll('.watch-item').length) fetchWatchlistPrices();
  if(viewedHistory.length) fetchHistoryPrices();
}

/* ─── INIT ─── */

document.addEventListener('DOMContentLoaded',async()=>{
  cacheEls();
  initCharts();
  initResizeHandles();
  initSearch();
  initTimeRanges();
  initIndicatorChips();
  initWatchlist();
  initHistoryPanel();
  initIntervalPills();
  initViewTabs();
  initPolling();
  initNewsPolling();
  initOverviewPolling();
  initOverviewControls();
  initMapSearch();
  initTrading();
  initAlerts();
  initAI();
  await loadUserState();
  renderOverviewCustomSyms();
  fetchAndRenderOverview();
  renderIntervalPills(state.range);
  loadStock(state.symbol,state.range);

  let resizeTimer;
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(resizeCharts,100);});
  new ResizeObserver(resizeCharts).observe(el.chartContainer);
  new ResizeObserver(()=>{if(state.volumeChart){const h=el.subChartContainer.clientHeight;state.volumeChart.resize(el.subChartContainer.clientWidth,h);}}).observe(el.subChartContainer);
});
