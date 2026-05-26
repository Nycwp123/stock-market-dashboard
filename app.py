import os, time, re, html, json, uuid, threading
from urllib.parse import quote
import requests
from xml.etree import ElementTree
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import pandas as pd
import numpy as np

load_dotenv()

app = Flask(__name__, static_folder='public', static_url_path='')
CORS(app)

YH = 'https://query1.finance.yahoo.com'
HEADERS = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
os.makedirs(DATA_DIR, exist_ok=True)
SETTINGS_FILE = os.path.join(DATA_DIR, 'settings.json')
ACCOUNT_FILE = os.path.join(DATA_DIR, 'account.json')
ALERTS_FILE = os.path.join(DATA_DIR, 'alerts.json')
USERSTATE_FILE = os.path.join(DATA_DIR, 'userstate.json')

def get_userstate():
    try:
        with open(USERSTATE_FILE) as f: return json.load(f)
    except: return {'watchlist': ['AAPL','MSFT','TSLA','NVDA'], 'history': [], 'activeTab': 'stocks', 'lastSymbol': 'AAPL', 'lastRange': '1mo'}

def save_userstate(data):
    with open(USERSTATE_FILE, 'w') as f: json.dump(data, f)

DEFAULT_SETTINGS = {
    'theme': {
        'accent': '#e3b341',
        'green': '#3fb950',
        'red': '#f85149',
        'bg': '#0d1117',
        'bg_elevated': '#151b23',
        'bg_card': '#161b22',
        'text_primary': '#e6edf3',
        'text_secondary': '#8b949e',
        'border': '#30363d',
    },
    'intervals': {
        'price_poll': 30,
        'news_poll': 60,
        'movers_poll': 30,
        'overview_poll': 60,
        'alert_check': 10,
    },
    'ai': {
        'provider': 'openrouter',
        'model': 'openai/gpt-4o',
        'base_url': 'https://openrouter.ai/api/v1',
        'api_key': '',
        'max_tokens': 4096,
        'temperature': 0.7,
        'multimodal': False,
    },
}

_cache = {}
_cache_ttl = 15

def _cached(key, ttl=None):
    ttl = ttl or _cache_ttl
    def decorator(fn):
        def wrapper(*args, **kwargs):
            k = f'{key}:{args}:{kwargs}'
            now = time.time()
            if k in _cache and now - _cache[k]['ts'] < ttl:
                return _cache[k]['data']
            result = fn(*args, **kwargs)
            _cache[k] = {'data': result, 'ts': now}
            return result
        return wrapper
    return decorator

def get_settings():
    try:
        with open(SETTINGS_FILE) as f:
            s = json.load(f)
            # merge with defaults for any missing keys
            for k, v in DEFAULT_SETTINGS.items():
                if k not in s:
                    s[k] = v
                elif isinstance(v, dict):
                    for k2, v2 in v.items():
                        if k2 not in s[k]:
                            s[k][k2] = v2
            return s
    except: return dict(DEFAULT_SETTINGS)

def save_settings(s):
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(s, f, indent=2)

def get_alerts():
    try:
        with open(ALERTS_FILE) as f: return json.load(f)
    except: return []

def save_alerts(alerts):
    with open(ALERTS_FILE, 'w') as f:
        json.dump(alerts, f, indent=2)

def get_account():
    try:
        with open(ACCOUNT_FILE) as f: return json.load(f)
    except:
        acc = {'cash': 100000.0, 'holdings': {}, 'transactions': []}
        save_account(acc)
        return acc

def save_account(acc):
    with open(ACCOUNT_FILE, 'w') as f:
        json.dump(acc, f, indent=2)

def _v(val):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    return round(float(val), 2)

def _sma(series, window):
    return series.rolling(window=window).mean()

def _ema(series, window):
    return series.ewm(span=window, adjust=False).mean()

def _rsi(series, window=14):
    delta = series.diff()
    gain = delta.where(delta > 0, 0).rolling(window=window).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=window).mean()
    rs = gain / loss
    return 100 - (100 / (1 + rs.replace(0, np.nan)))

def _bollinger(series, window=20, std_dev=2):
    ma = series.rolling(window=window).mean()
    sd = series.rolling(window=window).std()
    return ma + sd * std_dev, ma, ma - sd * std_dev

def _fib_levels(high, low):
    diff = high - low
    return {
        'level_0':   round(high, 2),
        'level_236': round(high - diff * 0.236, 2),
        'level_382': round(high - diff * 0.382, 2),
        'level_50':  round(high - diff * 0.5, 2),
        'level_618': round(high - diff * 0.618, 2),
        'level_786': round(high - diff * 0.786, 2),
        'level_100': round(low, 2),
    }

@_cached('stock_data', ttl=15)
def fetch_stock_data(symbol, range_='1mo', interval='1d'):
    chart_url = f'{YH}/v8/finance/chart/{symbol}?interval={interval}&range={range_}'
    resp = requests.get(chart_url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    result = data['chart']['result'][0]
    timestamps = result.get('timestamp', [])
    quotes = result['indicators']['quote'][0]
    adjclose = result['indicators'].get('adjclose', [{}])[0].get('adjclose', [])

    rows = []
    for i, ts in enumerate(timestamps):
        o = quotes['open'][i]; h = quotes['high'][i]
        l = quotes['low'][i]; c = quotes['close'][i]; v = quotes['volume'][i]
        if c is None: continue
        adj = adjclose[i] if i < len(adjclose) and adjclose[i] is not None else c
        rows.append({'time': ts, 'open': round(o, 2) if o else 0,
                     'high': round(h, 2) if h else 0, 'low': round(l, 2) if l else 0,
                     'close': round(c, 2), 'volume': int(v) if v else 0})

    if not rows: raise ValueError(f'No data for {symbol}')

    df = pd.DataFrame(rows)
    df['SMA20'] = _sma(df['close'], 20)
    df['SMA50'] = _sma(df['close'], 50)
    df['SMA200'] = _sma(df['close'], 200)
    df['EMA9'] = _ema(df['close'], 9)
    df['EMA12'] = _ema(df['close'], 12)
    df['EMA21'] = _ema(df['close'], 21)
    df['EMA26'] = _ema(df['close'], 26)
    df['RSI'] = _rsi(df['close'])
    df['BB_UPPER'], df['BB_MID'], df['BB_LOWER'] = _bollinger(df['close'])
    df['MACD'] = df['EMA12'] - df['EMA26']
    df['MACD_SIGNAL'] = _ema(df['MACD'], 9)
    df['MACD_HIST'] = df['MACD'] - df['MACD_SIGNAL']

    records = []
    for _, row in df.iterrows():
        records.append({
            'time': int(row['time']), 'open': _v(row['open']), 'high': _v(row['high']),
            'low': _v(row['low']), 'close': _v(row['close']), 'volume': int(row['volume']),
            'sma20': _v(row['SMA20']), 'sma50': _v(row['SMA50']), 'sma200': _v(row['SMA200']),
            'ema9': _v(row['EMA9']), 'ema12': _v(row['EMA12']), 'ema21': _v(row['EMA21']),
            'ema26': _v(row['EMA26']), 'rsi': _v(row['RSI']),
            'bb_upper': _v(row['BB_UPPER']), 'bb_mid': _v(row['BB_MID']), 'bb_lower': _v(row['BB_LOWER']),
            'macd': _v(row['MACD']), 'macd_signal': _v(row['MACD_SIGNAL']), 'macd_hist': _v(row['MACD_HIST']),
        })

    period_high = float(df['high'].max()); period_low  = float(df['low'].min())
    meta = result.get('meta', {})
    chart_prev_close = meta.get('chartPreviousClose') or meta.get('previousClose')
    last_close = records[-1]['close'] if records else None
    change_val = round(last_close - chart_prev_close, 2) if (last_close and chart_prev_close) else None
    change_pct = round((change_val / chart_prev_close) * 100, 2) if (change_val and chart_prev_close) else None

    quote = {
        'symbol': meta.get('symbol', symbol.upper()), 'longName': '', 'shortName': meta.get('symbol', ''),
        'currentPrice': meta.get('regularMarketPrice') or last_close, 'previousClose': chart_prev_close,
        'change': change_val or meta.get('regularMarketChange'),
        'changePercent': change_pct or meta.get('regularMarketChangePercent'),
        'dayHigh': meta.get('regularMarketDayHigh') or meta.get('dayHigh'),
        'dayLow': meta.get('regularMarketDayLow') or meta.get('dayLow'),
        'volume': meta.get('regularMarketVolume') or meta.get('volume'),
        'marketCap': None, 'fiftyTwoWeekHigh': None, 'fiftyTwoWeekLow': None,
        'exchange': meta.get('exchangeName', ''), 'currency': meta.get('currency', 'USD'),
    }
    try:
        extra = fetch_quote(symbol)
        if extra: quote.update({k: v for k, v in extra.items() if v is not None})
    except: pass

    return {
        'history': records, 'fib_levels': _fib_levels(period_high, period_low), 'quote': quote,
        'meta': {'symbol': symbol.upper(), 'range': range_, 'interval': interval,
                 'period_high': round(period_high, 2), 'period_low': round(period_low, 2)},
    }

@_cached('stock_quote', ttl=10)
def fetch_quote(symbol):
    url = f'{YH}/v10/finance/quoteSummary/{symbol}?modules=price,summaryDetail'
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status(); d = resp.json()
        r = d['quoteSummary']['result'][0]; price = r.get('price', {}); sd = r.get('summaryDetail', {})
        return {
            'symbol': price.get('symbol', symbol.upper()),
            'longName': (price.get('longName') or price.get('shortName') or ''),
            'shortName': price.get('shortName', ''),
            'currentPrice': _g(price, 'regularMarketPrice'),
            'previousClose': _g(sd, 'previousClose') or _g(price, 'regularMarketPreviousClose'),
            'change': _g(price, 'regularMarketChange'), 'changePercent': _g(price, 'regularMarketChangePercent'),
            'dayHigh': _g(sd, 'dayHigh') or _g(price, 'regularMarketDayHigh'),
            'dayLow': _g(sd, 'dayLow') or _g(price, 'regularMarketDayLow'),
            'volume': _g(sd, 'volume') or _g(price, 'regularMarketVolume'),
            'marketCap': _g(sd, 'marketCap'), 'fiftyTwoWeekHigh': _g(sd, 'fiftyTwoWeekHigh'),
            'fiftyTwoWeekLow': _g(sd, 'fiftyTwoWeekLow'),
            'exchange': price.get('exchange', ''), 'currency': price.get('currency', 'USD'),
        }
    except: return {'symbol': symbol.upper(), 'currentPrice': None}

def _g(obj, key):
    try:
        v = obj.get(key)
        if v is None: return None
        if isinstance(v, dict): return v.get('raw') or v.get('fmt')
        return v
    except: return None

def _fetch_current_price(symbol):
    try:
        url = f'{YH}/v8/finance/chart/{symbol}?interval=1d&range=5d'
        r = requests.get(url, headers=HEADERS, timeout=10)
        if r.status_code != 200: return None
        m = r.json()['chart']['result'][0]['meta']
        price = m.get('regularMarketPrice') or m.get('chartPreviousClose')
        prev = m.get('chartPreviousClose') or m.get('regularMarketPreviousClose')
        chg = round(price - prev, 2) if (price and prev) else None
        chg_pct = round((chg / prev) * 100, 2) if (chg and prev) else None
        return {
            'symbol': symbol, 'price': price, 'prev': prev,
            'change': chg, 'changePercent': chg_pct,
        }
    except: return None

# ─── Routes ──────────────────────────────────────────────

@app.route('/')
def index():
    return app.send_static_file('index.html')

# ─── Stock Data ──────────────────────────────────────────

@app.route('/api/stock/<symbol>')
def stock_data(symbol):
    try:
        rng = request.args.get('range', '1mo')
        interval = request.args.get('interval', '1d')
        if rng == 'max':
            if interval == '1d': range_val = '10y'
            elif interval == '1wk': range_val = '15y'
            else: range_val = 'max'
        elif rng == '1mo': range_val = '3mo'
        else: range_val = rng
        data = fetch_stock_data(symbol.upper(), range_val, interval)
        return jsonify(data)
    except ValueError as e: return jsonify({'error': str(e)}), 404
    except Exception as e: return jsonify({'error': str(e)}), 500

@app.route('/api/price/<symbol>')
def current_price(symbol):
    try:
        p = _fetch_current_price(symbol.upper())
        if not p: return jsonify({'error': 'No price'}), 404
        chg = round(p['price'] - p['prev'], 2) if (p['price'] and p['prev']) else None
        chg_pct = round((chg / p['prev']) * 100, 2) if (chg and p['prev']) else None
        return jsonify({'symbol': symbol.upper(), 'price': p['price'],
                        'change': chg, 'changePercent': chg_pct})
    except Exception as e: return jsonify({'error': str(e)}), 500

@app.route('/api/price/stream/<symbol>')
def price_stream(symbol):
    def generate():
        try:
            while True:
                try:
                    p = _fetch_current_price(symbol.upper())
                    if p and p['price']:
                        chg = round(p['price'] - p['prev'], 2) if (p['price'] and p['prev']) else None
                        chg_pct = round((chg / p['prev']) * 100, 2) if (chg and p['prev']) else None
                        yield f"data: {json.dumps({'symbol': symbol.upper(), 'price': p['price'], 'prev': p['prev'], 'change': chg, 'changePercent': chg_pct})}\n\n"
                except: pass
                time.sleep(2)
        except GeneratorExit:
            pass
    return Response(stream_with_context(generate()), mimetype='text/event-stream')

@app.route('/api/search/<query>')
def search_symbols(query):
    try:
        url = f'{YH}/v1/finance/search?q={query}'
        resp = requests.get(url, headers=HEADERS, timeout=10); data = resp.json()
        results = []
        for item in data.get('quotes', []):
            qtype = item.get('quoteType', '')
            if qtype in ('EQUITY', 'ETF', 'INDEX', 'CRYPTOCURRENCY', 'MUTUALFUND'):
                results.append({'symbol': item['symbol'],
                    'name': item.get('longname') or item.get('shortname', ''),
                    'exchange': item.get('exchange', ''), 'type': qtype})
        return jsonify(results[:15])
    except Exception as e: return jsonify({'error': str(e)}), 500

# ─── News ────────────────────────────────────────────────

@app.route('/api/news/<symbol>')
def stock_news(symbol):
    try:
        url = f'https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol.upper()}&region=US&lang=en-US'
        resp = requests.get(url, headers=HEADERS, timeout=10); resp.raise_for_status()
        root = ElementTree.fromstring(resp.content); items = []
        for item in root.findall('.//item'):
            title = item.findtext('title', ''); link = item.findtext('link', '')
            pub = item.findtext('pubDate', ''); desc = item.findtext('description', '')
            ts = 0
            if pub:
                try: ts = int(parsedate_to_datetime(pub).timestamp())
                except: pass
            items.append({'title': title, 'link': link, 'providerPublishTime': ts,
                          'description': _strip_html(desc)[:300], 'image': _extract_rss_image(item, desc)})
        return jsonify(items[:12])
    except: return jsonify([])

@app.route('/api/news/batch', methods=['POST'])
def batch_news():
    try:
        symbols = request.json.get('symbols', MAJOR_SYMBOLS[:10])
        all_items = []; seen_urls = set()
        def fetch_one(sym):
            items = []
            try:
                url = f'https://feeds.finance.yahoo.com/rss/2.0/headline?s={sym}&region=US&lang=en-US'
                r = requests.get(url, headers=HEADERS, timeout=10)
                if r.status_code == 200:
                    root = ElementTree.fromstring(r.content)
                    for item in root.findall('.//item'):
                        t = item.findtext('title', ''); l = item.findtext('link', '')
                        p = item.findtext('pubDate', ''); d = item.findtext('description', '')
                        ts = 0
                        if p:
                            try: ts = int(parsedate_to_datetime(p).timestamp())
                            except: pass
                        items.append({'title': t, 'link': l, 'ts': ts, 'source': 'Yahoo Finance',
                                      'symbol': sym, 'desc': _strip_html(d)[:300],
                                      'image': _extract_rss_image(item, d)})
            except: pass
            return items
        with ThreadPoolExecutor(max_workers=8) as pool:
            for f in as_completed({pool.submit(fetch_one, s): s for s in symbols}, timeout=30):
                for i in f.result():
                    if i['link'] and i['link'] not in seen_urls:
                        seen_urls.add(i['link']); all_items.append(i)
        all_items.sort(key=lambda x: x['ts'], reverse=True)
        return jsonify(all_items[:50])
    except Exception as e: return jsonify({'error': str(e)}), 500

def _strip_html(text):
    if not text: return ''
    text = re.sub(r'<[^>]+>', ' ', text)
    return ' '.join(html.unescape(text).split())

def _extract_rss_image(item, description):
    media = item.find('.//{http://search.yahoo.com/mrss/}content')
    if media is not None:
        url = media.get('url')
        if url: return url
    enc = item.find('enclosure')
    if enc is not None:
        url = enc.get('url', '')
        if url: return url
    if description:
        m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', description, re.IGNORECASE)
        if m: return m.group(1)
    return None

_og_image_cache = {}
_BAD_IMAGE_DOMAINS = ['lh3.googleusercontent.com', 'googleusercontent.com', 'placehold.it', 'via.placeholder.com']
def _is_bad_image(url):
    if not url: return True
    for d in _BAD_IMAGE_DOMAINS:
        if d in url: return True
    return False
def fetch_og_image(url, timeout_sec=5):
    if url in _og_image_cache:
        return _og_image_cache[url]
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout_sec)
        if r.status_code == 200:
            m = re.search(r'<meta[^>]+property=["\']og:image["\'"][^>]+content=["\']([^"\']+)["\']', r.text, re.IGNORECASE)
            if not m:
                m = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'"][^>]+property=["\']og:image["\']', r.text, re.IGNORECASE)
            if m:
                img = html.unescape(m.group(1))
                if img.startswith('//'): img = 'https:' + img
                if img.startswith('/'): img = url.rstrip('/') + img
                if _is_bad_image(img): img = None
                _og_image_cache[url] = img
                return img
    except: pass
    _og_image_cache[url] = None
    return None

@app.route('/api/news/latest')
def latest_news():
    try:
        all_items = []; seen_urls = set()
        def fetch_gn():
            items = []
            try:
                urls = ['https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
                        'https://news.google.com/rss/search?q=finance+stock+market&hl=en-US&gl=US&ceid=US:en',
                        'https://news.google.com/rss/search?q=business+economy&hl=en-US&gl=US&ceid=US:en',
                        'https://news.google.com/rss/search?q=investing+markets&hl=en-US&gl=US&ceid=US:en']
                for gu in urls:
                    try:
                        r = requests.get(gu, headers=HEADERS, timeout=10)
                        if r.status_code != 200: continue
                        root = ElementTree.fromstring(r.content)
                        for it in root.findall('.//item'):
                            t = it.findtext('title', ''); l = it.findtext('link', '')
                            p = it.findtext('pubDate', ''); d = it.findtext('description', '')
                            src = it.findtext('source', '')
                            ts = 0
                            if p:
                                try: ts = int(parsedate_to_datetime(p).timestamp())
                                except: pass
                            img = _extract_rss_image(it, d) or _extract_rss_image(it, '')
                            items.append({'title': t, 'link': l, 'providerPublishTime': ts,
                                          'description': _strip_html(d)[:400],
                                          'image': img, 'source': src or 'Google News'})
                    except: pass
            except: pass
            return items
        def fetch_yf(sym):
            items = []
            try:
                url = f'https://feeds.finance.yahoo.com/rss/2.0/headline?s={sym}&region=US&lang=en-US'
                r = requests.get(url, headers=HEADERS, timeout=10)
                if r.status_code == 200:
                    root = ElementTree.fromstring(r.content)
                    for item in root.findall('.//item'):
                        t = item.findtext('title', ''); l = item.findtext('link', '')
                        p = item.findtext('pubDate', ''); d = item.findtext('description', '')
                        ts = 0
                        if p:
                            try: ts = int(parsedate_to_datetime(p).timestamp())
                            except: pass
                        items.append({'title': t, 'link': l, 'providerPublishTime': ts,
                                      'description': _strip_html(d)[:400],
                                      'image': _extract_rss_image(item, d), 'source': 'Yahoo Finance'})
            except: pass
            return items
        with ThreadPoolExecutor(max_workers=12) as pool:
            futs = [pool.submit(fetch_gn)] + [pool.submit(fetch_yf, s) for s in MAJOR_SYMBOLS[:15]]
            for f in as_completed(futs, timeout=30):
                for i in f.result():
                    if i.get('link') and i['link'] not in seen_urls:
                        seen_urls.add(i['link']); all_items.append(i)
        all_items.sort(key=lambda x: x['providerPublishTime'], reverse=True)
        # Fetch OG images for top articles in parallel
        top = all_items[:25]
        with ThreadPoolExecutor(max_workers=10) as img_pool:
            img_futs = {img_pool.submit(fetch_og_image, a.get('link', '')): a for a in top if a.get('link')}
            for f in as_completed(img_futs, timeout=8):
                a = img_futs[f]
                img = f.result()
                if img: a['image'] = img
        return jsonify(all_items[:50])
    except Exception as e: return jsonify({'error': str(e)}), 500

# ─── Movers ──────────────────────────────────────────────

MAJOR_SYMBOLS = ['AAPL','MSFT','GOOGL','AMZN','TSLA','NVDA','META','AVGO','COST','NFLX',
                 'ADBE','CRM','AMD','INTC','QCOM','IBM','ORCL','CSCO','PYPL','UBER',
                 'BA','GE','CAT','JPM','GS','V','MA','JNJ','UNH','LLY']

@_cached('movers', ttl=30)
def fetch_movers():
    items = []
    def fetch_one(sym):
        try:
            url = f'{YH}/v8/finance/chart/{sym}?interval=1d&range=5d'
            r = requests.get(url, headers=HEADERS, timeout=10)
            if r.status_code != 200: return None
            m = r.json()['chart']['result'][0]['meta']
            price = m.get('regularMarketPrice'); prev_close = m.get('chartPreviousClose')
            if price is None or prev_close is None: return None
            chg = round(price - prev_close, 2); chg_pct = round((chg / prev_close) * 100, 2)
            return {'symbol': sym, 'name': m.get('shortName') or m.get('longName', ''),
                    'price': round(price, 2), 'change': chg, 'changePercent': chg_pct}
        except: return None
    with ThreadPoolExecutor(max_workers=10) as pool:
        for f in as_completed({pool.submit(fetch_one, s): s for s in MAJOR_SYMBOLS}, timeout=20):
            r = f.result()
            if r: items.append(r)
    items.sort(key=lambda x: abs(x['changePercent'] or 0), reverse=True)
    return items[:20]

@app.route('/api/movers')
def market_movers():
    try: return jsonify(fetch_movers())
    except Exception as e: return jsonify({'error': str(e)}), 500

# ─── Overview ────────────────────────────────────────────

INDICES = ['^GSPC','^IXIC','^DJI','^FTSE','^N225','^HSI','^AXJO','^STOXX50E','^BSESN','^KS11','^TWII','^GDAXI','^FCHI','^BFX']
COMMODITIES = ['GC=F','SI=F','CL=F','HG=F','NG=F','ZW=F','PL=F','PA=F','ZC=F','ZS=F','SB=F','CT=F','HO=F','RB=F']
FOREX = ['EURUSD=X','GBPUSD=X','USDJPY=X','USDCAD=X','USDCHF=X','AUDUSD=X','NZDUSD=X','EURGBP=X','EURJPY=X','GBPJPY=X','USDMXN=X','USDNOK=X','USDSEK=X','USDSGD=X']
CRYPTO = ['BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','ADA-USD','AVAX-USD','DOT-USD','LINK-USD','UNI-USD','LTC-USD','BCH-USD','NEAR-USD','APT-USD','TRX-USD','TON-USD','ATOM-USD','FIL-USD','SUI-USD','ARB-USD']

LONG_NAMES = {
    '^GSPC':'S&P 500','^IXIC':'NASDAQ','^DJI':'Dow Jones','^FTSE':'FTSE 100',
    '^N225':'Nikkei 225','^HSI':'Hang Seng','^AXJO':'ASX 200','^STOXX50E':'Euro Stoxx 50',
    '^BSESN':'BSE Sensex','^KS11':'KOSPI','^TWII':'Taiwan Weighted','^GDAXI':'DAX',
    '^FCHI':'CAC 40','^BFX':'Bel 20',
    'GC=F':'Gold','SI=F':'Silver','CL=F':'Crude Oil','HG=F':'Copper','NG=F':'Natural Gas','ZW=F':'Wheat',
    'PL=F':'Platinum','PA=F':'Palladium','ZC=F':'Corn','ZS=F':'Soybeans','SB=F':'Sugar',
    'CT=F':'Cotton','HO=F':'Heating Oil','RB=F':'RBOB Gasoline',
    'EURUSD=X':'EUR/USD','GBPUSD=X':'GBP/USD','USDJPY=X':'USD/JPY','USDCAD=X':'USD/CAD',
    'USDCHF=X':'USD/CHF','AUDUSD=X':'AUD/USD','NZDUSD=X':'NZD/USD','EURGBP=X':'EUR/GBP',
    'EURJPY=X':'EUR/JPY','GBPJPY=X':'GBP/JPY','USDMXN=X':'USD/MXN','USDNOK=X':'USD/NOK',
    'USDSEK=X':'USD/SEK','USDSGD=X':'USD/SGD',
    'BTC-USD':'Bitcoin','ETH-USD':'Ethereum','SOL-USD':'Solana','XRP-USD':'XRP','DOGE-USD':'Dogecoin',
    'ADA-USD':'Cardano','AVAX-USD':'Avalanche','DOT-USD':'Polkadot','LINK-USD':'Chainlink',
    'UNI-USD':'Uniswap','LTC-USD':'Litecoin','BCH-USD':'Bitcoin Cash','NEAR-USD':'Near Protocol',
    'APT-USD':'Aptos','TRX-USD':'TRON','TON-USD':'Toncoin','ATOM-USD':'Cosmos',
    'FIL-USD':'Filecoin','SUI-USD':'Sui','ARB-USD':'Arbitrum',
}

@_cached('overview', ttl=30)
def fetch_overview():
    results = {}
    categories = {'indices':INDICES,'commodities':COMMODITIES,'forex':FOREX,'crypto':CRYPTO}
    all_syms = INDICES + COMMODITIES + FOREX + CRYPTO
    def fetch_one(sym):
        try:
            url = f'{YH}/v8/finance/chart/{sym}?interval=1d&range=5d'
            r = requests.get(url, headers=HEADERS, timeout=10)
            if r.status_code != 200: return sym, None
            m = r.json()['chart']['result'][0]['meta']
            price = m.get('regularMarketPrice') or m.get('chartPreviousClose')
            prev = m.get('chartPreviousClose') or m.get('regularMarketPreviousClose')
            chg = round(price - prev, 4) if (price and prev) else None
            chg_pct = round((chg / prev) * 100, 2) if (chg and prev) else None
            return sym, {'symbol': sym, 'name': LONG_NAMES.get(sym, m.get('shortName') or m.get('longName', sym)),
                         'price': round(price, 4) if price else None, 'change': chg,
                         'changePercent': chg_pct, 'currency': m.get('currency', 'USD')}
        except: return sym, None
    with ThreadPoolExecutor(max_workers=10) as pool:
        for f in as_completed({pool.submit(fetch_one, s): s for s in all_syms}, timeout=30):
            sym, data = f.result()
            if data: results[sym] = data
    return {cat: [results[s] for s in syms if s in results] for cat, syms in categories.items()}

@app.route('/api/overview')
def market_overview():
    try: return jsonify(fetch_overview())
    except Exception as e: return jsonify({'error': str(e)}), 500

# ─── Exchanges ───────────────────────────────────────────

EXCHANGES = [
    {'code':'NYSE','name':'New York Stock Exchange','city':'New York','country':'USA','lat':40.7061,'lng':-74.0089,'tz':'America/New_York','marketCap':'~$26.2T','listed':'~2,400','founded':'1792'},
    {'code':'NASDAQ','name':'NASDAQ','city':'New York','country':'USA','lat':40.7564,'lng':-73.9869,'tz':'America/New_York','marketCap':'~$19.5T','listed':'~3,600','founded':'1971'},
    {'code':'LSE','name':'London Stock Exchange','city':'London','country':'UK','lat':51.5149,'lng':-0.0992,'tz':'Europe/London','marketCap':'~$3.2T','listed':'~1,800','founded':'1801'},
    {'code':'TSE','name':'Tokyo Stock Exchange','city':'Tokyo','country':'Japan','lat':35.6812,'lng':139.7671,'tz':'Asia/Tokyo','marketCap':'~$5.7T','listed':'~3,900','founded':'1878'},
    {'code':'SSE','name':'Shanghai Stock Exchange','city':'Shanghai','country':'China','lat':31.2304,'lng':121.4737,'tz':'Asia/Shanghai','marketCap':'~$6.5T','listed':'~2,100','founded':'1990'},
    {'code':'HKEX','name':'Hong Kong Exchange','city':'Hong Kong','country':'China','lat':22.2842,'lng':114.1586,'tz':'Asia/Hong_Kong','marketCap':'~$4.3T','listed':'~2,500','founded':'1891'},
    {'code':'EURONEXT','name':'Euronext','city':'Amsterdam','country':'Netherlands','lat':52.3676,'lng':4.9041,'tz':'Europe/Amsterdam','marketCap':'~$3.8T','listed':'~1,500','founded':'2000'},
    {'code':'DB','name':'Deutsche Borse','city':'Frankfurt','country':'Germany','lat':50.1109,'lng':8.6821,'tz':'Europe/Berlin','marketCap':'~$2.1T','listed':'~1,200','founded':'1585'},
    {'code':'SIX','name':'SIX Swiss Exchange','city':'Zurich','country':'Switzerland','lat':47.3769,'lng':8.5417,'tz':'Europe/Zurich','marketCap':'~$1.8T','listed':'~450','founded':'1995'},
    {'code':'TSX','name':'Toronto Stock Exchange','city':'Toronto','country':'Canada','lat':43.6481,'lng':-79.3820,'tz':'America/Toronto','marketCap':'~$2.3T','listed':'~1,500','founded':'1852'},
    {'code':'ASX','name':'Australian Securities Exchange','city':'Sydney','country':'Australia','lat':-33.8688,'lng':151.2093,'tz':'Australia/Sydney','marketCap':'~$1.7T','listed':'~2,100','founded':'1987'},
    {'code':'BSE','name':'BSE India','city':'Mumbai','country':'India','lat':18.9290,'lng':72.8336,'tz':'Asia/Kolkata','marketCap':'~$3.5T','listed':'~5,500','founded':'1875'},
    {'code':'BMF','name':'B3 Brazil','city':'Sao Paulo','country':'Brazil','lat':-23.5505,'lng':-46.6333,'tz':'America/Sao_Paulo','marketCap':'~$0.9T','listed':'~450','founded':'1890'},
    {'code':'KRX','name':'Korea Exchange','city':'Seoul','country':'South Korea','lat':37.5665,'lng':126.9780,'tz':'Asia/Seoul','marketCap':'~$1.6T','listed':'~2,000','founded':'1956'},
    {'code':'SGX','name':'Singapore Exchange','city':'Singapore','country':'Singapore','lat':1.3521,'lng':103.8198,'tz':'Asia/Singapore','marketCap':'~$0.6T','listed':'~750','founded':'1999'},
    {'code':'MSE','name':'Mexican Stock Exchange','city':'Mexico City','country':'Mexico','lat':19.4326,'lng':-99.1332,'tz':'America/Mexico_City','marketCap':'~$0.5T','listed':'~350','founded':'1894'},
]

@app.route('/api/exchanges')
def exchanges():
    import pytz
    try:
        now_utc = datetime.utcnow()
        for ex in EXCHANGES:
            try:
                tz = pytz.timezone(ex['tz'])
                local = now_utc.replace(tzinfo=pytz.UTC).astimezone(tz)
                hour = local.hour; weekday = local.weekday()
                ex['status'] = 'open' if weekday < 5 and 9 <= hour < 17 else 'closed'
                ex['local_time'] = local.strftime('%H:%M')
            except: ex['status'] = 'unknown'; ex['local_time'] = '--'
        return jsonify(EXCHANGES)
    except Exception as e: return jsonify({'error': str(e)}), 500

@app.route('/api/exchange/<code>')
def exchange_detail(code):
    try:
        ex = next((e for e in EXCHANGES if e['code'] == code.upper()), None)
        if not ex: return jsonify({'error': 'Exchange not found'}), 404
        # Get representative stocks for this exchange
        exchange_symbols = {
            'NYSE': ['JPM','GE','BA','CAT','V','JNJ','KO','PG','WMT','XOM'],
            'NASDAQ': ['AAPL','MSFT','GOOGL','AMZN','TSLA','NVDA','META','AVGO','COST','NFLX'],
            'LSE': ['III.L','AZN.L','HSBA.L','BP.L','GSK.L','DGE.L','ULVR.L','SHEL.L'],
            'TSE': ['7203.T','6758.T','6861.T','9984.T','9432.T'],
            'SSE': ['600519.SS','601318.SS','600036.SS','600276.SS','601166.SS'],
            'HKEX': ['0700.HK','0005.HK','9988.HK','1299.HK','1398.HK'],
            'TSX': ['RY.TO','TD.TO','BNS.TO','BMO.TO','CNQ.TO'],
            'ASX': ['BHP.AX','CBA.AX','CSL.AX','NAB.AX','WBC.AX'],
            'BSE': ['RELIANCE.NS','TCS.NS','HDFCBANK.NS','INFY.NS','ICICIBANK.NS'],
        }
        symbols = exchange_symbols.get(code.upper(), [])
        prices = []
        with ThreadPoolExecutor(max_workers=5) as pool:
            for f in as_completed({pool.submit(_fetch_current_price, s): s for s in symbols[:5]}, timeout=15):
                s = f.result()
                if s: prices.append(s)
        return jsonify({'exchange': ex, 'stocks': prices})
    except Exception as e: return jsonify({'error': str(e)}), 500

# ─── Settings ────────────────────────────────────────────

@app.route('/api/settings', methods=['GET', 'POST'])
def settings():
    if request.method == 'POST':
        try:
            s = request.json
            save_settings(s)
            return jsonify({'ok': True})
        except Exception as e: return jsonify({'error': str(e)}), 500
    return jsonify(get_settings())

@app.route('/api/userstate', methods=['GET', 'POST'])
def userstate():
    if request.method == 'POST':
        try:
            save_userstate(request.json)
            return jsonify({'ok': True})
        except Exception as e: return jsonify({'error': str(e)}), 500
    return jsonify(get_userstate())

# ─── Paper Trading ──────────────────────────────────────

@app.route('/api/account')
def get_account_info():
    return jsonify(get_account())

@app.route('/api/account/deposit', methods=['POST'])
def deposit():
    try:
        amt = float(request.json.get('amount', 0))
        if amt <= 0: return jsonify({'error': 'Amount must be positive'}), 400
        acc = get_account()
        acc['cash'] += amt
        acc['transactions'].insert(0, {'type': 'deposit', 'amount': amt, 'timestamp': time.time()})
        save_account(acc)
        return jsonify(acc)
    except Exception as e: return jsonify({'error': str(e)}), 500

@app.route('/api/account/buy', methods=['POST'])
def buy_stock():
    try:
        symbol = request.json.get('symbol', '').upper()
        shares = float(request.json.get('shares', 0))
        if not symbol or shares <= 0: return jsonify({'error': 'Invalid symbol or shares'}), 400
        price_data = _fetch_current_price(symbol)
        if not price_data or not price_data['price']: return jsonify({'error': 'Cannot get price'}), 400
        price = price_data['price']
        total = round(price * shares, 2)
        acc = get_account()
        if acc['cash'] < total: return jsonify({'error': 'Insufficient funds'}), 400
        acc['cash'] = round(acc['cash'] - total, 2)
        if symbol in acc['holdings']:
            existing = acc['holdings'][symbol]
            avg_cost = ((existing['avg_cost'] * existing['shares']) + total) / (existing['shares'] + shares)
            acc['holdings'][symbol]['shares'] += shares
            acc['holdings'][symbol]['avg_cost'] = round(avg_cost, 2)
        else:
            acc['holdings'][symbol] = {'shares': shares, 'avg_cost': round(price, 2)}
        acc['transactions'].insert(0, {'type': 'buy', 'symbol': symbol, 'shares': shares,
                                        'price': round(price, 2), 'total': total, 'timestamp': time.time()})
        save_account(acc)
        return jsonify(acc)
    except Exception as e: return jsonify({'error': str(e)}), 500

@app.route('/api/account/sell', methods=['POST'])
def sell_stock():
    try:
        symbol = request.json.get('symbol', '').upper()
        shares = float(request.json.get('shares', 0))
        if not symbol or shares <= 0: return jsonify({'error': 'Invalid symbol or shares'}), 400
        acc = get_account()
        if symbol not in acc['holdings'] or acc['holdings'][symbol]['shares'] < shares:
            return jsonify({'error': 'Not enough shares'}), 400
        price_data = _fetch_current_price(symbol)
        if not price_data or not price_data['price']: return jsonify({'error': 'Cannot get price'}), 400
        price = price_data['price']
        total = round(price * shares, 2)
        acc['cash'] = round(acc['cash'] + total, 2)
        acc['holdings'][symbol]['shares'] -= shares
        if acc['holdings'][symbol]['shares'] <= 0:
            del acc['holdings'][symbol]
        acc['transactions'].insert(0, {'type': 'sell', 'symbol': symbol, 'shares': shares,
                                        'price': round(price, 2), 'total': total, 'timestamp': time.time()})
        save_account(acc)
        return jsonify(acc)
    except Exception as e: return jsonify({'error': str(e)}), 500

@app.route('/api/account/portfolio')
def portfolio():
    try:
        acc = get_account()
        holdings = []
        total_value = acc['cash']
        def fetch_holding(symbol, info):
            try:
                p = _fetch_current_price(symbol)
                if p and p['price']:
                    current_price = p['price']
                    market_value = round(current_price * info['shares'], 2)
                    pnl = round((current_price - info['avg_cost']) * info['shares'], 2)
                    pnl_pct = round(((current_price - info['avg_cost']) / info['avg_cost']) * 100, 2)
                    return {'symbol': symbol, 'shares': info['shares'], 'avg_cost': info['avg_cost'],
                            'current_price': round(current_price, 2), 'market_value': market_value,
                            'pnl': pnl, 'pnl_pct': pnl_pct}
            except: pass
            return None
        with ThreadPoolExecutor(max_workers=5) as pool:
            for f in as_completed({pool.submit(fetch_holding, s, i): s for s, i in acc['holdings'].items()}, timeout=15):
                r = f.result()
                if r:
                    holdings.append(r)
                    total_value += r['market_value']
        return jsonify({'cash': acc['cash'], 'holdings': holdings, 'total_value': round(total_value, 2)})
    except Exception as e: return jsonify({'error': str(e)}), 500

# ─── Alerts ──────────────────────────────────────────────

@app.route('/api/alerts', methods=['GET', 'POST'])
def alerts():
    if request.method == 'POST':
        try:
            alerts_data = get_alerts()
            alert = request.json
            alert['id'] = str(uuid.uuid4())[:8]
            alert['created'] = time.time()
            alert['last_triggered'] = None
            alert['active'] = True
            alerts_data.append(alert)
            save_alerts(alerts_data)
            return jsonify(alert)
        except Exception as e: return jsonify({'error': str(e)}), 500
    return jsonify(get_alerts())

@app.route('/api/alerts/<alert_id>', methods=['DELETE', 'PATCH'])
def alert_crud(alert_id):
    alerts_data = get_alerts()
    idx = next((i for i, a in enumerate(alerts_data) if a['id'] == alert_id), None)
    if idx is None: return jsonify({'error': 'Not found'}), 404
    if request.method == 'DELETE':
        alerts_data.pop(idx)
        save_alerts(alerts_data)
        return jsonify({'ok': True})
    if request.method == 'PATCH':
        update = request.json
        alerts_data[idx].update(update)
        save_alerts(alerts_data)
        return jsonify(alerts_data[idx])

def _search_news_alert(keyword):
    items = []
    try:
        url = f'https://news.google.com/rss/search?q={quote(keyword)}&hl=en-US&gl=US&ceid=US:en'
        r = requests.get(url, headers=HEADERS, timeout=10)
        if r.status_code == 200:
            root = ElementTree.fromstring(r.content)
            for item in root.findall('.//item'):
                t = item.findtext('title', ''); l = item.findtext('link', '')
                p = item.findtext('pubDate', ''); d = item.findtext('description', '')
                ts = 0
                if p:
                    try: ts = int(parsedate_to_datetime(p).timestamp())
                    except: pass
                items.append({'title': t, 'link': l, 'published': ts, 'description': _strip_html(d)[:300]})
    except: pass
    if keyword.isupper() and len(keyword) <= 5:
        try:
            url = f'https://feeds.finance.yahoo.com/rss/2.0/headline?s={keyword}&region=US&lang=en-US'
            r = requests.get(url, headers=HEADERS, timeout=10)
            if r.status_code == 200:
                root = ElementTree.fromstring(r.content)
                existing = {x['link'] for x in items}
                for item in root.findall('.//item'):
                    l = item.findtext('link', '')
                    if l in existing: continue
                    t = item.findtext('title', ''); p = item.findtext('pubDate', '')
                    d = item.findtext('description', '')
                    ts = 0
                    if p:
                        try: ts = int(parsedate_to_datetime(p).timestamp())
                        except: pass
                    items.append({'title': t, 'link': l, 'published': ts, 'description': _strip_html(d)[:300]})
        except: pass
    return items[:10]

@app.route('/api/alerts/check')
def check_alerts():
    try:
        alerts_data = get_alerts()
        triggered = []
        for alert in alerts_data:
            if not alert.get('active'): continue
            atype = alert.get('type', 'price')
            symbol = alert.get('symbol', '')
            threshold = alert.get('threshold', 0)
            direction = alert.get('direction', 'above')
            if atype == 'price' and symbol:
                p = _fetch_current_price(symbol)
                if p and p['price']:
                    if direction == 'above' and p['price'] >= threshold:
                        triggered.append({**alert, 'current_price': p['price'], 'triggered_at': time.time()})
                        alert['last_triggered'] = time.time()
                    elif direction == 'below' and p['price'] <= threshold:
                        triggered.append({**alert, 'current_price': p['price'], 'triggered_at': time.time()})
                        alert['last_triggered'] = time.time()
            elif atype == 'change' and symbol:
                p = _fetch_current_price(symbol)
                if p and p['price'] and p['prev']:
                    chg_pct = abs((p['price'] - p['prev']) / p['prev'] * 100)
                    if chg_pct >= threshold:
                        triggered.append({**alert, 'current_price': p['price'], 'change_pct': round(chg_pct, 2), 'triggered_at': time.time()})
                        alert['last_triggered'] = time.time()
            elif atype == 'news' and symbol:
                articles = _search_news_alert(symbol)
                seen = set(alert.get('seen_urls', []))
                new_articles = [a for a in articles if a['link'] not in seen and a['link']]
                if new_articles:
                    new_urls = [a['link'] for a in new_articles]
                    alert['seen_urls'] = (list(seen) + new_urls)[-200:]
                    triggered.append({**alert, 'articles': new_articles[:5], 'triggered_at': time.time()})
                    alert['last_triggered'] = time.time()
        if triggered:
            save_alerts(alerts_data)
        return jsonify({'triggered': triggered, 'total': len(alerts_data)})
    except Exception as e: return jsonify({'error': str(e)}), 500

# ─── AI Chat ─────────────────────────────────────────────

AI_TOOLS_DESC = [
    {'name': 'analyze_stock', 'description': 'Get detailed stock data with indicators and price history.',
     'parameters': {'type': 'object', 'properties': {
         'symbol': {'type': 'string', 'description': 'Stock symbol e.g. AAPL'},
         'range': {'type': 'string', 'description': 'Time range: 1d,5d,1mo,3mo,1y,5y,max', 'default': '1y'},
         'interval': {'type': 'string', 'description': 'Interval: 1d,1wk,1mo', 'default': '1d'},
     }, 'required': ['symbol']}},
    {'name': 'search_web', 'description': 'Search the web for current information.',
     'parameters': {'type': 'object', 'properties': {'query': {'type': 'string', 'description': 'Search query'}}, 'required': ['query']}},
    {'name': 'fetch_url', 'description': 'Fetch and read a web page.',
     'parameters': {'type': 'object', 'properties': {'url': {'type': 'string', 'description': 'URL to fetch'}}, 'required': ['url']}},
    {'name': 'get_news', 'description': 'Get latest news for a stock symbol.',
     'parameters': {'type': 'object', 'properties': {'symbol': {'type': 'string', 'description': 'Stock symbol'}}, 'required': ['symbol']}},
    {'name': 'get_market_overview', 'description': 'Get overview of major indices, commodities, forex, and crypto prices.',
     'parameters': {'type': 'object', 'properties': {}}},
    {'name': 'get_portfolio', 'description': 'Get current paper trading portfolio with P and L.',
     'parameters': {'type': 'object', 'properties': {}}},
    {'name': 'create_widget', 'description': 'Create a visual widget in the workspace.',
     'parameters': {'type': 'object', 'properties': {
         'type': {'type': 'string', 'description': 'Widget type: chart, table, prediction, text'},
         'title': {'type': 'string', 'description': 'Widget title'},
         'data': {'type': 'object', 'description': 'Widget data: labels+values for chart, rows for table, html for text'},
     }, 'required': ['type', 'title', 'data']}},
    {'name': 'analyze_data', 'description': 'Analyze provided data and return insights.',
     'parameters': {'type': 'object', 'properties': {'data': {'type': 'string', 'description': 'Data to analyze'}}, 'required': ['data']}},
]

SYSTEM_PROMPT = """You are ZEUS AI, a professional financial analysis assistant integrated into the ZEUS terminal platform. You have access to real-time market data via tools.

Available tools:
- analyze_stock: Get detailed stock data with indicators
- search_web: Search the internet for current information
- fetch_url: Browse a specific URL
- get_news: Get news for a stock symbol
- get_market_overview: Get current market data (indices, commodities, forex, crypto)
- get_portfolio: Get paper trading portfolio
- create_widget: Create visual widgets in the workspace (charts, tables, predictions, text)
- analyze_data: Analyze data and return insights

When you use tools, explain what you are doing. Use create_widget to show results visually.
Be professional, precise, and data-driven. Always cite sources when possible."""

def _call_ai_api(messages, settings, on_token=None):
    provider_name = settings['ai'].get('provider', 'openrouter')
    base_url = settings['ai'].get('base_url', 'https://openrouter.ai/api/v1')
    api_key = settings['ai'].get('api_key', '')
    model = settings['ai'].get('model', 'openai/gpt-4o')
    max_tokens = settings['ai'].get('max_tokens', 4096)
    temperature = settings['ai'].get('temperature', 0.7)

    local_providers = ('ollama', 'lmstudio')
    supports_tools = provider_name not in local_providers

    if not api_key:
        if provider_name not in local_providers:
            yield {'type': 'error', 'content': 'API key not configured. Go to Settings > AI to configure.'}
            return
        api_key = 'not-needed'

    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key}'}

    tools_list = []
    if on_token is not None and supports_tools:
        tools_list = [
            {
                'type': 'function',
                'function': {
                    'name': t['name'],
                    'description': t['description'],
                    'parameters': t['parameters'],
                }
            } for t in AI_TOOLS_DESC
        ]

    body = {
        'model': model,
        'messages': messages,
        'max_tokens': max_tokens,
        'temperature': temperature,
        'stream': on_token is not None,
    }
    if tools_list:
        body['tools'] = tools_list

    try:
        resp = requests.post(url, headers=headers, json=body, timeout=60, stream=True)
        if resp.status_code != 200:
            yield {'type': 'error', 'content': f'API error: {resp.status_code} - {resp.text[:200]}'}
            return

        if on_token is None:
            # Non-streaming response
            data = resp.json()
            yield {'type': 'complete', 'content': data['choices'][0]['message']}
            return

        full_content = ''
        tool_calls = []

        for line in resp.iter_lines():
            if not line: continue
            line = line.decode('utf-8')
            if line.startswith('data: '):
                data_str = line[6:]
                if data_str == '[DONE]': break
                try:
                    data = json.loads(data_str)
                    delta = data.get('choices', [{}])[0].get('delta', {})
                    if delta.get('content'):
                        token = delta['content']
                        full_content += token
                        on_token({'type': 'token', 'content': token})
                    if delta.get('tool_calls'):
                        for tc in delta['tool_calls']:
                            idx = tc.get('index', 0)
                            while len(tool_calls) <= idx:
                                tool_calls.append({'id': '', 'function': {'name': '', 'arguments': ''}})
                            if tc.get('id'): tool_calls[idx]['id'] += tc['id']
                            if tc['function'].get('name'): tool_calls[idx]['function']['name'] += tc['function']['name']
                            if tc['function'].get('arguments'): tool_calls[idx]['function']['arguments'] += tc['function']['arguments']
                except: pass

        if tool_calls:
            for tc in tool_calls:
                try:
                    tc['function']['arguments'] = json.loads(tc['function']['arguments'])
                except: pass
            on_token({'type': 'tool_calls', 'tool_calls': tool_calls, 'content': full_content})
        else:
            on_token({'type': 'complete', 'content': full_content})

    except requests.exceptions.Timeout:
        yield {'type': 'error', 'content': 'Request timed out after 60s'}
    except Exception as e:
        yield {'type': 'error', 'content': f'Request failed: {str(e)}'}

def _execute_tool(name, args):
    try:
        if name == 'analyze_stock':
            symbol = args.get('symbol', 'AAPL')
            rng = args.get('range', '1y')
            iv = args.get('interval', '1d')
            if rng == 'max':
                if iv == '1d': rv = '10y'
                elif iv == '1wk': rv = '15y'
                else: rv = 'max'
            elif rng == '1mo': rv = '3mo'
            else: rv = rng
            data = fetch_stock_data(symbol.upper(), rv, iv)
            # Return summary for AI
            hist = data['history']
            closes = [h['close'] for h in hist if h['close']]
            return {'type': 'tool_result', 'name': name,
                    'content': json.dumps({
                        'symbol': symbol.upper(),
                        'current_price': data['quote'].get('currentPrice'),
                        'change': data['quote'].get('change'),
                        'change_percent': data['quote'].get('changePercent'),
                        'period_high': data['meta']['period_high'],
                        'period_low': data['meta']['period_low'],
                        'rsi': hist[-1].get('rsi') if hist else None,
                        'macd': hist[-1].get('macd') if hist else None,
                        'sma20': hist[-1].get('sma20') if hist else None,
                        'sma50': hist[-1].get('sma50') if hist else None,
                        'sma200': hist[-1].get('sma200') if hist else None,
                        'candles': len(hist),
                        'price_min': min(closes) if closes else None,
                        'price_max': max(closes) if closes else None,
                        'price_avg': round(sum(closes)/len(closes), 2) if closes else None,
                    }, indent=2)}

        elif name == 'search_web':
            query = args.get('query', '')
            try:
                from googlesearch import search
                results = []
                for url in search(query, num_results=5):
                    results.append(url)
                return {'type': 'tool_result', 'name': name, 'content': json.dumps({'query': query, 'results': results})}
            except ImportError:
                # Fallback to a simple search
                return {'type': 'tool_result', 'name': name, 'content': json.dumps({'query': query, 'note': 'Web search not available in this environment. Try fetch_url with a specific URL.'})}

        elif name == 'fetch_url':
            url = args.get('url', '')
            try:
                r = requests.get(url, headers=HEADERS, timeout=15)
                text = r.text[:5000]
                import html2text
                h = html2text.HTML2Text()
                h.ignore_links = False
                text = h.handle(text)[:3000]
                return {'type': 'tool_result', 'name': name, 'content': text}
            except ImportError:
                text = r.text[:3000] if r else ''
                # crude HTML stripping
                text = re.sub(r'<[^>]+>', ' ', text)
                text = ' '.join(text.split())[:3000]
                return {'type': 'tool_result', 'name': name, 'content': text}
            except Exception as e:
                return {'type': 'tool_result', 'name': name, 'content': f'Error fetching URL: {str(e)}'}

        elif name == 'get_news':
            symbol = args.get('symbol', '')
            url = f'https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol.upper()}&region=US&lang=en-US'
            r = requests.get(url, headers=HEADERS, timeout=10)
            root = ElementTree.fromstring(r.content)
            items = []
            for item in root.findall('.//item'):
                items.append({
                    'title': item.findtext('title', ''),
                    'link': item.findtext('link', ''),
                    'description': _strip_html(item.findtext('description', ''))[:200],
                })
            return {'type': 'tool_result', 'name': name, 'content': json.dumps(items[:8], indent=2)}

        elif name == 'get_market_overview':
            data = fetch_overview()
            return {'type': 'tool_result', 'name': name, 'content': json.dumps(data, indent=2)}

        elif name == 'get_portfolio':
            acc = get_account()
            holdings = list(acc.get('holdings', {}).items())
            return {'type': 'tool_result', 'name': name, 'content': json.dumps({
                'cash': acc['cash'],
                'holdings': [{'symbol': s, 'shares': i['shares'], 'avg_cost': i['avg_cost']} for s, i in holdings],
            }, indent=2)}

        elif name == 'create_widget':
            return {'type': 'widget', 'name': name, 'content': args}

        elif name == 'analyze_data':
            data = args.get('data', '')
            return {'type': 'tool_result', 'name': name, 'content': f'Analysis of provided data:\n{data[:1000]}'}

        return {'type': 'tool_result', 'name': name, 'content': f'Unknown tool: {name}'}

    except Exception as e:
        return {'type': 'tool_result', 'name': name, 'content': f'Error executing {name}: {str(e)}'}

def _is_openai_compatible(settings):
    provider = settings['ai'].get('provider', 'openrouter')
    # All supported providers are OpenAI-compatible except Anthropic
    return provider != 'anthropic'

@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        messages = request.json.get('messages', [])
        settings = get_settings()
        conversation = [{'role': 'system', 'content': SYSTEM_PROMPT}] + messages

        def stream():
            max_iterations = 15
            iteration = 0
            current_messages = list(conversation)

            while iteration < max_iterations:
                iteration += 1
                tool_results = []
                final_content = ''
                final_tool_calls = None

                def handle_token(token):
                    nonlocal final_content, final_tool_calls
                    if token['type'] == 'token':
                        final_content += token.get('content', '')
                    elif token['type'] == 'tool_calls':
                        final_tool_calls = token.get('tool_calls', [])
                    elif token['type'] == 'complete':
                        final_content = token.get('content', '')
                    elif token['type'] == 'error':
                        pass

                for result in _call_ai_api(current_messages, settings, on_token=handle_token):
                    if result['type'] == 'token':
                        yield f"data: {json.dumps({'type': 'token', 'content': result['content']})}\n\n"
                    elif result['type'] == 'error':
                        yield f"data: {json.dumps({'type': 'error', 'content': result['content']})}\n\n"
                        return
                    elif result['type'] == 'complete':
                        final_content = result.get('content', '')
                    elif result['type'] == 'tool_calls':
                        final_tool_calls = result.get('tool_calls', [])

                if final_content:
                    current_messages.append({'role': 'assistant', 'content': final_content})

                if final_tool_calls:
                    if final_content:
                        # Add assistant message with content and tool calls
                        current_messages[-1]['tool_calls'] = [
                            {'id': tc['id'], 'type': 'function',
                             'function': {'name': tc['function']['name'],
                                          'arguments': json.dumps(tc['function']['arguments'])}}
                            for tc in final_tool_calls
                        ]
                    for tc in final_tool_calls:
                        tool_name = tc['function']['name']
                        tool_args = tc['function']['arguments']
                        yield f"data: {json.dumps({'type': 'tool_start', 'name': tool_name, 'args': tool_args})}\n\n"

                        result = _execute_tool(tool_name, tool_args)
                        if result['type'] == 'widget':
                            yield f"data: {json.dumps({'type': 'widget', 'name': tool_name, 'content': result['content']})}\n\n"
                            current_messages.append({
                                'role': 'assistant',
                                'content': f"[Widget created: {result['content'].get('title', '')}]"
                            })
                        else:
                            tool_content = result.get('content', '')
                            yield f"data: {json.dumps({'type': 'tool_result', 'name': tool_name, 'content': tool_content[:500]})}\n\n"
                            current_messages.append({
                                'role': 'tool',
                                'tool_call_id': tc['id'],
                                'content': tool_content[:3000],
                            })
                else:
                    # No tool calls, we're done
                    break

            yield f"data: {json.dumps({'type': 'done', 'iteration': iteration})}\n\n"

        return Response(stream_with_context(stream()), mimetype='text/event-stream',
                        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/ai/providers')
def ai_providers():
    return jsonify([
        {'id': 'openai', 'name': 'OpenAI',
         'models': [{'id': 'gpt-4o', 'name': 'GPT-4o'}, {'id': 'gpt-4o-mini', 'name': 'GPT-4o Mini'}, {'id': 'gpt-4-turbo', 'name': 'GPT-4 Turbo'}, {'id': 'gpt-3.5-turbo', 'name': 'GPT-3.5 Turbo'}],
         'default_model': 'gpt-4o', 'base_url': 'https://api.openai.com/v1', 'base_url_editable': False,
         'needs_api_key': True, 'supports_multimodal': True, 'supports_tools': True},
        {'id': 'openrouter', 'name': 'OpenRouter',
         'models': [{'id': 'openai/gpt-4o', 'name': 'OpenAI GPT-4o'}, {'id': 'anthropic/claude-3.5-sonnet', 'name': 'Anthropic Claude 3.5 Sonnet'}, {'id': 'google/gemini-2.0-flash', 'name': 'Google Gemini 2.0 Flash'}, {'id': 'meta-llama/llama-3-70b-instruct', 'name': 'Meta Llama 3 70B'}],
         'default_model': 'openai/gpt-4o', 'base_url': 'https://openrouter.ai/api/v1', 'base_url_editable': True,
         'needs_api_key': True, 'supports_multimodal': True, 'supports_tools': True},
        {'id': 'ollama', 'name': 'Ollama (Local)',
         'models': [{'id': 'llama3', 'name': 'Llama 3'}, {'id': 'llama3.2', 'name': 'Llama 3.2'}, {'id': 'mistral', 'name': 'Mistral'}, {'id': 'mixtral', 'name': 'Mixtral'}, {'id': 'qwen2.5', 'name': 'Qwen 2.5'}],
         'default_model': 'llama3', 'base_url': 'http://localhost:11434/v1', 'base_url_editable': True,
         'needs_api_key': False, 'supports_multimodal': False, 'supports_tools': False},
        {'id': 'lmstudio', 'name': 'LM Studio (Local)',
         'models': [{'id': 'local-model', 'name': 'Local Model'}],
         'default_model': 'local-model', 'base_url': 'http://localhost:1234/v1', 'base_url_editable': True,
         'needs_api_key': False, 'supports_multimodal': False, 'supports_tools': False},
    ])

# ─── Entry point ─────────────────────────────────────────

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    app.run(debug=True, port=port, host='0.0.0.0')
