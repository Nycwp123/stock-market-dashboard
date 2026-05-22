const express = require('express');
const axios = require('axios');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const YAHOO_FINANCE_API = 'https://query1.finance.yahoo.com';

// Helper function to get stock quote
async function getStockQuote(symbol) {
  try {
    const response = await axios.get(`${YAHOO_FINANCE_API}/v10/finance/quoteSummary/${symbol}`, {
      params: {
        modules: 'price,summaryDetail'
      }
    });
    return response.data.quoteSummary.result[0];
  } catch (error) {
    console.error(`Error fetching stock data for ${symbol}:`, error.message);
    throw error;
  }
}

// Get historical price data with technical indicators
async function getHistoricalData(symbol, interval = '1d', range = '1mo') {
  try {
    const response = await axios.get(`${YAHOO_FINANCE_API}/v8/finance/chart/${symbol}`, {
      params: {
        interval: interval,
        range: range
      }
    });
    
    const chart = response.data.chart.result[0];
    const timestamps = chart.timestamp;
    const quotes = chart.indicators.quote[0];
    
    // Process data with calculations
    const processedData = timestamps.map((time, index) => {
      return {
        date: new Date(time * 1000).toISOString(),
        timestamp: time,
        open: parseFloat(quotes.open[index].toFixed(2)),
        close: parseFloat(quotes.close[index].toFixed(2)),
        high: parseFloat(quotes.high[index].toFixed(2)),
        low: parseFloat(quotes.low[index].toFixed(2)),
        volume: quotes.volume[index]
      };
    });
    
    // Calculate Moving Averages and RSI
    const withIndicators = processedData.map((item, index, arr) => {
      let ma20 = null;
      let ma50 = null;
      
      // MA20
      if (index >= 19) {
        ma20 = parseFloat((arr.slice(index - 19, index + 1).reduce((sum, d) => sum + d.close, 0) / 20).toFixed(2));
      }
      
      // MA50
      if (index >= 49) {
        ma50 = parseFloat((arr.slice(index - 49, index + 1).reduce((sum, d) => sum + d.close, 0) / 50).toFixed(2));
      }
      
      // RSI (14 period)
      let rsi = null;
      if (index >= 14) {
        const changes = [];
        for (let i = index - 13; i <= index; i++) {
          changes.push(arr[i].close - arr[i - 1].close);
        }
        
        const gains = changes.filter(c => c > 0).reduce((sum, c) => sum + c, 0) / 14;
        const losses = Math.abs(changes.filter(c => c < 0).reduce((sum, c) => sum + c, 0)) / 14;
        
        const rs = losses === 0 ? 100 : gains / losses;
        rsi = parseFloat((100 - (100 / (1 + rs))).toFixed(2));
      }
      
      return { ...item, ma20, ma50, rsi };
    });
    
    return withIndicators;
  } catch (error) {
    console.error(`Error fetching historical data for ${symbol}:`, error.message);
    throw error;
  }
}

// API Routes

// Get stock quote
app.get('/api/quote/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await getStockQuote(symbol.toUpperCase());
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get historical data with timeframe
app.get('/api/history/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { range = '1mo' } = req.query;
    
    // Map user-friendly ranges to API ranges and intervals
    const rangeConfig = {
      '1d': { range: '1d', interval: '5m' },
      '1mo': { range: '1mo', interval: '1d' },
      '1y': { range: '1y', interval: '1wk' },
      '5y': { range: '5y', interval: '1mo' }
    };
    
    const config = rangeConfig[range] || rangeConfig['1mo'];
    const data = await getHistoricalData(symbol.toUpperCase(), config.interval, config.range);
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get news for a stock
app.get('/api/news/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const response = await axios.get(`${YAHOO_FINANCE_API}/v10/finance/quoteSummary/${symbol.toUpperCase()}`, {
      params: {
        modules: 'news'
      }
    });
    
    const news = response.data.quoteSummary.result[0].news || [];
    res.json(news.slice(0, 10)); // Return top 10 news items
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get multiple popular stocks
app.get('/api/stocks', async (req, res) => {
  try {
    const symbols = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN', 'NVDA', 'META'];
    const promises = symbols.map(symbol => 
      getStockQuote(symbol)
        .then(data => ({
          symbol,
          ...data.price,
          ...data.summaryDetail
        }))
        .catch(() => null)
    );
    const results = await Promise.all(promises);
    
    res.json(results.filter(r => r !== null));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Stock Market Dashboard Server running on http://localhost:${PORT}`);
});
