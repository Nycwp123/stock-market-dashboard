
# 📈 Stock Market Dashboard

A modern, interactive stock market dashboard built with Node.js and vanilla JavaScript that displays real-time stock data from Yahoo Finance with advanced technical analysis indicators.

## Features

### 📊 Core Functionality
- **Real-time Stock Data**: Display current price, change, and market statistics for any stock
- **Interactive Charts**: Beautiful, responsive charts showing stock price movements
- **Multiple Timeframes**: View data for 1 Day, 1 Month, 1 Year, and 5 Years
- **Popular Stocks**: Quick access to major stocks (AAPL, GOOGL, MSFT, TSLA, AMZN, NVDA)
- **Search Functionality**: Search for any stock symbol with autocomplete suggestions

### 📈 Technical Indicators
- **Moving Average 20 (MA20)**: 20-day moving average indicator
- **Moving Average 50 (MA50)**: 50-day moving average indicator
- **RSI (14)**: Relative Strength Index with 14-day period
- **Volume**: Trading volume visualization on the chart
- **Hover Details**: Detailed information when hovering over chart points

### 📰 News Section
- **Latest News**: Display up to 6 latest news articles for the selected stock
- **Easy Navigation**: Direct links to full articles with timestamps

### 🎨 User Interface
- Clean, modern design with responsive layout
- Color-coded positive (green) and negative (red) indicators
- Intuitive tab navigation for switching between stocks
- Mobile-friendly responsive design
- Smooth animations and transitions

## Tech Stack

### Backend
- **Node.js** - Server runtime
- **Express.js** - Web framework
- **Axios** - HTTP client for API calls
- **CORS** - Cross-origin resource sharing
- **dotenv** - Environment variable management

### Frontend
- **HTML5** - Markup
- **CSS3** - Styling with modern grid and flexbox
- **Vanilla JavaScript** - No framework, pure JS functionality
- **Chart.js** - Chart library with plugins
- **date-fns** - Date formatting utilities

### Data Source
- **Yahoo Finance API** - Real-time and historical stock data

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Setup Steps

1. **Clone the repository**
```bash
git clone <repository-url>
cd stock-market-dashboard
```

2. **Install dependencies**
```bash
npm install
```

3. **Create environment file**
```bash
cp .env.example .env
```

4. **Start the server**
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

5. **Open in browser**
Navigate to `http://localhost:3000`

## Project Structure

```
stock-market-dashboard/
├── public/
│   ├── index.html       # Main dashboard HTML
│   ├── styles.css       # Dashboard styling
│   └── script.js        # Frontend JavaScript
├── server.js            # Express server and API routes
├── package.json         # Dependencies configuration
├── .env.example         # Environment variables template
├── .gitignore          # Git ignore rules
└── README.md           # This file
```

## API Endpoints

### Get Stock Quote
```
GET /api/quote/:symbol
```
Returns current price, change, and market data for a stock.

**Example:**
```bash
curl http://localhost:3000/api/quote/AAPL
```

### Get Historical Data
```
GET /api/history/:symbol?range=1mo
```
Returns historical price data with technical indicators (MA20, MA50, RSI).

**Query Parameters:**
- `range`: `1d`, `1mo`, `1y`, or `5y` (default: `1mo`)

**Example:**
```bash
curl http://localhost:3000/api/history/AAPL?range=1y
```

### Get Stock News
```
GET /api/news/:symbol
```
Returns the latest news articles for a stock.

**Example:**
```bash
curl http://localhost:3000/api/news/AAPL
```

### Get Multiple Stocks
```
GET /api/stocks
```
Returns data for popular stocks (AAPL, GOOGL, MSFT, TSLA, AMZN, NVDA).

**Example:**
```bash
curl http://localhost:3000/api/stocks
```

## Usage Guide

### Viewing a Stock
1. Click on any stock tab on the left sidebar (AAPL, GOOGL, MSFT, etc.)
2. The chart and information will update automatically

### Searching for a Stock
1. Type a stock symbol in the search box (e.g., "TSLA")
2. Click "Search" or press Enter
3. The dashboard will load data for that stock

### Changing Time Period
1. Click one of the time range buttons: **1D**, **1M**, **1Y**, **5Y**
2. The chart will update to show data for that period

### Reading Technical Indicators
- **MA20/MA50**: Orange and red dashed lines on the chart showing moving averages
- **RSI**: Displayed in the indicators section (values 0-100, 70+ = overbought, 30- = oversold)
- **Volume**: Gray bars at the bottom of the chart showing trading volume

### Viewing Stock Details
- **Current Price**: Large number at the top left
- **Price Change**: Green (positive) or red (negative) percentage change
- **52W High/Low**: 52-week price range
- **Market Cap**: Total market capitalization

## Technical Indicators Explained

### Moving Average (MA)
- **MA20**: Average price over the last 20 days - helps identify short-term trends
- **MA50**: Average price over the last 50 days - helps identify medium-term trends
- When MA20 crosses above MA50, it can signal an uptrend (Golden Cross)
- When MA20 crosses below MA50, it can signal a downtrend (Death Cross)

### RSI (Relative Strength Index)
- Values from 0 to 100
- **Below 30**: Stock may be oversold (potential buying opportunity)
- **Above 70**: Stock may be overbought (potential selling opportunity)
- **30-70**: Neutral zone

### Volume
- Shows the number of shares traded in each time period
- High volume can confirm price movements
- Low volume can suggest weak price movements

## Configuration

### Environment Variables
Edit `.env` file to configure:
```
PORT=3000                    # Server port
NODE_ENV=development         # Environment (development/production)
```

## Browser Compatibility

- Chrome (recommended)
- Firefox
- Safari
- Edge
- Mobile browsers (responsive design)

## Troubleshooting

### API calls returning 404
- Check that the stock symbol is valid (uppercase)
- Verify the server is running on the correct port
- Check browser console for error messages

### Chart not displaying
- Ensure Chart.js library is loaded (check browser console)
- Try refreshing the page
- Clear browser cache

### News section empty
- Yahoo Finance API may have rate limits
- Try refreshing after a few minutes
- Check browser console for API errors

### Server won't start
- Ensure port 3000 is not already in use
- Check that Node.js is installed correctly
- Verify all dependencies are installed with `npm install`

## Performance Notes

- Charts use responsive rendering and update efficiently
- API calls are debounced to prevent excessive requests
- Historical data is cached in browser state
- Images and assets are minified in production

## Future Enhancements

- [ ] Add more technical indicators (Bollinger Bands, MACD)
- [ ] Implement watchlist feature with local storage
- [ ] Add price alerts and notifications
- [ ] Portfolio tracking functionality
- [ ] Export chart as image
- [ ] Dark mode theme
- [ ] Real-time WebSocket updates
- [ ] Cryptocurrency support
- [ ] Multiple chart types (candlestick, OHLC)
- [ ] Compare multiple stocks side-by-side

## Disclaimer

This dashboard is for educational and informational purposes only. It displays real market data but should not be used as the sole basis for investment decisions. Always do your own research and consult with a financial advisor before making investment decisions.

## License

MIT License - feel free to use and modify this project

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues, questions, or suggestions, please open an issue on GitHub.

---

**Happy Trading! 📊📈**
