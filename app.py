import os
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

app = Flask(__name__, static_folder='public', static_url_path='')
CORS(app)

YAHOO_FINANCE_API = 'https://query1.finance.yahoo.com'

def get_stock_quote(symbol):
    try:
        url = f"{YAHOO_FINANCE_API}/v10/finance/quoteSummary/{symbol}?modules=price,summaryDetail"
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        return data['quoteSummary']['result'][0]
    except Exception as e:
        print(f"Error fetching stock data for {symbol}: {e}")
        raise

def get_historical_data(symbol, interval='1d', range='1mo'):
    try:
        url = f"{YAHOO_FINANCE_API}/v8/finance/chart/{symbol}?interval={interval}&range={range}"
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        chart = data['chart']['result'][0]
        timestamps = chart.get('timestamp', [])
        quotes = chart['indicators']['quote'][0]
        
        processed_data = []
        for i, time in enumerate(timestamps):
            try:
                open_val = round(quotes['open'][i], 2) if quotes['open'][i] is not None else None
                close_val = round(quotes['close'][i], 2) if quotes['close'][i] is not None else None
                high_val = round(quotes['high'][i], 2) if quotes['high'][i] is not None else None
                low_val = round(quotes['low'][i], 2) if quotes['low'][i] is not None else None
                vol_val = quotes['volume'][i]
                
                if close_val is None:
                    continue

                processed_data.append({
                    'date': datetime.fromtimestamp(time).isoformat() + "Z", # keep ISO format to match JS
                    'timestamp': time,
                    'open': open_val,
                    'close': close_val,
                    'high': high_val,
                    'low': low_val,
                    'volume': vol_val
                })
            except Exception:
                pass
                
        # Calculate Moving Averages and RSI
        with_indicators = []
        for i, item in enumerate(processed_data):
            ma20 = None
            ma50 = None
            rsi = None
            
            # MA20
            if i >= 19:
                slice_20 = processed_data[i - 19: i + 1]
                ma20 = round(sum(d['close'] for d in slice_20) / 20, 2)
                
            # MA50
            if i >= 49:
                slice_50 = processed_data[i - 49: i + 1]
                ma50 = round(sum(d['close'] for d in slice_50) / 50, 2)
                
            # RSI
            if i >= 14:
                changes = []
                for j in range(i - 13, i + 1):
                    changes.append(processed_data[j]['close'] - processed_data[j - 1]['close'])
                    
                gains = sum(c for c in changes if c > 0) / 14
                losses = abs(sum(c for c in changes if c < 0)) / 14
                
                rs = 100 if losses == 0 else gains / losses
                rsi = round(100 - (100 / (1 + rs)), 2)
                
            item_copy = dict(item)
            item_copy.update({'ma20': ma20, 'ma50': ma50, 'rsi': rsi})
            with_indicators.append(item_copy)
            
        return with_indicators
    except Exception as e:
        print(f"Error fetching historical data for {symbol}: {e}")
        raise

@app.route('/')
def serve_index():
    return app.send_static_file('index.html')

@app.route('/api/quote/<symbol>')
def quote(symbol):
    try:
        data = get_stock_quote(symbol.upper())
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/history/<symbol>')
def history(symbol):
    try:
        rng = request.args.get('range', '1mo')
        range_config = {
            '1d': {'range': '1d', 'interval': '5m'},
            '1mo': {'range': '1mo', 'interval': '1d'},
            '1y': {'range': '1y', 'interval': '1wk'},
            '5y': {'range': '5y', 'interval': '1mo'}
        }
        
        config = range_config.get(rng, range_config['1mo'])
        data = get_historical_data(symbol.upper(), config['interval'], config['range'])
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/news/<symbol>')
def news(symbol):
    try:
        url = f"{YAHOO_FINANCE_API}/v10/finance/quoteSummary/{symbol.upper()}?modules=news"
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        news_items = data['quoteSummary']['result'][0].get('news', [])
        return jsonify(news_items[:10])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/stocks')
def stocks():
    try:
        symbols = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'NVDA', 'META']
        results = []
        for symbol in symbols:
            try:
                data = get_stock_quote(symbol)
                result = {'symbol': symbol}
                if 'price' in data:
                    result.update(data['price'])
                if 'summaryDetail' in data:
                    result.update(data['summaryDetail'])
                results.append(result)
            except Exception:
                pass
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    app.run(debug=True, port=port, host='0.0.0.0')
