# ZEUS: Stock Market Dashboard

An interactive, real-time stock market dashboard built with Python and Flask, integrating the Yahoo Finance API. Track and analyze stocks with detailed charts, technical indicators, and news — all in a modern, responsive web interface.

## Features

- Real-time stock price data and statistics (via Yahoo Finance)
- Historic price charts with technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands & more)
- Customizable watchlist and paper trading (virtual trading)
- Financial news aggregation
- Alerts for price/indicator/news triggers
- Support for stocks, indices, ETFs, forex, commodities, and crypto
- Responsive UI, suitable for desktop or mobile views

## Getting Started

### Prerequisites

- Python 3.8 or newer
- git (to clone the repo)

### Setup Instructions

1. **Clone the repository**
    ```bash
    git clone https://github.com/Nycwp123/stock-market-dashboard.git
    cd stock-market-dashboard
    ```

2. **Create and activate a virtual environment**  
   *(Recommended for isolation; skip if you use your own environment manager)*

    On MacOS/Linux:
    ```bash
    python3 -m venv .venv
    source .venv/bin/activate
    ```

    On Windows:
    ```cmd
    python -m venv .venv
    .venv\Scripts\activate
    ```

3. **Install Python dependencies**
    ```bash
    pip install -r requirements.txt
    ```

4. **Configure environment variables**
    If you need to set environment variables, copy the example file:
    ```bash
    cp .env.example .env
    ```
    (By default, you probably don’t need to change anything. The app will run on port 3000.)

5. **Run the application**
    ```bash
    python app.py
    ```
    By default, access the app by opening your browser to:  
    `http://localhost:3000`

    > If you want live reload during development, use `flask run` instead:
    > ```bash
    > export FLASK_APP=app.py   # (set in .env on Windows)
    > flask run
    > ```

## Usage

- Use the sidebar or search function to select stocks, indices, crypto, etc.
- View price charts, indicators, and statistics.
- Monitor/watchlist, receive alert notifications, and view related financial news.

## Project Structure

```text
stock-market-dashboard/
├── app.py              # Main Flask web application
├── requirements.txt    # Python dependencies
├── public/             # Static files (frontend: HTML, CSS, JS)
├── data/               # User/account/settings state (created after first launch)
├── templates/          # (if present) Jinja2 HTML templates for Flask
├── .env.example        # Environment variables sample
└── README.md           # This file
```

## Troubleshooting

- **Port already in use**: Change the `PORT` variable in `.env` and restart.
- **Module not found**: Ensure you activated your venv and installed requirements.
- **No data returned/404**: Check your internet, ensure symbols are correct, and server is running.

## Licensing

MIT License

---

Happy trading and experimenting!
